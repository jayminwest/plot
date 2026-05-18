// JSON Schema (draft 2020-12) for Plot files and event log entries.
// Source of truth for external validators; the TS types in types.ts are
// hand-aligned with these schemas.

import {
	ATTACHMENT_TYPES,
	INTENT_FIELDS,
	PLOT_EVENT_TYPES,
	PLOT_STATUSES,
	SCHEMA_VERSION,
} from "./types.ts";

const PLOT_ID_PATTERN = "^plot-[a-z0-9]{8}$";
const ATTACHMENT_ID_PATTERN = "^att-\\d{3}$";
const ACTOR_PATTERN =
	"^(user:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*(:[A-Za-z0-9][A-Za-z0-9_-]*)?)$";

const intentSchema = {
	type: "object",
	additionalProperties: false,
	required: ["goal", "non_goals", "constraints", "success_criteria"],
	properties: {
		goal: { type: "string" },
		non_goals: { type: "array", items: { type: "string" } },
		constraints: { type: "array", items: { type: "string" } },
		success_criteria: { type: "array", items: { type: "string" } },
	},
} as const;

const attachmentSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "type", "ref", "role", "added_at", "added_by"],
	properties: {
		id: { type: "string", pattern: ATTACHMENT_ID_PATTERN },
		type: { type: "string", enum: [...ATTACHMENT_TYPES] },
		ref: { type: "string", minLength: 1 },
		role: { type: "string", minLength: 1 },
		added_at: { type: "string", format: "date-time" },
		added_by: { type: "string", pattern: ACTOR_PATTERN },
	},
} as const;

export const plotSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://os-eco.dev/plot/schemas/plot.json",
	title: "Plot",
	description: "A coordination object stored as .plot/plot-xxx.json (SPEC §3.1).",
	type: "object",
	additionalProperties: false,
	required: [
		"schema_version",
		"id",
		"name",
		"status",
		"created_at",
		"updated_at",
		"intent",
		"attachments",
	],
	properties: {
		schema_version: { type: "integer", const: SCHEMA_VERSION },
		id: { type: "string", pattern: PLOT_ID_PATTERN },
		name: { type: "string", minLength: 1 },
		status: { type: "string", enum: [...PLOT_STATUSES] },
		created_at: { type: "string", format: "date-time" },
		updated_at: { type: "string", format: "date-time" },
		intent: intentSchema,
		attachments: { type: "array", items: attachmentSchema },
	},
} as const;

// Per-event-type data schemas. Each line in plot-xxx.events.jsonl validates
// against one of these via the oneOf on `type`.

const eventDataByType = {
	plot_created: {
		type: "object",
		additionalProperties: false,
		required: ["name"],
		properties: { name: { type: "string", minLength: 1 } },
	},
	intent_edited: {
		type: "object",
		additionalProperties: false,
		required: ["field", "value"],
		properties: {
			field: { type: "string", enum: [...INTENT_FIELDS] },
			value: {
				oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
			},
		},
	},
	status_changed: {
		type: "object",
		additionalProperties: false,
		required: ["from", "to"],
		properties: {
			from: { type: "string", enum: [...PLOT_STATUSES] },
			to: { type: "string", enum: [...PLOT_STATUSES] },
		},
	},
	attachment_added: {
		type: "object",
		additionalProperties: false,
		required: ["id", "type", "ref", "role"],
		properties: {
			id: { type: "string", pattern: ATTACHMENT_ID_PATTERN },
			type: { type: "string", enum: [...ATTACHMENT_TYPES] },
			ref: { type: "string", minLength: 1 },
			role: { type: "string", minLength: 1 },
		},
	},
	attachment_removed: {
		type: "object",
		additionalProperties: false,
		required: ["id"],
		properties: { id: { type: "string", pattern: ATTACHMENT_ID_PATTERN } },
	},
	run_dispatched: {
		type: "object",
		required: ["run_id"],
		properties: {
			run_id: { type: "string", minLength: 1 },
			from_seed: { type: "string" },
		},
	},
	decision_made: {
		type: "object",
		required: ["summary"],
		properties: {
			summary: { type: "string", minLength: 1 },
			rationale: { type: "string" },
		},
	},
	question_posed: {
		type: "object",
		additionalProperties: false,
		required: ["text", "blocking"],
		properties: {
			text: { type: "string", minLength: 1 },
			blocking: { type: "boolean" },
		},
	},
	question_answered: {
		type: "object",
		required: ["text"],
		properties: {
			text: { type: "string", minLength: 1 },
			question_id: { type: "string" },
		},
	},
	artifact_produced: {
		type: "object",
		required: ["type", "ref"],
		properties: {
			type: { type: "string", minLength: 1 },
			ref: { type: "string", minLength: 1 },
		},
	},
	note: {
		type: "object",
		additionalProperties: false,
		required: ["text"],
		properties: { text: { type: "string", minLength: 1 } },
	},
} as const;

export const eventSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://os-eco.dev/plot/schemas/event.json",
	title: "PlotEvent",
	description: "A single line in .plot/plot-xxx.events.jsonl (SPEC §3.2).",
	type: "object",
	required: ["type", "actor", "at", "data"],
	properties: {
		type: { type: "string", enum: [...PLOT_EVENT_TYPES] },
		actor: { type: "string", pattern: ACTOR_PATTERN },
		at: { type: "string", format: "date-time" },
		data: { type: "object" },
	},
	oneOf: PLOT_EVENT_TYPES.map((t) => ({
		properties: {
			type: { const: t },
			data: eventDataByType[t],
		},
	})),
} as const;
