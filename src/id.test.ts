import { describe, expect, test } from "bun:test";
import {
	assertAttachmentId,
	assertPlotId,
	generatePlotId,
	isAttachmentId,
	isPlotId,
	nextAttachmentId,
} from "./id.ts";

describe("isPlotId", () => {
	test("accepts spec example", () => {
		expect(isPlotId("pl-abc12345")).toBe(true);
	});

	test("rejects wrong prefix, length, casing", () => {
		expect(isPlotId("PL-abc12345")).toBe(false);
		expect(isPlotId("pl-abc1234")).toBe(false);
		expect(isPlotId("pl-abc123456")).toBe(false);
		expect(isPlotId("pl-ABC12345")).toBe(false);
		expect(isPlotId("sd-abc12345")).toBe(false);
		expect(isPlotId("plabc12345")).toBe(false);
	});
});

describe("isAttachmentId", () => {
	test("accepts att-001 .. att-999", () => {
		expect(isAttachmentId("att-001")).toBe(true);
		expect(isAttachmentId("att-999")).toBe(true);
	});

	test("rejects malformed", () => {
		expect(isAttachmentId("att-1")).toBe(false);
		expect(isAttachmentId("att-0001")).toBe(false);
		expect(isAttachmentId("ATT-001")).toBe(false);
		expect(isAttachmentId("att-abc")).toBe(false);
	});
});

describe("assert helpers", () => {
	test("assertPlotId throws on bad input", () => {
		expect(() => assertPlotId("nope")).toThrow(/invalid Plot ID/);
		expect(() => assertPlotId("pl-abc12345")).not.toThrow();
	});

	test("assertAttachmentId throws on bad input", () => {
		expect(() => assertAttachmentId("att-1")).toThrow(/invalid attachment ID/);
		expect(() => assertAttachmentId("att-042")).not.toThrow();
	});
});

describe("generatePlotId", () => {
	test("returns a valid pl- ID", () => {
		const id = generatePlotId();
		expect(isPlotId(id)).toBe(true);
	});

	test("avoids collisions with existing IDs", () => {
		const existing = new Set<string>();
		for (let i = 0; i < 50; i++) existing.add(generatePlotId(existing));
		expect(existing.size).toBe(50);
	});
});

describe("nextAttachmentId", () => {
	test("starts at att-001 when no existing IDs", () => {
		expect(nextAttachmentId([])).toBe("att-001");
	});

	test("returns one past the highest existing ID", () => {
		expect(nextAttachmentId(["att-001", "att-002", "att-005"])).toBe("att-006");
	});

	test("ignores malformed IDs in the input", () => {
		expect(nextAttachmentId(["att-003", "garbage", "att-1"])).toBe("att-004");
	});

	test("throws past att-999", () => {
		expect(() => nextAttachmentId(["att-999"])).toThrow(/exceeds 999/);
	});
});
