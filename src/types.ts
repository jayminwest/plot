// Plot data model — see SPEC.md §3.

export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export const PLOT_STATUSES = ["drafting", "ready", "active", "done", "archived"] as const;
export type PlotStatus = (typeof PLOT_STATUSES)[number];

export const ATTACHMENT_TYPES = [
	"seeds_issue",
	"mulch_record",
	"agent_run",
	"gh_pr",
	"gh_issue",
	"file",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

// Roles are free-form strings per SPEC §3.1; these are the conventional values.
export const CONVENTIONAL_ATTACHMENT_ROLES = [
	"tracks",
	"implements",
	"informs",
	"discussion",
	"meeting",
	"reference",
] as const;
export type ConventionalAttachmentRole = (typeof CONVENTIONAL_ATTACHMENT_ROLES)[number];

export const PLOT_EVENT_TYPES = [
	"plot_created",
	"intent_edited",
	"status_changed",
	"attachment_added",
	"attachment_removed",
	"run_dispatched",
	"plan_run_dispatched",
	"decision_made",
	"question_posed",
	"question_answered",
	"artifact_produced",
	"note",
] as const;
export type PlotEventType = (typeof PLOT_EVENT_TYPES)[number];

export const INTENT_FIELDS = ["goal", "non_goals", "constraints", "success_criteria"] as const;
export type IntentField = (typeof INTENT_FIELDS)[number];

export interface Intent {
	goal: string;
	non_goals: string[];
	constraints: string[];
	success_criteria: string[];
}

export interface Attachment {
	id: string; // att-NNN, local to this Plot
	type: AttachmentType;
	ref: string;
	role: string;
	added_at: string; // ISO 8601
	added_by: string; // actor string
}

export interface Plot {
	schema_version: SchemaVersion;
	id: string; // plot-xxxxxxxx
	name: string;
	status: PlotStatus;
	created_at: string;
	updated_at: string;
	intent: Intent;
	attachments: Attachment[];
}

// Event payloads — discriminated union on `type`. SPEC §3.2.

interface EventBase<T extends PlotEventType, D> {
	type: T;
	actor: string;
	at: string;
	data: D;
}

export type PlotCreatedEvent = EventBase<"plot_created", { name: string }>;
export type IntentEditedEvent = EventBase<
	"intent_edited",
	{ field: IntentField; value: string | string[] }
>;
export type StatusChangedEvent = EventBase<"status_changed", { from: PlotStatus; to: PlotStatus }>;
export type AttachmentAddedEvent = EventBase<
	"attachment_added",
	{ id: string; type: AttachmentType; ref: string; role: string }
>;
export type AttachmentRemovedEvent = EventBase<"attachment_removed", { id: string }>;
export type RunDispatchedEvent = EventBase<
	"run_dispatched",
	{ run_id: string; from_seed?: string; [key: string]: unknown }
>;
export type PlanRunDispatchedEvent = EventBase<
	"plan_run_dispatched",
	{ plan_run_id: string; plan_id: string; children_count: number; [key: string]: unknown }
>;
export type DecisionMadeEvent = EventBase<"decision_made", { summary: string; rationale?: string }>;
export type QuestionPosedEvent = EventBase<"question_posed", { text: string; blocking: boolean }>;
export type QuestionAnsweredEvent = EventBase<
	"question_answered",
	{ question_id?: string; text: string }
>;
export type ArtifactProducedEvent = EventBase<
	"artifact_produced",
	{ type: AttachmentType | string; ref: string }
>;
export type NoteEvent = EventBase<"note", { text: string }>;

export type PlotEvent =
	| PlotCreatedEvent
	| IntentEditedEvent
	| StatusChangedEvent
	| AttachmentAddedEvent
	| AttachmentRemovedEvent
	| RunDispatchedEvent
	| PlanRunDispatchedEvent
	| DecisionMadeEvent
	| QuestionPosedEvent
	| QuestionAnsweredEvent
	| ArtifactProducedEvent
	| NoteEvent;

export const EMPTY_INTENT: Intent = {
	goal: "",
	non_goals: [],
	constraints: [],
	success_criteria: [],
};
