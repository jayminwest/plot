// `plot list` — list all Plots in .plot/.

import { formatPlotList } from "../format.ts";
import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runList(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	return withStore(ctx.env, async (store) => {
		// Rebuild before query so the index reflects on-disk state even if the
		// SQLite file was wiped (e.g. fresh clone) since the last write.
		await store.index.rebuild(store.dir);
		const result = await store.index.query();
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify(result.rows, null, 2)}\n`);
			return 0;
		}
		io.out(formatPlotList(result.rows));
		return 0;
	});
}
