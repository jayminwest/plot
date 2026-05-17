#!/usr/bin/env bun
import { runCli } from "./cli/router.ts";
import { processEnv, processIO } from "./cli/runtime.ts";

export * from "./acl.ts";
export * from "./actor.ts";
export * from "./id.ts";
export * from "./io.ts";
export * from "./lock.ts";
export * from "./migrations.ts";
export * from "./plot-index.ts";
export { eventSchema, plotSchema } from "./schemas.ts";
export { SQLitePlotIndex } from "./sqlite-index.ts";
export * from "./store.ts";
export * from "./types.ts";
export { VERSION } from "./version.ts";
export * from "./views.ts";

if (import.meta.main) {
	const exit = await runCli({
		argv: Bun.argv.slice(2),
		io: processIO(),
		env: processEnv(),
	});
	process.exit(exit);
}
