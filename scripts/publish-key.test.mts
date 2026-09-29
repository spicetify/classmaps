import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { writeIndex } from "./build-index.ts";
import { type Classmap, leafValues, renderJson, sha256 } from "./lib.ts";
import { type PublishOptions, publishAndIndex, publishRelease } from "./publish-key.ts";

const classmap = {
	main: {
		playbar: { indicator: "indicatorHashCC" },
		topbar: { retired: "retiredHashBB", wrapper: "topbarHashAA" },
	},
};
const inTargetCss = new Set(["main.topbar.wrapper"]);
let root: string;
let source: string;
let staticReport: Record<string, any>;
let cdpReport: Record<string, any>;

/** Reports for `map` on `version`: `css` paths are in the target CSS, `hits` were observed live. */
function reportsFor(map: Classmap, version: string, css: Set<string>, hits: Set<string>) {
	const digest = sha256(renderJson(map));
	const leaves = [...leafValues(map)];
	const summary: Record<string, number> = {};
	const staticRows = leaves.map(([leaf, cls]) => {
		const verdict = css.has(leaf) ? "needs_manual_check" : "missing_in_css";
		summary[verdict] = (summary[verdict] ?? 0) + 1;
		return { path: leaf, class: cls, missing_classes: css.has(leaf) ? [] : cls.split(" "), in_target_css: css.has(leaf), verdict };
	});
	const hitCount = leaves.filter(([leaf]) => hits.has(leaf)).length;
	return {
		static: { target: { spotify_version: version, css_sha256: "a".repeat(64), classmap_sha256: digest }, summary, rows: staticRows },
		cdp: {
			generatedAt: "2026-08-12T10:00:00.000Z",
			cdp: { browser: { "User-Agent": `Spotify/${version} Chrome/146` } },
			classmap: { sha256: digest },
			mode: "both",
			deep: true,
			navigation: { attempted: 8, succeeded: 8, failed: [] },
			summary: { total: leaves.length, hits: hitCount, hitRate: Number((hitCount / leaves.length).toFixed(4)) },
			rows: leaves.map(([leaf, cls]) => ({ path: leaf, hash: cls, hit: hits.has(leaf), hashHit: hits.has(leaf), semHit: false })),
		},
	};
}

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
		verified_classmap_sha256: null,
		...changes,
	};
	writeFileSync(path.join(source, "META.json"), renderJson(meta));
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "classmaps-"));
	source = path.join(root, "1020094");
	mkdirSync(source);
	writeFileSync(path.join(source, "classmap.json"), renderJson(classmap));
	writeFileSync(path.join(source, "css-map.json"), renderJson({ customHash: "semantic-name" }));
	writeSourceMeta({});
	writeFileSync(path.join(source, "VERIFICATION.md"), "# Spotify 1.2.94.583 (1020094)\n");
	const reports = reportsFor(classmap, "1.2.96.518", inTargetCss, new Set(["main.topbar.wrapper"]));
	staticReport = reports.static;
	cdpReport = reports.cdp;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

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

function derived(map: Classmap, changes: Partial<PublishOptions> = {}): Partial<PublishOptions> {
	const candidate = path.join(root, "candidate.json");
	writeFileSync(candidate, renderJson(map));
	return { inheritFrom: undefined, classmapPath: candidate, derivedFrom: "1020094", ...changes };
}

const readMeta = (target: string) => JSON.parse(readFileSync(path.join(target, "META.json"), "utf8"));
const readVerification = (target: string) => readFileSync(path.join(target, "VERIFICATION.md"), "utf8");
const stagingDirs = () => readdirSync(root).filter((name) => name.startsWith("."));

