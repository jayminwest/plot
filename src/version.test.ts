import { expect, test } from "bun:test";
import { VERSION } from "./version.ts";

test("VERSION is a semver string", () => {
	expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
