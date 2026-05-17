import { describe, expect, test } from "bun:test";
import { eventSchema, plotSchema } from "./schemas.ts";
import { ATTACHMENT_TYPES, PLOT_EVENT_TYPES, PLOT_STATUSES, SCHEMA_VERSION } from "./types.ts";

describe("plotSchema", () => {
	test("declares draft 2020-12 and stable $id", () => {
		expect(plotSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(plotSchema.$id).toBe("https://os-eco.dev/plot/schemas/plot.json");
		expect(plotSchema.title).toBe("Plot");
	});

	test("locks schema_version to SCHEMA_VERSION", () => {
		expect(plotSchema.properties.schema_version.const).toBe(SCHEMA_VERSION);
	});

	test("status enum matches PLOT_STATUSES", () => {
		expect(plotSchema.properties.status.enum).toEqual([...PLOT_STATUSES]);
	});

	test("attachment type enum matches ATTACHMENT_TYPES", () => {
		expect(plotSchema.properties.attachments.items.properties.type.enum).toEqual([
			...ATTACHMENT_TYPES,
		]);
	});

	test("required fields cover the full Plot object", () => {
		expect([...plotSchema.required].sort() as string[]).toEqual(
			[
				"attachments",
				"created_at",
				"id",
				"intent",
				"name",
				"schema_version",
				"status",
				"updated_at",
			].sort(),
		);
	});

	test("intent required fields match INTENT_FIELDS", () => {
		expect([...plotSchema.properties.intent.required].sort() as string[]).toEqual(
			["constraints", "goal", "non_goals", "success_criteria"].sort(),
		);
	});

	test("disallows extra properties at the top level", () => {
		expect(plotSchema.additionalProperties).toBe(false);
	});

	test("can be serialized to JSON", () => {
		expect(() => JSON.stringify(plotSchema)).not.toThrow();
	});
});

describe("eventSchema", () => {
	test("type enum matches PLOT_EVENT_TYPES", () => {
		expect(eventSchema.properties.type.enum).toEqual([...PLOT_EVENT_TYPES]);
	});

	test("has one oneOf branch per event type", () => {
		expect(eventSchema.oneOf.length).toBe(PLOT_EVENT_TYPES.length);
		const branchTypes = eventSchema.oneOf.map((b) => b.properties.type.const);
		expect([...branchTypes].sort()).toEqual([...PLOT_EVENT_TYPES].sort());
	});

	test("can be serialized to JSON", () => {
		expect(() => JSON.stringify(eventSchema)).not.toThrow();
	});
});