function setHit(leaf: string, hit: boolean, summary: Record<string, number>): void {
	const row = cdpReport.rows.find((r: { path: string }) => r.path === leaf);
	row.hit = hit;
	row.hashHit = hit;
	Object.assign(cdpReport.summary, summary);
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
	assert.equal(meta.verified_classmap_sha256, sha256(readFileSync(path.join(target, "classmap.json"))));
	assert.equal(meta.required_paths["main.topbar.wrapper"], "verified_cdp");
	assert.equal(meta.required_paths["main.playbar.indicator"], "unverified");
	const verification = readVerification(target);
	assert.ok(verification.includes("| static_present | 1 |"));
	assert.ok(verification.includes("| verified_cdp | 1 |"));
	assert.ok(verification.includes(`- Classmap SHA-256: \`${meta.verified_classmap_sha256}\``));
	assert.ok(verification.includes("- CDP report generated: 2026-08-12T10:00:00.000Z"));
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

test("refuses a legacy source without META.json by name", () => {
	rmSync(path.join(source, "META.json"));
	assert.throws(() => publishRelease(options()), /1020094 has no META\.json/);
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

test("a semantic-only hit does not clear a path missing from the stock CSS", () => {
	const row = cdpReport.rows.find((r: { path: string }) => r.path === "main.playbar.indicator");
	Object.assign(row, { hit: true, hashHit: false, semHit: true });
	Object.assign(cdpReport.summary, { hits: 2, hitRate: 0.6667 });
	const meta = readMeta(publishRelease(options()));
	assert.equal(meta.required_paths["main.playbar.indicator"], "unverified");
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator"]);
});

test("accepts the CLI's rounding of a hit rate", () => {
	const wide: Classmap = { leaves: Object.fromEntries(Array.from({ length: 160 }, (_, i) => [`leaf${i}`, `hashLeaf${i}XX`])) };
	const hits = new Set(Array.from({ length: 41 }, (_, i) => `leaves.leaf${i}`));
	const reports = reportsFor(wide, "1.2.96.518", new Set(leafValues(wide).keys()), hits);
	assert.equal(reports.cdp.summary.hitRate, 0.2562);
	writeSourceMeta({ required_paths: {}, stale_leaves: [] });
	const target = publishRelease(
		options({ ...derived(wide), staticReport: reports.static, cdpReport: reports.cdp, requiredFrom: "1020094" }),
	);
	assert.ok(readVerification(target).includes("| cdp_hit_rate | 0.2562 |"));
});

test("refuses a live report below the required hit rate", () => {
	setHit("main.topbar.wrapper", false, { hits: 0, hitRate: 0 });
	assert.throws(() => publishRelease(options()), /below required 0\.2500/);
});

test("refuses a summary that disagrees with rows", () => {
	cdpReport.rows[0].hit = !cdpReport.rows[0].hit;
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
	const row = cdpReport.rows[0];
	const hash = row.hash;
	row.hash = "anotherHashZZ";
	assert.throws(() => publishRelease(options()), /does not match classmap/);
	row.hash = hash;
	cdpReport.classmap.sha256 = "b".repeat(64);
	assert.throws(() => publishRelease(options()), /classmap digest/);
});

test("live verification recovers an inherited stale path", () => {
	setHit("main.topbar.retired", true, { hits: 2, hitRate: 0.6667 });
	staticReport.rows.find((r: { path: string }) => r.path === "main.topbar.retired").in_target_css = true;
	staticReport.rows.find((r: { path: string }) => r.path === "main.topbar.retired").verdict = "needs_manual_check";
	staticReport.summary = { needs_manual_check: 2, missing_in_css: 1 };
	assert.ok(!readMeta(publishRelease(options())).stale_leaves.includes("main.topbar.retired"));
});

test("a source-unverified path stays unverified without a live hit", () => {
	writeSourceMeta({
		required_paths: { "main.playbar.indicator": "verified", "main.topbar.wrapper": "unverified" },
		unverified_leaves: ["main.topbar.wrapper"],
	});
	setHit("main.topbar.wrapper", false, {});
	setHit("main.playbar.indicator", true, {});
	staticReport.rows.find((r: { path: string }) => r.path === "main.playbar.indicator").in_target_css = true;
	staticReport.rows.find((r: { path: string }) => r.path === "main.playbar.indicator").verdict = "needs_manual_check";
	staticReport.summary = { needs_manual_check: 2, missing_in_css: 1 };
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
	assert.throws(() => publishAndIndex(options()), /1020090\/META\.json/);
	assert.ok(!existsSync(path.join(root, "1020096")));
	assert.equal(readFileSync(path.join(root, "index.json"), "utf8"), '{"old": true}\n');
	assert.deepEqual(stagingDirs(), []);
});

test("refuses to overwrite an existing key without --replace", () => {
	publishRelease(options());
	assert.throws(() => publishRelease(options()), /1020096 already exists; pass --replace/);
});

test("--replace re-verifies a key, keeping its first publication date", () => {
	publishRelease(options());
	setHit("main.playbar.indicator", true, { hits: 2, hitRate: 0.6667 });
	const target = publishRelease(options({ replace: true, generated: "2026-09-30" }));
	const meta = readMeta(target);
	assert.equal(meta.generated, "2026-08-12");
	assert.equal(meta.required_paths["main.playbar.indicator"], "verified_cdp");
	assert.ok(readVerification(target).includes("Replaces an earlier verification"));
	const [current, earlier] = readVerification(target).split("## Earlier verification\n");
	assert.ok(current.includes("| verified_cdp | 2 |"));
	assert.ok(earlier.includes("### Notes") && earlier.includes("| verified_cdp | 1 |"), "the replaced history is kept, one level deeper");
	assert.deepEqual(stagingDirs(), []);
});

test("--replace refuses a map that would break the keys inheriting from it", () => {
	publishRelease(options());
	const changed = { ...classmap, main: { ...classmap.main, playbar: { indicator: "otherHashDD" } } };
	const reports = reportsFor(changed, "1.2.94.583", inTargetCss, new Set(["main.topbar.wrapper"]));
	const before = readFileSync(path.join(source, "classmap.json"));
	writeSourceMeta({});
	assert.throws(
		() =>
			publishRelease(
				options({
					...derived(changed, { derivedFrom: undefined, requiredFrom: undefined }),
					spotifyVersion: "1.2.94.583",
					staticReport: reports.static,
					cdpReport: reports.cdp,
					replace: true,
				}),
			),
		/keys inheriting from 1020094 would break/,
	);
	assert.deepEqual(readFileSync(path.join(source, "classmap.json")), before);
	assert.deepEqual(stagingDirs(), []);
});

test("publishes a derived key from a candidate map", () => {
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, renderJson({ topbarHashAA: "Root__globalNav" }));
	const target = publishRelease(
		options(derived(classmap, { overlayPath: overlay, notes: ["The retired leaf has no rendered instance."] })),
	);
	assert.equal(readFileSync(path.join(target, "classmap.json"), "utf8"), renderJson(classmap));
	assert.equal(readFileSync(path.join(target, "css-map.json"), "utf8"), renderJson({ topbarHashAA: "Root__globalNav" }));
	const meta = readMeta(target);
	assert.deepEqual(meta.source, { method: "derived", key: "1020094" });
	assert.deepEqual(meta.stale_leaves, ["main.topbar.retired"], "an unchanged stale leaf of the source stays stale");
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator"]);
	assert.deepEqual(meta.required_paths, {
		"main.playbar.indicator": "unverified",
		"main.topbar.wrapper": "verified_cdp",
	});
	assert.ok(readVerification(target).includes("- Classmap derived from 1020094."));
	assert.ok(readVerification(target).includes("- The retired leaf has no rendered instance."));
});

test("binds the published overlay to the one the CDP run applied", () => {
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, renderJson({ topbarHashAA: "Root__globalNav" }));
	cdpReport.cssMap = { sha256: "c".repeat(64), overlaySha256: sha256(readFileSync(overlay)) };
	const target = publishRelease(options(derived(classmap, { overlayPath: overlay })));
	assert.ok(!readVerification(target).includes("did not apply this key's overlay"));
	rmSync(target, { recursive: true });

	cdpReport.cssMap.overlaySha256 = "d".repeat(64);
	assert.throws(() => publishRelease(options(derived(classmap, { overlayPath: overlay }))), /different overlay/);

	delete cdpReport.cssMap;
	const unchecked = publishRelease(options(derived(classmap, { overlayPath: overlay })));
	assert.ok(readVerification(unchecked).includes("The CDP run did not apply this key's overlay"));
});

test("refuses an overlay that is not in canonical form", () => {
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, '{"topbarHashAA":"Root__globalNav"}');
	assert.throws(() => publishRelease(options(derived(classmap, { overlayPath: overlay }))), /overlay is not in canonical form/);
});

