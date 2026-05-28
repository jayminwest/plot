// `plot doctor` — check file integrity and replay the event log (SPEC §9.3).
//
// For every Plot in PLOT_DIR, doctor verifies:
//   - the JSON file parses and migrates to the current schema version
//   - the events file parses, every line is a known event type with a valid
//     actor, and the first event is `plot_created`
//   - replaying intent_edited / status_changed / attachment_added /
//     attachment_removed events reconstructs the structured fields actually
//     on disk (a divergence means someone edited the JSON without writing
//     the matching event, or the event log was trimmed)
//
// Findings are classified as `error` (corruption that breaks reads) or
// `warning` (drift the SPEC tolerates, like an orphan events file or a
// stranger attachment validation hint from §12.3). Exit code is 1 if any
// error fires, otherwise 0.

import { readdir } from "node:fs/promises";
import { isActor } from "../../actor.ts";
import { isPlotId } from "../../id.ts";
import { listPlotIds, plotEventsPath, plotJsonPath, readEvents, readJson } from "../../io.ts";
import { migratePlot } from "../../migrations.ts";
import {
	type Attachment,
	type Intent,
	PLOT_EVENT_TYPES,
	type Plot,
	type PlotEvent,
	type PlotStatus,
} from "../../types.ts";
import { type CliContext, flagBool, parseArgs, resolveStoreEnv } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

type Severity = "error" | "warning";

interface Finding {
	severity: Severity;
	code: string;
	message: string;
}

interface PlotReport {
	id: string;
	findings: Finding[];
}

interface DoctorReport {
	dir: string;
	plots: PlotReport[];
	orphans: Finding[];
	errorCount: number;
	warningCount: number;
}

const KNOWN_EVENT_TYPES = new Set<string>(PLOT_EVENT_TYPES);

