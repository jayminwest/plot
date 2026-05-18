import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "./actor.ts";
import { isPlotId } from "./id.ts";
import { plotEventsPath, plotJsonPath, readJson } from "./io.ts";
import type { Migration } from "./migrations.ts";
import { SQLitePlotIndex } from "./sqlite-index.ts";
import { PlotStore } from "./store.ts";
import type { Plot, PlotEvent } from "./types.ts";

const USER: Actor = { kind: "user", handle: "jw", raw: "user:jw" };
const AGENT: Actor = {
	kind: "agent",
	name: "claude",
	runId: "run-1",
	raw: "agent:claude:run-1",
};

let dir: string;
let index: SQLitePlotIndex;
let clockNow: Date;

function makeStore(actor: Actor = USER): PlotStore {
	return new PlotStore({
		dir,
		index,
		actor,
		now: () => clockNow,
	});
}

function advanceClock(ms: number): void {
	clockNow = new Date(clockNow.getTime() + ms);
}

async function readEventLines(id: string): Promise<PlotEvent[]> {
	const raw = await readFile(plotEventsPath(dir, id), "utf-8");
	return raw
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l) as PlotEvent);
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-store-"));
	index = new SQLitePlotIndex(":memory:");
	clockNow = new Date("2026-05-17T10:00:00.000Z");
});

afterEach(async () => {
	index.close();
	await rm(dir, { recursive: true, force: true });
});

describe("create", () => {
	test("writes a Plot file, the plot_created event, and indexes it", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "Add OAuth" });
		expect(isPlotId(handle.id)).toBe(true);

		const plot = await handle.read();
		expect(plot).toEqual({
			schema_version: 1,
			id: handle.id,
			name: "Add OAuth",
			status: "drafting",
			created_at: "2026-05-17T10:00:00.000Z",
			updated_at: "2026-05-17T10:00:00.000Z",
			intent: { goal: "", non_goals: [], constraints: [], success_criteria: [] },
			attachments: [],
		});

		const events = await readEventLines(handle.id);
		expect(events).toEqual([
			{
				type: "plot_created",
				actor: "user:jw",
				at: "2026-05-17T10:00:00.000Z",
				data: { name: "Add OAuth" },
			},
		]);

		const result = await index.query();
		expect(result.total).toBe(1);
		expect(result.rows[0]?.id).toBe(handle.id);
	});

	test("rejects empty name", async () => {
		const store = makeStore();
		expect(store.create({ name: "" })).rejects.toThrow(/name is required/);
	});

	test("generates unique IDs across multiple creates", async () => {
		const store = makeStore();
		const a = await store.create({ name: "A" });
		advanceClock(1000);
		const b = await store.create({ name: "B" });
		expect(a.id).not.toBe(b.id);
		expect(await store.list()).toEqual([a.id, b.id].sort());
	});
});

describe("get", () => {
	test("returns a handle that reads the underlying Plot", async () => {
		const store = makeStore();
		const created = await store.create({ name: "X" });
		const handle = store.get(created.id);
		const plot = await handle.read();
		expect(plot.id).toBe(created.id);
	});

	test("validates Plot ID format", () => {
		const store = makeStore();
		expect(() => store.get("not-a-plot")).toThrow(/invalid Plot ID/);
	});

	test("read throws when Plot is missing", async () => {
		const store = makeStore();
		const handle = store.get("plot-aaaaaaaa");
		expect(handle.read()).rejects.toThrow(/not found/);
	});
});

