// Plot file IO layer (SPEC §4).
//
// Two-files-per-Plot model: `pl-xxx.json` (low write rate, pretty-printed,
// sorted keys, atomically replaced) and `pl-xxx.events.jsonl` (high write
// rate, append-only, one JSON object per line). All mutating operations
// hold a per-file advisory lock so concurrent writers in the same process
// can't interleave.
//
// This module is intentionally narrow: it does no schema validation, no
// migration, and no actor checks. PlotStore composes it with those layers.

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type WithFileLockOptions, withFileLock } from "./lock.ts";

// ---------------------------------------------------------------------------
// Path helpers

export function plotJsonPath(dir: string, id: string): string {
	return join(dir, `${id}.json`);
}

export function plotEventsPath(dir: string, id: string): string {
	return join(dir, `${id}.events.jsonl`);
}

const PLOT_JSON_RE = /^(pl-[a-z0-9]{8})\.json$/;

// List Plot IDs by scanning the directory for `pl-xxx.json` files. Missing
// directories return an empty list — first-time `plot init` callers shouldn't
// need to special-case this.
export async function listPlotIds(dir: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const ids: string[] = [];
	for (const name of entries) {
		const m = name.match(PLOT_JSON_RE);
		if (m?.[1]) ids.push(m[1]);
	}
	ids.sort();
	return ids;
}

// ---------------------------------------------------------------------------
// Stable JSON serialization
//
// SPEC §4.2: pretty-printed JSON with sorted keys for clean semantic diffs in
// git. We recursively sort object keys and use a 2-space indent. Arrays keep
// their natural order — semantic order of e.g. `attachments` is caller-owned.

function sortKeysDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep) as unknown as T;
	}
	if (value && typeof value === "object") {
		const obj = value as unknown as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(obj).sort()) {
			sorted[k] = sortKeysDeep(obj[k]);
		}
		return sorted as unknown as T;
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// JSON read / atomic write

export interface ReadJsonOptions {
	// When the file is missing, return this value instead of throwing.
	// Distinguishes "no file" from "empty file" — callers that want a hard
	// error on missing should not pass this.
	defaultIfMissing?: unknown;
}

export async function readJson<T = unknown>(path: string, opts: ReadJsonOptions = {}): Promise<T> {
	let raw: string;
	try {
		raw = await readFile(path, "utf-8");
	} catch (err) {
		if ("defaultIfMissing" in opts && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return opts.defaultIfMissing as T;
		}
		throw err;
	}
	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(`Malformed JSON at ${path}: ${reason}`);
	}
}

// Atomic write: serialize to a sibling tmp file, fsync-on-rename via
// `rename(2)`. A reader who opens `path` either sees the previous full
// version or the new full version — never a half-written file.
export async function writeJsonAtomic(
	path: string,
	value: unknown,
	opts: WithFileLockOptions = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const content = stableStringify(value);
	await withFileLock(path, () => atomicReplace(path, content), opts);
}

// Variant for callers that already hold `withFileLock(path)`. Re-acquiring
// the same lock would deadlock against ourselves; PlotStore uses this from
// inside its outer transaction lock.
export async function writeJsonAtomicWithinLock(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await atomicReplace(path, stableStringify(value));
}

async function atomicReplace(path: string, content: string): Promise<void> {
	const tmpPath = `${path}.tmp.${randomBytes(8).toString("hex")}`;
	await writeFile(tmpPath, content, "utf-8");
	try {
		await rename(tmpPath, path);
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			/* best-effort cleanup */
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// JSONL append / read
//
// Append is the high-frequency path (every agent event). We hold the lock on
// the events file itself — not a sibling — so a concurrent `readEvents`
// caller doesn't have to coordinate, but two concurrent appenders serialize.

export async function appendEvent(
	path: string,
	event: unknown,
	opts: WithFileLockOptions = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const serialized = JSON.stringify(event);
	if (serialized.includes("\n")) {
		// JSON.stringify never emits raw newlines, but a caller could hand us a
		// pre-serialized string with embedded newlines. Catch that here rather
		// than silently corrupting the JSONL framing.
		throw new Error("appendEvent: serialized event contains a newline");
	}
	const line = `${serialized}\n`;

	await withFileLock(
		path,
		async () => {
			await appendFile(path, line, "utf-8");
		},
		opts,
	);
}

// Variant for callers that already hold a coordinating lock (e.g. the
// sibling JSON file's lock from a PlotStore transaction). Skips the
// per-events-file lock to avoid blocking against ourselves.
export async function appendEventWithinLock(path: string, event: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const serialized = JSON.stringify(event);
	if (serialized.includes("\n")) {
		throw new Error("appendEventWithinLock: serialized event contains a newline");
	}
	await appendFile(path, `${serialized}\n`, "utf-8");
}

export interface ReadEventsOptions {
	// When the file is missing, return [] instead of throwing.
	missingIsEmpty?: boolean;
}

export async function readEvents<T = unknown>(
	path: string,
	opts: ReadEventsOptions = {},
): Promise<T[]> {
	let raw: string;
	try {
		raw = await readFile(path, "utf-8");
	} catch (err) {
		if (opts.missingIsEmpty && (err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const out: T[] = [];
	const lines = raw.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(line) as T);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
			throw new Error(`Malformed JSONL at ${path}:${i + 1}: ${reason}. Line: ${preview}`);
		}
	}
	return out;
}
