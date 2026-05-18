import { describe, expect, test } from "bun:test";
import type {
	ArtifactProducedEvent,
	Attachment,
	DecisionMadeEvent,
	IntentEditedEvent,
	NoteEvent,
	Plot,
	PlotCreatedEvent,
	PlotEvent,
	QuestionPosedEvent,
	StatusChangedEvent,
} from "./types.ts";
import {
	ATTACHMENT_TYPES,
	CONVENTIONAL_ATTACHMENT_ROLES,
	EMPTY_INTENT,
	INTENT_FIELDS,
	PLOT_EVENT_TYPES,
	PLOT_STATUSES,
	SCHEMA_VERSION,
} from "./types.ts";

describe("constants match SPEC", () => {
	test("SCHEMA_VERSION is 1 for V1", () => {
		expect(SCHEMA_VERSION).toBe(1);
	});

	test("PLOT_STATUSES matches §3.1 status enum", () => {
		expect([...PLOT_STATUSES]).toEqual(["drafting", "ready", "active", "done", "archived"]);
	});

	test("ATTACHMENT_TYPES matches §3.1 V1 types", () => {
		expect([...ATTACHMENT_TYPES]).toEqual([
			"seeds_issue",
			"mulch_record",
			"agent_run",
			"gh_pr",
			"gh_issue",
			"file",
		]);
	});

	test("CONVENTIONAL_ATTACHMENT_ROLES matches §3.1", () => {
		expect([...CONVENTIONAL_ATTACHMENT_ROLES]).toEqual([
			"tracks",
			"implements",
			"informs",
			"discussion",
			"meeting",
			"reference",
		]);
	});

	test("PLOT_EVENT_TYPES matches §3.2 table", () => {
		expect([...PLOT_EVENT_TYPES].sort() as string[]).toEqual(
			[
				"plot_created",
				"intent_edited",
				"status_changed",
				"attachment_added",
				"attachment_removed",
				"run_dispatched",
				"decision_made",
				"question_posed",
				"question_answered",
				"artifact_produced",
				"note",
			].sort(),
		);
	});

	test("INTENT_FIELDS covers every Intent field", () => {
		expect([...INTENT_FIELDS]).toEqual(["goal", "non_goals", "constraints", "success_criteria"]);
	});
});

describe("EMPTY_INTENT", () => {
	test("has all fields with safe defaults", () => {
		expect(EMPTY_INTENT).toEqual({
			goal: "",
			non_goals: [],
			constraints: [],
			success_criteria: [],
		});
	});
});

describe("type compile checks", () => {
	test("Plot literal matches the spec example shape", () => {
		const attachment: Attachment = {
			id: "att-001",
			type: "seeds_issue",
			ref: "sd-123",
			role: "tracks",
			added_at: "2026-05-17T10:01:00Z",
			added_by: "user:jw",
		};

		const plot: Plot = {
			schema_version: SCHEMA_VERSION,
			id: "plot-abc12345",
			name: "Add OAuth to billing portal",
			status: "drafting",
			created_at: "2026-05-17T10:00:00Z",
			updated_at: "2026-05-17T14:23:00Z",
			intent: {
				goal: "Replace email/password auth on /billing with GitHub OAuth.",
				non_goals: ["Migrating existing accounts in v1"],
				constraints: ["Must work with existing Stripe customer IDs"],
				success_criteria: ["New users can sign in with GitHub on /billing"],
			},
			attachments: [attachment],
		};

		expect(plot.attachments[0]).toBe(attachment);
	});

	test("PlotEvent discriminated union covers each spec example", () => {
		const events: PlotEvent[] = [
			{
				type: "plot_created",
				actor: "user:jw",
				at: "2026-05-17T10:00:00Z",
				data: { name: "Add OAuth to billing portal" },
			} satisfies PlotCreatedEvent,
			{
				type: "intent_edited",
				actor: "user:jw",
				at: "2026-05-17T10:00:30Z",
				data: { field: "goal", value: "..." },
			} satisfies IntentEditedEvent,
			{
				type: "status_changed",
				actor: "user:jw",
				at: "2026-05-17T11:00:00Z",
				data: { from: "drafting", to: "ready" },
			} satisfies StatusChangedEvent,
			{
				type: "decision_made",
				actor: "agent:claude_code:run-456",
				at: "2026-05-17T11:32:00Z",
				data: { summary: "Using @octokit/oauth-app", rationale: "..." },
			} satisfies DecisionMadeEvent,
			{
				type: "question_posed",
				actor: "agent:claude_code:run-456",
				at: "2026-05-17T11:45:00Z",
				data: { text: "Hard cut?", blocking: true },
			} satisfies QuestionPosedEvent,
			{
				type: "artifact_produced",
				actor: "agent:claude_code:run-456",
				at: "2026-05-17T12:10:00Z",
				data: { type: "gh_pr", ref: "owner/repo#789" },
			} satisfies ArtifactProducedEvent,
			{
				type: "note",
				actor: "user:jw",
				at: "2026-05-17T12:15:00Z",
				data: { text: "Looks good." },
			} satisfies NoteEvent,
		];

		expect(events).toHaveLength(7);
	});
});
