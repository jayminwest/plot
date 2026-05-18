import { describe, expect, test } from "bun:test";
import type { CliEnv } from "./runtime.ts";
import { parseArgs, resolveActor, resolvePlotId } from "./runtime.ts";

describe("parseArgs", () => {
	test("positional only", () => {
		expect(parseArgs(["a", "b", "c"])).toEqual({ positional: ["a", "b", "c"], flags: {} });
	});

	test("--flag value form", () => {
		expect(parseArgs(["--role", "tracks", "plot-x"])).toEqual({
			positional: ["plot-x"],
			flags: { role: "tracks" },
		});
	});

	test("--flag=value form", () => {
		expect(parseArgs(["--role=tracks"])).toEqual({ positional: [], flags: { role: "tracks" } });
	});

	test("boolean flag does not consume next token", () => {
		expect(parseArgs(["--json", "plot-x"], { boolean: ["json"] })).toEqual({
			positional: ["plot-x"],
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

describe("resolvePlotId", () => {
	const empty: CliEnv = { get: () => undefined };
	const withEnvId = (id: string): CliEnv => ({
		get: (n) => (n === "PLOT_ID" ? id : undefined),
	});

	test("positional wins over --plot and PLOT_ID", () => {
		const args = parseArgs(["plot-11111111", "--plot", "plot-22222222"]);
		expect(resolvePlotId(args, withEnvId("plot-33333333"))).toBe("plot-11111111");
	});

	test("--plot wins over PLOT_ID", () => {
		const args = parseArgs(["--plot", "plot-22222222"]);
		expect(resolvePlotId(args, withEnvId("plot-33333333"))).toBe("plot-22222222");
	});

	test("falls back to PLOT_ID env", () => {
		const args = parseArgs([]);
		expect(resolvePlotId(args, withEnvId("plot-33333333"))).toBe("plot-33333333");
	});

	test("throws when no source provides an id", () => {
		expect(() => resolvePlotId(parseArgs([]), empty)).toThrow(/PLOT_ID/);
	});

	test("rejects malformed Plot ID", () => {
		expect(() => resolvePlotId(parseArgs(["not-a-plot"]), empty)).toThrow(/invalid Plot ID/);
	});
});
