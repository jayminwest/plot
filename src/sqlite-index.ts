// SQLite-backed PlotIndex (SPEC §5.2). File lives at `.plot/.index.db` and is
// gitignored; first read rebuilds from `.plot/plot-*.json` if missing.
//
// The index is purely derived state. The schema mirrors the projection in
// `plotToIndexRow` exactly so the §5.4 invariant ("never put a field in the
// index that isn't derivable from a source file") is enforced by construction
// — every column has a source-file origin.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { listPlotIds, plotJsonPath, readJson } from "./io.ts";
import {
	type PlotIndex,
	type PlotIndexOrderBy,
	type PlotIndexRow,
	type PlotQuery,
	type PlotQueryResult,
	plotToIndexRow,
	type Unsubscribe,
} from "./plot-index.ts";
import type { Plot } from "./types.ts";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS plots (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plots_status_idx     ON plots(status);
CREATE INDEX IF NOT EXISTS plots_updated_at_idx ON plots(updated_at);
`;

const ORDER_COLUMNS: Record<PlotIndexOrderBy, string> = {
	id: "id",
	created_at: "created_at",
	updated_at: "updated_at",
};

export class SQLitePlotIndex implements PlotIndex {
	private readonly db: Database;
	private readonly subscribers = new Map<string, Set<() => void>>();
	private closed = false;

	constructor(dbPath: string) {
		if (dbPath !== ":memory:") {
			mkdirSync(dirname(dbPath), { recursive: true });
		}
		this.db = new Database(dbPath, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec(SCHEMA_SQL);
	}

	async rebuild(plotsDir: string): Promise<void> {
		this.assertOpen();
		const ids = await listPlotIds(plotsDir);
		const plots: Plot[] = [];
		for (const id of ids) {
			plots.push(await readJson<Plot>(plotJsonPath(plotsDir, id)));
		}

		const insert = this.db.prepare(
			"INSERT INTO plots (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		);
		const tx = this.db.transaction((rows: PlotIndexRow[]) => {
			this.db.exec("DELETE FROM plots");
			for (const r of rows) {
				insert.run(r.id, r.name, r.status, r.created_at, r.updated_at);
			}
		});
		tx(plots.map(plotToIndexRow));

		// Fire subscribers for every Plot that now exists in the index plus any
		// Plot a subscriber is watching that disappeared. Both transitions are
		// observable from the subscriber's perspective.
		const seen = new Set<string>();
		for (const id of ids) {
			seen.add(id);
			this.notify(id);
		}
		for (const id of this.subscribers.keys()) {
			if (!seen.has(id)) this.notify(id);
		}
	}

	async upsert(plot: Plot): Promise<void> {
		this.assertOpen();
		const row = plotToIndexRow(plot);
		this.db
			.prepare(
				`INSERT INTO plots (id, name, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   name       = excluded.name,
				   status     = excluded.status,
				   created_at = excluded.created_at,
				   updated_at = excluded.updated_at`,
			)
			.run(row.id, row.name, row.status, row.created_at, row.updated_at);
		this.notify(row.id);
	}

	async remove(id: string): Promise<void> {
		this.assertOpen();
		this.db.prepare("DELETE FROM plots WHERE id = ?").run(id);
		this.notify(id);
	}

	async query(q: PlotQuery = {}): Promise<PlotQueryResult> {
		this.assertOpen();

		const where: string[] = [];
		const params: (string | number)[] = [];

		if (q.ids !== undefined) {
			if (q.ids.length === 0) {
				// Explicit empty filter — match nothing without round-tripping SQL.
				return { rows: [], total: 0 };
			}
			where.push(`id IN (${q.ids.map(() => "?").join(",")})`);
			params.push(...q.ids);
		}

		if (q.status !== undefined) {
			const statuses = Array.isArray(q.status) ? q.status : [q.status];
			if (statuses.length === 0) {
				return { rows: [], total: 0 };
			}
			where.push(`status IN (${statuses.map(() => "?").join(",")})`);
			params.push(...statuses);
		}

		if (q.updatedSince !== undefined) {
			where.push("updated_at >= ?");
			params.push(q.updatedSince);
		}

		const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

		const totalRow = this.db
			.prepare(`SELECT COUNT(*) AS c FROM plots ${whereSql}`)
			.get(...params) as { c: number };

		const orderCol = ORDER_COLUMNS[q.orderBy ?? "updated_at"];
		const orderDir = q.orderDir === "asc" ? "ASC" : "DESC";

		let sql = `SELECT id, name, status, created_at, updated_at FROM plots ${whereSql} ORDER BY ${orderCol} ${orderDir}`;
		const pageParams: (string | number)[] = [];
		if (q.limit !== undefined) {
			sql += " LIMIT ?";
			pageParams.push(q.limit);
			if (q.offset !== undefined) {
				sql += " OFFSET ?";
				pageParams.push(q.offset);
			}
		}

		const rows = this.db.prepare(sql).all(...params, ...pageParams) as PlotIndexRow[];
		return { rows, total: totalRow.c };
	}

	subscribe(plotId: string, onChange: () => void): Unsubscribe {
		let set = this.subscribers.get(plotId);
		if (!set) {
			set = new Set();
			this.subscribers.set(plotId, set);
		}
		set.add(onChange);
		return () => {
			const s = this.subscribers.get(plotId);
			if (!s) return;
			s.delete(onChange);
			if (s.size === 0) this.subscribers.delete(plotId);
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.subscribers.clear();
		this.db.close();
	}

	private notify(plotId: string): void {
		const set = this.subscribers.get(plotId);
		if (!set) return;
		// Snapshot so a subscriber that unsubscribes itself during the callback
		// doesn't mutate the set we're iterating.
		for (const cb of [...set]) {
			cb();
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error("SQLitePlotIndex: instance is closed");
		}
	}
}
