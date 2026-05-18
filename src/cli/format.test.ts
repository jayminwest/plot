import { describe, expect, test } from "bun:test";
import type { Plot, PlotEvent } from "../types.ts";
import {
	buildQuestionIndexMap,
	findQuestionByCliId,
	formatPlotList,
	formatPlotShow,
} from "./format.ts";

const PLOT: Plot = {
	schema_version: 1,
	id: "plot-abcd1234",
	name: "Add OAuth",
	status: "ready",
	created_at: "2026-05-17T10:00:00.000Z",
	updated_at: "2026-05-17T11:00:00.000Z",
	intent: {
		goal: "Replace email auth",
		non_goals: ["migrate existing accounts"],
		constraints: [],
		success_criteria: ["passes tests"],
	},
	attachments: [
		{
			id: "att-001",
			type: "seeds_issue",
			ref: "sd-123",
			role: "tracks",
			added_at: "2026-05-17T10:01:00.000Z",
			added_by: "user:jw",
		},
	],
};

const Q1: PlotEvent = {
	type: "question_posed",
	actor: "agent:claude:run-1",
	at: "2026-05-17T11:00:00.000Z",
	data: { text: "Should we migrate existing accounts?", blocking: true },
};
const Q2: PlotEvent = {
	type: "question_posed",
	actor: "agent:claude:run-1",
	at: "2026-05-17T11:05:00.000Z",
	data: { text: "What about Google OAuth?", blocking: false },
};

describe("formatPlotList", () => {
	test("returns 'no plots' for empty input", () => {
		expect(formatPlotList([])).toBe("no plots\n");
	});

	test("aligns columns", () => {
		const out = formatPlotList([
			{ id: "plot-aaaaaaaa", name: "A", status: "ready" },
			{ id: "plot-bbbbbbbb", name: "B", status: "drafting" },
		]);
		expect(out).toContain("plot-aaaaaaaa  ready");
		expect(out).toContain("plot-bbbbbbbb  drafting");
	});
});

describe("formatPlotShow", () => {
	test("renders intent fields, attachments, recent events with question ids", () => {
		const out = formatPlotShow(PLOT, [Q1, Q2]);
		expect(out).toContain("plot-abcd1234  ready");
		expect(out).toContain("goal: Replace email auth");
		expect(out).toContain("- migrate existing accounts");
		expect(out).toContain("att-001  seeds_issue  sd-123");
		expect(out).toContain("[q-1] question_posed");
		expect(out).toContain("[q-2] question_posed");
	});

	test("empty events section is explicit", () => {
		const out = formatPlotShow(PLOT, []);
		expect(out).toContain("Recent events (last 0 of 0)");
		expect(out).toContain("(none)");
	});
});

describe("question id mapping", () => {
	test("buildQuestionIndexMap numbers in order", () => {
		const map = buildQuestionIndexMap([Q1, Q2]);
		expect(map.get(Q1)).toBe("q-1");
		expect(map.get(Q2)).toBe("q-2");
	});

	test("findQuestionByCliId resolves N to the Nth question_posed", () => {
		expect(findQuestionByCliId([Q1, Q2], "q-2")).toBe(Q2);
		expect(findQuestionByCliId([Q1, Q2], "q-3")).toBeUndefined();
		expect(findQuestionByCliId([Q1, Q2], "bogus")).toBeUndefined();
	});
});
