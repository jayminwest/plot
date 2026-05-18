import { describe, expect, test } from "bun:test";
import { plotToIndexRow } from "./plot-index.ts";
import { type Plot, SCHEMA_VERSION } from "./types.ts";

const plot: Plot = {
	schema_version: SCHEMA_VERSION,
	id: "plot-abcdefgh",
	name: "Test plot",
	status: "drafting",
	created_at: "2026-05-17T10:00:00Z",
	updated_at: "2026-05-17T11:00:00Z",
	intent: { goal: "g", non_goals: [], constraints: [], success_criteria: [] },
	attachments: [
		{
			id: "att-001",
			type: "seeds_issue",
			ref: "sd-1",
			role: "tracks",
			added_at: "2026-05-17T10:00:00Z",
			added_by: "user:jw",
		},
	],
};

describe("plotToIndexRow", () => {
	test("projects only the structured-field subset (§5.4 invariant)", () => {
		expect(plotToIndexRow(plot)).toEqual({
			id: "plot-abcdefgh",
			name: "Test plot",
			status: "drafting",
			created_at: "2026-05-17T10:00:00Z",
			updated_at: "2026-05-17T11:00:00Z",
		});
	});

	test("does not leak intent or attachments into the index row", () => {
		const row = plotToIndexRow(plot) as unknown as Record<string, unknown>;
		expect(row.intent).toBeUndefined();
		expect(row.attachments).toBeUndefined();
	});
});
