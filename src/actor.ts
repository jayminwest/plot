// SPEC §2.4 — Actor format: user:<handle> or agent:<name>[:<run-id>].
// Strict regex per spec. Handles/names/run-ids use a conservative alphabet
// matching git/GitHub handles plus the underscores agents commonly use.

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]*";
const ACTOR_RE = new RegExp(`^(user:${SEGMENT}|agent:${SEGMENT}(?::${SEGMENT})?)$`);

export interface UserActor {
	kind: "user";
	handle: string;
	raw: string;
}

export interface AgentActor {
	kind: "agent";
	name: string;
	runId?: string;
	raw: string;
}

export type Actor = UserActor | AgentActor;

export function isActor(value: string): boolean {
	return ACTOR_RE.test(value);
}

export function parseActor(value: string): Actor {
	if (!ACTOR_RE.test(value)) {
		throw new Error(
			`invalid actor: ${JSON.stringify(value)} (expected user:<handle> or agent:<name>[:<run-id>])`,
		);
	}
	const parts = value.split(":");
	if (parts[0] === "user") {
		return { kind: "user", handle: parts[1] ?? "", raw: value };
	}
	const actor: AgentActor = { kind: "agent", name: parts[1] ?? "", raw: value };
	if (parts[2]) actor.runId = parts[2];
	return actor;
}

export function formatActor(actor: Actor): string {
	if (actor.kind === "user") return `user:${actor.handle}`;
	return actor.runId ? `agent:${actor.name}:${actor.runId}` : `agent:${actor.name}`;
}
