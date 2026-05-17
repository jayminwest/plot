import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "./actor.ts";
import { SQLitePlotIndex } from "./sqlite-index.ts";
import { PlotStore } from "./store.ts";
import type { Attachment, Intent, Plot, PlotEvent } from "./types.ts";
import {
	IMPLEMENTER_VIEW_ATTACHMENT_ROLES,
	IMPLEMENTER_VIEW_EVENT_LIMIT,
	IMPLEMENTER_VIEW_EVENT_TYPES,
	isViewName,
	renderImplementerView,
	VIEW_NAMES,
} from "./views.ts";

const USER: Actor = { kind: "user", handle: "jw", raw: "user:jw" };
const AGENT: Actor = {
	kind: "agent",
	name: "claude",
	runId: "run-1",
	raw: "agent:claude:run-1",
};

function makePlot(overrides: Partial<Plot> = {}): Plot {
	const intent: Intent = {
		goal: "Add OAuth",
		non_goals: ["v1 migrations"],
		constraints: ["no downtime"],
		success_criteria: ["new users sign in"],
	};
	return {
		schema_version: 1,
		id: "pl-abcdefgh",
		name: "OAuth",
		status: "active",
		created_at: "2026-05-17T10:00:00.000Z",
		updated_at: "2026-05-17T10:00:00.000Z",
		intent,
		attachments: [],
		...overrides,
	};
}

function makeAttachment(
	role: string,
	id = "att-001",
	type: Attachment["type"] = "seeds_issue",
): Attachment {
	return {
		id,
		type,
		ref: "sd-1",
		role,
		added_at: "2026-05-17T10:00:00.000Z",
		added_by: "user:jw",
	};
}

function makeEvent(
	type: PlotEvent["type"],
	at: string,
	data: Record<string, unknown> = {},
): PlotEvent {
	return { type, actor: "agent:claude:run-1", at, data } as PlotEvent;
}

describe("renderImplementerView (pure)", () => {
	test("returns intent verbatim and a defensive clone", () => {
		const plot = makePlot();
		const view = renderImplementerView(plot, []);
		expect(view.intent).toEqual(plot.intent);
		expect(view.intent).not.toBe(plot.intent);
		expect(view.intent.non_goals).not.toBe(plot.intent.non_goals);

		view.intent.non_goals.push("mutated");
		expect(plot.intent.non_goals).toEqual(["v1 migrations"]);
	});

	test("filters events to the §8.1 allowed types", () => {
		const plot = makePlot();
		const events: PlotEvent[] = [
			makeEvent("plot_created", "2026-05-17T10:00:00.000Z", { name: "OAuth" }),
			makeEvent("intent_edited", "2026-05-17T10:00:01.000Z", { field: "goal", value: "x" }),
			makeEvent("status_changed", "2026-05-17T10:00:02.000Z", { from: "drafting", to: "ready" }),
			makeEvent("decision_made", "2026-05-17T10:00:03.000Z", { summary: "use octokit" }),
			makeEvent("question_posed", "2026-05-17T10:00:04.000Z", { text: "?", blocking: true }),
			makeEvent("question_answered", "2026-05-17T10:00:05.000Z", { text: "!" }),
			makeEvent("artifact_produced", "2026-05-17T10:00:06.000Z", { type: "gh_pr", ref: "o/r#1" }),
			makeEvent("note", "2026-05-17T10:00:07.000Z", { text: "n" }),
			makeEvent("run_dispatched", "2026-05-17T10:00:08.000Z", { run_id: "run-1" }),
			makeEvent("attachment_added", "2026-05-17T10:00:09.000Z", {
				id: "att-001",
				type: "seeds_issue",
				ref: "sd-1",
				role: "tracks",
			}),
			makeEvent("attachment_removed", "2026-05-17T10:00:10.000Z", { id: "att-001" }),
		];
		const view = renderImplementerView(plot, events);
		expect(view.events.map((e) => e.type)).toEqual([
			"decision_made",
			"question_posed",
			"question_answered",
			"artifact_produced",
			"note",
		]);
	});

	test("keeps only the last 20 of the allowed types, preserving order", () => {
		const plot = makePlot();
		const events: PlotEvent[] = [];
		// 25 allowed events interleaved with disallowed ones
		for (let i = 0; i < 25; i++) {
			events.push(
				makeEvent("note", `2026-05-17T10:00:${String(i).padStart(2, "0")}.000Z`, { text: `n${i}` }),
			);
			events.push(
				makeEvent("intent_edited", `2026-05-17T10:00:${String(i).padStart(2, "0")}.500Z`, {
					field: "goal",
					value: "x",
				}),
			);
		}
		const view = renderImplementerView(plot, events);
		expect(view.events).toHaveLength(IMPLEMENTER_VIEW_EVENT_LIMIT);
		expect((view.events[0]?.data as { text: string }).text).toBe("n5");
		expect((view.events[19]?.data as { text: string }).text).toBe("n24");
		for (const ev of view.events) {
			expect(ev.type).toBe("note");
		}
	});

	test("returns fewer than 20 when fewer allowed events exist", () => {
		const plot = makePlot();
		const events = [
			makeEvent("decision_made", "2026-05-17T10:00:00.000Z", { summary: "a" }),
			makeEvent("note", "2026-05-17T10:00:01.000Z", { text: "b" }),
		];
		const view = renderImplementerView(plot, events);
		expect(view.events).toHaveLength(2);
	});

	test("filters attachments to the §8.1 allowed roles", () => {
		const plot = makePlot({
			attachments: [
				makeAttachment("tracks", "att-001"),
				makeAttachment("implements", "att-002"),
				makeAttachment("informs", "att-003"),
				makeAttachment("reference", "att-004"),
				makeAttachment("discussion", "att-005"),
				makeAttachment("meeting", "att-006"),
				makeAttachment("custom-role", "att-007"),
			],
		});
		const view = renderImplementerView(plot, []);
		expect(view.attachments.map((a) => a.role)).toEqual([
			"tracks",
			"implements",
			"informs",
			"reference",
		]);
	});

	test("does not mutate the input events array", () => {
		const plot = makePlot();
		const events: PlotEvent[] = [
			makeEvent("decision_made", "2026-05-17T10:00:00.000Z", { summary: "a" }),
		];
		const snapshot = [...events];
		renderImplementerView(plot, events);
		expect(events).toEqual(snapshot);
	});

	test("returns a fresh attachments array (mutation safe)", () => {
		const plot = makePlot({ attachments: [makeAttachment("tracks", "att-001")] });
		const view = renderImplementerView(plot, []);
		expect(view.attachments).not.toBe(plot.attachments);
		view.attachments.push(makeAttachment("tracks", "att-099"));
		expect(plot.attachments).toHaveLength(1);
	});
});

