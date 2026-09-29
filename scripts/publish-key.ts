// Publishes a classmap key from the CLI's static and deep CDP verification reports.
//
// An inherited key copies an older key's map and overlay byte-for-byte:
//
//   node scripts/publish-key.ts --inherit-from 1020094 \
//     --spotify-version 1.2.96.518 \
//     --static-report static.json --cdp-report cdp.json
//
// A derived key publishes a new candidate map:
//
//   node scripts/publish-key.ts --classmap candidate.json --css-map overlay.json \
//     --derived-from 1030001 --spotify-version 1.3.2.100 \
//     --static-report static.json --cdp-report cdp.json \
//     --stale main.topbar.right.upgrade_button.wrapper \
//     --note "The upgrade button has no rendered instance on a premium account."
//
// Both reports must be bound to the published map and Spotify build. The
// command writes classmap.json, css-map.json, META.json and VERIFICATION.md,
// validates the new key, and rebuilds index.json, rolling everything back if a
// step fails.

import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { writeIndex } from "./build-index.ts";
import { type Classmap, KEY_DIR, keyDirs, leafValues, renderJson, ROOT, sha256, versionToKey, writeText } from "./lib.ts";
import { keyErrors } from "./validate-classmaps.ts";

export const MIN_HIT_RATE = 0.25;
const SHA256_RE = /^[0-9a-f]{64}$/;

type Report = Record<string, any>;
type Meta = {
	classmap_key?: string;
	required_paths?: Record<string, string>;
	spotify_version?: string;
	stale_leaves?: string[];
	status?: string;
	unverified_leaves?: string[];
};

export type PublishOptions = {
	root: string;
	spotifyVersion: string;
	staticReport: Report;
	cdpReport: Report;
	generated: string;
	minHitRate: number;
	inheritFrom?: string;
	classmapPath?: string;
	overlayPath?: string;
	derivedFrom?: string;
	requiredFrom?: string;
	stale?: string[];
	notes?: string[];
};

function reportRows(report: Report, name: string, expected: Map<string, string>, field: string): Map<string, Report> {
	const rows = new Map<string, Report>();
	for (const row of report.rows ?? []) if (row.path) rows.set(row.path, row);
	const missing = [...expected.keys()].filter((p) => !rows.has(p)).sort();
	const extra = [...rows.keys()].filter((p) => !expected.has(p)).sort();
	if (missing.length || extra.length) {
		throw new Error(
			`${name} paths do not match classmap; missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`,
		);
	}
	const mismatched = [...expected].filter(([p, v]) => rows.get(p)?.[field] !== v).map(([p]) => p);
	if (mismatched.length) throw new Error(`${name} does not match classmap at ${JSON.stringify(mismatched.sort())}`);
	return rows;
}

function checkSource(sourceKey: string, targetKey: string, meta: Meta, inherited: boolean): void {
	if (!KEY_DIR.test(sourceKey)) throw new Error("classmap keys must contain exactly seven digits");
	if (meta.status !== "verified") throw new Error(`source ${sourceKey} is not verified`);
	if (meta.classmap_key !== sourceKey) throw new Error(`source metadata key does not match ${sourceKey}`);
	if (versionToKey(String(meta.spotify_version ?? "")) !== sourceKey) {
		throw new Error(`source metadata version does not match ${sourceKey}`);
	}
	if (Number(targetKey) <= Number(sourceKey)) throw new Error(`${targetKey} is not newer than ${sourceKey}`);
	if (inherited && sourceKey.slice(0, 3) !== targetKey.slice(0, 3)) {
		throw new Error(`${targetKey} is not a newer patch in the ${sourceKey.slice(0, 3)} family`);
	}
}

