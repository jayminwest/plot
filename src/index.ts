#!/usr/bin/env bun
import { VERSION } from "./version.ts";

export * from "./actor.ts";
export * from "./id.ts";
export { eventSchema, plotSchema } from "./schemas.ts";
export * from "./types.ts";
export { VERSION } from "./version.ts";

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
