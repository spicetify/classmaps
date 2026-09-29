// Regenerates index.json, the manifest the CLI fetches to resolve a classmap.
// Output is deterministic (no timestamps) so --check is a plain comparison.
//
//   node scripts/build-index.ts          # rewrite index.json
//   node scripts/build-index.ts --check  # fail if it is out of date

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { keyDirs, renderJson, ROOT, sha256, writeText } from "./lib.ts";

type FileRef = { file: string; sha256: string };
type Entry = {
	classmap: FileRef;
	cssMapOverlay?: FileRef;
	meta?: FileRef;
	spotifyVersion?: string;
	status?: string;
};

function fileRef(dir: string, name: string): FileRef {
	return { file: name, sha256: sha256(readFileSync(path.join(dir, name))) };
}

function entryFor(keyDir: string): Entry | null {
	if (!existsSync(path.join(keyDir, "classmap.json"))) return null;
	const entry: Entry = { classmap: fileRef(keyDir, "classmap.json") };
	if (existsSync(path.join(keyDir, "css-map.json"))) entry.cssMapOverlay = fileRef(keyDir, "css-map.json");
	if (existsSync(path.join(keyDir, "META.json"))) {
		entry.meta = fileRef(keyDir, "META.json");
		const meta = JSON.parse(readFileSync(path.join(keyDir, "META.json"), "utf8"));
		if ("spotify_version" in meta) entry.spotifyVersion = meta.spotify_version;
		if ("status" in meta) entry.status = meta.status;
	}
	return entry;
}

export function buildIndex(root = ROOT): Record<string, unknown> {
	const keys: Record<string, Entry> = {};
	for (const key of keyDirs(root)) {
		const entry = entryFor(path.join(root, key));
		if (entry) keys[key] = entry;
		else console.error(`skipping ${key}: no classmap file`);
	}
	const index: Record<string, unknown> = { version: 1, keys };
	// The exposure patch set is one file for every build, so it sits beside the
	// keys rather than under one; older CLIs ignore the entry.
	if (existsSync(path.join(root, "expose.json"))) index.expose = fileRef(root, "expose.json");
	return index;
}

export function writeIndex(root = ROOT): void {
	writeText(path.join(root, "index.json"), renderJson(buildIndex(root)));
}

export function indexIsCurrent(root = ROOT): boolean {
	const file = path.join(root, "index.json");
	return existsSync(file) && readFileSync(file, "utf8") === renderJson(buildIndex(root));
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		if (indexIsCurrent()) console.log("index.json is up to date");
		else {
			console.error("index.json is out of date; run node scripts/build-index.ts");
			process.exitCode = 1;
		}
	} else {
		writeIndex();
		console.log("wrote index.json");
	}
}
