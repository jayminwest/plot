// `plot sync` — stage and commit `.plot/` source files (SPEC §9.3).
//
// Stages only the source-of-truth files — `plot-*.json` and `plot-*.events.jsonl`
// — explicitly. The SQLite cache (`.index.db` and its `-wal` / `-shm`
// sidecars) is purely derived (§5.4) and must not be committed; this command
// never adds it regardless of the project's `.gitignore`.
//
// If there's nothing to commit, the command exits 0 with a friendly message
// rather than treating "no changes" as an error.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { listPlotIds } from "../../io.ts";
import {
	type CliContext,
	flagBool,
	flagString,
	type ParsedArgs,
	parseArgs,
	resolveStoreEnv,
} from "../runtime.ts";

const SPEC = {
	boolean: ["json"] as const,
	aliases: { m: "message" } as const,
};

const DEFAULT_MESSAGE = "plot: sync";

export async function runSync(ctx: CliContext): Promise<number> {
	const { io } = ctx;
	const args = parseArgs(ctx.argv, SPEC);
	const message = flagString(args, "message") ?? DEFAULT_MESSAGE;
	const { dir } = resolveStoreEnv(ctx.env);

	const ids = await listPlotIds(dir);
	if (ids.length === 0) {
		emit(
			io,
			args,
			{ staged: 0, committed: false, reason: "no plots" },
			`no plots in ${dir} — nothing to sync\n`,
		);
		return 0;
	}

	const paths: string[] = [];
	for (const id of ids) {
		paths.push(join(dir, `${id}.json`));
		paths.push(join(dir, `${id}.events.jsonl`));
	}

	// `--ignore-errors` keeps `git add` from failing on a missing events file
	// (a freshly-created Plot already has one event written, but be defensive).
	const add = spawnSync("git", ["add", "--ignore-errors", "--", ...paths], {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf-8",
	});
	if (add.status !== 0) {
		io.err(`plot sync: git add failed (${add.status})\n${add.stderr}`);
		return 1;
	}

	// `git diff --cached --quiet` exits 0 when there are no staged changes, 1
	// when there are. Any other exit code is an error.
	const diff = spawnSync("git", ["diff", "--cached", "--quiet", "--", ...paths], {
		stdio: ["ignore", "ignore", "pipe"],
		encoding: "utf-8",
	});
	if (diff.status === 0) {
		emit(
			io,
			args,
			{ staged: paths.length, committed: false, reason: "nothing to commit" },
			`nothing to commit in ${dir}\n`,
		);
		return 0;
	}
	if (diff.status !== 1) {
		io.err(`plot sync: git diff failed (${diff.status})\n${diff.stderr}`);
		return 1;
	}

	const commit = spawnSync("git", ["commit", "-m", message, "--", ...paths], {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf-8",
	});
	if (commit.status !== 0) {
		io.err(`plot sync: git commit failed (${commit.status})\n${commit.stderr}`);
		return 1;
	}

	emit(
		io,
		args,
		{ staged: paths.length, committed: true, message },
		`committed ${dir} with message ${JSON.stringify(message)}\n`,
	);
	return 0;
}

function emit(
	io: CliContext["io"],
	args: ParsedArgs,
	jsonPayload: Record<string, unknown>,
	text: string,
): void {
	if (flagBool(args, "json")) {
		io.out(`${JSON.stringify(jsonPayload)}\n`);
	} else {
		io.out(text);
	}
}
