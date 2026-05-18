// `plot rebuild-index` — wipe the SQLite cache and regenerate it from the
// `.plot/plot-*.json` source files (SPEC §9.3, §5.4 invariant).
//
// The index is purely derived state, so a full rebuild is always safe: it
// drops every row and reinserts from the JSON files on disk. Useful after a
// fresh clone (the gitignored `.index.db` is missing) or to recover from any
// suspected drift. PlotIndex.rebuild already wraps the wipe + reinsert in a
// single transaction.

import { listPlotIds } from "../../io.ts";
import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runRebuildIndex(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	return withStore(ctx.env, async (store) => {
		await store.index.rebuild(store.dir);
		const ids = await listPlotIds(store.dir);
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify({ rebuilt: ids.length, dir: store.dir })}\n`);
		} else {
			io.out(
				`rebuilt index for ${ids.length} plot${ids.length === 1 ? "" : "s"} in ${store.dir}\n`,
			);
		}
		return 0;
	});
}
