import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { renderJson } from "./lib.ts";
import { keyErrors } from "./validate-classmaps.ts";

const classmap = { main: { topbar: { retired: "retiredHashBB", wrapper: "topbarHashAA" } } };
let root: string;
let parent: string;
let child: string;
let childMeta: Record<string, unknown>;

function meta(key: string, version: string, source: Record<string, unknown>) {
	return {
		schema_version: 2,
		classmap_key: key,
		spotify_version: version,
		status: "verified",
		generated: "2026-08-12",
		source,
		required_paths: { "main.topbar.wrapper": "verified_cdp" },
		stale_leaves: ["main.topbar.retired"],
		unverified_leaves: [],
	};
}

function writeKey(key: string, map: unknown, keyMeta: unknown): string {
	const dir = path.join(root, key);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "classmap.json"), renderJson(map));
	writeFileSync(path.join(dir, "META.json"), renderJson(keyMeta));
	writeFileSync(path.join(dir, "VERIFICATION.md"), `# ${key}\n`);
	return dir;
}

const parentMeta = () => meta("1020094", "1.2.94.583", { method: "derived", key: null });
const errors = (dir: string) => keyErrors(dir, path.basename(dir), root);

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "classmaps-"));
	parent = writeKey("1020094", classmap, parentMeta());
	childMeta = meta("1020096", "1.2.96.518", { method: "inherited", key: "1020094" });
	child = writeKey("1020096", classmap, childMeta);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("accepts a consistent inherited release", () => {
	assert.deepEqual(errors(parent), []);
	assert.deepEqual(errors(child), []);
});

test("rejects an inherited map whose bytes differ from its source", () => {
	writeKey("1020096", { main: { topbar: { retired: "retiredHashBB", wrapper: "otherHashCC" } } }, childMeta);
	assert.ok(errors(child).includes("classmap.json: inherited from 1020094 but its bytes differ"));
});

test("rejects a leaf listed as both stale and unverified", () => {
	childMeta.unverified_leaves = ["main.topbar.retired"];
	writeKey("1020096", classmap, childMeta);
	assert.ok(errors(child).includes("META.json: main.topbar.retired is both stale and unverified"));
});

test("rejects a required status that disagrees with the leaf lists", () => {
	childMeta.required_paths = { "main.topbar.wrapper": "unverified" };
	writeKey("1020096", classmap, childMeta);
	assert.ok(errors(child).includes("META.json: main.topbar.wrapper is unverified but unverified_leaves disagrees"));
});

test("rejects free-text path statuses", () => {
	childMeta.required_paths = { "main.topbar.wrapper": "verified (present in target CSS)" };
	writeKey("1020096", classmap, childMeta);
	assert.ok(errors(child).some((e) => e.includes("unknown status")));
});

test("rejects empty groups and padded class strings", () => {
	writeKey("1020096", { main: { panel: {}, topbar: { wrapper: " a  b" } } }, childMeta);
	const found = errors(child);
	assert.ok(found.includes("classmap.json: main.panel: empty group"));
	assert.ok(
		found.includes("classmap.json: main.topbar.wrapper: classes must be single-space separated with no padding"),
	);
});

test("rejects non-canonical JSON and stray classmap files", () => {
	writeFileSync(path.join(child, "classmap.json"), JSON.stringify(classmap, null, "\t"));
	writeFileSync(path.join(child, "classmap-19f856aefd5.json"), "{}\n");
	const found = errors(child);
	assert.ok(found.includes("classmap.json: not canonical (2-space indent, sorted keys, trailing newline)"));
	assert.ok(found.includes("classmap-19f856aefd5.json: not part of the published layout"));
});

test("rejects metadata that names another build", () => {
	childMeta.spotify_version = "1.2.97.270";
	writeKey("1020096", classmap, childMeta);
	assert.ok(errors(child).includes("META.json: spotify_version does not belong to 1020096"));
});

test("rejects a leaf stored as its Spicetify name", () => {
	writeFileSync(path.join(child, "css-map.json"), renderJson({ topbarHashAA: "Root__globalNav" }));
	const named = { main: { topbar: { retired: "main-topBar-retired", wrapper: "Root__globalNav" } } };
	writeKey("1020094", named, parentMeta());
	writeKey("1020096", named, childMeta);
	const found = errors(child);
	assert.ok(
		found.includes("classmap.json: main.topbar.wrapper stores the Spicetify name Root__globalNav, not the stock class"),
	);
	assert.ok(
		found.includes(
			"classmap.json: main.topbar.retired stores the Spicetify name main-topBar-retired, not the stock class",
		),
	);
});

test("rejects inheritance across a minor version", () => {
	const dir = writeKey("1030004", classmap, meta("1030004", "1.3.4.100", { method: "inherited", key: "1020094" }));
	assert.ok(errors(dir).includes("META.json: an inherited map must come from the same major.minor family"));
});

test("rejects a compact, week or impossible date", () => {
	for (const generated of ["20260812", "2026-W33-3", "2026-02-30"]) {
		childMeta.generated = generated;
		writeKey("1020096", classmap, childMeta);
		assert.ok(errors(child).includes("META.json: generated must be a YYYY-MM-DD date"), generated);
	}
});

test("rejects group keys that would collide as dotted paths", () => {
	writeKey("1020096", { main: { topbar: { wrapper: "b" }, "topbar.wrapper": "a" } }, childMeta);
	assert.ok(
		errors(child).includes('classmap.json: main: group key "topbar.wrapper" must be non-empty and contain no dots'),
	);
});
