import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
	fileURLToPath(
		new URL("../src/posapp/workers/itemWorker.js", import.meta.url),
	),
	"utf8",
);

describe("persistence worker schema safety", () => {
	it("does not run historical full-table migrations in the worker", () => {
		expect(workerSource).not.toContain("toCollection().modify");
		expect(workerSource).not.toContain("toArray().then");
	});

	it("declares the current schema and limits upgrades to the schema signature", () => {
		expect(workerSource).toContain("db.version(18)");
		expect(workerSource).toContain('tx.table("settings").put({');
		expect(workerSource.match(/\.upgrade\(/g)).toHaveLength(2);
	});
});
