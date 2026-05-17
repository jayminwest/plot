import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "./lock.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "plot-lock-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("withFileLock", () => {
	test("serializes overlapping critical sections", async () => {
		const target = join(dir, "shared");
		let inside = 0;
		let maxInside = 0;

		const work = async () => {
			await withFileLock(target, async () => {
				inside++;
				if (inside > maxInside) maxInside = inside;
				// Hold the lock long enough that overlapping callers would race
				// without serialization.
				await new Promise((r) => setTimeout(r, 20));
				inside--;
			});
		};

		await Promise.all([work(), work(), work(), work()]);
		expect(maxInside).toBe(1);
	});

	test("releases the lock on success", async () => {
		const target = join(dir, "released");
		await withFileLock(target, async () => {});
		await expect(stat(`${target}.lock`)).rejects.toThrow();
	});

	test("releases the lock on error", async () => {
		const target = join(dir, "errored");
		await expect(
			withFileLock(target, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(stat(`${target}.lock`)).rejects.toThrow();
	});

	test("times out when the lock is held longer than timeoutMs", async () => {
		const target = join(dir, "contended");
		const release = Promise.withResolvers<void>();

		const holder = withFileLock(target, async () => {
			await release.promise;
		});

		try {
			await expect(
				withFileLock(target, async () => {}, { timeoutMs: 100, retryIntervalMs: 10 }),
			).rejects.toThrow(/Timed out waiting for lock/);
		} finally {
			release.resolve();
			await holder;
		}
	});

	test("reclaims a stale lock", async () => {
		const target = join(dir, "stale");
		const lockPath = `${target}.lock`;
		// Hand-create a stale lock file. staleMs:1 forces immediate eviction
		// after a brief sleep, simulating a crashed peer.
		await writeFile(lockPath, "");
		await new Promise((r) => setTimeout(r, 10));

		let ran = false;
		await withFileLock(
			target,
			async () => {
				ran = true;
			},
			{ staleMs: 1, timeoutMs: 1_000, retryIntervalMs: 5 },
		);
		expect(ran).toBe(true);
	});
});
