// CLI router — discovers the subcommand, delegates to its module.
//
// Commands are registered in a flat map; each handler receives the raw argv
// tail and parses it with a command-specific spec. Top-level `--help` and
// `--version` short-circuit before dispatch. Errors thrown by handlers turn
// into exit code 1 with a stderr message — no stack traces on stderr in the
// default path (set PLOT_DEBUG=1 to route the full diagnostic through the
// debug logger).

import { log } from "../log.ts";
import { VERSION } from "../version.ts";
import { runAnswer } from "./commands/answer.ts";
import { runAppend } from "./commands/append.ts";
import { runAttach } from "./commands/attach.ts";
import { runDetach } from "./commands/detach.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runEdit } from "./commands/edit.ts";
import { runGet } from "./commands/get.ts";
import { runInit } from "./commands/init.ts";
import { runIntent } from "./commands/intent.ts";
import { runList } from "./commands/list.ts";
import { runRebuildIndex } from "./commands/rebuild-index.ts";
import { runShow } from "./commands/show.ts";
import { runStatus } from "./commands/status.ts";
import { runSync } from "./commands/sync.ts";
import type { CliContext, CliEnv, CliIO } from "./runtime.ts";

type CommandFn = (ctx: CliContext) => Promise<number>;

const COMMANDS: Record<string, { run: CommandFn; summary: string }> = {
	init: { run: runInit, summary: "create a new Plot, return its ID" },
	list: { run: runList, summary: "list all Plots in .plot/" },
	show: { run: runShow, summary: "pretty-print Plot fields + recent events" },
	edit: { run: runEdit, summary: "open intent in $EDITOR" },
	intent: { run: runIntent, summary: "non-interactive intent edit" },
	status: { run: runStatus, summary: "transition a Plot's status" },
	attach: { run: runAttach, summary: "attach a typed reference" },
	detach: { run: runDetach, summary: "remove an attachment" },
	answer: { run: runAnswer, summary: "answer an agent-posed question" },
	get: { run: runGet, summary: "render a view (agent-facing, default JSON)" },
	append: { run: runAppend, summary: "append an event (agent-facing)" },
	"rebuild-index": { run: runRebuildIndex, summary: "wipe and regenerate the SQLite cache" },
	sync: { run: runSync, summary: "stage + commit .plot/ source files" },
	doctor: { run: runDoctor, summary: "check file integrity + event log replay" },
};

export interface RunCliOptions {
	argv: readonly string[];
	io: CliIO;
	env: CliEnv;
}

export async function runCli(opts: RunCliOptions): Promise<number> {
	const { argv, io, env } = opts;
	const first = argv[0];

	if (!first || first === "--help" || first === "-h" || first === "help") {
		io.out(renderHelp());
		return first ? 0 : 1;
	}
	if (first === "--version" || first === "-v") {
		io.out(`${VERSION}\n`);
		return 0;
	}

	const cmd = COMMANDS[first];
	if (!cmd) {
		io.err(`plot: unknown command ${JSON.stringify(first)}\n\n`);
		io.err(renderHelp());
		return 2;
	}

	const ctx: CliContext = { argv: argv.slice(1), io, env };
	try {
		return await cmd.run(ctx);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		io.err(`plot ${first}: ${message}\n`);
		if (env.get("PLOT_DEBUG")) {
			// Route the full diagnostic (stack + any context) through the pino
			// logger rather than the user-facing IO stream. The logger only
			// surfaces this when PLOT_DEBUG=1 (its level is debug), and its
			// redact paths scrub any secrets that rode along on the error.
			log.debug({ err, command: first }, "command failed");
		}
		return 1;
	}
}

function renderHelp(): string {
	const names = Object.keys(COMMANDS);
	const width = Math.max(...names.map((n) => n.length));
	const lines: string[] = [
		`plot ${VERSION} — coordination substrate for multi-agent work`,
		"",
		"Usage: plot <command> [options]",
		"",
		"Commands:",
	];
	for (const name of names) {
		const entry = COMMANDS[name];
		if (!entry) continue;
		lines.push(`  ${name.padEnd(width)}  ${entry.summary}`);
	}
	lines.push("");
	lines.push("Global options:");
	lines.push("  --help, -h     Show this help");
	lines.push("  --version, -v  Print version");
	lines.push("");
	lines.push("Per-command options:");
	lines.push("  --json         Machine-readable output; supported by most subcommands");
	lines.push("");
	lines.push("Env:");
	lines.push("  PLOT_DIR       Plot directory (default: .plot)");
	lines.push("  PLOT_ACTOR     Override actor (e.g. user:jw, agent:claude:run-1)");
	lines.push("  PLOT_ID        Default Plot ID for agent commands (`get`, `append`)");
	lines.push("  PLOT_DEBUG     Set to 1 to route diagnostics through the debug logger");
	lines.push("");
	return `${lines.join("\n")}\n`;
}
