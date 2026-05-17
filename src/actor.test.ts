import { describe, expect, test } from "bun:test";
import { formatActor, isActor, parseActor } from "./actor.ts";

describe("isActor", () => {
	test.each([
		"user:jw",
		"user:jaymin-west",
		"agent:warren",
		"agent:claude_code",
		"agent:claude_code:run-456",
	])("accepts %s", (value) => {
		expect(isActor(value)).toBe(true);
	});

	test.each([
		"",
		"jw",
		"user:",
		"user:_leading",
		"agent:",
		"agent:claude_code:",
		"agent:claude_code:run-456:extra",
		"USER:jw",
		"user: jw",
		"user:jw ",
	])("rejects %s", (value) => {
		expect(isActor(value)).toBe(false);
	});
});

describe("parseActor", () => {
	test("parses user actor", () => {
		expect(parseActor("user:jw")).toEqual({ kind: "user", handle: "jw", raw: "user:jw" });
	});

	test("parses bare agent", () => {
		expect(parseActor("agent:warren")).toEqual({
			kind: "agent",
			name: "warren",
			raw: "agent:warren",
		});
	});

	test("parses agent with run ID", () => {
		expect(parseActor("agent:claude_code:run-456")).toEqual({
			kind: "agent",
			name: "claude_code",
			runId: "run-456",
			raw: "agent:claude_code:run-456",
		});
	});

	test("throws on garbage", () => {
		expect(() => parseActor("nope")).toThrow(/invalid actor/);
	});
});

describe("formatActor", () => {
	test("round-trips user actors", () => {
		const raw = "user:jw";
		expect(formatActor(parseActor(raw))).toBe(raw);
	});

	test("round-trips agent actors with and without run ID", () => {
		for (const raw of ["agent:warren", "agent:claude_code:run-456"]) {
			expect(formatActor(parseActor(raw))).toBe(raw);
		}
	});
});
