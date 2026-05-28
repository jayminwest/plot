import { describe, expect, test } from "bun:test";
import type { DestinationStream } from "pino";
import { createLog, REDACT_PATHS } from "./log.ts";

// Collect each line pino writes so we can assert on the serialized JSON.
function sink(): { stream: DestinationStream; lines: () => string[] } {
	const buf: string[] = [];
	return {
		stream: {
			write: (msg: string) => {
				buf.push(msg);
			},
		},
		lines: () => buf,
	};
}

describe("createLog redaction", () => {
	test("redacts root-level sensitive keys", () => {
		const s = sink();
		const log = createLog({ debug: true, destination: s.stream });
		log.debug(
			{ token: "sk-live-deadbeef", apiKey: "ak-123", password: "hunter2", secret: "s3cr3t" },
			"sanity",
		);
		const out = s.lines().join("");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("sk-live-deadbeef");
		expect(out).not.toContain("hunter2");
		expect(out).not.toContain("s3cr3t");
		expect(out).not.toContain("ak-123");
	});

	test("redacts one-level-nested sensitive keys via *.key", () => {
		const s = sink();
		const log = createLog({ debug: true, destination: s.stream });
		log.debug({ config: { token: "nested-token", apiKey: "nested-key" } }, "nested");
		const out = s.lines().join("");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("nested-token");
		expect(out).not.toContain("nested-key");
	});

	test("redacts auth + cookie headers", () => {
		const s = sink();
		const log = createLog({ debug: true, destination: s.stream });
		log.debug({ headers: { authorization: "Bearer abc.def", cookie: "session=xyz" } }, "request");
		const out = s.lines().join("");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("Bearer abc.def");
		expect(out).not.toContain("session=xyz");
	});

	test("leaves non-sensitive fields intact", () => {
		const s = sink();
		const log = createLog({ debug: true, destination: s.stream });
		log.debug({ plotId: "plot-12345678", count: 3 }, "ok");
		const out = s.lines().join("");
		expect(out).toContain("plot-12345678");
		expect(out).toContain("ok");
	});
});

describe("createLog level gating", () => {
	test("debug lines are suppressed at the default (info) level", () => {
		const s = sink();
		const log = createLog({ debug: false, destination: s.stream });
		log.debug({ token: "should-not-appear" }, "suppressed");
		expect(s.lines().join("")).toBe("");
	});

	test("info lines emit at the default level and still redact", () => {
		const s = sink();
		const log = createLog({ debug: false, destination: s.stream });
		log.info({ token: "secret-token" }, "kept");
		const out = s.lines().join("");
		expect(out).toContain("kept");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("secret-token");
	});
});

describe("REDACT_PATHS", () => {
	test("covers both bare and one-level wildcard forms for each secret key", () => {
		for (const key of ["token", "apiKey", "password", "secret"]) {
			expect(REDACT_PATHS).toContain(key);
			expect(REDACT_PATHS).toContain(`*.${key}`);
		}
	});
});