export async function runDoctor(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const { dir } = resolveStoreEnv(ctx.env);

	const ids = await listPlotIds(dir);
	const plotReports: PlotReport[] = [];
	for (const id of ids) {
		plotReports.push(await checkPlot(dir, id));
	}
	const orphans = await checkOrphans(dir, new Set(ids));

	let errorCount = 0;
	let warningCount = 0;
	for (const r of plotReports) {
		for (const f of r.findings) {
			if (f.severity === "error") errorCount++;
			else warningCount++;
		}
	}
	for (const f of orphans) {
		if (f.severity === "error") errorCount++;
		else warningCount++;
	}

	const report: DoctorReport = {
		dir,
		plots: plotReports,
		orphans,
		errorCount,
		warningCount,
	};

	if (flagBool(args, "json")) {
		io.out(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		io.out(formatReport(report));
	}
	return errorCount > 0 ? 1 : 0;
}

async function checkPlot(dir: string, id: string): Promise<PlotReport> {
	const findings: Finding[] = [];

	let plot: Plot | undefined;
	try {
		const raw = await readJson<unknown>(plotJsonPath(dir, id));
		plot = migratePlot(raw);
	} catch (err) {
		findings.push({
			severity: "error",
			code: "plot_unreadable",
			message: `cannot read ${id}.json: ${errMessage(err)}`,
		});
	}

	if (plot && plot.id !== id) {
		findings.push({
			severity: "error",
			code: "id_mismatch",
			message: `${id}.json contains id ${JSON.stringify(plot.id)}`,
		});
	}

	let events: PlotEvent[] | undefined;
	try {
		events = await readEvents<PlotEvent>(plotEventsPath(dir, id), { missingIsEmpty: false });
	} catch (err) {
		findings.push({
			severity: "error",
			code: "events_unreadable",
			message: `cannot read ${id}.events.jsonl: ${errMessage(err)}`,
		});
	}

	if (events) {
		validateEventShape(events, findings);
		if (plot) {
			validateReplay(plot, events, findings);
		}
	}

	return { id, findings };
}

function validateEventShape(events: PlotEvent[], findings: Finding[]): void {
	if (events.length === 0) {
		findings.push({
			severity: "error",
			code: "no_events",
			message: "events.jsonl is empty (expected at least plot_created)",
		});
		return;
	}
	const first = events[0];
	if (first && first.type !== "plot_created") {
		findings.push({
			severity: "error",
			code: "missing_plot_created",
			message: `first event is ${JSON.stringify(first.type)}, expected plot_created`,
		});
	}
	for (let i = 0; i < events.length; i++) {
		const ev = events[i];
		if (!ev) continue;
		const where = `event[${i}]`;
		if (typeof ev.type !== "string" || !KNOWN_EVENT_TYPES.has(ev.type)) {
			findings.push({
				severity: "error",
				code: "unknown_event_type",
				message: `${where}: unknown type ${JSON.stringify(ev.type)}`,
			});
			continue;
		}
		if (typeof ev.actor !== "string" || !isActor(ev.actor)) {
			findings.push({
				severity: "error",
				code: "invalid_actor",
				message: `${where} (${ev.type}): invalid actor ${JSON.stringify(ev.actor)}`,
			});
		}
		if (typeof ev.at !== "string" || Number.isNaN(Date.parse(ev.at))) {
			findings.push({
				severity: "error",
				code: "invalid_timestamp",
				message: `${where} (${ev.type}): invalid timestamp ${JSON.stringify(ev.at)}`,
			});
		}
		if (!ev.data || typeof ev.data !== "object" || Array.isArray(ev.data)) {
			findings.push({
				severity: "error",
				code: "invalid_event_data",
				message: `${where} (${ev.type}): data is not an object`,
			});
		}
	}
}

// Reconstruct the structured fields from the event log and compare against
// what's on disk. A divergence is an error because future agent reads of
// the JSON will be inconsistent with the log.
function validateReplay(plot: Plot, events: PlotEvent[], findings: Finding[]): void {
	const replay = replayPlot(events);
	if (replay.status !== plot.status) {
		findings.push({
			severity: "error",
			code: "status_drift",
			message: `replayed status ${JSON.stringify(replay.status)} != on-disk ${JSON.stringify(plot.status)}`,
		});
	}
	if (!intentEquals(replay.intent, plot.intent)) {
		findings.push({
			severity: "warning",
			code: "intent_drift",
			message: "replayed intent differs from on-disk intent",
		});
	}
	if (!attachmentsEqual(replay.attachments, plot.attachments)) {
		findings.push({
			severity: "error",
			code: "attachments_drift",
			message: `replayed attachments [${replay.attachments.map((a) => a.id).join(",")}] != on-disk [${plot.attachments.map((a) => a.id).join(",")}]`,
		});
	}
}

interface ReplayState {
	status: PlotStatus;
	intent: Intent;
	attachments: Attachment[];
}

function replayPlot(events: PlotEvent[]): ReplayState {
	const state: ReplayState = {
		status: "drafting",
		intent: { goal: "", non_goals: [], constraints: [], success_criteria: [] },
		attachments: [],
	};
	for (const ev of events) {
		switch (ev.type) {
			case "status_changed":
				state.status = ev.data.to;
				break;
			case "intent_edited": {
				const { field, value } = ev.data;
				if (field === "goal") {
					state.intent.goal = typeof value === "string" ? value : "";
				} else if (Array.isArray(value)) {
					state.intent[field] = [...value];
				}
				break;
			}
			case "attachment_added": {
				const a: Attachment = {
					id: ev.data.id,
					type: ev.data.type,
					ref: ev.data.ref,
					role: ev.data.role,
					added_at: ev.at,
					added_by: ev.actor,
				};
				state.attachments.push(a);
				break;
			}
			case "attachment_removed":
				state.attachments = state.attachments.filter((a) => a.id !== ev.data.id);
				break;
			default:
				break;
		}
	}
	return state;
}

function intentEquals(a: Intent, b: Intent): boolean {
	if (a.goal !== b.goal) return false;
	for (const f of ["non_goals", "constraints", "success_criteria"] as const) {
		const x = a[f];
		const y = b[f];
		if (x.length !== y.length) return false;
		for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
	}
	return true;
}

// Replay only tracks attachment identity (add then remove); we compare
// against the on-disk attachments by id alone, since added_at/added_by
// in the event predate any later edits we don't model.
function attachmentsEqual(a: readonly Attachment[], b: readonly Attachment[]): boolean {
	if (a.length !== b.length) return false;
	const idsA = a.map((x) => x.id).sort();
	const idsB = b.map((x) => x.id).sort();
	for (let i = 0; i < idsA.length; i++) if (idsA[i] !== idsB[i]) return false;
	return true;
}

// Surface JSONL files whose paired JSON is missing. Stray `.json` files that
// don't match the plot ID pattern are silently ignored — listPlotIds already
// filters them out.
async function checkOrphans(dir: string, knownIds: Set<string>): Promise<Finding[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const findings: Finding[] = [];
	for (const name of entries) {
		const m = name.match(/^(plot-[a-z0-9]{8})\.events\.jsonl$/);
		if (!m?.[1]) continue;
		const id = m[1];
		if (!isPlotId(id)) continue;
		if (!knownIds.has(id)) {
			findings.push({
				severity: "warning",
				code: "orphan_events",
				message: `${name} has no matching ${id}.json`,
			});
		}
	}
	return findings;
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function formatReport(report: DoctorReport): string {
	const lines: string[] = [];
	lines.push(
		`checked ${report.plots.length} plot${report.plots.length === 1 ? "" : "s"} in ${report.dir}`,
	);
	for (const r of report.plots) {
		if (r.findings.length === 0) {
			lines.push(`  ${r.id}  ok`);
			continue;
		}
		lines.push(`  ${r.id}`);
		for (const f of r.findings) {
			lines.push(`    [${f.severity}] ${f.code}: ${f.message}`);
		}
	}
	for (const f of report.orphans) {
		lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
	}
	lines.push("");
	lines.push(
		`summary: ${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}`,
	);
	return `${lines.join("\n")}\n`;
}
