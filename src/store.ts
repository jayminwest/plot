// PlotStore — SPEC §10. Library API for creating and mutating Plots.
//
// Each mutator holds the per-Plot JSON file lock across read-modify-write-
// append-index-upsert so concurrent writers in the same process can't lose
// updates. The lock guarding the JSON file also serializes appends to the
// matching events log, so we use the within-lock io helpers there.
//
// Write-ACL enforcement (SPEC §6) and view rendering (§8) are layered on
// top of this in separate modules.

import { assertCanEmit } from "./acl.ts";
import { type Actor, formatActor } from "./actor.ts";
import { assertAttachmentId, assertPlotId, generatePlotId, nextAttachmentId } from "./id.ts";
import {
	appendEventWithinLock,
	listPlotIds,
	plotEventsPath,
	plotJsonPath,
	readEvents,
	readJson,
	writeJsonAtomicWithinLock,
} from "./io.ts";
import { withFileLock } from "./lock.ts";
import { type Migration, migratePlot } from "./migrations.ts";
import type { PlotIndex } from "./plot-index.ts";
import {
	type Attachment,
	type AttachmentType,
	INTENT_FIELDS,
	type Intent,
	type IntentField,
	PLOT_STATUSES,
	type Plot,
	type PlotEvent,
	type PlotEventType,
	type PlotStatus,
	SCHEMA_VERSION,
} from "./types.ts";

export interface PlotStoreOptions {
	dir: string;
	index: PlotIndex;
	actor: Actor;
	// Injectable clock for deterministic tests. Defaults to system time.
	now?: () => Date;
	// Override the migration registry used on read. Defaults to
	// DEFAULT_MIGRATIONS from ./migrations.ts. Tests inject synthetic
	// legacy-fixture migrations through this.
	migrations?: readonly Migration[];
}

export interface CreatePlotInput {
	name: string;
}

export interface AttachInput {
	type: AttachmentType;
	ref: string;
	role: string;
}

// Events that mutate the Plot JSON go through dedicated methods, not `append`.
const APPEND_DISALLOWED_TYPES = new Set<PlotEventType>([
	"plot_created",
	"intent_edited",
	"status_changed",
	"attachment_added",
	"attachment_removed",
]);

const APPEND_REDIRECTS: Partial<Record<PlotEventType, string>> = {
	plot_created: "use PlotStore.create() instead",
	intent_edited: "use PlotHandle.editIntent() instead",
	status_changed: "use PlotHandle.setStatus() instead",
	attachment_added: "use PlotHandle.attach() instead",
	attachment_removed: "use PlotHandle.detach() instead",
};

export class PlotStore {
	readonly dir: string;
	readonly index: PlotIndex;
	readonly actor: Actor;
	readonly migrations?: readonly Migration[];
	private readonly clock: () => Date;

	constructor(opts: PlotStoreOptions) {
		this.dir = opts.dir;
		this.index = opts.index;
		this.actor = opts.actor;
		this.clock = opts.now ?? (() => new Date());
		this.migrations = opts.migrations;
	}

	async create(input: CreatePlotInput): Promise<PlotHandle> {
		if (!input.name || input.name.length === 0) {
			throw new Error("PlotStore.create: name is required");
		}
		assertCanEmit(this.actor, "plot_created");
		const existing = new Set(await listPlotIds(this.dir));
		const id = generatePlotId(existing);
		const now = this.nowIso();
		const plot: Plot = {
			schema_version: SCHEMA_VERSION,
			id,
			name: input.name,
			status: "drafting",
			created_at: now,
			updated_at: now,
			intent: { goal: "", non_goals: [], constraints: [], success_criteria: [] },
			attachments: [],
		};
		const event: PlotEvent = {
			type: "plot_created",
			actor: formatActor(this.actor),
			at: now,
			data: { name: input.name },
		};

		const jsonPath = plotJsonPath(this.dir, id);
		await withFileLock(jsonPath, async () => {
			await writeJsonAtomicWithinLock(jsonPath, plot);
			await appendEventWithinLock(plotEventsPath(this.dir, id), event);
		});
		await this.index.upsert(plot);
		return new PlotHandle(this, id);
	}

	get(id: string): PlotHandle {
		assertPlotId(id);
		return new PlotHandle(this, id);
	}

