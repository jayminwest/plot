#!/usr/bin/env bun
import { VERSION } from "./version.ts";

const arg = Bun.argv[2];

if (arg === "--version" || arg === "-v") {
	console.log(VERSION);
	process.exit(0);
}

console.log(`plot ${VERSION}`);
console.log("");
console.log("Plot is in design phase — see SPEC.md. CLI is not yet implemented.");
process.exit(0);