test("a derived key keeps the leaves the migrate report kept as stale", () => {
	writeSourceMeta({ stale_leaves: [], required_paths: { "main.topbar.wrapper": "verified" } });
	const migrateReport = { unmatched: [{ path: "main.playbar.indicator", old: "indicatorHashCC", kept: "indicatorHashCC", stale: true }] };
	const meta = readMeta(publishRelease(options(derived(classmap, { migrateReport, requiredFrom: undefined }))));
	assert.deepEqual(meta.stale_leaves, ["main.playbar.indicator"]);
	assert.deepEqual(meta.unverified_leaves, ["main.topbar.retired"]);
});

test("a kept leaf whose classes are not hashes stays resolvable", () => {
	const encore = { main: { topbar: { retired: "retiredHashBB", wrapper: "topbarHashAA" }, playbar: { indicator: "e-10860-button-primary__inner" } } };
	const reports = reportsFor(encore, "1.2.96.518", inTargetCss, new Set(["main.topbar.wrapper"]));
	writeSourceMeta({ stale_leaves: [], required_paths: { "main.topbar.wrapper": "verified" } });
	const migrateReport = { unmatched: [{ path: "main.playbar.indicator", kept: "e-10860-button-primary__inner", stale: true }] };
	const meta = readMeta(
		publishRelease(options({ ...derived(encore, { migrateReport }), staticReport: reports.static, cdpReport: reports.cdp })),
	);
	assert.deepEqual(meta.stale_leaves, []);
	assert.deepEqual(meta.unverified_leaves, ["main.playbar.indicator", "main.topbar.retired"]);
});