describe("view-name helpers", () => {
	test("VIEW_NAMES is the singleton {implementer}", () => {
		expect([...VIEW_NAMES]).toEqual(["implementer"]);
	});

	test("isViewName narrows correctly", () => {
		expect(isViewName("implementer")).toBe(true);
		expect(isViewName("planner")).toBe(false);
	});

	test("IMPLEMENTER_VIEW_EVENT_TYPES matches §8.1 exactly", () => {
		expect([...IMPLEMENTER_VIEW_EVENT_TYPES]).toEqual([
			"decision_made",
			"question_posed",
			"question_answered",
			"artifact_produced",
			"note",
		]);
	});

	test("IMPLEMENTER_VIEW_ATTACHMENT_ROLES matches §8.1 exactly", () => {
		expect([...IMPLEMENTER_VIEW_ATTACHMENT_ROLES]).toEqual([
			"tracks",
			"implements",
			"informs",
			"reference",
		]);
	});
});

describe("PlotHandle.view (integration)", () => {
	let dir: string;
	let index: SQLitePlotIndex;
	let clockNow: Date;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "plot-views-"));
		index = new SQLitePlotIndex(":memory:");
		clockNow = new Date("2026-05-17T10:00:00.000Z");
	});

	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
	});

	function makeStore(actor: Actor): PlotStore {
		return new PlotStore({ dir, index, actor, now: () => clockNow });
	}

	function advanceClock(ms: number): void {
		clockNow = new Date(clockNow.getTime() + ms);
	}

	test("renders intent, filtered events, and filtered attachments end-to-end", async () => {
		const userStore = makeStore(USER);
		const handle = await userStore.create({ name: "OAuth" });

		advanceClock(1000);
		await handle.editIntent({
			goal: "Replace email/password with GitHub OAuth",
			constraints: ["no downtime"],
		});

		advanceClock(1000);
		await handle.attach({ type: "seeds_issue", ref: "sd-1", role: "tracks" });
		advanceClock(1000);
		await handle.attach({ type: "mulch_record", ref: "mx-1", role: "discussion" });
		advanceClock(1000);
		await handle.attach({ type: "gh_pr", ref: "o/r#1", role: "implements" });

		advanceClock(1000);
		await handle.setStatus("ready");

		const agentStore = makeStore(AGENT);
		const agentHandle = agentStore.get(handle.id);

		advanceClock(1000);
		await agentHandle.append({
			type: "decision_made",
			data: { summary: "use @octokit/oauth-app" },
		});
		advanceClock(1000);
		await agentHandle.append({
			type: "question_posed",
			data: { text: "hard-cut or migrate?", blocking: true },
		});
		advanceClock(1000);
		await agentHandle.append({
			type: "artifact_produced",
			data: { type: "gh_pr", ref: "o/r#1" },
		});

		const view = await agentHandle.view("implementer");

		expect(view.intent.goal).toBe("Replace email/password with GitHub OAuth");
		expect(view.intent.constraints).toEqual(["no downtime"]);

		expect(view.events.map((e) => e.type)).toEqual([
			"decision_made",
			"question_posed",
			"artifact_produced",
		]);
		// Events do not include plot_created / intent_edited / status_changed /
		// attachment_added even though they sit earlier in the log.

		expect(view.attachments.map((a) => a.role)).toEqual(["tracks", "implements"]);
		// The mulch_record with role "discussion" is excluded.
	});

	test("rejects unknown view names", async () => {
		const store = makeStore(USER);
		const handle = await store.create({ name: "X" });
		expect(handle.view("planner" as "implementer")).rejects.toThrow(/unknown view/);
	});

	test("works with an empty events log", async () => {
		const store = makeStore(USER);
		const handle = await store.create({ name: "X" });
		const view = await handle.view("implementer");
		expect(view.events).toEqual([]);
		expect(view.attachments).toEqual([]);
		expect(view.intent.goal).toBe("");
	});
});
