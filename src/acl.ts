// Write-ACL — SPEC §6.
//
// The single hard rule: agents may never mutate intent. Enforcement is at
// the library level so the rule is impossible to bypass through normal use;
// any code path that writes an event without consulting this module breaks
// the network topology guarantee.

import type { Actor } from "./actor.ts";
import type { PlotEventType } from "./types.ts";

export type ActorKind = Actor["kind"];

// Allowed actor kinds per event type per SPEC §6.
export const EVENT_ACL: Record<PlotEventType, readonly ActorKind[]> = {
	plot_created: ["user", "agent"],
	intent_edited: ["user"],
	status_changed: ["user"],
	attachment_added: ["user", "agent"],
	attachment_removed: ["user"],
	question_answered: ["user"],
	run_dispatched: ["user", "agent"],
	plan_run_dispatched: ["user", "agent"],
	decision_made: ["agent"],
	question_posed: ["agent"],
	artifact_produced: ["agent"],
	note: ["user", "agent"],
};

// Redirect hint when a forbidden event is attempted. Per SPEC §6, an agent
// that wants intent to change must surface a question for a human to answer.
const REDIRECT_HINT: Partial<Record<PlotEventType, Partial<Record<ActorKind, string>>>> = {
	intent_edited: {
		agent: "agents must surface a `question_posed` event instead of mutating intent",
	},
	status_changed: {
		agent: "agents must surface a `question_posed` event to ask a human to transition status",
	},
	attachment_removed: {
		agent: "agents must surface a `question_posed` event to ask a human to remove an attachment",
	},
	question_answered: {
		agent: "agents must surface a `question_posed` event; only users answer questions",
	},
	decision_made: {
		user: "`decision_made` is agent-only; users can record context with a `note` event",
	},
	question_posed: {
		user: "`question_posed` is agent-only; users answer with `question_answered`",
	},
	artifact_produced: {
		user: "`artifact_produced` is agent-only; users can attach artifacts with PlotHandle.attach()",
	},
};

export function isAllowed(actor: Actor, event: PlotEventType): boolean {
	return EVENT_ACL[event].includes(actor.kind);
}

export function assertCanEmit(actor: Actor, event: PlotEventType): void {
	if (isAllowed(actor, event)) return;
	const allowed = EVENT_ACL[event].map((k) => `${k}:*`).join(" or ");
	const hint = REDIRECT_HINT[event]?.[actor.kind];
	throw new Error(
		`write-ACL: ${actor.raw} cannot emit ${JSON.stringify(event)} (allowed: ${allowed || "none"})${
			hint ? ` — ${hint}` : ""
		}`,
	);
}
