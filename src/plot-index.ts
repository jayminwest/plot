// PlotIndex interface — derived materialized view over .plot/plot-xxx.json files
// (SPEC §5). The index is purely a query cache; the JSON + JSONL files on disk
// are the sole source of truth (§4.1, §5.4). Any field exposed here must be
// derivable from a source file so `rebuild()` can reconstruct the index from
// scratch.
//
// V1 ships a single implementation (SQLitePlotIndex) but the interface is
// designed so warren and other multi-instance consumers can plug in shared
// backends (Postgres, DuckDB, in-memory) later (§5.3).

import type { Plot, PlotStatus } from "./types.ts";

// A single row returned by `query`. Mirrors the structured-field subset of a
// Plot that's safe to project (no intent text, no event data — those stay in
// the source files and are only loaded via PlotStore.get + view).
export interface PlotIndexRow {
	id: string;
	name: string;
	status: PlotStatus;
	created_at: string;
	updated_at: string;
}

export type PlotIndexOrderBy = "id" | "created_at" | "updated_at";
export type PlotIndexOrderDir = "asc" | "desc";

export interface PlotQuery {
	// Restrict to these Plot IDs. Empty array means "match nothing".
	ids?: string[];
	// Restrict to one or more statuses.
	status?: PlotStatus | PlotStatus[];
	// updated_at >= this ISO 8601 timestamp.
	updatedSince?: string;
	limit?: number;
	offset?: number;
	// Default: updated_at desc.
	orderBy?: PlotIndexOrderBy;
	orderDir?: PlotIndexOrderDir;
}

export interface PlotQueryResult {
	rows: PlotIndexRow[];
	// Match count before limit/offset is applied. Useful for paging UIs.
	total: number;
}

export type Unsubscribe = () => void;

export interface PlotIndex {
	// Wipe and repopulate the index from `<plotsDir>/plot-*.json` files. Always
	// sufficient to reconstruct the index — §4.1 invariant. Notifies every
	// per-Plot subscriber whose Plot is present after rebuild.
	rebuild(plotsDir: string): Promise<void>;

	// Incremental update from a Plot in memory. PlotStore calls this after
	// every write so the index stays consistent without a full rebuild.
	upsert(plot: Plot): Promise<void>;

	// Drop a Plot from the index. PlotStore calls this when a Plot file is
	// deleted (rare in V1; reserved for archival flows).
	remove(id: string): Promise<void>;

	// Read-only query. Implementations should treat the query object as
	// immutable.
	query(q?: PlotQuery): Promise<PlotQueryResult>;

	// Observe changes to a single Plot. Fires after upsert/remove/rebuild
	// touches `plotId`. V1 is single-process; cross-process notification is
	// out of scope.
	subscribe(plotId: string, onChange: () => void): Unsubscribe;

	// Release any resources held by the index (e.g. the SQLite file handle).
	// Safe to call multiple times.
	close(): void;
}

// Pure projection used by every PlotIndex implementation. Centralizing this
// keeps the §5.4 invariant honest — if a future field needs indexing, it
// flows through one function.
export function plotToIndexRow(plot: Plot): PlotIndexRow {
	return {
		id: plot.id,
		name: plot.name,
		status: plot.status,
		created_at: plot.created_at,
		updated_at: plot.updated_at,
	};
}
