// Advisory file-level lock used by the Plot file IO layer (SPEC §4.4).
// Matches the mulch/seeds convention: O_CREAT | O_EXCL lock files with
// a stale-lock recovery window so a crashed writer can't deadlock peers.

import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

export interface WithFileLockOptions {
	timeoutMs?: number;
	staleMs?: number;
	retryIntervalMs?: number;
}

export async function withFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
	opts: WithFileLockOptions = {},
): Promise<T> {
	const lockPath = `${filePath}.lock`;
	const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
	const staleMs = opts.staleMs ?? LOCK_STALE_MS;
	const retryIntervalMs = opts.retryIntervalMs ?? LOCK_RETRY_INTERVAL_MS;

	await acquireLock(lockPath, timeoutMs, staleMs, retryIntervalMs);
	try {
		return await fn();
	} finally {
		await releaseLock(lockPath);
	}
}

async function acquireLock(
	lockPath: string,
	timeoutMs: number,
	staleMs: number,
	retryIntervalMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while (true) {
		try {
			const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
			await fd.close();
			return;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
				throw err;
			}

			if (await isStaleLock(lockPath, staleMs)) {
				try {
					await unlink(lockPath);
				} catch {
					// Another process may have already removed it.
				}
				continue;
			}

			if (Date.now() >= deadline) {
				throw new Error(
					`Timed out waiting for lock on ${lockPath}. If no other plot process is running, delete the lock file manually.`,
				);
			}

			await sleep(retryIntervalMs);
		}
	}
}

async function isStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
	try {
		const stats = await lstat(lockPath);
		return Date.now() - stats.mtimeMs > staleMs;
	} catch {
		return false;
	}
}

async function releaseLock(lockPath: string): Promise<void> {
	try {
		await unlink(lockPath);
	} catch {
		// Lock file already gone — acceptable.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
