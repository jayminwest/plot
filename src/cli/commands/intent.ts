// `plot intent <id> --goal "..." --non-goals "..."* --constraints "..."* --success-criteria "..."*`
//
// Non-interactive intent edit. Each list flag is repeatable and REPLACES the
// current list (rather than appending) so the CLI is idempotent and easy to
// script. To extend an existing list, pass the previous values plus the new
// ones. Interactive editing lives in `plot edit`.

import type { Intent } from "../../types.ts";
import {
	type CliContext,
	flagBool,
	flagString,
	flagStringArray,
	hasFlag,
	parseArgs,
	withStore,
} from "../runtime.ts";

const SPEC = {
	repeated: ["non-goals", "constraints", "success-criteria"] as const,
	boolean: ["json"] as const,
	aliases: {
		"non-goal": "non-goals",
		constraint: "constraints",
		"success-criterion": "success-criteria",
	} as const,
};

export async function runIntent(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	if (!id) {
		io.err(
			"usage: plot intent <id> [--goal ...] [--non-goals ...]* [--constraints ...]* [--success-criteria ...]*\n",
		);
		return 2;
	}

	const patch: Partial<Intent> = {};
	const goal = flagString(args, "goal");
	if (goal !== undefined) patch.goal = goal;
	if (hasFlag(args, "non-goals")) patch.non_goals = flagStringArray(args, "non-goals");
	if (hasFlag(args, "constraints")) patch.constraints = flagStringArray(args, "constraints");
	if (hasFlag(args, "success-criteria")) {
		patch.success_criteria = flagStringArray(args, "success-criteria");
	}

	if (Object.keys(patch).length === 0) {
		io.err(
			"plot intent: nothing to update (pass at least one of --goal, --non-goals, --constraints, --success-criteria)\n",
		);
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		const plot = await handle.editIntent(patch);
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify(plot.intent, null, 2)}\n`);
		} else {
			io.out(`updated intent on ${plot.id}\n`);
		}
		return 0;
	});
}