/** Returns the paths missing from the target CSS, the live hits, and the hit rate. */
function checkReports(
	spotifyVersion: string,
	classmap: Classmap,
	digest: string,
	staticReport: Report,
	cdpReport: Report,
	minHitRate: number,
): { missing: Set<string>; live: Set<string>; hitRate: number } {
	if (staticReport.target?.classmap_sha256 !== digest) {
		throw new Error("static report classmap digest does not match the published map");
	}
	if (cdpReport.classmap?.sha256 !== digest) throw new Error("CDP report classmap digest does not match the published map");

	const userAgent: string = cdpReport.cdp?.browser?.["User-Agent"] ?? "";
	const version = /(?:^|\s)Spotify\/([0-9.]+)(?=\s|$)/.exec(userAgent);
	if (!version || version[1] !== spotifyVersion) {
		throw new Error(`CDP report does not match Spotify ${spotifyVersion}: ${JSON.stringify(userAgent)}`);
	}
	if (cdpReport.deep !== true) throw new Error("publication requires a deep CDP verification report");
	if (cdpReport.mode !== "both") throw new Error("publication requires CDP mode 'both'");
	const { attempted, succeeded, failed } = cdpReport.navigation ?? {};
	if (
		!Number.isInteger(attempted) ||
		!Number.isInteger(succeeded) ||
		!Array.isArray(failed) ||
		attempted < 0 ||
		succeeded < 0 ||
		succeeded > attempted ||
		failed.length !== attempted - succeeded
	) {
		throw new Error("CDP navigation ledger is inconsistent");
	}
	if (attempted < 8 || succeeded < 4) throw new Error("publication requires meaningful deep navigation coverage");
	if (!Number.isFinite(minHitRate) || minHitRate < MIN_HIT_RATE || minHitRate > 1) {
		throw new Error(`minimum hit rate must be finite and at least ${MIN_HIT_RATE}`);
	}

	if (staticReport.target?.spotify_version !== spotifyVersion) {
		throw new Error(`static report does not match Spotify ${spotifyVersion}`);
	}
	if (!SHA256_RE.test(String(staticReport.target?.css_sha256 ?? ""))) {
		throw new Error("static report has no valid target CSS digest");
	}

	const values = leafValues(classmap);
	const staticRows = reportRows(staticReport, "static report", values, "class");
	const cdpRows = reportRows(cdpReport, "CDP report", values, "hash");
	const live = new Set([...cdpRows].filter(([, row]) => row.hit === true).map(([p]) => p));
	const total = cdpRows.size;
	const hitRate = total ? live.size / total : 0;
	const summary = cdpReport.summary ?? {};
	if (typeof summary.hitRate !== "number" || !Number.isFinite(summary.hitRate)) {
		throw new Error("CDP summary hit rate must be finite");
	}
	if (summary.total !== total || summary.hits !== live.size || Math.abs(summary.hitRate - round4(hitRate)) > 0.00005) {
		throw new Error("CDP summary does not match rows");
	}
	if (hitRate < minHitRate) {
		throw new Error(`CDP hit rate ${hitRate.toFixed(4)} is below required ${minHitRate.toFixed(4)}`);
	}

	const missing = new Set([...staticRows].filter(([, row]) => !row.in_target_css).map(([p]) => p));
	const staticSummary: Record<string, number> = {};
	for (const row of staticRows.values()) {
		const verdict = String(row.verdict);
		staticSummary[verdict] = (staticSummary[verdict] ?? 0) + 1;
	}
	if (renderJson(staticReport.summary ?? null) !== renderJson(staticSummary)) {
		throw new Error("static summary does not match rows");
	}
	return { missing, live, hitRate: round4(hitRate) };
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function requiredStatuses(required: Record<string, string>, unverified: Set<string>, live: Set<string>) {
	const statuses: Record<string, string> = {};
	for (const leaf of Object.keys(required)) {
		statuses[leaf] = live.has(leaf) ? "verified_cdp" : unverified.has(leaf) ? "unverified" : "verified_static";
	}
	return statuses;
}

function verificationMarkdown(o: {
	targetKey: string;
	spotifyVersion: string;
	method: string;
	sourceKey: string | null;
	leaves: number;
	missing: Set<string>;
	live: Set<string>;
	navigation: { attempted: number; succeeded: number };
	hitRate: number;
	overlayEntries: number;
	notes: string[];
}): string {
	const liveOnly = [...o.missing].filter((p) => o.live.has(p)).length;
	const staticPresent = o.leaves - o.missing.size;
	const rows: [string, number][] = [
		["leaves", o.leaves],
		["static_present", staticPresent],
		["verified_cdp", o.live.size],
		["live_only", liveOnly],
		["unresolved_missing", o.missing.size - liveOnly],
		["cdp_hit_rate", o.hitRate],
		["overlay_entries", o.overlayEntries],
	];
	const inherited = o.method === "inherited";
	const step = inherited ? `inherit(${o.sourceKey} -> ${o.targetKey})` : `derive(${o.sourceKey ?? "stock CSS"} -> ${o.targetKey})`;
	const origin = inherited
		? `- Classmap inherited byte-for-byte from ${o.sourceKey}; no migration guesses were accepted.`
		: o.sourceKey
			? `- Classmap derived from ${o.sourceKey}.`
			: "- Classmap derived from the stock CSS.";
	return [
		`# Spotify ${o.spotifyVersion} (${o.targetKey})`,
		"",
		`Pipeline: ${step} + static target-CSS verification + CDP e2e (deep).`,
		"",
		"## Notes",
		"",
		origin,
		`- Static verification found ${staticPresent}/${o.leaves} paths in the target CSS.`,
		`- CSS-only misses observed live, which remain verified: ${liveOnly}.`,
		`- Deep CDP verification observed ${o.live.size}/${o.leaves} paths with ` +
			`${o.navigation.succeeded}/${o.navigation.attempted} successful navigation steps.`,
		"- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.",
		...o.notes.map((note) => `- ${note}`),
		"",
		"## Statistics at publication",
		"",
		"| Field | Value |",
		"| --- | --- |",
		...rows.map(([field, value]) => `| ${field} | ${value} |`),
		"",
	].join("\n");
}

function readMeta(root: string, key: string): Meta {
	return JSON.parse(readFileSync(path.join(root, key, "META.json"), "utf8"));
}

function newestKeyWithMeta(root: string, below: string): string | undefined {
	return keyDirs(root)
		.filter((key) => key < below && existsSync(path.join(root, key, "META.json")))
		.at(-1);
}

export function publishRelease(o: PublishOptions): string {
	if ((o.inheritFrom === undefined) === (o.classmapPath === undefined)) {
		throw new Error("pass exactly one of --inherit-from or --classmap");
	}
	if (o.inheritFrom !== undefined && (o.overlayPath || o.derivedFrom || o.stale?.length)) {
		throw new Error("an inherited key takes its map, overlay and stale paths from its source");
	}

	const targetKey = versionToKey(o.spotifyVersion);
	const targetDir = path.join(o.root, targetKey);
	if (existsSync(targetDir)) throw new Error(`${targetKey} already exists`);

	const sourceKey = o.inheritFrom ?? o.derivedFrom ?? null;
	const sourceMeta: Meta = sourceKey ? readMeta(o.root, sourceKey) : {};
	if (sourceKey) checkSource(sourceKey, targetKey, sourceMeta, o.inheritFrom !== undefined);

	let classmapBytes: Buffer;
	let overlay: Record<string, string> | undefined;
	if (o.inheritFrom !== undefined) {
		classmapBytes = readFileSync(path.join(o.root, o.inheritFrom, "classmap.json"));
		const sourceOverlay = path.join(o.root, o.inheritFrom, "css-map.json");
		if (existsSync(sourceOverlay)) overlay = JSON.parse(readFileSync(sourceOverlay, "utf8"));
	} else {
		classmapBytes = readFileSync(o.classmapPath as string);
		if (o.overlayPath) overlay = JSON.parse(readFileSync(o.overlayPath, "utf8"));
	}
	const classmap: Classmap = JSON.parse(classmapBytes.toString("utf8"));

	const { missing, live, hitRate } = checkReports(
		o.spotifyVersion,
		classmap,
		sha256(classmapBytes),
		o.staticReport,
		o.cdpReport,
		o.minHitRate,
	);

	let stale: string[];
	let doubted: Set<string>;
	let required: Record<string, string>;
	if (o.inheritFrom !== undefined) {
		stale = (sourceMeta.stale_leaves ?? []).filter((p) => !live.has(p)).sort();
		doubted = new Set([...missing, ...(sourceMeta.unverified_leaves ?? [])]);
		required = sourceMeta.required_paths ?? {};
	} else {
		stale = [...new Set(o.stale ?? [])].sort();
		doubted = new Set(missing);
		const requiredKey = o.requiredFrom ?? o.derivedFrom ?? newestKeyWithMeta(o.root, targetKey);
		required = requiredKey ? (readMeta(o.root, requiredKey).required_paths ?? {}) : {};
	}
	const unverified = new Set([...doubted].filter((p) => !live.has(p) && !stale.includes(p)));

	const method = o.inheritFrom !== undefined ? "inherited" : "derived";
	const meta = {
		schema_version: 2,
		classmap_key: targetKey,
		spotify_version: o.spotifyVersion,
		status: "verified",
		generated: o.generated,
		source: { method, key: sourceKey },
		required_paths: requiredStatuses(required, unverified, live),
		stale_leaves: stale,
		unverified_leaves: [...unverified].sort(),
	};
	const verification = verificationMarkdown({
		targetKey,
		spotifyVersion: o.spotifyVersion,
		method,
		sourceKey,
		leaves: leafValues(classmap).size,
		missing,
		live,
		navigation: o.cdpReport.navigation,
		hitRate,
		overlayEntries: overlay ? Object.keys(overlay).length : 0,
		notes: o.notes ?? [],
	});

	const staging = mkdtempSync(path.join(o.root, `.${targetKey}-`));
	try {
		if (o.inheritFrom !== undefined) writeFileSync(path.join(staging, "classmap.json"), classmapBytes);
		else writeText(path.join(staging, "classmap.json"), renderJson(classmap));
		if (overlay) writeText(path.join(staging, "css-map.json"), renderJson(overlay));
		writeText(path.join(staging, "META.json"), renderJson(meta));
		writeText(path.join(staging, "VERIFICATION.md"), verification);
		const errors = keyErrors(staging, targetKey, o.root);
		if (errors.length) throw new Error(`published key fails validation: ${errors.join("; ")}`);
		renameSync(staging, targetDir);
	} catch (e) {
		rmSync(staging, { recursive: true, force: true });
		throw e;
	}
	return targetDir;
}

export function publishAndIndex(o: PublishOptions): string {
	const indexPath = path.join(o.root, "index.json");
	const previous = existsSync(indexPath) ? readFileSync(indexPath) : undefined;
	const target = publishRelease(o);
	try {
		writeIndex(o.root);
	} catch (e) {
		rmSync(target, { recursive: true, force: true });
		if (previous === undefined) rmSync(indexPath, { force: true });
		else writeFileSync(indexPath, previous);
		throw e;
	}
	return target;
}

function main(): number {
	const { values } = parseArgs({
		options: {
			"inherit-from": { type: "string" },
			classmap: { type: "string" },
			"css-map": { type: "string" },
			"derived-from": { type: "string" },
			"required-paths-from": { type: "string" },
			stale: { type: "string", multiple: true, default: [] },
			note: { type: "string", multiple: true, default: [] },
			"spotify-version": { type: "string" },
			"static-report": { type: "string" },
			"cdp-report": { type: "string" },
			root: { type: "string", default: ROOT },
			generated: { type: "string", default: new Date().toISOString().slice(0, 10) },
			"min-hit-rate": { type: "string", default: String(MIN_HIT_RATE) },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(readFileSync(import.meta.filename, "utf8").split("\n\n")[0].replace(/^\/\/ ?/gm, ""));
		return 0;
	}
	try {
		for (const flag of ["spotify-version", "static-report", "cdp-report"] as const) {
			if (!values[flag]) throw new Error(`--${flag} is required`);
		}
		const target = publishAndIndex({
			root: values.root,
			spotifyVersion: values["spotify-version"] as string,
			staticReport: JSON.parse(readFileSync(values["static-report"] as string, "utf8")),
			cdpReport: JSON.parse(readFileSync(values["cdp-report"] as string, "utf8")),
			generated: values.generated,
			minHitRate: Number(values["min-hit-rate"]),
			inheritFrom: values["inherit-from"],
			classmapPath: values.classmap,
			overlayPath: values["css-map"],
			derivedFrom: values["derived-from"],
			requiredFrom: values["required-paths-from"],
			stale: values.stale,
			notes: values.note,
		});
		console.log(`published ${path.basename(target)}: ${target}`);
		return 0;
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		return 1;
	}
}

if (import.meta.main) process.exitCode = main();
