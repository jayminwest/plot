// `plot append [<id>] --event <type> --data <json>` — agent-facing event
// write (SPEC §9.2).
//
// Agents emit `decision_made`, `question_posed`, `artifact_produced`,
// `note`, and `run_dispatched` events through this command. Events that
// mutate the Plot JSON (intent_edited, status_changed, attachment_*) have
// dedicated human-facing commands; attempting to write them here surfaces
// the SPEC §6 redirect ("agents must surface a `question_posed` event …")
// when the actor is an agent, or a CLI hint pointing at the right
// subcommand when the actor is a user.

import { assertCanEmit, isAllowed } from "../../acl.ts";
import { PLOT_EVENT_TYPES, type PlotEventType } from "../../types.ts";
import {
	type CliContext,
	flagBool,
	flagString,
	parseArgs,
	resolveActor,
	resolvePlotId,
	withStore,
} from "../runtime.ts";

const SPEC = { boolean: ["pretty"] as const };

// Events that have dedicated CLI commands; `plot append` rejects them with
// a pointer at the correct subcommand (for users) or at `question_posed`
// (for agents, per SPEC §6 redirects).
const CLI_DISALLOWED_TYPES: Record<string, string> = {
	plot_created: "use `plot init <name>`",
	intent_edited: "use `plot intent <id> --goal ...` or `plot edit <id>`",
	status_changed: "use `plot status <id> <status>`",
	attachment_added: "use `plot attach <id> <type>:<ref> --role <role>`",
	attachment_removed: "use `plot detach <id> <attachment-id>`",
	question_answered: 'use `plot answer <id> <question-id> "..."`',
};

export async function runAppend(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);

	let plotId: string;
	try {
		plotId = resolvePlotId(args, ctx.env);
	} catch (err) {
		io.err(
			`usage: plot append [<id>] [--plot <id>] --event <type> --data <json> [--pretty]\n  ${(err as Error).message}\n`,
		);
		return 2;
	}

	const eventType = flagString(args, "event");
	if (!eventType) {
		io.err("plot append: --event <type> is required\n");
		return 2;
	}
	if (!(PLOT_EVENT_TYPES as readonly string[]).includes(eventType)) {
		io.err(
			`plot append: unknown event type ${JSON.stringify(eventType)} (expected one of ${PLOT_EVENT_TYPES.join(", ")})\n`,
		);
		return 2;
	}
	const typedEvent = eventType as PlotEventType;

	const dataRaw = flagString(args, "data");
	if (dataRaw === undefined) {
		io.err('plot append: --data <json> is required (use --data "{}" for none)\n');
		return 2;
	}
	let data: Record<string, unknown>;
	try {
		const parsed = JSON.parse(dataRaw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			io.err("plot append: --data must be a JSON object\n");
			return 2;
		}
		data = parsed as Record<string, unknown>;
	} catch (err) {
		io.err(`plot append: --data is not valid JSON — ${(err as Error).message}\n`);
		return 2;
	}

	// Resolve the actor up front so we can produce ACL-aware hints below.
	// Bubble the same error as withStore would have raised on missing actor.
	const actor = resolveActor(ctx.env);

	// SPEC §6: surface the ACL redirect first when the actor is forbidden
	// from this event type. This catches `plot append --event intent_edited`
	// from an agent and points them at `question_posed` per the acceptance
	// criterion in pl-f853 / plot-95ed.
	if (!isAllowed(actor, typedEvent)) {
		try {
			assertCanEmit(actor, typedEvent);
		} catch (err) {
			io.err(`plot append: ${(err as Error).message}\n`);
			return 1;
		}
	}

	// Events with dedicated subcommands: redirect rather than calling the
	// library (which would surface a library-API message about "use
	// PlotHandle.editIntent()" — not useful from the CLI).
	const redirect = CLI_DISALLOWED_TYPES[typedEvent];
	if (redirect) {
		io.err(
			`plot append: event ${JSON.stringify(typedEvent)} has a dedicated command — ${redirect}\n`,
		);
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const event = await store.get(plotId).append({ type: typedEvent, data });
		if (flagBool(args, "pretty")) {
			io.out(`appended ${event.type} to ${plotId} at ${event.at}\n`);
		} else {
			io.out(`${JSON.stringify({ id: plotId, event }, null, 2)}\n`);
		}
		return 0;
	});
}