	async list(): Promise<string[]> {
		return listPlotIds(this.dir);
	}

	nowIso(): string {
		return this.clock().toISOString();
	}

	// Read-modify-write transaction on a Plot. The mutator runs while the
	// JSON file lock is held; it returns the next state and any events that
	// describe the mutation. If the mutator returns no events, this is a
	// no-op and neither the file nor the index is touched.
	async transact(
		id: string,
		mutator: (plot: Plot, now: string) => MutationResult | Promise<MutationResult>,
	): Promise<{ plot: Plot; events: PlotEvent[] }> {
		assertPlotId(id);
		const jsonPath = plotJsonPath(this.dir, id);
		const eventsPath = plotEventsPath(this.dir, id);
		let result: { plot: Plot; events: PlotEvent[] } = {
			plot: undefined as unknown as Plot,
			events: [],
		};
		await withFileLock(jsonPath, async () => {
			let current: Plot;
			try {
				const raw = await readJson<unknown>(jsonPath);
				current = migratePlot(raw, { migrations: this.migrations });
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(`Plot ${id} not found at ${jsonPath}`);
				}
				throw err;
			}
			const now = this.nowIso();
			const { next, events } = await mutator(current, now);
			if (events.length === 0) {
				result = { plot: current, events };
				return;
			}
			next.updated_at = now;
			await writeJsonAtomicWithinLock(jsonPath, next);
			for (const ev of events) {
				await appendEventWithinLock(eventsPath, ev);
			}
			result = { plot: next, events };
		});
		if (result.events.length > 0) {
			await this.index.upsert(result.plot);
		}
		return result;
	}
}

export interface MutationResult {
	next: Plot;
	events: PlotEvent[];
}

export class PlotHandle {
	constructor(
		private readonly store: PlotStore,
		readonly id: string,
	) {}

