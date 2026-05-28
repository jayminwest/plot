// `plot status <id> <status>` — transition a Plot's status.

import { PLOT_STATUSES, type PlotStatus } from "../../types.ts";
import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runStatus(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	const next = args.positional[1];
	if (!id || !next) {
		io.err(`usage: plot status <id> <${PLOT_STATUSES.join("|")}>\n`);
		return 2;
	}
	if (!(PLOT_STATUSES as readonly string[]).includes(next)) {
		io.err(
			`plot status: invalid status ${JSON.stringify(next)} (expected one of ${PLOT_STATUSES.join(", ")})\n`,
		);
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		const plot = await handle.setStatus(next as PlotStatus);
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify({ id: plot.id, status: plot.status }, null, 2)}\n`);
		} else {
			io.out(`${plot.id} → ${plot.status}\n`);
		}
		return 0;
	});
}
