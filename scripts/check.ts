// Runs every data check CI runs, then the unit tests. With --fix, first
// rewrites the JSON files in canonical form and rebuilds index.json.
//
//   node scripts/check.ts
//   node scripts/check.ts --fix

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { indexIsCurrent, writeIndex } from "./build-index.ts";
import { keyDirs, renderJson, ROOT, writeText } from "./lib.ts";
import { validateClassmaps } from "./validate-classmaps.ts";
import { renderExpose, validateExpose } from "./validate-expose.ts";

function fix(): void {
	for (const key of keyDirs(ROOT)) {
		for (const name of ["classmap.json", "css-map.json", "META.json"]) {
			const file = path.join(ROOT, key, name);
			if (existsSync(file)) writeText(file, renderJson(JSON.parse(readFileSync(file, "utf8"))));
		}
	}
	const expose = path.join(ROOT, "expose.json");
	writeText(expose, renderExpose(JSON.parse(readFileSync(expose, "utf8"))));
	writeIndex();
}

function main(): number {
	if (process.argv.includes("--fix")) fix();
	const failed: string[] = [];
	if (!indexIsCurrent()) {
		console.error("index.json is out of date; run node scripts/check.ts --fix");
		failed.push("index");
	}
	if (validateClassmaps() !== 0) failed.push("classmaps");
	if (validateExpose() !== 0) failed.push("expose");
	const tests = spawnSync(process.execPath, ["--test", "scripts/*.test.mts"], { cwd: ROOT, stdio: "inherit" });
	if (tests.status !== 0) failed.push("tests");
	if (failed.length) {
		console.error(`failed: ${failed.join(", ")}`);
		return 1;
	}
	console.log("all checks passed");
	return 0;
}

process.exitCode = main();
