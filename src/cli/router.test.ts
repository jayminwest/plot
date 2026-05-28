// End-to-end tests for the human-facing CLI surface (§9.1).
//
// Each test drives the router with a captured IO/env pair against a temp
// PLOT_DIR. PLOT_ACTOR is set so git config doesn't matter; otherwise the
// router would fall back to spawnSync git in test environments.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./router.ts";
import type { CliEnv, CliIO } from "./runtime.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-cli-"));
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

function makeEnv(actor: string, overrides: Record<string, string> = {}): CliEnv {
	const map: Record<string, string> = {
		PLOT_DIR: dir,
		PLOT_ACTOR: actor,
		...overrides,
	};
	return { get: (n) => map[n] };
}

async function run(
	actor: string,
	argv: string[],
	envOverrides: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
	const { io, out, err } = makeIO();
	const code = await runCli({ argv, io, env: makeEnv(actor, envOverrides) });
	return { code, out: out.join(""), err: err.join("") };
}

describe("router help + dispatch", () => {
	test("--help prints command list", async () => {
		const r = await run("user:jw", ["--help"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain("plot");
		expect(r.out).toContain("init");
		expect(r.out).toContain("answer");
	});

	test("--version prints version", async () => {
		const r = await run("user:jw", ["--version"]);
		expect(r.code).toBe(0);
		expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("unknown command exits 2 with help", async () => {
		const r = await run("user:jw", ["nope"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("unknown command");
	});

	test("PLOT_DEBUG=1 emits stack traces", async () => {
		const { io, err } = makeIO();
		const env: CliEnv = {
			get: (n) =>
				n === "PLOT_DIR"
					? dir
					: n === "PLOT_ACTOR"
						? "user:jw"
						: n === "PLOT_DEBUG"
							? "1"
							: undefined,
		};
		const code = await runCli({ argv: ["show", "plot-aaaaaaaa"], io, env });
		expect(code).toBe(1);
		const out = err.join("");
		expect(out).toContain("not found");
		// stack line from Error
		expect(out).toMatch(/at\s+/);
	});
});

describe("init / list / show", () => {
	test("init returns an id, list surfaces it, show renders it", async () => {
		const init = await run("user:jw", ["init", "Add OAuth"]);
		expect(init.code).toBe(0);
		const id = init.out.trim();
		expect(id).toMatch(/^plot-[a-z0-9]{8}$/);

		const list = await run("user:jw", ["list"]);
		expect(list.code).toBe(0);
		expect(list.out).toContain(id);
		expect(list.out).toContain("drafting");
		expect(list.out).toContain("Add OAuth");

		const show = await run("user:jw", ["show", id]);
		expect(show.code).toBe(0);
		expect(show.out).toContain(`${id}  drafting`);
		expect(show.out).toContain("Name:     Add OAuth");
	});

	test("init --json emits id+name as JSON", async () => {
		const r = await run("user:jw", ["init", "X", "--json"]);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.name).toBe("X");
		expect(parsed.id).toMatch(/^plot-[a-z0-9]{8}$/);
	});

	test("init usage error when name missing", async () => {
		const r = await run("user:jw", ["init"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage");
	});

	test("list with no plots prints 'no plots'", async () => {
		const r = await run("user:jw", ["list"]);
		expect(r.code).toBe(0);
		expect(r.out).toBe("no plots\n");
	});

	test("show with missing id is a usage error", async () => {
		const r = await run("user:jw", ["show"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage");
	});

	test("show on nonexistent plot exits 1 with message", async () => {
		const r = await run("user:jw", ["show", "plot-aaaaaaaa"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("not found");
	});
});

describe("intent", () => {
	test("sets goal and replaces non_goals", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", [
			"intent",
			id,
			"--goal",
			"Replace email auth",
			"--non-goal",
			"migrate accounts",
			"--non-goal",
			"add Google",
		]);
		expect(r.code).toBe(0);

		const show = await run("user:jw", ["show", id, "--json"]);
		const parsed = JSON.parse(show.out);
		expect(parsed.plot.intent.goal).toBe("Replace email auth");
		expect(parsed.plot.intent.non_goals).toEqual(["migrate accounts", "add Google"]);
	});

	test("no flags is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["intent", id]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("nothing to update");
	});
});

describe("status", () => {
	test("drafting → ready transition", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["status", id, "ready"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`${id} → ready`);
	});

	test("rejects invalid status", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["status", id, "frozen"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("plot status: invalid status");
	});

	test("agents cannot transition status (ACL)", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["status", id, "ready"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("write-ACL");
	});
});

describe("attach / detach", () => {
	test("attach with type:ref and --role then detach by attachment id", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const attach = await run("user:jw", [
			"attach",
			id,
			"seeds_issue:sd-123",
			"--role",
			"tracks",
			"--json",
		]);
		expect(attach.code).toBe(0);
		const a = JSON.parse(attach.out);
		expect(a.id).toBe("att-001");
		expect(a.type).toBe("seeds_issue");
		expect(a.ref).toBe("sd-123");
		expect(a.role).toBe("tracks");

		const detach = await run("user:jw", ["detach", id, "att-001"]);
		expect(detach.code).toBe(0);
		expect(detach.out).toContain("removed att-001");
	});

	test("attach rejects unknown type", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["attach", id, "nope:ref", "--role", "tracks"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("unknown attachment type");
	});

	test("attach requires --role", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["attach", id, "seeds_issue:sd-1"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--role is required");
	});

	test("attach malformed target is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["attach", id, "no-colon", "--role", "tracks"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("expected <type>:<ref>");
	});

	test("agents cannot detach (ACL)", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		await run("user:jw", ["attach", id, "seeds_issue:sd-1", "--role", "tracks"]);
		const r = await run("agent:claude:run-1", ["detach", id, "att-001"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("write-ACL");
	});
});

describe("answer", () => {
	test("looks up q-1 from event log and appends question_answered", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		// Stage a question_posed event via the agent-facing append path on the
		// library directly (CLI for §9.2 is a separate seed). The CLI under
		// test still has to look this up at read time.
		const { PlotStore } = await import("../store.ts");
		const { SQLitePlotIndex } = await import("../sqlite-index.ts");
		const idx = new SQLitePlotIndex(":memory:");
		const agentStore = new PlotStore({
			dir,
			index: idx,
			actor: { kind: "agent", name: "claude", runId: "run-1", raw: "agent:claude:run-1" },
		});
		await agentStore.get(id).append({
			type: "question_posed",
			data: { text: "Migrate existing accounts?", blocking: true },
		});
		idx.close();

		const ans = await run("user:jw", ["answer", id, "q-1", "no — hard cut"]);
		expect(ans.code).toBe(0);
		expect(ans.out).toContain("answered q-1");

		const show = await run("user:jw", ["show", id, "--json"]);
		const parsed = JSON.parse(show.out);
		const last = parsed.events[parsed.events.length - 1];
		expect(last.type).toBe("question_answered");
		expect(last.data).toEqual({ question_id: "q-1", text: "no — hard cut" });
	});

	test("rejects malformed question id", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["answer", id, "bogus", "x"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("question id must look like q-1");
	});

	test("missing question id exits 1 with message", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["answer", id, "q-5", "x"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("no question q-5");
	});

	test("agents cannot answer (ACL)", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { PlotStore } = await import("../store.ts");
		const { SQLitePlotIndex } = await import("../sqlite-index.ts");
		const idx = new SQLitePlotIndex(":memory:");
		const agentStore = new PlotStore({
			dir,
			index: idx,
			actor: { kind: "agent", name: "claude", runId: "run-1", raw: "agent:claude:run-1" },
		});
		await agentStore.get(id).append({
			type: "question_posed",
			data: { text: "?", blocking: false },
		});
		idx.close();

		const r = await run("agent:claude:run-1", ["answer", id, "q-1", "x"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("write-ACL");
	});
});

describe("edit", () => {
	test("uses EDITOR script to non-interactively rewrite intent", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { writeFile, mkdtemp, rm: rmDir } = await import("node:fs/promises");
		const { chmodSync } = await import("node:fs");
		const editorDir = await mkdtemp(join(tmpdir(), "plot-editor-"));
		const editorScript = join(editorDir, "fake-editor.sh");
		// Editor that replaces the buffer with a new intent JSON; bash is
		// available on every test host (macOS + Linux dev environments).
		await writeFile(
			editorScript,
			`#!/usr/bin/env bash\ncat > "$1" <<'JSON'\n{"goal":"rewritten","non_goals":[],"constraints":["c1"],"success_criteria":[]}\nJSON\n`,
			"utf-8",
		);
		chmodSync(editorScript, 0o755);

		try {
			const { io, out, err } = makeIO();
			const env: CliEnv = {
				get: (n) => {
					if (n === "PLOT_DIR") return dir;
					if (n === "PLOT_ACTOR") return "user:jw";
					if (n === "EDITOR") return editorScript;
					return undefined;
				},
			};
			const code = await runCli({ argv: ["edit", id], io, env });
			expect(code).toBe(0);
			expect(out.join("")).toContain("updated intent");
			expect(err.join("")).toBe("");
		} finally {
			await rmDir(editorDir, { recursive: true, force: true });
		}

		const show = await run("user:jw", ["show", id, "--json"]);
		const parsed = JSON.parse(show.out);
		expect(parsed.plot.intent.goal).toBe("rewritten");
		expect(parsed.plot.intent.constraints).toEqual(["c1"]);
	});

	test("no-change edit returns 'no changes'", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { writeFile, mkdtemp, rm: rmDir } = await import("node:fs/promises");
		const { chmodSync } = await import("node:fs");
		const editorDir = await mkdtemp(join(tmpdir(), "plot-editor-"));
		const editorScript = join(editorDir, "noop-editor.sh");
		// `true` exits 0 without modifying the file
		await writeFile(editorScript, "#!/usr/bin/env bash\nexit 0\n", "utf-8");
		chmodSync(editorScript, 0o755);

		try {
			const { io, out } = makeIO();
			const env: CliEnv = {
				get: (n) => {
					if (n === "PLOT_DIR") return dir;
					if (n === "PLOT_ACTOR") return "user:jw";
					if (n === "EDITOR") return editorScript;
					return undefined;
				},
			};
			const code = await runCli({ argv: ["edit", id], io, env });
			expect(code).toBe(0);
			expect(out.join("")).toContain("no changes");
		} finally {
			await rmDir(editorDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Agent-facing CLI surface (§9.2)

describe("get (agent-facing view query)", () => {
	test("defaults to implementer view, JSON output, PLOT_ID env", async () => {
		const id = (await run("user:jw", ["init", "Add OAuth"])).out.trim();
		// Seed an agent event so the view has something to render.
		const agent = "agent:claude:run-1";
		await run(agent, ["append", "--event", "note", "--data", '{"text":"hello"}'], {
			PLOT_ID: id,
		});

		const r = await run(agent, ["get"], { PLOT_ID: id });
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.id).toBe(id);
		expect(parsed.view).toBe("implementer");
		expect(parsed.intent.goal).toBe("");
		expect(Array.isArray(parsed.events)).toBe(true);
		expect(parsed.events.at(-1)?.type).toBe("note");
	});

	test("positional id overrides PLOT_ID env", async () => {
		const a = (await run("user:jw", ["init", "A"])).out.trim();
		const b = (await run("user:jw", ["init", "B"])).out.trim();
		const r = await run("agent:claude:run-1", ["get", b], { PLOT_ID: a });
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).id).toBe(b);
	});

	test("--plot flag is honored", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["get", "--plot", id]);
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).id).toBe(id);
	});

	test("missing id with no PLOT_ID is a usage error", async () => {
		const r = await run("agent:claude:run-1", ["get"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("PLOT_ID");
	});

	test("unknown view is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["get", id, "--view", "planner"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("unknown view");
	});

	test("--pretty renders text", async () => {
		const id = (await run("user:jw", ["init", "Add OAuth"])).out.trim();
		const r = await run("agent:claude:run-1", ["get", id, "--pretty"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`${id}  view=implementer`);
		expect(r.out).toContain("Intent:");
	});
});

describe("append (agent-facing event write)", () => {
	test("agent appends decision_made and the event lands in the log", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run(
			"agent:claude:run-1",
			[
				"append",
				"--event",
				"decision_made",
				"--data",
				JSON.stringify({ summary: "use OIDC", rationale: "spec-aligned" }),
			],
			{ PLOT_ID: id },
		);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.id).toBe(id);
		expect(parsed.event.type).toBe("decision_made");
		expect(parsed.event.actor).toBe("agent:claude:run-1");
		expect(parsed.event.data).toEqual({ summary: "use OIDC", rationale: "spec-aligned" });

		const show = await run("user:jw", ["show", id, "--json"]);
		const showParsed = JSON.parse(show.out);
		const last = showParsed.events.at(-1);
		expect(last.type).toBe("decision_made");
	});

	test("intent_edited from an agent → ACL hint pointing at question_posed", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", [
			"append",
			id,
			"--event",
			"intent_edited",
			"--data",
			'{"field":"goal","value":"x"}',
		]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("write-ACL");
		expect(r.err).toContain("question_posed");
	});

	test("intent_edited from a user → CLI redirect to `plot intent`", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", [
			"append",
			id,
			"--event",
			"intent_edited",
			"--data",
			'{"field":"goal","value":"x"}',
		]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("dedicated command");
		expect(r.err).toContain("plot intent");
	});

	test("unknown event type is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["append", id, "--event", "bogus", "--data", "{}"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("unknown event type");
	});

	test("missing --event is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["append", id, "--data", "{}"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--event");
	});

	test("missing --data is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", ["append", id, "--event", "note"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--data");
	});

	test("invalid JSON data is a usage error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", [
			"append",
			id,
			"--event",
			"note",
			"--data",
			"{not json",
		]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("not valid JSON");
	});

	test("non-object JSON data is rejected", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", [
			"append",
			id,
			"--event",
			"note",
			"--data",
			'["a","b"]',
		]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("must be a JSON object");
	});

	test("missing id with no PLOT_ID is a usage error", async () => {
		const r = await run("agent:claude:run-1", [
			"append",
			"--event",
			"note",
			"--data",
			'{"text":"x"}',
		]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("PLOT_ID");
	});

	test("user cannot emit decision_made (ACL)", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", [
			"append",
			id,
			"--event",
			"decision_made",
			"--data",
			'{"summary":"x"}',
		]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("write-ACL");
	});

	test("note works for both users and agents", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const u = await run("user:jw", [
			"append",
			id,
			"--event",
			"note",
			"--data",
			'{"text":"by user"}',
		]);
		expect(u.code).toBe(0);
		const a = await run("agent:claude:run-1", [
			"append",
			id,
			"--event",
			"note",
			"--data",
			'{"text":"by agent"}',
		]);
		expect(a.code).toBe(0);
	});

	test("--pretty emits a human-friendly summary line", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("agent:claude:run-1", [
			"append",
			id,
			"--event",
			"note",
			"--data",
			'{"text":"hi"}',
			"--pretty",
		]);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`appended note to ${id}`);
	});
});

