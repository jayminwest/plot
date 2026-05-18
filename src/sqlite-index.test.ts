import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plotJsonPath, writeJsonAtomic } from "./io.ts";
import { SQLitePlotIndex } from "./sqlite-index.ts";
import { type Plot, type PlotStatus, SCHEMA_VERSION } from "./types.ts";

function makePlot(overrides: Partial<Plot> = {}): Plot {
	return {
		schema_version: SCHEMA_VERSION,
		id: "plot-aaaaaaaa",
		name: "A plot",
		status: "drafting",
		created_at: "2026-05-17T10:00:00Z",
		updated_at: "2026-05-17T10:00:00Z",
		intent: { goal: "", non_goals: [], constraints: [], success_criteria: [] },
		attachments: [],
		...overrides,
	};
}

let dir: string;
let dbPath: string;
let index: SQLitePlotIndex;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-idx-"));
	dbPath = join(dir, ".index.db");
	index = new SQLitePlotIndex(dbPath);
});
afterEach(async () => {
	index.close();
	await rm(dir, { recursive: true, force: true });
});

async function seedFile(plot: Plot): Promise<void> {
	await writeJsonAtomic(plotJsonPath(dir, plot.id), plot);
}

describe("constructor", () => {
	test("creates the parent directory and DB file on disk", () => {
		// beforeEach already created it; just assert it isn't :memory:.
		expect(dbPath.endsWith(".index.db")).toBe(true);
	});

	test("supports :memory: for ephemeral usage", async () => {
		const mem = new SQLitePlotIndex(":memory:");
		try {
			expect(await mem.query()).toEqual({ rows: [], total: 0 });
		} finally {
			mem.close();
		}
	});
});

describe("upsert / query", () => {
	test("upsert inserts a Plot and query returns the projected row", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", name: "First", status: "ready" }));
		const result = await index.query();
		expect(result.total).toBe(1);
		expect(result.rows).toEqual([
			{
				id: "plot-aaaaaaaa",
				name: "First",
				status: "ready",
				created_at: "2026-05-17T10:00:00Z",
				updated_at: "2026-05-17T10:00:00Z",
			},
		]);
	});

	test("upsert on an existing id updates instead of duplicating", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", name: "v1" }));
		await index.upsert(
			makePlot({ id: "plot-aaaaaaaa", name: "v2", updated_at: "2026-05-17T12:00:00Z" }),
		);
		const result = await index.query();
		expect(result.total).toBe(1);
		expect(result.rows[0]?.name).toBe("v2");
		expect(result.rows[0]?.updated_at).toBe("2026-05-17T12:00:00Z");
	});

	test("filters by status (single value and array)", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", status: "drafting" }));
		await index.upsert(makePlot({ id: "plot-bbbbbbbb", status: "ready" }));
		await index.upsert(makePlot({ id: "plot-cccccccc", status: "done" }));

		const ready = await index.query({ status: "ready" });
		expect(ready.rows.map((r) => r.id)).toEqual(["plot-bbbbbbbb"]);

		const multi = await index.query({ status: ["ready", "done"] });
		expect(multi.rows.map((r) => r.id).sort()).toEqual(["plot-bbbbbbbb", "plot-cccccccc"]);
	});

	test("filters by id list", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		await index.upsert(makePlot({ id: "plot-bbbbbbbb" }));
		await index.upsert(makePlot({ id: "plot-cccccccc" }));

		const result = await index.query({ ids: ["plot-aaaaaaaa", "plot-cccccccc"] });
		expect(result.rows.map((r) => r.id).sort()).toEqual(["plot-aaaaaaaa", "plot-cccccccc"]);
	});

	test("empty ids array matches nothing without round-tripping SQL", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		expect(await index.query({ ids: [] })).toEqual({ rows: [], total: 0 });
	});

	test("updatedSince filters by ISO timestamp", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", updated_at: "2026-05-15T00:00:00Z" }));
		await index.upsert(makePlot({ id: "plot-bbbbbbbb", updated_at: "2026-05-17T00:00:00Z" }));
		await index.upsert(makePlot({ id: "plot-cccccccc", updated_at: "2026-05-18T00:00:00Z" }));

		const result = await index.query({ updatedSince: "2026-05-17T00:00:00Z" });
		expect(result.rows.map((r) => r.id).sort()).toEqual(["plot-bbbbbbbb", "plot-cccccccc"]);
	});

	test("orders by updated_at desc by default", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", updated_at: "2026-05-15T00:00:00Z" }));
		await index.upsert(makePlot({ id: "plot-bbbbbbbb", updated_at: "2026-05-17T00:00:00Z" }));
		await index.upsert(makePlot({ id: "plot-cccccccc", updated_at: "2026-05-16T00:00:00Z" }));

		const result = await index.query();
		expect(result.rows.map((r) => r.id)).toEqual([
			"plot-bbbbbbbb",
			"plot-cccccccc",
			"plot-aaaaaaaa",
		]);
	});

	test("supports custom orderBy + orderDir", async () => {
		await index.upsert(makePlot({ id: "plot-bbbbbbbb" }));
		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		await index.upsert(makePlot({ id: "plot-cccccccc" }));

		const result = await index.query({ orderBy: "id", orderDir: "asc" });
		expect(result.rows.map((r) => r.id)).toEqual([
			"plot-aaaaaaaa",
			"plot-bbbbbbbb",
			"plot-cccccccc",
		]);
	});

	test("paginates with limit/offset and reports total before paging", async () => {
		for (const id of ["plot-aaaaaaaa", "plot-bbbbbbbb", "plot-cccccccc", "plot-dddddddd"]) {
			await index.upsert(makePlot({ id, updated_at: `2026-05-17T${id.slice(-2)}:00:00Z` }));
		}
		const page = await index.query({ orderBy: "id", orderDir: "asc", limit: 2, offset: 1 });
		expect(page.total).toBe(4);
		expect(page.rows.map((r) => r.id)).toEqual(["plot-bbbbbbbb", "plot-cccccccc"]);
	});
});