describe("editIntent", () => {
	test("updates goal and emits intent_edited", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);

		const next = await handle.editIntent({ goal: "Ship OAuth" });
		expect(next.intent.goal).toBe("Ship OAuth");
		expect(next.updated_at).toBe("2026-05-17T10:00:01.000Z");

		const events = await readEventLines(handle.id);
		expect(events).toHaveLength(2);
		expect(events[1]).toEqual({
			type: "intent_edited",
			actor: "user:jw",
			at: "2026-05-17T10:00:01.000Z",
			data: { field: "goal", value: "Ship OAuth" },
		});
	});

	test("emits one event per changed field, in INTENT_FIELDS order", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);

		await handle.editIntent({
			goal: "g",
			constraints: ["c1", "c2"],
			success_criteria: ["s1"],
		});

		const events = await readEventLines(handle.id);
		const intentEvents = events.filter((e) => e.type === "intent_edited");
		expect(intentEvents.map((e) => (e.data as { field: string }).field)).toEqual([
			"goal",
			"constraints",
			"success_criteria",
		]);
	});

	test("skips fields whose value is unchanged", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);
		await handle.editIntent({ goal: "g" });
		advanceClock(1000);
		await handle.editIntent({ goal: "g", constraints: ["c"] });

		const events = await readEventLines(handle.id);
		const intentEvents = events.filter((e) => e.type === "intent_edited");
		expect(intentEvents).toHaveLength(2);
		expect((intentEvents[1] as { data: { field: string } }).data.field).toBe("constraints");
	});

	test("no-op edit leaves updated_at and event log untouched", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		const before = await handle.read();
		advanceClock(5000);
		const after = await handle.editIntent({});
		expect(after.updated_at).toBe(before.updated_at);
		const events = await readEventLines(handle.id);
		expect(events).toHaveLength(1);
	});

	test("rejects unknown intent fields", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(handle.editIntent({ bogus: "x" } as never)).rejects.toThrow(/unknown intent field/);
	});

	test("rejects wrong types", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(handle.editIntent({ goal: 5 as unknown as string })).rejects.toThrow(
			/goal must be a string/,
		);
		expect(handle.editIntent({ non_goals: "x" as unknown as string[] })).rejects.toThrow(
			/non_goals must be an array/,
		);
	});
});

describe("attach / detach", () => {
	test("attach assigns sequential IDs and writes attachment_added", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);
		const a = await handle.attach({ type: "seeds_issue", ref: "sd-1", role: "tracks" });
		advanceClock(1000);
		const b = await handle.attach({ type: "gh_pr", ref: "o/r#1", role: "implements" });
		expect(a.id).toBe("att-001");
		expect(b.id).toBe("att-002");

		const plot = await handle.read();
		expect(plot.attachments.map((x) => x.id)).toEqual(["att-001", "att-002"]);

		const events = await readEventLines(handle.id);
		const addedEvents = events.filter((e) => e.type === "attachment_added");
		expect(addedEvents).toHaveLength(2);
		expect((addedEvents[0] as { data: { ref: string } }).data.ref).toBe("sd-1");
	});

	test("attach validates ref and role", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(handle.attach({ type: "seeds_issue", ref: "", role: "tracks" })).rejects.toThrow(
			/ref is required/,
		);
		expect(handle.attach({ type: "seeds_issue", ref: "sd-1", role: "" })).rejects.toThrow(
			/role is required/,
		);
	});

	test("detach removes the attachment and writes attachment_removed", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		const a = await handle.attach({ type: "seeds_issue", ref: "sd-1", role: "tracks" });
		advanceClock(1000);
		await handle.detach(a.id);
		const plot = await handle.read();
		expect(plot.attachments).toEqual([]);
		const events = await readEventLines(handle.id);
		expect(events.at(-1)).toEqual({
			type: "attachment_removed",
			actor: "user:jw",
			at: "2026-05-17T10:00:01.000Z",
			data: { id: "att-001" },
		});
	});

	test("detach errors when attachment is missing", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(handle.detach("att-099")).rejects.toThrow(/att-099 not found/);
	});
});

describe("setStatus", () => {
	test("transitions and writes status_changed", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);
		const next = await handle.setStatus("ready");
		expect(next.status).toBe("ready");

		const events = await readEventLines(handle.id);
		expect(events.at(-1)).toEqual({
			type: "status_changed",
			actor: "user:jw",
			at: "2026-05-17T10:00:01.000Z",
			data: { from: "drafting", to: "ready" },
		});
	});

	test("no-op when status is unchanged", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);
		const next = await handle.setStatus("drafting");
		expect(next.status).toBe("drafting");
		expect(next.updated_at).toBe("2026-05-17T10:00:00.000Z");
		const events = await readEventLines(handle.id);
		expect(events).toHaveLength(1);
	});

	test("rejects invalid status", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(handle.setStatus("bogus" as never)).rejects.toThrow(/invalid status/);
	});

	test("updates index row", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);
		await handle.setStatus("ready");
		const rows = (await index.query()).rows;
		expect(rows[0]?.status).toBe("ready");
		expect(rows[0]?.updated_at).toBe("2026-05-17T10:00:01.000Z");
	});
});

