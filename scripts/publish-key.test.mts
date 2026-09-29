import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { writeIndex } from "./build-index.ts";
import { renderJson, sha256 } from "./lib.ts";
import { type PublishOptions, publishAndIndex, publishRelease } from "./publish-key.ts";

const classmap = {
	main: {
		playbar: { indicator: "indicatorHashCC" },
		topbar: { retired: "retiredHashBB", wrapper: "topbarHashAA" },
	},
};
let root: string;
let source: string;
let staticReport: Record<string, any>;
let cdpReport: Record<string, any>;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "classmaps-"));
	source = path.join(root, "1020094");
	mkdirSync(source);
	writeFileSync(path.join(source, "classmap.json"), renderJson(classmap));
	writeFileSync(path.join(source, "css-map.json"), renderJson({ customHash: "semantic-name" }));
	writeSourceMeta({});
	writeFileSync(path.join(source, "VERIFICATION.md"), "# Spotify 1.2.94.583 (1020094)\n");
	const digest = sha256(readFileSync(path.join(source, "classmap.json")));
	staticReport = {
		target: { spotify_version: "1.2.96.518", css_sha256: "a".repeat(64), classmap_sha256: digest },
		summary: { needs_manual_check: 1, missing_in_css: 2 },
		rows: [
			{ path: "main.topbar.wrapper", class: "topbarHashAA", in_target_css: true, verdict: "needs_manual_check" },
			{ path: "main.topbar.retired", class: "retiredHashBB", in_target_css: false, verdict: "missing_in_css" },
			{ path: "main.playbar.indicator", class: "indicatorHashCC", in_target_css: false, verdict: "missing_in_css" },
		],
	};
	cdpReport = {
		cdp: { browser: { "User-Agent": "Spotify/1.2.96.518 Chrome/146" } },
		classmap: { sha256: digest },
		mode: "both",
		deep: true,
		navigation: { attempted: 8, succeeded: 8, failed: [] },
		summary: { total: 3, hits: 1, hitRate: 0.3333 },
		rows: [
			{ path: "main.topbar.wrapper", hash: "topbarHashAA", hit: true },
			{ path: "main.topbar.retired", hash: "retiredHashBB", hit: false },
			{ path: "main.playbar.indicator", hash: "indicatorHashCC", hit: false },
		],
	};
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeSourceMeta(changes: Record<string, unknown>): void {
	const meta = {
		schema_version: 2,
		spotify_version: "1.2.94.583",
		classmap_key: "1020094",
		status: "verified",
		generated: "2026-07-21",
		source: { method: "derived", key: null },
		stale_leaves: ["main.topbar.retired"],
		unverified_leaves: [],
		required_paths: { "main.playbar.indicator": "verified", "main.topbar.wrapper": "verified" },
		...changes,
	};
	writeFileSync(path.join(source, "META.json"), renderJson(meta));
}

function options(changes: Partial<PublishOptions> = {}): PublishOptions {
	return {
		root,
		inheritFrom: "1020094",
		spotifyVersion: "1.2.96.518",
		staticReport,
		cdpReport,
		generated: "2026-08-12",
		minHitRate: 0.25,
		...changes,
	};
}

const readMeta = (target: string) => JSON.parse(readFileSync(path.join(target, "META.json"), "utf8"));
const readVerification = (target: string) => readFileSync(path.join(target, "VERIFICATION.md"), "utf8");
const stagingDirs = () => readdirSync(root).filter((name) => name.startsWith(".1020096-"));

function setHit(leaf: string, hit: boolean, summary: Record<string, number>): void {
	cdpReport.rows.find((row: { path: string }) => row.path === leaf).hit = hit;
	Object.assign(cdpReport.summary, summary);
}

function bindReportsTo(file: string): void {
	const digest = sha256(readFileSync(file));
	staticReport.target.classmap_sha256 = digest;
	cdpReport.classmap.sha256 = digest;
}

test("promotes an unchanged map and records new stale paths", () => {
	const target = publishRelease(options());
	assert.equal(target, path.join(root, "1020096"));
	assert.deepEqual(readFileSync(path.join(target, "classmap.json")), readFileSync(path.join(source, "classmap.json")));
	assert.deepEqual(JSON.parse(readFileSync(path.join(target, "css-map.json"), "utf8")), { customHash: "semantic-name" });
	assert.ok(!readFileSync(path.join(target, "META.json")).includes("\r"));
	const meta = readMeta(target);
	assert.equal(meta.status, "verified");
	assert.deepEqual(meta.source, { method: "inherited", key: "1020094" });
	assert.deepEqual(meta.stale_leaves, ["main.topbar.retired"]);
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator"]);
	assert.ok(readVerification(target).includes("| static_present | 1 |"));
	assert.ok(readVerification(target).includes("| verified_cdp | 1 |"));
	assert.equal(meta.required_paths["main.topbar.wrapper"], "verified_cdp");
	assert.equal(meta.required_paths["main.playbar.indicator"], "unverified");
});

