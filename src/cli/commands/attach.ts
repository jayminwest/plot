// `plot attach <id> <type>:<ref> --role <role>` — attach a typed reference.

import { ATTACHMENT_TYPES, type AttachmentType } from "../../types.ts";
import { type CliContext, flagBool, flagString, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runAttach(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	const target = args.positional[1];
	if (!id || !target) {
		io.err("usage: plot attach <id> <type>:<ref> --role <role>\n");
		return 2;
	}

	const colon = target.indexOf(":");
	if (colon <= 0 || colon === target.length - 1) {
		io.err(
			`plot attach: expected <type>:<ref> (e.g. seeds_issue:sd-123), got ${JSON.stringify(target)}\n`,
		);
		return 2;
	}
	const type = target.slice(0, colon);
	const ref = target.slice(colon + 1);
	if (!(ATTACHMENT_TYPES as readonly string[]).includes(type)) {
		io.err(
			`plot attach: unknown attachment type ${JSON.stringify(type)} (expected one of ${ATTACHMENT_TYPES.join(", ")})\n`,
		);
		return 2;
	}

	const role = flagString(args, "role");
	if (!role) {
		io.err("plot attach: --role is required\n");
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		const attachment = await handle.attach({ type: type as AttachmentType, ref, role });
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify(attachment, null, 2)}\n`);
		} else {
			io.out(`${attachment.id}  ${attachment.type}  ${attachment.ref}  role=${attachment.role}\n`);
		}
		return 0;
	});
}