describe("append", () => {
	test("appends a decision_made event from an agent", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		advanceClock(1000);

		const agentStore = makeStore(AGENT);
		const ev = await agentStore.get(handle.id).append({
			type: "decision_made",
			data: { summary: "Use octokit", rationale: "official" },
		});
		expect(ev.actor).toBe("agent:claude:run-1");

		const events = await readEventLines(handle.id);
		expect(events).toHaveLength(2);
		expect(events[1]?.type).toBe("decision_made");
	});

	test("rejects mutating event types with a redirect hint", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		expect(
			handle.append({ type: "intent_edited", data: { field: "goal", value: "x" } }),
		).rejects.toThrow(/editIntent/);
		expect(
			handle.append({ type: "status_changed", data: { from: "drafting", to: "ready" } }),
		).rejects.toThrow(/setStatus/);
		expect(handle.append({ type: "plot_created", data: { name: "X" } })).rejects.toThrow(
			/PlotStore.create/,
		);
	});

	test("errors when the Plot doesn't exist", async () => {
		const store = makeStore();
		expect(
			store.get("plot-aaaaaaaa").append({ type: "note", data: { text: "hi" } }),
		).rejects.toThrow(/not found/);
	});

	test("does not change Plot.updated_at or the index row", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		const created = await handle.read();
		advanceClock(5000);
		await handle.append({ type: "note", data: { text: "hi" } });
		const after = await handle.read();
		expect(after.updated_at).toBe(created.updated_at);
		const rows = (await index.query()).rows;
		expect(rows[0]?.updated_at).toBe(created.updated_at);
	});
});

describe("write-ACL (SPEC §6)", () => {
	test("agent cannot editIntent — error redirects to question_posed", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		expect(agentHandle.editIntent({ goal: "agents shouldn't do this" })).rejects.toThrow(
			/write-ACL.*intent_edited.*question_posed/s,
		);
		// No event was written.
		const events = await readEventLines(handle.id);
		expect(events).toHaveLength(1);
	});

	test("agent cannot setStatus", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		expect(agentHandle.setStatus("ready")).rejects.toThrow(/write-ACL.*status_changed/);
	});

	test("agent cannot detach", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const att = await handle.attach({ type: "seeds_issue", ref: "sd-1", role: "tracks" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		expect(agentHandle.detach(att.id)).rejects.toThrow(/write-ACL.*attachment_removed/);
		const plot = await handle.read();
		expect(plot.attachments).toHaveLength(1);
	});

	test("agent cannot question_answered via append", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		expect(agentHandle.append({ type: "question_answered", data: { text: "no" } })).rejects.toThrow(
			/write-ACL.*question_answered/,
		);
	});

	test("user cannot decision_made / question_posed / artifact_produced via append", async () => {
		const store = makeStore(USER);
		const handle = await store.create({ name: "X" });
		expect(handle.append({ type: "decision_made", data: { summary: "x" } })).rejects.toThrow(
			/write-ACL.*decision_made/,
		);
		expect(
			handle.append({ type: "question_posed", data: { text: "?", blocking: false } }),
		).rejects.toThrow(/write-ACL.*question_posed/);
		expect(
			handle.append({ type: "artifact_produced", data: { type: "file", ref: "a" } }),
		).rejects.toThrow(/write-ACL.*artifact_produced/);
	});

	test("agent can append decision_made / question_posed / artifact_produced / note / run_dispatched / plan_run_dispatched", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		await agentHandle.append({ type: "decision_made", data: { summary: "s" } });
		await agentHandle.append({ type: "question_posed", data: { text: "q", blocking: false } });
		await agentHandle.append({ type: "artifact_produced", data: { type: "file", ref: "r" } });
		await agentHandle.append({ type: "note", data: { text: "n" } });
		await agentHandle.append({ type: "run_dispatched", data: { run_id: "run-1" } });
		await agentHandle.append({
			type: "plan_run_dispatched",
			data: { plan_run_id: "prun-1", plan_id: "pl-abcd", children_count: 3 },
		});
		const events = await readEventLines(handle.id);
		// 1 plot_created + 6 appends
		expect(events).toHaveLength(7);
	});

	test("agent attach is allowed (attachment_added is anyone)", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "X" });
		const agentHandle = makeStore(AGENT).get(handle.id);
		const att = await agentHandle.attach({
			type: "gh_pr",
			ref: "o/r#1",
			role: "implements",
		});
		expect(att.added_by).toBe("agent:claude:run-1");
	});
});

describe("on-disk format", () => {
	test("Plot JSON keys are deep-sorted (matches stableStringify)", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		await handle.attach({ type: "seeds_issue", ref: "sd-1", role: "tracks" });

		const raw = await readFile(plotJsonPath(dir, handle.id), "utf-8");
		const parsed = JSON.parse(raw) as Plot;
		expect(Object.keys(parsed)).toEqual([
			"attachments",
			"created_at",
			"id",
			"intent",
			"name",
			"schema_version",
			"status",
			"updated_at",
		]);
	});

	test("readJson round-trips a freshly created Plot", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "Plot" });
		const onDisk = await readJson<Plot>(plotJsonPath(dir, handle.id));
		expect(onDisk).toEqual(await handle.read());
	});
});

