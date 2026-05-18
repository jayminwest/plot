// Integration tests — exercise the acceptance criteria of pl-f853 / plot-95ed
// end-to-end against the real CLI router, real on-disk JSON + JSONL files, and
// the real SQLitePlotIndex. Per-command behavior is covered in
// `cli/router.test.ts`; this file walks complete scenarios so the surface
// stays coherent across module boundaries.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli/router.ts";
import type { CliEnv, CliIO } from "./cli/runtime.ts";
import { plotEventsPath, plotJsonPath } from "./io.ts";
import type { Migration } from "./migrations.ts";
import { SQLitePlotIndex } from "./sqlite-index.ts";
import { PlotStore } from "./store.ts";
import { SCHEMA_VERSION } from "./types.ts";
import {
	IMPLEMENTER_VIEW_ATTACHMENT_ROLES,
	IMPLEMENTER_VIEW_EVENT_LIMIT,
	IMPLEMENTER_VIEW_EVENT_TYPES,
} from "./views.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-integration-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function makeIO() {
	const out: string[] = [];
	const err: string[] = [];
	const io: CliIO = {
		out: (t) => out.push(t),
		err: (t) => err.push(t),
	};
	return { io, out, err };
}

function envFor(actor: string, overrides: Record<string, string> = {}): CliEnv {
	const map: Record<string, string> = {
		PLOT_DIR: dir,
		PLOT_ACTOR: actor,
		...overrides,
	};
	return { get: (n) => map[n] };
}

async function cli(
	actor: string,
	argv: string[],
	overrides: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
	const { io, out, err } = makeIO();
	const code = await runCli({ argv, io, env: envFor(actor, overrides) });
	return { code, out: out.join(""), err: err.join("") };
}

// ---------------------------------------------------------------------------
// Acceptance #1 — human authoring workflow via CLI only
//
// "A human can run `plot init`, edit intent, attach a seeds issue, and
// transition status to `ready` using only CLI commands listed in §9.1."

describe("acceptance #1 — human authoring workflow", () => {
	test("init → intent → attach → status ready, end-to-end", async () => {
		const init = await cli("user:jw", ["init", "Add OAuth to billing portal"]);
		expect(init.code).toBe(0);
		const id = init.out.trim();
		expect(id).toMatch(/^plot-[a-z0-9]{8}$/);

		const intent = await cli("user:jw", [
			"intent",
			id,
			"--goal",
			"Replace email/password auth on /billing with GitHub OAuth.",
			"--non-goal",
			"Migrating existing accounts in v1",
			"--constraint",
			"Must work with existing Stripe customer IDs",
			"--success-criteria",
			"New users can sign in with GitHub on /billing",
		]);
		expect(intent.code).toBe(0);

		const attach = await cli("user:jw", [
			"attach",
			id,
			"seeds_issue:sd-123",
			"--role",
			"tracks",
			"--json",
		]);
		expect(attach.code).toBe(0);
		const attached = JSON.parse(attach.out);
		expect(attached.id).toBe("att-001");
		expect(attached.type).toBe("seeds_issue");
		expect(attached.ref).toBe("sd-123");

		const status = await cli("user:jw", ["status", id, "ready"]);
		expect(status.code).toBe(0);
		expect(status.out).toContain(`${id} → ready`);

		// Verify final on-disk shape: JSON file carries the edits + status, and
		// the event log records every transition.
		const showRaw = await cli("user:jw", ["show", id, "--json"]);
		const show = JSON.parse(showRaw.out);
		expect(show.plot.status).toBe("ready");
		expect(show.plot.intent.goal).toBe(
			"Replace email/password auth on /billing with GitHub OAuth.",
		);
		expect(show.plot.intent.non_goals).toEqual(["Migrating existing accounts in v1"]);
		expect(show.plot.attachments).toHaveLength(1);
		expect(show.plot.attachments[0].role).toBe("tracks");

		const eventTypes = show.events.map((e: { type: string }) => e.type);
		expect(eventTypes[0]).toBe("plot_created");
		expect(eventTypes).toContain("intent_edited");
		expect(eventTypes).toContain("attachment_added");
		expect(eventTypes[eventTypes.length - 1]).toBe("status_changed");
	});
});