test("a required path migrate kept with a missing hash stays unverified with a note", () => {
	writeSourceMeta({ stale_leaves: [] });
	const migrateReport = { unmatched: [{ path: "main.playbar.indicator", kept: "indicatorHashCC", stale: true }] };
	const target = publishRelease(options(derived(classmap, { migrateReport })));
	const meta = readMeta(target);
	assert.equal(meta.required_paths["main.playbar.indicator"], "unverified");
	assert.ok(!meta.stale_leaves.includes("main.playbar.indicator"));
	assert.ok(readVerification(target).includes("Required path main.playbar.indicator kept indicatorHashCC, which the stock CSS lacks"));
});

test("--drop-required stops tracking a path the new map no longer has", () => {
	const smaller = { main: { topbar: { retired: "retiredHashBB", wrapper: "topbarHashAA" } } };
	const reports = reportsFor(smaller, "1.2.96.518", inTargetCss, new Set(["main.topbar.wrapper"]));
	const target = publishRelease(
		options({ ...derived(smaller, { dropRequired: ["main.playbar.indicator"] }), staticReport: reports.static, cdpReport: reports.cdp }),
	);
	assert.deepEqual(readMeta(target).required_paths, { "main.topbar.wrapper": "verified_cdp" });
	assert.ok(readVerification(target).includes("No longer tracks the required path main.playbar.indicator."));
});

test("refuses a candidate map that is not in canonical form", () => {
	const candidate = path.join(root, "candidate.json");
	writeFileSync(candidate, JSON.stringify(classmap, null, "\t"));
	assert.throws(
		() => publishRelease(options({ inheritFrom: undefined, classmapPath: candidate, derivedFrom: "1020094" })),
		/not in canonical form/,
	);
});

test("refuses a derived candidate that stores Spicetify names", () => {
	const overlay = path.join(root, "overlay.json");
	writeFileSync(overlay, renderJson({ someHash: "topbarHashAA" }));
	assert.throws(() => publishRelease(options(derived(classmap, { overlayPath: overlay }))), /stores the Spicetify name topbarHashAA/);
	assert.ok(!existsSync(path.join(root, "1020096")));
});

test("refuses stale paths or required-path changes for an inherited key", () => {
	assert.throws(() => publishRelease(options({ stale: ["main.topbar.wrapper"] })), /takes its map, overlay and stale paths/);
	assert.throws(() => publishRelease(options({ dropRequired: ["main.topbar.wrapper"] })), /tracks its source's required paths/);
});
