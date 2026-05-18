import { describe, expect, test } from "bun:test";
import { type Migration, migratePlot } from "./migrations.ts";
import { type Plot, SCHEMA_VERSION } from "./types.ts";

const currentPlot: Plot = {
	schema_version: SCHEMA_VERSION,
	id: "plot-aaaaaaaa",
	name: "X",
	status: "drafting",
	created_at: "2026-05-17T10:00:00.000Z",
	updated_at: "2026-05-17T10:00:00.000Z",
	intent: { goal: "", non_goals: [], constraints: [], success_criteria: [] },
	attachments: [],
};

describe("migratePlot", () => {
	test("returns the input unchanged when already at SCHEMA_VERSION", () => {
		const result = migratePlot(currentPlot);
		expect(result).toEqual(currentPlot);
	});

	test("rejects non-object input", () => {
		expect(() => migratePlot(null)).toThrow(/must be a Plot object/);
		expect(() => migratePlot("oops")).toThrow(/must be a Plot object/);
		expect(() => migratePlot([])).toThrow(/must be a Plot object/);
	});

	test("rejects missing schema_version", () => {
		expect(() => migratePlot({ id: "plot-aaaaaaaa" })).toThrow(/missing or invalid schema_version/);
	});

	test("rejects negative or non-integer schema_version", () => {
		expect(() => migratePlot({ schema_version: -1 })).toThrow(/missing or invalid schema_version/);
		expect(() => migratePlot({ schema_version: 1.5 })).toThrow(/missing or invalid schema_version/);
		expect(() => migratePlot({ schema_version: "1" })).toThrow(/missing or invalid schema_version/);
	});

	test("rejects schema_version newer than supported", () => {
		expect(() => migratePlot({ ...currentPlot, schema_version: SCHEMA_VERSION + 1 })).toThrow(
			/newer Plot/,
		);
	});

	test("throws when no migration is registered for an older version", () => {
		// DEFAULT_MIGRATIONS is empty in V1, so any version < SCHEMA_VERSION trips here.
		expect(() => migratePlot({ ...currentPlot, schema_version: 0 })).toThrow(
			/no migration registered from schema_version 0/,
		);
	});

	test("chains a synthetic legacy fixture from v0 → v1", () => {
		// Pretend v0 had no `success_criteria` field; v1 adds it.
		const legacy = {
			schema_version: 0,
			id: "plot-legacy00",
			name: "L",
			status: "drafting",
			created_at: "2026-05-17T10:00:00.000Z",
			updated_at: "2026-05-17T10:00:00.000Z",
			intent: { goal: "g", non_goals: [], constraints: [] },
			attachments: [],
		};
		const v0to1: Migration = {
			from: 0,
			to: 1,
			migrate: (raw) => ({
				...raw,
				intent: {
					...(raw.intent as Record<string, unknown>),
					success_criteria: [],
				},
			}),
		};
		const result = migratePlot(legacy, { migrations: [v0to1] });
		expect(result.schema_version).toBe(SCHEMA_VERSION);
		expect(result.intent.success_criteria).toEqual([]);
		expect(result.intent.goal).toBe("g");
		expect(result.id).toBe("plot-legacy00");
	});

	test("rejects a migration whose `to` does not equal `from + 1`", () => {
		const skip: Migration = {
			from: 0,
			to: 2,
			migrate: (raw) => raw,
		};
		expect(() =>
			migratePlot({ ...currentPlot, schema_version: 0 }, { migrations: [skip] }),
		).toThrow(/must step to 1, got 2/);
	});

	test("rejects a migration that returns a non-object", () => {
		const broken: Migration = {
			from: 0,
			to: 1,
			migrate: () => null as unknown as Record<string, unknown>,
		};
		expect(() =>
			migratePlot({ ...currentPlot, schema_version: 0 }, { migrations: [broken] }),
		).toThrow(/returned non-object/);
	});

	test("does not mutate the input object", () => {
		const legacy = {
			schema_version: 0,
			id: "plot-legacy00",
			intent: { goal: "g" },
		};
		const snapshot = JSON.parse(JSON.stringify(legacy));
		const v0to1: Migration = {
			from: 0,
			to: 1,
			migrate: (raw) => ({ ...raw, intent: { ...(raw.intent as object), extra: true } }),
		};
		migratePlot(legacy, { migrations: [v0to1] });
		expect(legacy).toEqual(snapshot);
	});
});
