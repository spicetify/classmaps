// Runs every data check CI runs, then the unit tests. With --fix, first
// rewrites the JSON files in canonical form and rebuilds index.json. With
// --fix and file arguments, only formats those files.
//
//   node scripts/check.ts
//   node scripts/check.ts --fix
//   node scripts/check.ts --fix /tmp/candidate.json

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { indexIsCurrent, writeIndex } from "./build-index.ts";
import { keyDirs, readUtf8, renderJson, ROOT, writeText } from "./lib.ts";
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
	const args = process.argv.slice(2);
	const files = args.filter((arg) => arg !== "--fix");
	if (args.includes("--fix") && files.length) {
		for (const file of files) writeText(file, renderJson(JSON.parse(readUtf8(file))));
		console.log(`formatted ${files.join(", ")}`);
		return 0;
	}
	if (args.includes("--fix")) fix();
	const failed: string[] = [];
	const step = (name: string, run: () => boolean) => {
		try {
			if (!run()) failed.push(name);
		} catch (e) {
			console.error(`${name}: ${(e as Error).message}`);
			failed.push(name);
		}
	};
	step("index", () => {
		if (indexIsCurrent()) return true;
		console.error("index.json is out of date; run pnpm fix");
		return false;
	});
	step("classmaps", () => validateClassmaps() === 0);
	step("expose", () => validateExpose() === 0);
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