	async read(): Promise<Plot> {
		try {
			const raw = await readJson<unknown>(plotJsonPath(this.store.dir, this.id));
			return migratePlot(raw, { migrations: this.store.migrations });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Plot ${this.id} not found`);
			}
			throw err;
		}
	}

	async events(): Promise<PlotEvent[]> {
		return readEvents<PlotEvent>(plotEventsPath(this.store.dir, this.id), {
			missingIsEmpty: true,
		});
	}

	async editIntent(patch: Partial<Intent>): Promise<Plot> {
		assertIntentPatch(patch);
		assertCanEmit(this.store.actor, "intent_edited");
		const actorStr = formatActor(this.store.actor);
		const { plot } = await this.store.transact(this.id, (current, now) => {
			const nextIntent: Intent = { ...current.intent };
			const events: PlotEvent[] = [];
			for (const field of INTENT_FIELDS) {
				const value = patch[field];
				if (value === undefined) continue;
				if (intentFieldEquals(field, current.intent, value)) continue;
				assignIntentField(nextIntent, field, value);
				events.push({
					type: "intent_edited",
					actor: actorStr,
					at: now,
					data: { field, value: cloneIntentValue(value) },
				});
			}
			return { next: { ...current, intent: nextIntent }, events };
		});
		return plot;
	}

	async attach(input: AttachInput): Promise<Attachment> {
		if (!input.ref || input.ref.length === 0) {
			throw new Error("PlotHandle.attach: ref is required");
		}
		if (!input.role || input.role.length === 0) {
			throw new Error("PlotHandle.attach: role is required");
		}
		assertCanEmit(this.store.actor, "attachment_added");
		const actorStr = formatActor(this.store.actor);
		let added!: Attachment;
		await this.store.transact(this.id, (current, now) => {
			const id = nextAttachmentId(current.attachments.map((a) => a.id));
			added = {
				id,
				type: input.type,
				ref: input.ref,
				role: input.role,
				added_at: now,
				added_by: actorStr,
			};
			const next: Plot = {
				...current,
				attachments: [...current.attachments, added],
			};
			const event: PlotEvent = {
				type: "attachment_added",
				actor: actorStr,
				at: now,
				data: { id, type: input.type, ref: input.ref, role: input.role },
			};
			return { next, events: [event] };
		});
		return added;
	}

	async detach(attachmentId: string): Promise<void> {
		assertAttachmentId(attachmentId);
		assertCanEmit(this.store.actor, "attachment_removed");
		const actorStr = formatActor(this.store.actor);
		await this.store.transact(this.id, (current, now) => {
			const idx = current.attachments.findIndex((a) => a.id === attachmentId);
			if (idx < 0) {
				throw new Error(`attachment ${attachmentId} not found on ${this.id}`);
			}
			const next: Plot = {
				...current,
				attachments: current.attachments.filter((a) => a.id !== attachmentId),
			};
			const event: PlotEvent = {
				type: "attachment_removed",
				actor: actorStr,
				at: now,
				data: { id: attachmentId },
			};
			return { next, events: [event] };
		});
	}

	async setStatus(status: PlotStatus): Promise<Plot> {
		if (!PLOT_STATUSES.includes(status)) {
			throw new Error(
				`invalid status ${JSON.stringify(status)} (expected one of ${PLOT_STATUSES.join(", ")})`,
			);
		}
		assertCanEmit(this.store.actor, "status_changed");
		const actorStr = formatActor(this.store.actor);
		const { plot } = await this.store.transact(this.id, (current, now) => {
			if (current.status === status) {
				return { next: current, events: [] };
			}
			const next: Plot = { ...current, status };
			const event: PlotEvent = {
				type: "status_changed",
				actor: actorStr,
				at: now,
				data: { from: current.status, to: status },
			};
			return { next, events: [event] };
		});
		return plot;
	}

	// Generic event append. Used by agents to write decision_made,
	// question_posed, artifact_produced, run_dispatched, question_answered,
	// and note events. Events that mutate the Plot JSON go through their
	// dedicated methods and are rejected here.
	async append(input: { type: PlotEventType; data: Record<string, unknown> }): Promise<PlotEvent> {
		if (APPEND_DISALLOWED_TYPES.has(input.type)) {
			const hint = APPEND_REDIRECTS[input.type];
			throw new Error(
				`PlotHandle.append: event type ${JSON.stringify(input.type)} is not appendable directly${hint ? ` — ${hint}` : ""}`,
			);
		}
		assertCanEmit(this.store.actor, input.type);

		const jsonPath = plotJsonPath(this.store.dir, this.id);
		const eventsPath = plotEventsPath(this.store.dir, this.id);
		const actorStr = formatActor(this.store.actor);
		let event!: PlotEvent;
		await withFileLock(jsonPath, async () => {
			// Confirm the Plot exists and is at a supported schema_version;
			// appending to a missing or future-version Plot is a bug.
			try {
				const raw = await readJson<unknown>(jsonPath);
				migratePlot(raw, { migrations: this.store.migrations });
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(`Plot ${this.id} not found`);
				}
				throw err;
			}
			event = {
				type: input.type,
				actor: actorStr,
				at: this.store.nowIso(),
				data: input.data,
			} as PlotEvent;
			await appendEventWithinLock(eventsPath, event);
		});
		return event;
	}
}

// ---------------------------------------------------------------------------
// Intent helpers

function assertIntentPatch(patch: Partial<Intent>): void {
	for (const key of Object.keys(patch)) {
		if (!(INTENT_FIELDS as readonly string[]).includes(key)) {
			throw new Error(
				`editIntent: unknown intent field ${JSON.stringify(key)} (expected one of ${INTENT_FIELDS.join(", ")})`,
			);
		}
	}
	if (patch.goal !== undefined && typeof patch.goal !== "string") {
		throw new Error("editIntent: goal must be a string");
	}
	for (const field of ["non_goals", "constraints", "success_criteria"] as const) {
		const value = patch[field];
		if (value === undefined) continue;
		if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
			throw new Error(`editIntent: ${field} must be an array of strings`);
		}
	}
}

function intentFieldEquals(field: IntentField, intent: Intent, value: string | string[]): boolean {
	if (field === "goal") return intent.goal === value;
	const current = intent[field];
	if (!Array.isArray(value)) return false;
	if (current.length !== value.length) return false;
	for (let i = 0; i < current.length; i++) {
		if (current[i] !== value[i]) return false;
	}
	return true;
}

function assignIntentField(intent: Intent, field: IntentField, value: string | string[]): void {
	if (field === "goal") {
		intent.goal = value as string;
		return;
	}
	intent[field] = [...(value as string[])];
}

function cloneIntentValue(value: string | string[]): string | string[] {
	return Array.isArray(value) ? [...value] : value;
}