describe("schema versioning (SPEC §7)", () => {
	test("rejects reading a Plot written by a newer schema", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });
		// Tamper the on-disk file to a future schema version.
		const path = plotJsonPath(dir, handle.id);
		const onDisk = await readJson<Plot>(path);
		await writeFile(path, JSON.stringify({ ...onDisk, schema_version: 999 }), "utf-8");
		expect(handle.read()).rejects.toThrow(/newer Plot/);
	});

	test("migrate-on-read upgrades a synthetic legacy fixture without rewriting the file", async () => {
		// Write a v0 Plot directly to disk, then read it through a PlotStore
		// configured with a v0->v1 migration. PlotHandle.read should return the
		// upgraded shape; the on-disk file should remain at v0 since no edit
		// triggered a write-back.
		const id = "plot-legacy01";
		const path = plotJsonPath(dir, id);
		const legacy = {
			schema_version: 0,
			id,
			name: "Legacy",
			status: "drafting",
			created_at: "2026-05-17T10:00:00.000Z",
			updated_at: "2026-05-17T10:00:00.000Z",
			intent: { goal: "g", non_goals: [], constraints: [] },
			attachments: [],
		};
		await writeFile(path, JSON.stringify(legacy), "utf-8");

		const v0to1: Migration = {
			from: 0,
			to: 1,
			migrate: (raw) => ({
				...raw,
				intent: {
					...(raw.intent as Record<string, unknown>),
					success_criteria: [],
				},
			}),
		};
		const store = new PlotStore({
			dir,
			index,
			actor: USER,
			now: () => clockNow,
			migrations: [v0to1],
		});

		const upgraded = await store.get(id).read();
		expect(upgraded.schema_version).toBe(1);
		expect(upgraded.intent.success_criteria).toEqual([]);
		expect(upgraded.intent.goal).toBe("g");

		// On disk is still v0 — write-back is deferred until something edits.
		const rawAfter = JSON.parse(await readFile(path, "utf-8")) as { schema_version: number };
		expect(rawAfter.schema_version).toBe(0);
	});

	test("editing a migrated Plot writes the upgraded shape back at SCHEMA_VERSION", async () => {
		const id = "plot-legacy02";
		const path = plotJsonPath(dir, id);
		const legacy = {
			schema_version: 0,
			id,
			name: "Legacy",
			status: "drafting",
			created_at: "2026-05-17T10:00:00.000Z",
			updated_at: "2026-05-17T10:00:00.000Z",
			intent: { goal: "g", non_goals: [], constraints: [] },
			attachments: [],
		};
		await writeFile(path, JSON.stringify(legacy), "utf-8");

		const v0to1: Migration = {
			from: 0,
			to: 1,
			migrate: (raw) => ({
				...raw,
				intent: {
					...(raw.intent as Record<string, unknown>),
					success_criteria: [],
				},
			}),
		};
		const store = new PlotStore({
			dir,
			index,
			actor: USER,
			now: () => clockNow,
			migrations: [v0to1],
		});
		advanceClock(1000);
		await store.get(id).editIntent({ goal: "g2" });

		const onDisk = JSON.parse(await readFile(path, "utf-8")) as Plot;
		expect(onDisk.schema_version).toBe(1);
		expect(onDisk.intent.success_criteria).toEqual([]);
		expect(onDisk.intent.goal).toBe("g2");
	});
});

describe("concurrent mutations", () => {
	test("interleaved setStatus / editIntent on the same Plot don't lose updates", async () => {
		const store = makeStore();
		const handle = await store.create({ name: "X" });

		// Fire many parallel mutations from different "instances" of the store.
		// The JSON file lock serializes them; no event should be lost.
		const ops: Promise<unknown>[] = [];
		for (let i = 0; i < 10; i++) {
			advanceClock(1);
			const h = store.get(handle.id);
			ops.push(h.editIntent({ goal: `g${i}` }));
			ops.push(h.attach({ type: "file", ref: `r${i}`, role: "reference" }));
		}
		await Promise.all(ops);

		const finalPlot = await handle.read();
		expect(finalPlot.intent.goal).toMatch(/^g\d$/);
		expect(finalPlot.attachments).toHaveLength(10);
		const ids = finalPlot.attachments.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual([...ids].sort());
	});
});
