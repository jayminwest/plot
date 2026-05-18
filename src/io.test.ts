import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendEvent,
	listPlotIds,
	plotEventsPath,
	plotJsonPath,
	readEvents,
	readJson,
	stableStringify,
	writeJsonAtomic,
} from "./io.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-io-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("path helpers", () => {
	test("plotJsonPath / plotEventsPath produce the SPEC §4 layout", () => {
		expect(plotJsonPath(".plot", "plot-abc12345")).toBe(".plot/plot-abc12345.json");
		expect(plotEventsPath(".plot", "plot-abc12345")).toBe(".plot/plot-abc12345.events.jsonl");
	});
});

describe("stableStringify", () => {
	test("sorts object keys deeply", () => {
		const out = stableStringify({ b: 1, a: { d: 2, c: 3 } });
		expect(out).toBe(`{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n`);
	});

	test("preserves array order", () => {
		const out = stableStringify({ items: [{ b: 2, a: 1 }, "x"] });
		expect(out).toContain(`"items": [\n    {\n      "a": 1,\n      "b": 2\n    },\n    "x"\n  ]`);
	});

	test("emits a trailing newline", () => {
		expect(stableStringify({})).toBe("{}\n");
	});
});

describe("writeJsonAtomic / readJson", () => {
	test("round-trips and sorts keys on disk", async () => {
		const path = join(dir, "plot-abc12345.json");
		await writeJsonAtomic(path, { b: 1, a: 2 });

		const onDisk = await readFile(path, "utf-8");
		expect(onDisk).toBe(`{\n  "a": 2,\n  "b": 1\n}\n`);

		const parsed = await readJson<{ a: number; b: number }>(path);
		expect(parsed).toEqual({ a: 2, b: 1 });
	});

	test("creates parent directories on demand", async () => {
		const path = join(dir, "nested", "deeper", "plot-abc12345.json");
		await writeJsonAtomic(path, { ok: true });
		expect(await readJson<{ ok: boolean }>(path)).toEqual({ ok: true });
	});

	test("returns the default when the file is missing and a default was provided", async () => {
		const result = await readJson(join(dir, "nope.json"), { defaultIfMissing: null });
		expect(result).toBeNull();
	});

	test("throws on a missing file without defaultIfMissing", async () => {
		await expect(readJson(join(dir, "nope.json"))).rejects.toThrow();
	});

	test("throws a useful message on malformed JSON", async () => {
		const path = join(dir, "bad.json");
		await writeFile(path, "{not json", "utf-8");
		await expect(readJson(path)).rejects.toThrow(/Malformed JSON at .*bad\.json/);
	});

	test("leaves no .tmp.* siblings after a successful write", async () => {
		const path = join(dir, "plot-abc12345.json");
		await writeJsonAtomic(path, { ok: true });
		const entries = await readdir(dir);
		expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
		expect(entries.some((e) => e.endsWith(".lock"))).toBe(false);
	});

	test("serializes concurrent writes to the same file", async () => {
		const path = join(dir, "plot-abc12345.json");
		const writers = Array.from({ length: 8 }, (_, i) =>
			writeJsonAtomic(path, { i, marker: `v${i}` }),
		);
		await Promise.all(writers);
		const result = (await readJson(path)) as { i: number; marker: string };
		expect(result.marker).toBe(`v${result.i}`);
	});
});

describe("appendEvent / readEvents", () => {
	test("appends a single JSONL line per event", async () => {
		const path = join(dir, "plot-abc12345.events.jsonl");
		await appendEvent(path, { type: "plot_created", actor: "user:jw", at: "t0", data: {} });
		await appendEvent(path, { type: "note", actor: "user:jw", at: "t1", data: { text: "hi" } });

		const raw = await readFile(path, "utf-8");
		const lines = raw.split("\n");
		// Two JSON lines plus a trailing empty entry after the final \n.
		expect(lines).toHaveLength(3);
		expect(lines[2]).toBe("");

		const events = await readEvents<{ type: string }>(path);
		expect(events.map((e) => e.type)).toEqual(["plot_created", "note"]);
	});

	test("missingIsEmpty returns [] for a non-existent file", async () => {
		expect(await readEvents(join(dir, "missing.jsonl"), { missingIsEmpty: true })).toEqual([]);
	});

	test("skips blank lines in the JSONL stream", async () => {
		const path = join(dir, "blanks.jsonl");
		await writeFile(path, `{"a":1}\n\n{"a":2}\n\n`, "utf-8");
		const out = await readEvents<{ a: number }>(path);
		expect(out.map((e) => e.a)).toEqual([1, 2]);
	});

	test("reports file path and line number on malformed JSONL", async () => {
		const path = join(dir, "broken.jsonl");
		await writeFile(path, `{"a":1}\n{not json}\n`, "utf-8");
		await expect(readEvents(path)).rejects.toThrow(/Malformed JSONL at .*broken\.jsonl:2/);
	});

	test("serializes concurrent appends without interleaving lines", async () => {
		const path = join(dir, "concurrent.jsonl");
		const writers = Array.from({ length: 32 }, (_, i) =>
			appendEvent(path, { i, type: "note", actor: "user:jw", at: "t", data: {} }),
		);
		await Promise.all(writers);

		const events = await readEvents<{ i: number }>(path);
		expect(events.map((e) => e.i).sort((a, b) => a - b)).toEqual(
			Array.from({ length: 32 }, (_, i) => i),
		);
	});

	test("rejects serialized events that contain a newline", async () => {
		const path = join(dir, "newline.jsonl");
		// JSON.stringify normally escapes newlines, but verify the guard
		// rejects a hand-crafted object whose serialization would still embed
		// one if a caller monkey-patched JSON.stringify.
		const original = JSON.stringify;
		JSON.stringify = ((value: unknown) => `${original(value)}\nleaked`) as typeof JSON.stringify;
		try {
			await expect(appendEvent(path, { x: 1 })).rejects.toThrow(/contains a newline/);
		} finally {
			JSON.stringify = original;
		}
	});
});

describe("listPlotIds", () => {
	test("returns [] when the directory is missing", async () => {
		expect(await listPlotIds(join(dir, "absent"))).toEqual([]);
	});

	test("returns sorted Plot IDs and ignores unrelated files", async () => {
		await writeFile(join(dir, "plot-cccccccc.json"), "{}", "utf-8");
		await writeFile(join(dir, "plot-aaaaaaaa.json"), "{}", "utf-8");
		await writeFile(join(dir, "plot-bbbbbbbb.json"), "{}", "utf-8");
		await writeFile(join(dir, "plot-aaaaaaaa.events.jsonl"), "", "utf-8");
		await writeFile(join(dir, "README.md"), "", "utf-8");
		await writeFile(join(dir, ".index.db"), "", "utf-8");

		expect(await listPlotIds(dir)).toEqual(["plot-aaaaaaaa", "plot-bbbbbbbb", "plot-cccccccc"]);
	});
});
