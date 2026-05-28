// `plot answer <id> <question-id> "..."` — record a question_answered event.
//
// Question IDs are synthesized at read time as `q-N`, where N is the 1-based
// position of the `question_posed` event in the chronological log. `plot show`
// surfaces these IDs so a human can reply by copying one.

import { findQuestionByCliId, QUESTION_ID_RE } from "../format.ts";
import { type CliContext, flagBool, parseArgs, withStore } from "../runtime.ts";

const SPEC = { boolean: ["json"] as const };

export async function runAnswer(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	const questionId = args.positional[1];
	const text = args.positional[2];
	if (!id || !questionId || !text) {
		io.err('usage: plot answer <id> <question-id> "<answer text>"\n');
		return 2;
	}
	if (!QUESTION_ID_RE.test(questionId)) {
		io.err(`plot answer: question id must look like q-1 (got ${JSON.stringify(questionId)})\n`);
		return 2;
	}

	return withStore(ctx.env, async (store) => {
		const handle = store.get(id);
		const events = await handle.events();
		const question = findQuestionByCliId(events, questionId);
		if (!question) {
			io.err(`plot answer: no question ${questionId} on ${id}\n`);
			return 1;
		}
		const event = await handle.append({
			type: "question_answered",
			data: { question_id: questionId, text },
		});
		if (flagBool(args, "json")) {
			io.out(`${JSON.stringify(event, null, 2)}\n`);
		} else {
			io.out(`answered ${questionId} on ${id}\n`);
		}
		return 0;
	});
}
