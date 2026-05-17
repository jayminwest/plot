// Schema versioning & migrate-on-read (SPEC §7).
//
// Plot files carry `schema_version`. When the running code is at version N and
// a file on disk is at version M < N, the read path runs the registered
// migrations in-memory from M → M+1 → … → N and returns the upgraded shape.
// Write-back happens naturally the next time something edits the Plot, since
// the in-memory shape carries the current SCHEMA_VERSION.
//
// V1 ships with no migrations — schema_version is 1 and no prior versions
// exist in the wild. A v2 in the future adds a Migration { from: 1, to: 2, … }
// to DEFAULT_MIGRATIONS so existing v1 files keep loading.

import { type Plot, SCHEMA_VERSION } from "./types.ts";

export interface Migration {
	from: number;
	to: number;
	migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

export const DEFAULT_MIGRATIONS: readonly Migration[] = [];

export interface MigrateOptions {
	migrations?: readonly Migration[];
}

// Apply registered migrations to a raw JSON object until it matches the
// current SCHEMA_VERSION. Returns the upgraded Plot. Throws when:
//   - input is not a plain object
//   - schema_version is missing, non-integer, or negative
//   - schema_version exceeds SCHEMA_VERSION (file from a newer Plot)
//   - no migration is registered for some intermediate step
//   - a registered migration's `to` is not exactly `from + 1` (chains must be unit-step)
//   - a migration's return value is not a plain object
export function migratePlot(raw: unknown, opts: MigrateOptions = {}): Plot {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("migratePlot: input must be a Plot object");
	}
	const obj = raw as Record<string, unknown>;
	const version = obj.schema_version;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
		throw new Error(
			`migratePlot: missing or invalid schema_version (got ${JSON.stringify(version)})`,
		);
	}
	if (version > SCHEMA_VERSION) {
		throw new Error(
			`migratePlot: Plot was written by a newer Plot (schema_version=${version}, supported max=${SCHEMA_VERSION}). Upgrade the plot CLI.`,
		);
	}
	if (version === SCHEMA_VERSION) {
		return obj as unknown as Plot;
	}

	const migrations = opts.migrations ?? DEFAULT_MIGRATIONS;
	let current: Record<string, unknown> = obj;
	let currentVersion = version;
	while (currentVersion < SCHEMA_VERSION) {
		const step = migrations.find((m) => m.from === currentVersion);
		if (!step) {
			throw new Error(
				`migratePlot: no migration registered from schema_version ${currentVersion} (target ${SCHEMA_VERSION})`,
			);
		}
		if (step.to !== currentVersion + 1) {
			throw new Error(
				`migratePlot: migration from ${currentVersion} must step to ${currentVersion + 1}, got ${step.to}`,
			);
		}
		const result = step.migrate(current);
		if (!result || typeof result !== "object" || Array.isArray(result)) {
			throw new Error(`migratePlot: migration ${step.from}->${step.to} returned non-object`);
		}
		current = { ...(result as Record<string, unknown>), schema_version: step.to };
		currentVersion = step.to;
	}
	return current as unknown as Plot;
}
