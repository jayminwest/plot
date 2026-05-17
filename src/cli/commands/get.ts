// `plot get [<id>] --view <name>` — agent-facing view query (SPEC §9.2).
//
// Surfaces a hardcoded view of the Plot so the calling agent can prime its
// context without loading the full event log. V1 only ships the `implementer`
// view (§8.1); unknown view names are rejected with a list of valid options.
//
// Output defaults to JSON since this command is primarily consumed by
// orchestrators and agent runtimes. Pass `--pretty` for a human-readable
// dump when debugging.

import { assertViewName, type ImplementerView } from "../../views.ts";
import {
	type CliContext,
	flagBool,
	flagString,
	parseArgs,
	resolvePlotId,
	withStore,
} from "../runtime.ts";

const SPEC = { boolean: ["pretty"] as const };

export async function runGet(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);

	let plotId: string;
	try {
		plotId = resolvePlotId(args, ctx.env);
	} catch (err) {
		io.err(
			`usage: plot get [<id>] [--plot <id>] [--view implementer] [--pretty]\n  ${(err as Error).message}\n`,
		);
		return 2;
	}

	const viewName = flagString(args, "view") ?? "implementer";
	try {
		assertViewName(viewName);
	} catch (err) {
		io.err(`plot get: ${(err as Error).message}\n`);
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const view = await store.get(plotId).view(viewName);
		if (flagBool(args, "pretty")) {
			io.out(formatImplementerView(plotId, view));
		} else {
			io.out(`${JSON.stringify({ id: plotId, view: viewName, ...view }, null, 2)}\n`);
		}
		return 0;
	});
}

function formatImplementerView(id: string, view: ImplementerView): string {
	const lines: string[] = [];
	lines.push(`${id}  view=implementer`);
	lines.push("");
	lines.push("Intent:");
	lines.push(`  goal: ${view.intent.goal || "(empty)"}`);
	appendArray(lines, "non_goals", view.intent.non_goals);
	appendArray(lines, "constraints", view.intent.constraints);
	appendArray(lines, "success_criteria", view.intent.success_criteria);

	lines.push("");
	lines.push(`Attachments (${view.attachments.length}):`);
	if (view.attachments.length === 0) {
		lines.push("  (none)");
	} else {
		for (const a of view.attachments) {
			lines.push(`  ${a.id}  ${a.type}  ${a.ref}  role=${a.role}`);
		}
	}

	lines.push("");
	lines.push(`Events (${view.events.length}):`);
	if (view.events.length === 0) {
		lines.push("  (none)");
	} else {
		for (const ev of view.events) {
			lines.push(`  ${ev.at}  ${ev.actor}  ${ev.type}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function appendArray(lines: string[], label: string, values: readonly string[]): void {
	if (values.length === 0) {
		lines.push(`  ${label}: (none)`);
		return;
	}
	lines.push(`  ${label}:`);
	for (const v of values) lines.push(`    - ${v}`);
}
