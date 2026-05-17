import { describe, expect, test } from "bun:test";
import { parseArgs, resolveActor } from "./runtime.ts";

describe("parseArgs", () => {
	test("positional only", () => {
		expect(parseArgs(["a", "b", "c"])).toEqual({ positional: ["a", "b", "c"], flags: {} });
	});

	test("--flag value form", () => {
		expect(parseArgs(["--role", "tracks", "pl-x"])).toEqual({
			positional: ["pl-x"],
			flags: { role: "tracks" },
		});
	});

	test("--flag=value form", () => {
		expect(parseArgs(["--role=tracks"])).toEqual({ positional: [], flags: { role: "tracks" } });
	});

	test("boolean flag does not consume next token", () => {
		expect(parseArgs(["--json", "pl-x"], { boolean: ["json"] })).toEqual({
			positional: ["pl-x"],
			flags: { json: true },
		});
	});

	test("repeated flags collect", () => {
		expect(parseArgs(["--non-goal", "a", "--non-goal", "b"], { repeated: ["non-goal"] })).toEqual({
			positional: [],
			flags: { "non-goal": ["a", "b"] },
		});
	});

	test("aliases canonicalize", () => {
		expect(
			parseArgs(["--non-goals", "a"], {
				repeated: ["non-goal"],
				aliases: { "non-goals": "non-goal" },
			}),
		).toEqual({ positional: [], flags: { "non-goal": ["a"] } });
	});

	test("-- terminates flag parsing", () => {
		expect(parseArgs(["--role", "x", "--", "--not-a-flag"])).toEqual({
			positional: ["--not-a-flag"],
			flags: { role: "x" },
		});
	});

	test("throws when value-flag missing value", () => {
		expect(() => parseArgs(["--role"])).toThrow(/requires a value/);
	});

	test("does not treat negative numbers as flags", () => {
		expect(parseArgs(["-5"])).toEqual({ positional: ["-5"], flags: {} });
	});
});

describe("resolveActor", () => {
	test("PLOT_ACTOR wins", () => {
		const env = { get: (n: string) => (n === "PLOT_ACTOR" ? "agent:claude:run-7" : undefined) };
		const actor = resolveActor(env);
		expect(actor).toEqual({
			kind: "agent",
			name: "claude",
			runId: "run-7",
			raw: "agent:claude:run-7",
		});
	});

	test("invalid PLOT_ACTOR throws", () => {
		const env = { get: (n: string) => (n === "PLOT_ACTOR" ? "not-an-actor" : undefined) };
		expect(() => resolveActor(env)).toThrow(/not a valid actor/);
	});
});
