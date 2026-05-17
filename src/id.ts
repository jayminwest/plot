import { randomBytes } from "node:crypto";

// SPEC §3.3 — Plot: pl-<8 char base32>; Attachment: att-<3 digit>.
// The spec example `pl-abc12345` mixes letters and digits, so we accept
// any lowercase alphanumeric. Stricter base32 (RFC 4648) is a superset
// rejection we can tighten later without breaking existing IDs.

const PLOT_ID_RE = /^pl-[a-z0-9]{8}$/;
const ATTACHMENT_ID_RE = /^att-\d{3}$/;

export function isPlotId(value: string): boolean {
	return PLOT_ID_RE.test(value);
}

export function isAttachmentId(value: string): boolean {
	return ATTACHMENT_ID_RE.test(value);
}

export function assertPlotId(value: string): void {
	if (!isPlotId(value)) {
		throw new Error(
			`invalid Plot ID: ${JSON.stringify(value)} (expected pl-<8 lowercase alphanumeric>)`,
		);
	}
}

export function assertAttachmentId(value: string): void {
	if (!isAttachmentId(value)) {
		throw new Error(`invalid attachment ID: ${JSON.stringify(value)} (expected att-NNN)`);
	}
}

// Generate a fresh pl-<8 char> ID that does not collide with the given set.
export function generatePlotId(existingIds: Iterable<string> = []): string {
	const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
	for (let attempt = 0; attempt < 100; attempt++) {
		const id = `pl-${randomBytes(5).toString("hex").slice(0, 8)}`;
		if (!taken.has(id)) return id;
	}
	throw new Error("generatePlotId: exhausted attempts (100 collisions in a row)");
}

// Attachments are sequential per Plot; pass in existing IDs and get the next.
export function nextAttachmentId(existingIds: Iterable<string>): string {
	let max = 0;
	for (const id of existingIds) {
		const match = id.match(/^att-(\d{3})$/);
		if (match?.[1]) {
			const n = Number.parseInt(match[1], 10);
			if (n > max) max = n;
		}
	}
	const next = max + 1;
	if (next > 999) {
		throw new Error("nextAttachmentId: attachment count exceeds 999 (att-NNN format limit)");
	}
	return `att-${String(next).padStart(3, "0")}`;
}