// ---------------------------------------------------------------------------
// Acceptance #2 — agent context + write path with ACL redirect
//
// "An agent (PLOT_ACTOR=agent:test:run-1, PLOT_ID set) can run
// `plot get --view implementer` and `plot append --event decision_made --data
// {...}` and see the event in the log — but `plot append --event
// intent_edited` returns a non-zero exit with a message pointing at
// `question_posed`."

describe("acceptance #2 — agent view + append + ACL redirect", () => {
	test("get implementer view + decision_made append + intent_edited rejection", async () => {
		const init = await cli("user:jw", ["init", "Add OAuth"]);
		const id = init.out.trim();
		const agent = "agent:test:run-1";

		const view = await cli(agent, ["get", "--view", "implementer"], { PLOT_ID: id });
		expect(view.code).toBe(0);
		const parsed = JSON.parse(view.out);
		expect(parsed.id).toBe(id);
		expect(parsed.view).toBe("implementer");
		expect(parsed.intent).toBeDefined();
		expect(Array.isArray(parsed.events)).toBe(true);
		expect(Array.isArray(parsed.attachments)).toBe(true);

		const append = await cli(
			agent,
			[
				"append",
				"--event",
				"decision_made",
				"--data",
				JSON.stringify({ summary: "use @octokit/oauth-app", rationale: "spec-aligned" }),
			],
			{ PLOT_ID: id },
		);
		expect(append.code).toBe(0);

		// The event lands in the event log on disk.
		const events = (await readFile(plotEventsPath(dir, id), "utf-8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const decision = events.find((e) => e.type === "decision_made");
		expect(decision).toBeDefined();
		expect(decision.actor).toBe(agent);
		expect(decision.data).toEqual({
			summary: "use @octokit/oauth-app",
			rationale: "spec-aligned",
		});

		// ACL: agent cannot emit intent_edited; the error must mention the
		// allowed alternative (question_posed) per SPEC §6.
		const denied = await cli(
			agent,
			[
				"append",
				"--event",
				"intent_edited",
				"--data",
				JSON.stringify({ field: "goal", value: "x" }),
			],
			{ PLOT_ID: id },
		);
		expect(denied.code).not.toBe(0);
		expect(denied.err).toContain("question_posed");
	});
});

// ---------------------------------------------------------------------------
// Acceptance #3 — rebuild-index reproduces identical query results
//
// "Deleting .plot/.index.db and running `plot rebuild-index` reproduces
// identical query results to the prior index."

describe("acceptance #3 — rebuild-index round-trip", () => {
	test("query results survive a wipe-and-rebuild of .index.db", async () => {
		const a = (await cli("user:jw", ["init", "Plot A"])).out.trim();
		const b = (await cli("user:jw", ["init", "Plot B"])).out.trim();
		const c = (await cli("user:jw", ["init", "Plot C"])).out.trim();
		await cli("user:jw", ["status", b, "ready"]);
		await cli("user:jw", ["status", c, "active"]);

		// Snapshot the index's view of the world before the wipe.
		const before = JSON.parse((await cli("user:jw", ["list", "--json"])).out);
		expect(before.map((r: { id: string }) => r.id).sort()).toEqual([a, b, c].sort());

		// Wipe the SQLite cache + WAL sidecars.
		for (const suffix of ["", "-wal", "-shm"]) {
			await rm(join(dir, `.index.db${suffix}`), { force: true });
		}

		const rebuilt = await cli("user:jw", ["rebuild-index", "--json"]);
		expect(rebuilt.code).toBe(0);
		expect(JSON.parse(rebuilt.out).rebuilt).toBe(3);

		const after = JSON.parse((await cli("user:jw", ["list", "--json"])).out);
		expect(after).toEqual(before);
	});
});

// ---------------------------------------------------------------------------
// Acceptance #4 — schema_version on disk + migrate-on-read scaffolding
//
// "Every Plot file written carries `schema_version: 1`; the migrations
// registry runs (no-op) on read; an added synthetic legacy fixture migrates
// cleanly in-memory."

describe("acceptance #4 — schema versioning + migrate-on-read", () => {
	test("every Plot written by the CLI carries schema_version: 1", async () => {
		const id = (await cli("user:jw", ["init", "X"])).out.trim();
		await cli("user:jw", ["intent", id, "--goal", "g"]);
		await cli("user:jw", ["status", id, "ready"]);

		const raw = await readFile(plotJsonPath(dir, id), "utf-8");
		const plot = JSON.parse(raw);
		expect(plot.schema_version).toBe(SCHEMA_VERSION);
		expect(plot.schema_version).toBe(1);
	});

	test("default registry is a no-op on a current-version Plot", async () => {
		const id = (await cli("user:jw", ["init", "X"])).out.trim();
		const show = await cli("user:jw", ["show", id, "--json"]);
		expect(show.code).toBe(0);
		const parsed = JSON.parse(show.out);
		expect(parsed.plot.schema_version).toBe(SCHEMA_VERSION);
	});

	test("synthetic legacy fixture migrates cleanly in-memory", async () => {
		// Hand-write a v0 Plot file with the previous (synthetic) shape. The
		// CLI doesn't know about v0, but a PlotStore configured with a v0→v1
		// migration should read it as v1 without touching disk.
		const legacyId = "plot-leg00001";
		await writeFile(
			plotJsonPath(dir, legacyId),
			`${JSON.stringify(
				{
					schema_version: 0,
					id: legacyId,
					name: "Legacy",
					status: "drafting",
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-01T00:00:00Z",
					// Imagined v0 shape: only had a flat `goal` string, no intent block.
					goal: "old shape",
					attachments: [],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);

		const migration: Migration = {
			from: 0,
			to: 1,
			migrate(raw) {
				const obj = raw as Record<string, unknown>;
				const goal = typeof obj.goal === "string" ? obj.goal : "";
				return {
					id: obj.id,
					name: obj.name,
					status: obj.status,
					created_at: obj.created_at,
					updated_at: obj.updated_at,
					attachments: obj.attachments ?? [],
					intent: {
						goal,
						non_goals: [],
						constraints: [],
						success_criteria: [],
					},
				};
			},
		};

		const index = new SQLitePlotIndex(join(dir, ".index.db"));
		try {
			const store = new PlotStore({
				dir,
				index,
				actor: { kind: "user", handle: "jw", raw: "user:jw" },
				migrations: [migration],
			});
			const migrated = await store.get(legacyId).read();
			expect(migrated.schema_version).toBe(1);
			expect(migrated.intent.goal).toBe("old shape");
			expect(migrated.intent.non_goals).toEqual([]);
			expect(migrated.attachments).toEqual([]);

			// The on-disk file is unchanged until the next write — migrate-on-read.
			const onDisk = JSON.parse(await readFile(plotJsonPath(dir, legacyId), "utf-8"));
			expect(onDisk.schema_version).toBe(0);
		} finally {
			index.close();
		}
	});
});

// ---------------------------------------------------------------------------
// Acceptance #5 — implementer view matches SPEC §8.1 exactly
//
// "The `implementer` view returns intent + the last 20 events filtered to
// {decision_made, question_posed, question_answered, artifact_produced, note}
// + attachments whose role ∈ {tracks, implements, informs, reference}."

describe("acceptance #5 — implementer view shape", () => {
	test("filters event types and attachment roles per SPEC §8.1", async () => {
		const id = (await cli("user:jw", ["init", "View Test"])).out.trim();
		await cli("user:jw", ["intent", id, "--goal", "exercise the view"]);

		// Attachments — one per allowed role plus one filtered-out role.
		const attachments: { ref: string; role: string; expected: boolean }[] = [
			{ ref: "sd-1", role: "tracks", expected: true },
			{ ref: "sd-2", role: "implements", expected: true },
			{ ref: "mx-1", role: "informs", expected: true },
			{ ref: "owner/repo#1", role: "reference", expected: true },
			{ ref: "thread-1", role: "discussion", expected: false },
			{ ref: "meet-1", role: "meeting", expected: false },
		];
		const typeFor = (role: string): string => {
			if (role === "tracks" || role === "implements") return "seeds_issue";
			if (role === "informs") return "mulch_record";
			if (role === "reference") return "gh_pr";
			return "file";
		};
		for (const att of attachments) {
			await cli("user:jw", ["attach", id, `${typeFor(att.role)}:${att.ref}`, "--role", att.role]);
		}

		// Events — mix of allowed and disallowed types. Use an agent for the
		// agent-only ones and a user for the human ones.
		const agent = "agent:test:run-1";
		await cli(agent, ["append", "--event", "decision_made", "--data", '{"summary":"d1"}'], {
			PLOT_ID: id,
		});
		await cli(
			agent,
			["append", "--event", "question_posed", "--data", '{"text":"q1","blocking":false}'],
			{ PLOT_ID: id },
		);
		await cli(
			agent,
			["append", "--event", "artifact_produced", "--data", '{"type":"gh_pr","ref":"o/r#1"}'],
			{
				PLOT_ID: id,
			},
		);
		await cli(agent, ["append", "--event", "note", "--data", '{"text":"hello"}'], {
			PLOT_ID: id,
		});
		await cli(agent, ["append", "--event", "run_dispatched", "--data", '{"run_id":"r1"}'], {
			PLOT_ID: id,
		});

		const view = JSON.parse(
			(await cli(agent, ["get", "--view", "implementer"], { PLOT_ID: id })).out,
		);

		// Intent passes through.
		expect(view.intent.goal).toBe("exercise the view");

		// Attachments filtered to the §8.1 role allowlist.
		const allowedRoles = new Set<string>(IMPLEMENTER_VIEW_ATTACHMENT_ROLES);
		expect(view.attachments).toHaveLength(attachments.filter((a) => a.expected).length);
		for (const att of view.attachments) {
			expect(allowedRoles.has(att.role)).toBe(true);
		}

		// Events filtered to the §8.1 type allowlist. plot_created,
		// intent_edited, attachment_added, run_dispatched are all excluded.
		const allowedTypes = new Set<string>(IMPLEMENTER_VIEW_EVENT_TYPES);
		expect(view.events.length).toBe(4);
		for (const ev of view.events) {
			expect(allowedTypes.has(ev.type)).toBe(true);
		}
		expect(view.events.map((e: { type: string }) => e.type)).toEqual([
			"decision_made",
			"question_posed",
			"artifact_produced",
			"note",
		]);
	});

	test("event list is capped at the last 20 of allowed types", async () => {
		const id = (await cli("user:jw", ["init", "Cap Test"])).out.trim();
		const agent = "agent:test:run-1";

		// Append 25 notes; only the last 20 should survive the view filter.
		for (let i = 0; i < 25; i++) {
			await cli(agent, ["append", "--event", "note", "--data", JSON.stringify({ text: `n${i}` })], {
				PLOT_ID: id,
			});
		}

		const view = JSON.parse(
			(await cli(agent, ["get", "--view", "implementer"], { PLOT_ID: id })).out,
		);
		expect(view.events).toHaveLength(IMPLEMENTER_VIEW_EVENT_LIMIT);
		expect(view.events[0].data.text).toBe("n5");
		expect(view.events[IMPLEMENTER_VIEW_EVENT_LIMIT - 1].data.text).toBe("n24");
	});
});
