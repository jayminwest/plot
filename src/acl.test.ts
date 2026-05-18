import { describe, expect, test } from "bun:test";
import { assertCanEmit, EVENT_ACL, isAllowed } from "./acl.ts";
import type { Actor } from "./actor.ts";
import { PLOT_EVENT_TYPES } from "./types.ts";

const USER: Actor = { kind: "user", handle: "jw", raw: "user:jw" };
const AGENT: Actor = {
	kind: "agent",
	name: "claude",
	runId: "run-1",
	raw: "agent:claude:run-1",
};

describe("EVENT_ACL", () => {
	test("covers every PlotEventType", () => {
		for (const t of PLOT_EVENT_TYPES) {
			expect(EVENT_ACL[t]).toBeDefined();
			expect(EVENT_ACL[t].length).toBeGreaterThan(0);
		}
	});

	test("matches SPEC §6 table", () => {
		// User-only
		expect(EVENT_ACL.intent_edited).toEqual(["user"]);
		expect(EVENT_ACL.status_changed).toEqual(["user"]);
		expect(EVENT_ACL.attachment_removed).toEqual(["user"]);
		expect(EVENT_ACL.question_answered).toEqual(["user"]);
		// Agent-only
		expect(EVENT_ACL.decision_made).toEqual(["agent"]);
		expect(EVENT_ACL.question_posed).toEqual(["agent"]);
		expect(EVENT_ACL.artifact_produced).toEqual(["agent"]);
		// Anyone
		for (const t of [
			"plot_created",
			"attachment_added",
			"run_dispatched",
			"plan_run_dispatched",
			"note",
		] as const) {
			expect([...EVENT_ACL[t]].sort()).toEqual(["agent", "user"]);
		}
	});
});

describe("isAllowed", () => {
	test("user can emit user-only and shared events", () => {
		expect(isAllowed(USER, "intent_edited")).toBe(true);
		expect(isAllowed(USER, "status_changed")).toBe(true);
		expect(isAllowed(USER, "attachment_removed")).toBe(true);
		expect(isAllowed(USER, "question_answered")).toBe(true);
		expect(isAllowed(USER, "note")).toBe(true);
		expect(isAllowed(USER, "attachment_added")).toBe(true);
	});

	test("user cannot emit agent-only events", () => {
		expect(isAllowed(USER, "decision_made")).toBe(false);
		expect(isAllowed(USER, "question_posed")).toBe(false);
		expect(isAllowed(USER, "artifact_produced")).toBe(false);
	});

	test("agent can emit agent-only and shared events", () => {
		expect(isAllowed(AGENT, "decision_made")).toBe(true);
		expect(isAllowed(AGENT, "question_posed")).toBe(true);
		expect(isAllowed(AGENT, "artifact_produced")).toBe(true);
		expect(isAllowed(AGENT, "note")).toBe(true);
		expect(isAllowed(AGENT, "attachment_added")).toBe(true);
		expect(isAllowed(AGENT, "run_dispatched")).toBe(true);
		expect(isAllowed(AGENT, "plan_run_dispatched")).toBe(true);
	});

	test("agent cannot emit user-only events", () => {
		expect(isAllowed(AGENT, "intent_edited")).toBe(false);
		expect(isAllowed(AGENT, "status_changed")).toBe(false);
		expect(isAllowed(AGENT, "attachment_removed")).toBe(false);
		expect(isAllowed(AGENT, "question_answered")).toBe(false);
	});
});

describe("assertCanEmit", () => {
	test("no-op when allowed", () => {
		expect(() => assertCanEmit(USER, "intent_edited")).not.toThrow();
		expect(() => assertCanEmit(AGENT, "decision_made")).not.toThrow();
	});

	test("error names the actor, the event, and the allowed kinds", () => {
		expect(() => assertCanEmit(AGENT, "intent_edited")).toThrow(/write-ACL/);
		expect(() => assertCanEmit(AGENT, "intent_edited")).toThrow(/agent:claude:run-1/);
		expect(() => assertCanEmit(AGENT, "intent_edited")).toThrow(/"intent_edited"/);
		expect(() => assertCanEmit(AGENT, "intent_edited")).toThrow(/user:\*/);
	});

	test("agent attempting intent_edited is redirected to question_posed", () => {
		expect(() => assertCanEmit(AGENT, "intent_edited")).toThrow(/question_posed/);
	});

	test("agent attempting status_changed / attachment_removed / question_answered is redirected", () => {
		expect(() => assertCanEmit(AGENT, "status_changed")).toThrow(/question_posed/);
		expect(() => assertCanEmit(AGENT, "attachment_removed")).toThrow(/question_posed/);
		expect(() => assertCanEmit(AGENT, "question_answered")).toThrow(/question_posed/);
	});

	test("user attempting agent-only events gets a useful hint", () => {
		expect(() => assertCanEmit(USER, "decision_made")).toThrow(/note/);
		expect(() => assertCanEmit(USER, "question_posed")).toThrow(/question_answered/);
		expect(() => assertCanEmit(USER, "artifact_produced")).toThrow(/attach/);
	});
});