// ---------------------------------------------------------------------------
// Operational CLI surface (§9.3)

describe("rebuild-index", () => {
	test("rebuilds with no plots reports 0", async () => {
		const r = await run("user:jw", ["rebuild-index"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain("rebuilt index for 0 plots");
	});

	test("rebuilds after deleting the SQLite cache and surfaces existing plots", async () => {
		const a = (await run("user:jw", ["init", "A"])).out.trim();
		const b = (await run("user:jw", ["init", "B"])).out.trim();
		const { rm: rmFile } = await import("node:fs/promises");
		// Wipe the index file (and its WAL sidecars) — listed via plot rebuild.
		for (const suffix of ["", "-wal", "-shm"]) {
			await rmFile(join(dir, `.index.db${suffix}`), { force: true });
		}
		const r = await run("user:jw", ["rebuild-index", "--json"]);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.rebuilt).toBe(2);
		expect(parsed.dir).toBe(dir);

		// List should now find both via the rebuilt index.
		const list = await run("user:jw", ["list"]);
		expect(list.out).toContain(a);
		expect(list.out).toContain(b);
	});
});

describe("sync", () => {
	// Stages and commits in a throwaway git repo to keep the user's HEAD safe.
	let repoDir: string;
	let plotDir: string;
	beforeEach(async () => {
		const { mkdir, writeFile: wf } = await import("node:fs/promises");
		repoDir = await mkdtemp(join(tmpdir(), "plot-sync-repo-"));
		plotDir = join(repoDir, ".plot");
		await mkdir(plotDir, { recursive: true });
		// Minimal git repo with identity so commits succeed in CI.
		const { spawnSync } = await import("node:child_process");
		spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
		spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
		spawnSync("git", ["config", "user.name", "Tester"], { cwd: repoDir });
		spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoDir });
		await wf(join(repoDir, "README"), "seed\n");
		spawnSync("git", ["add", "README"], { cwd: repoDir });
		spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
	});
	afterEach(async () => {
		await rm(repoDir, { recursive: true, force: true });
	});

	async function runInRepo(argv: string[]): Promise<{ code: number; out: string; err: string }> {
		const { io, out, err } = makeIO();
		const env: CliEnv = {
			get: (n) => {
				if (n === "PLOT_DIR") return plotDir;
				if (n === "PLOT_ACTOR") return "user:jw";
				return undefined;
			},
		};
		// Run from inside the temp repo so `git` operates on it.
		const cwd = process.cwd();
		process.chdir(repoDir);
		try {
			const code = await runCli({ argv, io, env });
			return { code, out: out.join(""), err: err.join("") };
		} finally {
			process.chdir(cwd);
		}
	}

	test("with no plots, reports nothing to sync and exits 0", async () => {
		const r = await runInRepo(["sync"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain("no plots");
	});

	test("stages + commits newly-created plot files", async () => {
		const init = await runInRepo(["init", "OAuth"]);
		const id = init.out.trim();
		expect(id).toMatch(/^plot-[a-z0-9]{8}$/);

		const r = await runInRepo(["sync", "-m", "plot: add OAuth"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain("committed");

		const { spawnSync } = await import("node:child_process");
		const log = spawnSync("git", ["log", "--name-only", "--pretty=%s", "-1"], {
			cwd: repoDir,
			encoding: "utf-8",
		});
		expect(log.stdout).toContain("plot: add OAuth");
		expect(log.stdout).toContain(`.plot/${id}.json`);
		expect(log.stdout).toContain(`.plot/${id}.events.jsonl`);
		expect(log.stdout).not.toContain(".index.db");
	});

	test("second sync with nothing changed exits 0 with 'nothing to commit'", async () => {
		await runInRepo(["init", "X"]);
		const first = await runInRepo(["sync"]);
		expect(first.code).toBe(0);
		const second = await runInRepo(["sync"]);
		expect(second.code).toBe(0);
		expect(second.out).toContain("nothing to commit");
	});
});

describe("doctor", () => {
	test("clean plot reports ok and exits 0", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const r = await run("user:jw", ["doctor"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`${id}  ok`);
		expect(r.out).toContain("0 errors");
	});

	test("orphan events file is flagged as a warning", async () => {
		const { writeFile: wf } = await import("node:fs/promises");
		await wf(
			join(dir, "plot-deadbeef.events.jsonl"),
			`${JSON.stringify({ type: "plot_created", actor: "user:jw", at: "2026-01-01T00:00:00Z", data: { name: "ghost" } })}\n`,
			"utf-8",
		);
		const r = await run("user:jw", ["doctor", "--json"]);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.orphans).toHaveLength(1);
		expect(parsed.orphans[0].code).toBe("orphan_events");
		expect(parsed.warningCount).toBe(1);
		expect(parsed.errorCount).toBe(0);
	});

	test("status drift between JSON and event log is an error", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		// Hand-edit the JSON file to claim status `active` without emitting the
		// matching event. Mimics what corrupted state looks like on disk.
		const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
		const raw = await rf(join(dir, `${id}.json`), "utf-8");
		const obj = JSON.parse(raw);
		obj.status = "active";
		await wf(join(dir, `${id}.json`), `${JSON.stringify(obj, null, 2)}\n`, "utf-8");

		const r = await run("user:jw", ["doctor"]);
		expect(r.code).toBe(1);
		expect(r.out).toContain("status_drift");
	});

	test("intent_edited with value type mismatching field flags invalid_event_data", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { appendFile } = await import("node:fs/promises");
		// goal must be string, but here value is an array → malformed.
		const badGoal = {
			type: "intent_edited",
			actor: "user:jw",
			at: "2026-01-01T00:00:00Z",
			data: { field: "goal", value: ["oops"] },
		};
		// non_goals must be string[], but here value is a plain string → malformed.
		const badNonGoals = {
			type: "intent_edited",
			actor: "user:jw",
			at: "2026-01-01T00:00:01Z",
			data: { field: "non_goals", value: "not-an-array" },
		};
		await appendFile(
			join(dir, `${id}.events.jsonl`),
			`${JSON.stringify(badGoal)}\n${JSON.stringify(badNonGoals)}\n`,
			"utf-8",
		);
		const r = await run("user:jw", ["doctor", "--json"]);
		expect(r.code).toBe(1);
		const parsed = JSON.parse(r.out);
		const plot = parsed.plots.find((p: { id: string }) => p.id === id);
		const invalid = plot.findings.filter(
			(f: { code: string; severity: string }) =>
				f.code === "invalid_event_data" && f.severity === "error",
		);
		expect(invalid.length).toBe(2);
		expect(invalid.some((f: { message: string }) => f.message.includes(`"goal"`))).toBe(true);
		expect(invalid.some((f: { message: string }) => f.message.includes(`"non_goals"`))).toBe(true);
	});

	test("intent_edited with unknown field flags invalid_event_data", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { appendFile } = await import("node:fs/promises");
		const bogus = {
			type: "intent_edited",
			actor: "user:jw",
			at: "2026-01-01T00:00:00Z",
			data: { field: "mystery", value: "x" },
		};
		await appendFile(join(dir, `${id}.events.jsonl`), `${JSON.stringify(bogus)}\n`, "utf-8");
		const r = await run("user:jw", ["doctor", "--json"]);
		expect(r.code).toBe(1);
		const parsed = JSON.parse(r.out);
		const plot = parsed.plots.find((p: { id: string }) => p.id === id);
		expect(
			plot.findings.some(
				(f: { code: string; message: string }) =>
					f.code === "invalid_event_data" && f.message.includes("unknown field"),
			),
		).toBe(true);
	});

	test("malformed events file surfaces events_unreadable", async () => {
		const id = (await run("user:jw", ["init", "X"])).out.trim();
		const { appendFile } = await import("node:fs/promises");
		await appendFile(join(dir, `${id}.events.jsonl`), "{not json\n", "utf-8");
		const r = await run("user:jw", ["doctor", "--json"]);
		expect(r.code).toBe(1);
		const parsed = JSON.parse(r.out);
		const plot = parsed.plots.find((p: { id: string }) => p.id === id);
		expect(plot.findings.some((f: { code: string }) => f.code === "events_unreadable")).toBe(true);
	});
});
