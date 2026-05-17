// `plot edit <id>` — open the Plot's intent in $EDITOR.
//
// We serialize the current intent to a temp JSON file, spawn the editor
// inheriting the user's TTY, then diff the saved buffer against the original
// and call PlotHandle.editIntent with the deltas. JSON keeps the surface
// dependency-free; intent fields are small enough that JSON is reasonable
// to hand-edit. Validation errors from editIntent surface verbatim.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INTENT_FIELDS, type Intent } from "../../types.ts";
import { type CliContext, parseArgs, withStore } from "../runtime.ts";

const SPEC = {};

const EDITOR_PREAMBLE = [
	"// Edit the intent below. Save and exit when done. Quit without saving to abort.",
	"// Fields: goal (string), non_goals/constraints/success_criteria (arrays of strings).",
	"",
].join("\n");

export async function runEdit(ctx: CliContext): Promise<number> {
	const { io, env } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const id = args.positional[0];
	if (!id) {
		io.err("usage: plot edit <id>\n");
		return 2;
	}

	return withStore(env, async (store) => {
		const handle = store.get(id);
		const plot = await handle.read();
		const before = projectIntent(plot.intent);
		const editorCmd = env.get("VISUAL") || env.get("EDITOR") || "vi";

		const tmpDir = await mkdtemp(join(tmpdir(), "plot-edit-"));
		const tmpFile = join(tmpDir, `${id}.intent.json`);
		try {
			await writeFile(tmpFile, `${EDITOR_PREAMBLE}${JSON.stringify(before, null, 2)}\n`, "utf-8");
			const result = spawnSync(editorCmd, [tmpFile], { stdio: "inherit" });
			if (result.status !== 0) {
				io.err(`plot edit: editor ${JSON.stringify(editorCmd)} exited ${result.status}\n`);
				return 1;
			}
			const raw = await readFile(tmpFile, "utf-8");
			const stripped = raw
				.split("\n")
				.filter((line) => !line.trimStart().startsWith("//"))
				.join("\n")
				.trim();
			if (!stripped) {
				io.err("plot edit: no content after editor; aborting\n");
				return 1;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(stripped);
			} catch (err) {
				io.err(
					`plot edit: edited file is not valid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
				);
				return 1;
			}
			let patch: Partial<Intent>;
			try {
				patch = diffIntent(before, parsed);
			} catch (err) {
				io.err(`${err instanceof Error ? err.message : String(err)}\n`);
				return 1;
			}
			if (Object.keys(patch).length === 0) {
				io.out("no changes\n");
				return 0;
			}
			const updated = await handle.editIntent(patch);
			io.out(`updated intent on ${updated.id}\n`);
			return 0;
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
}

function projectIntent(intent: Intent): Intent {
	return {
		goal: intent.goal,
		non_goals: [...intent.non_goals],
		constraints: [...intent.constraints],
		success_criteria: [...intent.success_criteria],
	};
}

// Compare edited shape against the original and return only changed fields.
// Returns `{}` for no changes. Returns the full patch on differences; passes
// invalid shapes straight through to editIntent so its validation messages
// stay the single source of truth.
function diffIntent(before: Intent, after: unknown): Partial<Intent> {
	if (!after || typeof after !== "object" || Array.isArray(after)) {
		throw new Error("plot edit: edited content must be a JSON object");
	}
	const obj = after as Record<string, unknown>;
	const patch: Partial<Intent> = {};
	for (const field of INTENT_FIELDS) {
		if (!(field in obj)) continue;
		const next = obj[field];
		if (field === "goal") {
			if (next !== before.goal) patch.goal = next as string;
			continue;
		}
		if (!arraysEqual(before[field], next)) {
			(patch as Record<string, unknown>)[field] = next;
		}
	}
	return patch;
}

function arraysEqual(a: readonly unknown[], b: unknown): boolean {
	if (!Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
