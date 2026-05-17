// `plot init <name>` — create a new Plot, return its ID.

import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runInit(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const name = args.positional[0];
	if (!name) {
		io.err("usage: plot init <name>\n");
		return 2;
	}
	if (args.positional.length > 1) {
		io.err('usage: plot init <name>  (multi-word names must be quoted: plot init "Add OAuth")\n');
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = await store.create({ name });
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify({ id: handle.id, name })}\n`);
		} else {
			io.out(`${handle.id}\n`);
		}
		return 0;
	});
}
