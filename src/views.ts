// Views — SPEC §8.
//
// V1 ships exactly one hardcoded view: `implementer`. Per §8.1:
//   - intent (all fields)
//   - last 20 events of types: decision_made, question_posed,
//     question_answered, artifact_produced, note
//   - attachments where role ∈ {tracks, implements, informs, reference}
//
// Views exist so agents never load a full Plot — a Plot is a database and the
// agent must query a projection that fits its task (§8.2). Configurable views
// land in V2 (§8.3); for now the projection logic is a pure function over an
// in-memory Plot + events array, so callers can compose it with whichever IO
// path they're already on.

import type { Attachment, Intent, Plot, PlotEvent, PlotEventType } from "./types.ts";

export const VIEW_NAMES = ["implementer"] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export const IMPLEMENTER_VIEW_EVENT_TYPES = [
	"decision_made",
	"question_posed",
	"question_answered",
	"artifact_produced",
	"note",
] as const satisfies readonly PlotEventType[];

export const IMPLEMENTER_VIEW_ATTACHMENT_ROLES = [
	"tracks",
	"implements",
	"informs",
	"reference",
] as const;

export const IMPLEMENTER_VIEW_EVENT_LIMIT = 20;

export interface ImplementerView {
	intent: Intent;
	events: PlotEvent[];
	attachments: Attachment[];
}

export interface ViewResult {
	implementer: ImplementerView;
}

// Pure projection — does not read or write files. Callers pass the Plot
// (already migrated to the current schema_version) and the full ordered event
// list; the function returns the §8.1 shape. Events are not mutated — the
// returned array is a new slice.
export function renderImplementerView(plot: Plot, events: readonly PlotEvent[]): ImplementerView {
	const allowedTypes = new Set<PlotEventType>(IMPLEMENTER_VIEW_EVENT_TYPES);
	const allowedRoles = new Set<string>(IMPLEMENTER_VIEW_ATTACHMENT_ROLES);

	const filtered = events.filter((ev) => allowedTypes.has(ev.type));
	const lastN =
		filtered.length > IMPLEMENTER_VIEW_EVENT_LIMIT
			? filtered.slice(filtered.length - IMPLEMENTER_VIEW_EVENT_LIMIT)
			: filtered.slice();

	const attachments = plot.attachments.filter((a) => allowedRoles.has(a.role));

	return {
		intent: cloneIntent(plot.intent),
		events: lastN,
		attachments: attachments.map(cloneAttachment),
	};
}

export function isViewName(name: string): name is ViewName {
	return (VIEW_NAMES as readonly string[]).includes(name);
}

export function assertViewName(name: string): asserts name is ViewName {
	if (!isViewName(name)) {
		throw new Error(
			`unknown view ${JSON.stringify(name)} (expected one of ${VIEW_NAMES.join(", ")})`,
		);
	}
}

function cloneIntent(intent: Intent): Intent {
	return {
		goal: intent.goal,
		non_goals: [...intent.non_goals],
		constraints: [...intent.constraints],
		success_criteria: [...intent.success_criteria],
	};
}

function cloneAttachment(a: Attachment): Attachment {
	return { ...a };
}
