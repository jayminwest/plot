// `plot show <id>` — pretty-print Plot fields + recent events.

import { formatPlotShow } from "../format.ts";
import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runShow(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	if (!id) {
		io.err("usage: plot show <id>\n");
		return 2;
	}
	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		const [plot, events] = await Promise.all([handle.read(), handle.events()]);
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify({ plot, events }, null, 2)}\n`);
			return 0;
		}
		io.out(formatPlotShow(plot, events));
		return 0;
	});
}