describe("remove", () => {
	test("deletes the row and subsequent queries no longer see it", async () => {
		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		await index.upsert(makePlot({ id: "plot-bbbbbbbb" }));

		await index.remove("plot-aaaaaaaa");
		const result = await index.query();
		expect(result.rows.map((r) => r.id)).toEqual(["plot-bbbbbbbb"]);
	});

	test("removing a missing id is a no-op", async () => {
		await index.remove("plot-zzzzzzzz");
		expect(await index.query()).toEqual({ rows: [], total: 0 });
	});
});

describe("rebuild (SPEC §4.1, §5.4 invariant)", () => {
	test("rebuilds an empty index from a directory of Plot files", async () => {
		await seedFile(makePlot({ id: "plot-aaaaaaaa", name: "Alpha", status: "ready" }));
		await seedFile(makePlot({ id: "plot-bbbbbbbb", name: "Beta", status: "drafting" }));

		await index.rebuild(dir);
		const result = await index.query({ orderBy: "id", orderDir: "asc" });
		expect(result.rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
	});

	test("wiping the DB and rebuilding reproduces identical query results", async () => {
		await seedFile(makePlot({ id: "plot-aaaaaaaa", name: "Alpha", status: "ready" }));
		await seedFile(
			makePlot({
				id: "plot-bbbbbbbb",
				name: "Beta",
				status: "active",
				updated_at: "2026-05-18T00:00:00Z",
			}),
		);
		await seedFile(makePlot({ id: "plot-cccccccc", name: "Gamma", status: "done" }));

		await index.rebuild(dir);
		const before = await index.query({ orderBy: "id", orderDir: "asc" });

		// Simulate `.plot/.index.db` getting blown away. WAL mode also writes
		// sibling `-wal` / `-shm` files; clear all three so we're truly starting
		// from a clean slate.
		index.close();
		await rm(dbPath, { force: true });
		await rm(`${dbPath}-wal`, { force: true });
		await rm(`${dbPath}-shm`, { force: true });
		index = new SQLitePlotIndex(dbPath);
		await index.rebuild(dir);

		const after = await index.query({ orderBy: "id", orderDir: "asc" });
		expect(after).toEqual(before);
	});

	test("rebuild replaces previous rows (no stale entries)", async () => {
		await index.upsert(makePlot({ id: "plot-stalexyz" as string, name: "stale" } as Partial<Plot>));
		// plot-stalexyz isn't on disk; rebuild should drop it.
		await seedFile(makePlot({ id: "plot-aaaaaaaa", name: "Alpha" }));
		await index.rebuild(dir);

		const result = await index.query();
		expect(result.rows.map((r) => r.id)).toEqual(["plot-aaaaaaaa"]);
	});

	test("rebuild on a missing directory leaves the index empty", async () => {
		await index.rebuild(join(dir, "absent"));
		expect(await index.query()).toEqual({ rows: [], total: 0 });
	});
});

describe("subscribe", () => {
	test("fires on upsert for the matching Plot only", async () => {
		const calls: string[] = [];
		const unsub = index.subscribe("plot-aaaaaaaa", () => calls.push("a"));
		index.subscribe("plot-bbbbbbbb", () => calls.push("b"));

		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		expect(calls).toEqual(["a"]);

		await index.upsert(makePlot({ id: "plot-bbbbbbbb" }));
		expect(calls).toEqual(["a", "b"]);

		unsub();
		await index.upsert(makePlot({ id: "plot-aaaaaaaa", name: "v2" }));
		expect(calls).toEqual(["a", "b"]); // unsubscribed
	});

	test("fires on remove", async () => {
		let fired = 0;
		index.subscribe("plot-aaaaaaaa", () => {
			fired += 1;
		});
		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		await index.remove("plot-aaaaaaaa");
		expect(fired).toBe(2);
	});

	test("fires on rebuild for every Plot present after rebuild", async () => {
		const fired = new Set<string>();
		index.subscribe("plot-aaaaaaaa", () => fired.add("a"));
		index.subscribe("plot-bbbbbbbb", () => fired.add("b"));

		await seedFile(makePlot({ id: "plot-aaaaaaaa" }));
		await seedFile(makePlot({ id: "plot-bbbbbbbb" }));
		await index.rebuild(dir);

		expect(fired).toEqual(new Set(["a", "b"]));
	});

	test("fires on rebuild for a watched Plot that disappeared", async () => {
		let fired = 0;
		index.subscribe("plot-vanished" as string, () => {
			fired += 1;
		});

		await seedFile(makePlot({ id: "plot-aaaaaaaa" }));
		await index.rebuild(dir);

		expect(fired).toBe(1);
	});

	test("unsubscribing during a callback does not skip remaining listeners", async () => {
		const order: string[] = [];
		let unsubA: (() => void) | undefined;
		unsubA = index.subscribe("plot-aaaaaaaa", () => {
			order.push("a");
			unsubA?.();
		});
		index.subscribe("plot-aaaaaaaa", () => order.push("b"));

		await index.upsert(makePlot({ id: "plot-aaaaaaaa" }));
		expect(order.sort()).toEqual(["a", "b"]);
	});
});

describe("close", () => {
	test("is idempotent", () => {
		const mem = new SQLitePlotIndex(":memory:");
		mem.close();
		expect(() => mem.close()).not.toThrow();
	});

	test("rejects further queries after close", async () => {
		const mem = new SQLitePlotIndex(":memory:");
		mem.close();
		await expect(mem.query()).rejects.toThrow(/closed/);
	});
});

describe("status-string round trip", () => {
	test("preserves every PlotStatus value through SQLite", async () => {
		const statuses: PlotStatus[] = ["drafting", "ready", "active", "done", "archived"];
		for (let i = 0; i < statuses.length; i++) {
			await index.upsert(
				makePlot({
					id: `plot-${"a".repeat(7)}${i}`,
					status: statuses[i] as PlotStatus,
				}),
			);
		}
		for (const s of statuses) {
			const r = await index.query({ status: s });
			expect(r.rows).toHaveLength(1);
			expect(r.rows[0]?.status).toBe(s);
		}
	});
});