test("the generated index uses LF and hashes the published bytes", () => {
	writeIndex(root);
	const bytes = readFileSync(path.join(root, "index.json"));
	assert.ok(!bytes.includes("\r"));
	const entry = JSON.parse(bytes.toString()).keys["1020094"];
	for (const field of ["classmap", "cssMapOverlay", "meta"]) {
		assert.equal(entry[field].sha256, sha256(readFileSync(path.join(source, entry[field].file))));
	}
});

test("refuses a report from another Spotify version", () => {
	cdpReport.cdp.browser["User-Agent"] = "Spotify/1.2.95.453 Chrome/146";
	assert.throws(() => publishRelease(options()), /does not match Spotify 1\.2\.96\.518/);
});

test("refuses a Spotify version that only has the requested prefix", () => {
	cdpReport.cdp.browser["User-Agent"] = "Spotify/1.2.96.5189 Chrome/146";
	assert.throws(() => publishRelease(options()), /does not match Spotify 1\.2\.96\.518/);
});

test("refuses source metadata that does not match the source key", () => {
	writeSourceMeta({ classmap_key: "1020092" });
	assert.throws(() => publishRelease(options()), /source metadata key/);
});

test("a live hit overrides a CSS-only missing result", () => {
	setHit("main.playbar.indicator", true, { hits: 2, hitRate: 0.6667 });
	const target = publishRelease(options());
	const meta = readMeta(target);
	assert.deepEqual(meta.stale_leaves, ["main.topbar.retired"]);
	assert.deepEqual(meta.unverified_leaves, []);
	assert.equal(meta.required_paths["main.playbar.indicator"], "verified_cdp");
	assert.ok(readVerification(target).includes("| live_only | 1 |"));
	assert.ok(readVerification(target).includes("| unresolved_missing | 1 |"));
});

test("refuses a live report below the required hit rate", () => {
	setHit("main.topbar.wrapper", false, { hits: 0, hitRate: 0 });
	assert.throws(() => publishRelease(options()), /below required 0\.2500/);
});

test("refuses a summary that disagrees with rows", () => {
	cdpReport.rows[0].hit = false;
	assert.throws(() => publishRelease(options()), /summary does not match rows/);
});

test("refuses non-finite rates and bypass thresholds", () => {
	cdpReport.summary.hitRate = Number.NaN;
	assert.throws(() => publishRelease(options()), /finite/);
	cdpReport.summary.hitRate = 0.3333;
	assert.throws(() => publishRelease(options({ minHitRate: 0 })), /at least 0\.25/);
});

test("refuses a shallow CDP run", () => {
	cdpReport.deep = false;
	assert.throws(() => publishRelease(options()), /deep CDP/);
});

test("refuses a missing mode or failed deep navigation", () => {
	delete cdpReport.mode;
	assert.throws(() => publishRelease(options()), /mode 'both'/);
	cdpReport.mode = "both";
	cdpReport.navigation = { attempted: 8, succeeded: 0, failed: Array.from({ length: 8 }, (_, i) => `step-${i}`) };
	assert.throws(() => publishRelease(options()), /deep navigation coverage/);
});

test("refuses an inconsistent navigation ledger", () => {
	cdpReport.navigation = { attempted: 8, succeeded: 9, failed: [] };
	assert.throws(() => publishRelease(options()), /navigation ledger/);
	cdpReport.navigation = { attempted: 8, succeeded: 7, failed: [] };
	assert.throws(() => publishRelease(options()), /navigation ledger/);
});

test("refuses a static report that disagrees with its rows or build", () => {
	staticReport.summary = { missing_in_css: 0, needs_manual_check: 3 };
	assert.throws(() => publishRelease(options()), /static summary does not match rows/);
	staticReport.summary = { needs_manual_check: 1, missing_in_css: 2 };
	staticReport.target.spotify_version = "1.2.95.453";
	assert.throws(() => publishRelease(options()), /static report does not match/);
});

test("refuses a report leaf or digest mismatch", () => {
	cdpReport.rows[0].hash = "anotherHashZZ";
	assert.throws(() => publishRelease(options()), /does not match classmap/);
	cdpReport.rows[0].hash = "topbarHashAA";
	cdpReport.classmap.sha256 = "b".repeat(64);
	assert.throws(() => publishRelease(options()), /classmap digest/);
});

