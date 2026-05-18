// Output formatters for human-facing CLI commands.
//
// Two output modes: default human-readable text and `--json` for machine
// consumption (warren, overstory, tests). Both modes render the same source
// data — Plot + events array — so they stay consistent.

import type { Plot, PlotEvent } from "../types.ts";

const SHOW_RECENT_EVENT_LIMIT = 10;

export function formatPlotList(rows: { id: string; name: string; status: string }[]): string {
	if (rows.length === 0) return "no plots\n";
	const lines: string[] = [];
	const idWidth = Math.max(...rows.map((r) => r.id.length));
	const statusWidth = Math.max(...rows.map((r) => r.status.length));
	for (const r of rows) {
		lines.push(`${r.id.padEnd(idWidth)}  ${r.status.padEnd(statusWidth)}  ${r.name}`);
	}
	return `${lines.join("\n")}\n`;
}

export function formatPlotShow(plot: Plot, events: PlotEvent[]): string {
	const lines: string[] = [];
	lines.push(`${plot.id}  ${plot.status}`);
	lines.push(`Name:     ${plot.name}`);
	lines.push(`Created:  ${plot.created_at}`);
	lines.push(`Updated:  ${plot.updated_at}`);
	lines.push("");
	lines.push("Intent:");
	lines.push(`  goal: ${plot.intent.goal || "(empty)"}`);
	appendArrayField(lines, "non_goals", plot.intent.non_goals);
	appendArrayField(lines, "constraints", plot.intent.constraints);
	appendArrayField(lines, "success_criteria", plot.intent.success_criteria);

	lines.push("");
	lines.push(`Attachments (${plot.attachments.length}):`);
	if (plot.attachments.length === 0) {
		lines.push("  (none)");
	} else {
		for (const a of plot.attachments) {
			lines.push(
				`  ${a.id}  ${a.type}  ${a.ref}  role=${a.role}  by ${a.added_by} at ${a.added_at}`,
			);
		}
	}

	lines.push("");
	const recent = events.slice(-SHOW_RECENT_EVENT_LIMIT);
	lines.push(`Recent events (last ${recent.length} of ${events.length}):`);
	if (recent.length === 0) {
		lines.push("  (none)");
	} else {
		// Number question_posed events globally so `plot answer` can reference them.
		const questionIndex = buildQuestionIndexMap(events);
		for (const ev of recent) {
			lines.push(`  ${formatEventLine(ev, questionIndex)}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function appendArrayField(lines: string[], label: string, values: readonly string[]): void {
	if (values.length === 0) {
		lines.push(`  ${label}: (none)`);
		return;
	}
	lines.push(`  ${label}:`);
	for (const v of values) {
		lines.push(`    - ${v}`);
	}
}

function formatEventLine(ev: PlotEvent, questionIndex: Map<PlotEvent, string>): string {
	const qid = questionIndex.get(ev);
	const tag = qid ? `[${qid}] ` : "";
	const summary = summarizeEventData(ev);
	return `${ev.at}  ${ev.actor.padEnd(20)}  ${tag}${ev.type}${summary ? `: ${summary}` : ""}`;
}

function summarizeEventData(ev: PlotEvent): string {
	switch (ev.type) {
		case "plot_created":
			return ev.data.name;
		case "intent_edited":
			return `${ev.data.field} = ${formatIntentValue(ev.data.value)}`;
		case "status_changed":
			return `${ev.data.from} → ${ev.data.to}`;
		case "attachment_added":
			return `${ev.data.id} ${ev.data.type}:${ev.data.ref} role=${ev.data.role}`;
		case "attachment_removed":
			return ev.data.id;
		case "run_dispatched":
			return ev.data.run_id;
		case "plan_run_dispatched":
			return `${ev.data.plan_run_id} plan=${ev.data.plan_id} children=${ev.data.children_count}`;
		case "decision_made":
			return ev.data.summary;
		case "question_posed":
			return `${ev.data.blocking ? "blocking " : ""}${ev.data.text}`;
		case "question_answered":
			return `${ev.data.question_id ? `${ev.data.question_id}: ` : ""}${ev.data.text}`;
		case "artifact_produced":
			return `${ev.data.type}:${ev.data.ref}`;
		case "note":
			return ev.data.text;
		default:
			return "";
	}
}

function formatIntentValue(value: string | string[]): string {
	if (Array.isArray(value)) return `[${value.length}]`;
	return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

// ---------------------------------------------------------------------------
// Question ID mapping
//
// Question IDs are synthesized at read time: the Nth `question_posed` event
// in chronological order is referenced as `q-N` (1-based). The CLI surfaces
// these IDs in `plot show` output; `plot answer` looks them up to attach a
// `question_answered` event back to the right question.

export const QUESTION_ID_RE = /^q-(\d+)$/;

export function buildQuestionIndexMap(events: readonly PlotEvent[]): Map<PlotEvent, string> {
	const map = new Map<PlotEvent, string>();
	let count = 0;
	for (const ev of events) {
		if (ev.type === "question_posed") {
			count++;
			map.set(ev, `q-${count}`);
		}
	}
	return map;
}

export function findQuestionByCliId(
	events: readonly PlotEvent[],
	questionId: string,
): PlotEvent | undefined {
	const m = questionId.match(QUESTION_ID_RE);
	if (!m?.[1]) return undefined;
	const target = Number.parseInt(m[1], 10);
	let count = 0;
	for (const ev of events) {
		if (ev.type !== "question_posed") continue;
		count++;
		if (count === target) return ev;
	}
	return undefined;
}
