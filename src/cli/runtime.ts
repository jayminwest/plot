// Shared CLI runtime: argv parsing, actor resolution, store construction, IO.
//
// Each command module is a plain async function that takes a `CliContext`
// (raw argv tail + IO + env) and returns an exit code. Commands parse their
// own argv via `parseArgs` with a command-specific `ArgSpec`. The runtime
// helpers keep command modules free of process-level globals so they're
// testable end-to-end against in-memory directories and captured streams.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { type Actor, isActor, parseActor } from "../actor.ts";
import { assertPlotId } from "../id.ts";
import { SQLitePlotIndex } from "../sqlite-index.ts";
import { PlotStore } from "../store.ts";

// ---------------------------------------------------------------------------
// Argv parser

export interface ParsedArgs {
	positional: string[];
	flags: Record<string, string | string[] | boolean>;
}

export interface ArgSpec {
	// Repeatable flags collect into string[]. Boolean flags don't consume the
	// next token. Anything not listed is treated as a single-value string flag.
	repeated?: readonly string[];
	boolean?: readonly string[];
	aliases?: Readonly<Record<string, string>>;
}

// Parse `argv` slice (post-command) into positional + flags. Supports
// `--flag value`, `--flag=value`, `-x value`, and `--bool` shapes.
export function parseArgs(argv: readonly string[], spec: ArgSpec = {}): ParsedArgs {
	const repeated = new Set(spec.repeated ?? []);
	const booleans = new Set(spec.boolean ?? []);
	const aliases = spec.aliases ?? {};

	const positional: string[] = [];
	const flags: Record<string, string | string[] | boolean> = {};

	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i] ?? "";
		if (tok === "--") {
			for (let j = i + 1; j < argv.length; j++) {
				const t = argv[j];
				if (t !== undefined) positional.push(t);
			}
			break;
		}
		if (tok.startsWith("--") || (tok.startsWith("-") && tok.length > 1 && !/^-\d/.test(tok))) {
			let name: string;
			let value: string | undefined;
			const eq = tok.indexOf("=");
			if (eq >= 0) {
				name = tok.slice(tok.startsWith("--") ? 2 : 1, eq);
				value = tok.slice(eq + 1);
			} else {
				name = tok.slice(tok.startsWith("--") ? 2 : 1);
			}
			const canonical = aliases[name] ?? name;
			if (booleans.has(canonical)) {
				flags[canonical] = true;
				continue;
			}
			if (value === undefined) {
				value = argv[i + 1];
				if (value === undefined) {
					throw new Error(`flag --${canonical} requires a value`);
				}
				i++;
			}
			if (repeated.has(canonical)) {
				const prev = flags[canonical];
				if (Array.isArray(prev)) prev.push(value);
				else flags[canonical] = [value];
			} else {
				flags[canonical] = value;
			}
			continue;
		}
		positional.push(tok);
	}

	return { positional, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
	const v = args.flags[name];
	if (typeof v === "string") return v;
	if (v === undefined) return undefined;
	throw new Error(`flag --${name} expected a single string value`);
}

export function flagStringArray(args: ParsedArgs, name: string): string[] {
	const v = args.flags[name];
	if (v === undefined) return [];
	if (Array.isArray(v)) return v;
	if (typeof v === "string") return [v];
	throw new Error(`flag --${name} expected string values`);
}

export function flagBool(args: ParsedArgs, name: string): boolean {
	return args.flags[name] === true;
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
	return name in args.flags;
}

// ---------------------------------------------------------------------------
// IO + context

export interface CliIO {
	out(text: string): void;
	err(text: string): void;
}

export interface CliEnv {
	get(name: string): string | undefined;
}

export function processIO(): CliIO {
	return {
		out: (t) => {
			process.stdout.write(t);
		},
		err: (t) => {
			process.stderr.write(t);
		},
	};
}

export function processEnv(): CliEnv {
	return { get: (name) => process.env[name] };
}

export interface CliContext {
	// Raw argv tail (after the command name). Commands run parseArgs with their
	// own spec — keeps each command's grammar local to its module.
	argv: readonly string[];
	io: CliIO;
	env: CliEnv;
}

// ---------------------------------------------------------------------------
// Actor resolution — SPEC §12.4
//
// PLOT_ACTOR wins. Falls back to user:<handle> derived from `git config
// user.email` (handle = part before "@", sanitized to the actor alphabet).

const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function resolveActor(env: CliEnv): Actor {
	const explicit = env.get("PLOT_ACTOR");
	if (explicit) {
		if (!isActor(explicit)) {
			throw new Error(
				`PLOT_ACTOR=${JSON.stringify(explicit)} is not a valid actor (expected user:<handle> or agent:<name>[:<run-id>])`,
			);
		}
		return parseActor(explicit);
	}
	const handle = gitUserHandle();
	if (!handle) {
		throw new Error(
			"could not resolve actor: set PLOT_ACTOR (e.g. user:jw) or configure git user.email",
		);
	}
	return parseActor(`user:${handle}`);
}

function gitUserHandle(): string | undefined {
	const result = spawnSync("git", ["config", "--get", "user.email"], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return undefined;
	const email = result.stdout.trim();
	if (!email) return undefined;
	const local = email.split("@")[0] ?? "";
	// Replace runs of unsupported chars with `-`; trim leading non-alphanum.
	const cleaned = local.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
	if (!HANDLE_RE.test(cleaned)) return undefined;
	return cleaned;
}

// ---------------------------------------------------------------------------
// Plot ID resolution — SPEC §9.2.
//
// Agent-facing commands (`plot get`, `plot append`) discover the target Plot
// from one of three sources, in priority order:
//   1. positional `<id>` argument
//   2. `--plot <id>` flag
//   3. `PLOT_ID` env var (set by orchestrators on dispatch)
// Returns the validated Plot ID or throws a usage-style Error.

export function resolvePlotId(
	args: ParsedArgs,
	env: CliEnv,
	opts: { positionalIndex?: number } = {},
): string {
	const idx = opts.positionalIndex ?? 0;
	const positional = args.positional[idx];
	const fromFlag = flagString(args, "plot");
	const fromEnv = env.get("PLOT_ID");
	const id = positional ?? fromFlag ?? fromEnv;
	if (!id) {
		throw new Error("no Plot ID — pass <id>, --plot <id>, or set PLOT_ID");
	}
	assertPlotId(id);
	return id;
}

// ---------------------------------------------------------------------------
// Store construction

export interface StoreEnv {
	dir: string;
	actor: Actor;
}

export function resolveStoreEnv(env: CliEnv): StoreEnv {
	const dir = env.get("PLOT_DIR") ?? ".plot";
	const actor = resolveActor(env);
	return { dir, actor };
}

// CLI invocations build a per-process PlotStore against `.plot/` (or PLOT_DIR
// if set) backed by a SQLitePlotIndex at `<dir>/.index.db`. `withStore`
// closes the index after the command completes so tests don't leak file
// descriptors.
export async function withStore<T>(
	env: CliEnv,
	fn: (store: PlotStore, dir: string) => Promise<T>,
): Promise<T> {
	const { dir, actor } = resolveStoreEnv(env);
	const index = new SQLitePlotIndex(join(dir, ".index.db"));
	const store = new PlotStore({ dir, index, actor });
	try {
		return await fn(store, dir);
	} finally {
		index.close();
	}
}
