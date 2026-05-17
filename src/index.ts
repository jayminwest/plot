#!/usr/bin/env bun
import { VERSION } from "./version.ts";

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
	const arg = Bun.argv[2];

	if (arg === "--version" || arg === "-v") {
		console.log(VERSION);
		process.exit(0);
	}

	console.log(`plot ${VERSION}`);
	console.log("");
	console.log("Plot is in design phase — see SPEC.md. CLI is not yet implemented.");
	process.exit(0);
}
