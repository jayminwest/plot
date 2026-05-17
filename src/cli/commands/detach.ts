// `plot detach <id> <attachment-id>` — remove an attachment by its att-NNN id.

import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runDetach(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	const attachmentId = args.positional[1];
	if (!id || !attachmentId) {
		io.err("usage: plot detach <id> <attachment-id>\n");
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		await handle.detach(attachmentId);
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify({ id, removed: attachmentId })}\n`);
		} else {
			io.out(`removed ${attachmentId} from ${id}\n`);
		}
		return 0;
	});
}