test("live verification recovers an inherited stale path", () => {
	setHit("main.topbar.retired", true, { hits: 2, hitRate: 0.6667 });
	assert.ok(!readMeta(publishRelease(options())).stale_leaves.includes("main.topbar.retired"));
});

test("a source-unverified path stays unverified without a live hit", () => {
	writeSourceMeta({
		required_paths: { "main.playbar.indicator": "verified", "main.topbar.wrapper": "unverified" },
		unverified_leaves: ["main.topbar.wrapper"],
	});
	setHit("main.topbar.wrapper", false, {});
	setHit("main.playbar.indicator", true, {});
	const meta = readMeta(publishRelease(options()));
	assert.equal(meta.required_paths["main.topbar.wrapper"], "unverified");
	assert.deepEqual(meta.unverified_leaves, ["main.topbar.wrapper"]);
});

test("a live hit clears a source-unverified path", () => {
	writeSourceMeta({
		required_paths: { "main.playbar.indicator": "verified", "main.topbar.wrapper": "unverified" },
		unverified_leaves: ["main.topbar.wrapper"],
	});
	const meta = readMeta(publishRelease(options()));
	assert.equal(meta.required_paths["main.topbar.wrapper"], "verified_cdp");
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator"]);
});

test("refuses a release that keeps a required path stale, leaving no staging files", () => {
	writeSourceMeta({
		required_paths: {
			"main.playbar.indicator": "verified",
			"main.topbar.retired": "verified",
			"main.topbar.wrapper": "verified",
		},
	});
	assert.throws(() => publishRelease(options()), /required path main\.topbar\.retired is stale/);
	assert.ok(!existsSync(path.join(root, "1020096")));
	assert.deepEqual(stagingDirs(), []);
});

test("an index failure rolls back the key and the index", () => {
	writeFileSync(path.join(root, "index.json"), '{"old": true}\n');
	mkdirSync(path.join(root, "1020090"));
	writeFileSync(path.join(root, "1020090", "classmap.json"), "{}\n");
	writeFileSync(path.join(root, "1020090", "META.json"), "not json");
	assert.throws(() => publishAndIndex(options()), SyntaxError);
	assert.ok(!existsSync(path.join(root, "1020096")));
	assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), '{"old": true}\n');
});

test("refuses to overwrite an existing target", () => {
	mkdirSync(path.join(root, "1020096"));
	assert.throws(() => publishRelease(options()), /1020096 already exists/);
});

test("publishes a derived key from a candidate map", () => {
	const candidate = path.join(root, "candidate.json");
	writeFileSync(candidate, JSON.stringify(classmap, null, "\t"));
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, '{"topbarHashAA":"Root__globalNav"}');
	bindReportsTo(candidate);

	const target = publishRelease(
		options({
			inheritFrom: undefined,
			classmapPath: candidate,
			overlayPath: overlay,
			derivedFrom: "1020094",
			stale: ["main.topbar.retired"],
			notes: ["The retired leaf has no rendered instance."],
		}),
	);

	assert.equal(readFileSync(path.join(target, "classmap.json"), "utf8"), renderJson(classmap));
	assert.equal(readFileSync(path.join(target, "css-map.json"), "utf8"), renderJson({ topbarHashAA: "Root__globalNav" }));
	const meta = readMeta(target);
	assert.deepEqual(meta.source, { method: "derived", key: "1020094" });
	assert.deepEqual(meta.stale_leaves, ["main.topbar.retired"]);
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator"]);
	assert.deepEqual(meta.required_paths, {
		"main.playbar.indicator": "unverified",
		"main.topbar.wrapper": "verified_cdp",
	});
	assert.ok(readVerification(target).includes("- Classmap derived from 1020094."));
	assert.ok(readVerification(target).includes("- The retired leaf has no rendered instance."));
});

test("refuses a derived candidate that stores Spicetify names", () => {
	const candidate = path.join(root, "candidate.json");
	writeFileSync(candidate, renderJson(classmap));
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, renderJson({ someHash: "topbarHashAA" }));
	bindReportsTo(candidate);
	assert.throws(
		() =>
			publishRelease(
				options({
					inheritFrom: undefined,
					classmapPath: candidate,
					overlayPath: overlay,
					derivedFrom: "1020094",
					stale: ["main.topbar.retired"],
				}),
			),
		/stores the Spicetify name topbarHashAA/,
	);
	assert.ok(!existsSync(path.join(root, "1020096")));
});

test("refuses stale paths for an inherited key", () => {
	assert.throws(
		() => publishRelease(options({ stale: ["main.topbar.wrapper"] })),
		/takes its map, overlay and stale paths/,
	);
});
