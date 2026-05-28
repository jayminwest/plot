// Structured logger — a pino instance gated on PLOT_DEBUG.
//
// Plot's command output is structured data emitted through `src/cli/format.ts`
// and the injected `CliIO` streams; this module is the *diagnostic* channel,
// separate from that user-facing output. By default the logger sits at `info`
// and writes JSON; setting `PLOT_DEBUG=1` drops it to `debug` and routes
// through `pino-pretty` for human-readable terminal output (matching the
// activation env var the CLI already documents — no new flag).
//
// Defense-in-depth redaction: secrets (npm tokens, GitHub PATs, API keys,
// passwords, auth/cookie headers) must never reach any log sink. Callers don't
// deliberately log credentials, but the redact paths cover the common slip-ups
// — e.g. logging an error object or request context that happens to carry one.
// See AGENTS.md §"Log scrubbing" for the policy.

import pino from "pino";

// pino redact-path syntax: a bare key matches at the root; `*.key` matches a
// key one level deep under any object. `**.key` is NOT supported, so we pair
// the bare key with the `*.key` wildcard to catch both shapes conservatively.
export const REDACT_PATHS: readonly string[] = [
	"token",
	"apiKey",
	"password",
	"secret",
	"*.token",
	"*.apiKey",
	"*.password",
	"*.secret",
	"headers.authorization",
	"headers.cookie",
];

export interface CreateLogOptions {
	// Force the debug level/transport regardless of PLOT_DEBUG (tests).
	debug?: boolean;
	// Capture output to a stream instead of the default destination (tests).
	// When set, the pino-pretty transport is skipped so output is synchronous
	// and assertable.
	destination?: pino.DestinationStream;
}

export function createLog(options: CreateLogOptions = {}): pino.Logger {
	const debug = options.debug ?? process.env.PLOT_DEBUG === "1";
	const base: pino.LoggerOptions = {
		level: debug ? "debug" : "info",
		redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
	};

	if (debug && !options.destination) {
		base.transport = { target: "pino-pretty" };
		return pino(base);
	}

	return options.destination ? pino(base, options.destination) : pino(base);
}

// Process-wide logger. Level + transport are fixed at import from PLOT_DEBUG.
export const log = createLog();
