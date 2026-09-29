// Publishes a classmap key from the CLI's static and deep CDP verification reports.
//
// An inherited key copies an older key's map and overlay byte-for-byte:
//
//   pnpm publish-key --inherit-from 1020094 --spotify-version 1.2.96.518 \
//     --static-report static.json --cdp-report cdp.json
//
// A derived key publishes a candidate map produced by `classmap-capture.ts migrate`:
//
//   pnpm publish-key --classmap candidate.json --overlay overlay.json \
//     --derived-from 1030001 --migrate-report migrate.json \
//     --spotify-version 1.3.2.100 --static-report static.json --cdp-report cdp.json
//
// Flags:
//   --inherit-from KEY          copy KEY's map and overlay (an unchanged patch release)
//   --classmap FILE             candidate map for a derived key, in canonical form
//   --overlay FILE              css-map overlay for a derived key
//   --derived-from KEY          key the candidate was migrated from; its stale leaves carry over
//   --migrate-report FILE       migrate report; the leaves it kept as stale stay stale
//   --stale PATH                mark a leaf stale (repeatable)
//   --required-paths-from KEY   track KEY's required_paths (default: --derived-from, else the newest verified key)
//   --drop-required PATH        stop tracking a required path the new map no longer has (repeatable)
//   --note TEXT                 add a line to VERIFICATION.md (repeatable)
//   --replace                   re-verify an existing key in place
//   --spotify-version VERSION   exact Spotify build the reports were taken on
//   --static-report FILE        output of `classmap-capture.ts verify`
//   --cdp-report FILE           output of `classmap-cdp-verify.mjs --mode both --deep`
//   --generated DATE            first publication date (default: today, local time)
//   --min-hit-rate RATE         minimum CDP hit rate (default: 0.25)
//
// The command writes classmap.json, css-map.json, META.json and VERIFICATION.md,
// validates the key and every key inheriting from it, and rebuilds index.json,
// rolling everything back if a step fails.

import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { writeIndex } from "./build-index.ts";
import {
	type Classmap,
	isFile,
	isHashLike,
	KEY_DIR,
	keyDirs,
	leafValues,
	readUtf8,
	renderJson,
	ROOT,
	sha256,
	versionToKey,
	writeText,
} from "./lib.ts";
import { keyErrors } from "./validate-classmaps.ts";

export const MIN_HIT_RATE = 0.25;
const SHA256_RE = /^[0-9a-f]{64}$/;

type Report = Record<string, any>;
type Meta = {
	classmap_key?: string;
	generated?: string;
	required_paths?: Record<string, string>;
	source?: { method?: string; key?: string | null };
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
	migrateReport?: Report;
	requiredFrom?: string;
	dropRequired?: string[];
	stale?: string[];
	notes?: string[];
	replace?: boolean;
};

/** Matches the CLI's `Number(rate.toFixed(4))`. */
function round4(n: number): number {
	return Number(n.toFixed(4));
}

function localDate(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

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

function readMeta(root: string, key: string): Meta {
	const file = path.join(root, key, "META.json");
	if (!isFile(file)) throw new Error(`${key} has no META.json; only a verified key can be a source`);
	try {
		return JSON.parse(readUtf8(file));
	} catch (e) {
		throw new Error(`${key}/META.json: ${(e as Error).message}`);
	}
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

type Evidence = { missing: Set<string>; live: Set<string>; hitRate: number; deadHashes: Map<string, string[]> };

/**
 * Checks both reports against the map and build. A path missing from the
 * stock target CSS counts as observed only through its stock class: a hit on
 * its css-map name can come from another class renamed to the same name.
 */
function checkReports(
	spotifyVersion: string,
	classmap: Classmap,
	digest: string,
	staticReport: Report,
	cdpReport: Report,
	minHitRate: number,
): Evidence {
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
	const hits = [...cdpRows.values()].filter((row) => row.hit === true).length;
	const total = cdpRows.size;
	const hitRate = total ? hits / total : 0;
	const summary = cdpReport.summary ?? {};
	if (typeof summary.hitRate !== "number" || !Number.isFinite(summary.hitRate)) {
		throw new Error("CDP summary hit rate must be finite");
	}
	if (summary.total !== total || summary.hits !== hits || Math.abs(summary.hitRate - round4(hitRate)) > 0.00005) {
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
	const deadHashes = new Map<string, string[]>();
	for (const [leaf, row] of staticRows) {
		const dead = (Array.isArray(row.missing_classes) ? row.missing_classes : []).filter(isHashLike);
		if (dead.length) deadHashes.set(leaf, dead);
	}
	const observed = (leaf: string, row: Report) =>
		missing.has(leaf) && typeof row.hashHit === "boolean" ? row.hashHit : row.hit === true;
	const live = new Set([...cdpRows].filter(([leaf, row]) => observed(leaf, row)).map(([leaf]) => leaf));
	return { missing, live, hitRate: round4(hitRate), deadHashes };
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
	published: string;
	method: string;
	sourceKey: string | null;
	leaves: number;
	evidence: Evidence;
	cdpReport: Report;
	staticReport: Report;
	classmapSha: string;
	overlaySha: string | null;
	overlayEntries: number;
	notes: string[];
}): string {
	const { missing, live, hitRate } = o.evidence;
	const liveOnly = [...missing].filter((p) => live.has(p)).length;
	const staticPresent = o.leaves - missing.size;
	const navigation = o.cdpReport.navigation;
	const rows: [string, number][] = [
		["leaves", o.leaves],
		["static_present", staticPresent],
		["verified_cdp", live.size],
		["live_only", liveOnly],
		["unresolved_missing", missing.size - liveOnly],
		["cdp_hit_rate", hitRate],
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
		`Pipeline: ${step} + static target-CSS verification + CDP e2e (deep). Published ${o.published}.`,
		"",
		"## Notes",
		"",
		origin,
		`- Static verification found ${staticPresent}/${o.leaves} paths in the target CSS.`,
		`- CSS-only misses observed live by their stock class, which remain verified: ${liveOnly}.`,
		`- Deep CDP verification observed ${live.size}/${o.leaves} paths with ` +
			`${navigation.succeeded}/${navigation.attempted} successful navigation steps.`,
		"- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.",
		...o.notes.map((note) => `- ${note}`),
		"",
		"## Statistics at publication",
		"",
		"| Field | Value |",
		"| --- | --- |",
		...rows.map(([field, value]) => `| ${field} | ${value} |`),
		"",
		"## Evidence",
		"",
		`- Classmap SHA-256: \`${o.classmapSha}\``,
		`- Overlay SHA-256: ${o.overlaySha ? `\`${o.overlaySha}\`` : "none"}`,
		`- Target CSS SHA-256: \`${o.staticReport.target.css_sha256}\``,
		`- CDP report generated: ${o.cdpReport.generatedAt ?? "not recorded"}`,
		"",
	].join("\n");
}

function newestVerifiedKey(root: string, below: string): string | undefined {
	return keyDirs(root)
		.filter((key) => key < below && isFile(path.join(root, key, "META.json")) && readMeta(root, key).status === "verified")
		.at(-1);
}

function inheritors(root: string, key: string): string[] {
	return keyDirs(root).filter((other) => {
		if (!isFile(path.join(root, other, "META.json"))) return false;
		const source = readMeta(root, other).source;
		return source?.method === "inherited" && source.key === key;
	});
}

/** Publishes the key; with `index`, also rebuilds index.json inside the same rollback. */
export function publishRelease(o: PublishOptions, index = false): string {
	if ((o.inheritFrom === undefined) === (o.classmapPath === undefined)) {
		throw new Error("pass exactly one of --inherit-from or --classmap");
	}
	const inherited = o.inheritFrom !== undefined;
	if (inherited && (o.overlayPath || o.derivedFrom || o.migrateReport || o.stale?.length)) {
		throw new Error("an inherited key takes its map, overlay and stale paths from its source");
	}
	if (inherited && (o.requiredFrom || o.dropRequired?.length)) {
		throw new Error("an inherited key tracks its source's required paths");
	}

	const targetKey = versionToKey(o.spotifyVersion);
	const targetDir = path.join(o.root, targetKey);
	const exists = isFile(path.join(targetDir, "classmap.json"));
	if (exists && !o.replace) throw new Error(`${targetKey} already exists; pass --replace to re-verify it`);
	if (!exists && o.replace) throw new Error(`${targetKey} does not exist, so there is nothing to replace`);
	const generated = exists ? (readMeta(o.root, targetKey).generated ?? o.generated) : o.generated;

	const sourceKey = o.inheritFrom ?? o.derivedFrom ?? null;
	const sourceMeta: Meta = sourceKey ? readMeta(o.root, sourceKey) : {};
	if (sourceKey) checkSource(sourceKey, targetKey, sourceMeta, inherited);

	let classmapBytes: Buffer;
	let overlayText: string | null = null;
	if (inherited) {
		classmapBytes = readFileSync(path.join(o.root, o.inheritFrom as string, "classmap.json"));
		const sourceOverlay = path.join(o.root, o.inheritFrom as string, "css-map.json");
		if (isFile(sourceOverlay)) overlayText = readUtf8(sourceOverlay);
	} else {
		classmapBytes = readFileSync(o.classmapPath as string);
		if (o.overlayPath) overlayText = readUtf8(o.overlayPath);
	}
	const overlay: Record<string, string> | undefined = overlayText === null ? undefined : JSON.parse(overlayText);
	if (overlayText !== null && overlayText !== renderJson(overlay)) {
		throw new Error("the overlay is not in canonical form; run pnpm fix on it before the CDP run");
	}
	const classmap: Classmap = JSON.parse(classmapBytes.toString("utf8"));
	if (classmapBytes.toString("utf8") !== renderJson(classmap)) {
		throw new Error(
			"the candidate map is not in canonical form (sorted keys, two-space indent); " +
				"`classmap-capture.ts migrate` writes it that way, so verify the file it wrote",
		);
	}
	const values = leafValues(classmap);

	const evidence = checkReports(o.spotifyVersion, classmap, sha256(classmapBytes), o.staticReport, o.cdpReport, o.minHitRate);
	const { missing, live, deadHashes } = evidence;
	const overlaySha = overlayText === null ? null : sha256(overlayText);
	const liveOverlaySha: unknown = o.cdpReport.cssMap?.overlaySha256;

	const notes = [...(o.notes ?? [])];
	let stale: Set<string>;
	let doubted: Set<string>;
	let required: Record<string, string>;
	if (inherited) {
		stale = new Set((sourceMeta.stale_leaves ?? []).filter((p) => !live.has(p)));
		doubted = new Set([...missing, ...(sourceMeta.unverified_leaves ?? [])]);
		required = sourceMeta.required_paths ?? {};
	} else {
		const sourceValues = sourceKey
			? leafValues(JSON.parse(readUtf8(path.join(o.root, sourceKey, "classmap.json"))))
			: new Map<string, string>();
		const unchanged = (leaf: string) => sourceValues.get(leaf) === values.get(leaf);
		const carried = (sourceMeta.stale_leaves ?? []).filter((p) => values.has(p) && unchanged(p) && !live.has(p));
		const requiredKey = o.requiredFrom ?? o.derivedFrom ?? newestVerifiedKey(o.root, targetKey);
		required = { ...(requiredKey ? (readMeta(o.root, requiredKey).required_paths ?? {}) : {}) };
		for (const leaf of o.dropRequired ?? []) {
			if (!Object.hasOwn(required, leaf)) throw new Error(`--drop-required ${leaf} is not a required path of ${requiredKey}`);
			delete required[leaf];
			notes.push(`No longer tracks the required path ${leaf}.`);
		}
		// A leaf migrate kept is dead only when one of its hashed classes is gone
		// from the stock CSS and was not seen live; a required one stays resolvable.
		const kept = (o.migrateReport?.unmatched ?? [])
			.filter((u: Report) => u.stale === true && values.get(u.path) === u.kept && deadHashes.has(u.path) && !live.has(u.path))
			.map((u: Report) => u.path as string);
		for (const leaf of kept.filter((p: string) => Object.hasOwn(required, p))) {
			notes.push(`Required path ${leaf} kept ${(deadHashes.get(leaf) ?? []).join(", ")}, which the stock CSS lacks; left unverified.`);
		}
		stale = new Set([...carried, ...kept.filter((p: string) => !Object.hasOwn(required, p)), ...(o.stale ?? [])]);
		doubted = new Set(missing);
	}
	const observedStale = [...stale].filter((p) => live.has(p)).sort();
	if (observedStale.length) notes.push(`Marked stale although observed live: ${observedStale.join(", ")}.`);
	if (exists) notes.push(`Replaces an earlier verification of this key; its history is in git.`);
	if (liveOverlaySha !== undefined && liveOverlaySha !== overlaySha) {
		throw new Error("the CDP report was run with a different overlay than the one being published");
	}
	if (overlaySha && liveOverlaySha === undefined) {
		notes.push("The CDP run did not apply this key's overlay, so its names were not checked live.");
	}
	const unverified = new Set([...doubted].filter((p) => !live.has(p) && !stale.has(p)));

	const method = inherited ? "inherited" : "derived";
	const meta = {
		schema_version: 2,
		classmap_key: targetKey,
		spotify_version: o.spotifyVersion,
		status: "verified",
		generated,
		source: { method, key: sourceKey },
		required_paths: requiredStatuses(required, unverified, live),
		stale_leaves: [...stale].sort(),
		unverified_leaves: [...unverified].sort(),
		verified_classmap_sha256: sha256(classmapBytes),
	};
	const verification = verificationMarkdown({
		targetKey,
		spotifyVersion: o.spotifyVersion,
		published: o.generated,
		method,
		sourceKey,
		leaves: values.size,
		evidence,
		cdpReport: o.cdpReport,
		staticReport: o.staticReport,
		classmapSha: sha256(classmapBytes),
		overlaySha,
		overlayEntries: overlay ? Object.keys(overlay).length : 0,
		notes,
	});

	const indexPath = path.join(o.root, "index.json");
	const previousIndex = index && isFile(indexPath) ? readFileSync(indexPath) : undefined;
	const staging = mkdtempSync(path.join(o.root, `.${targetKey}-`));
	let previous: string | undefined;
	try {
		writeFileSync(path.join(staging, "classmap.json"), classmapBytes);
		if (overlayText) writeText(path.join(staging, "css-map.json"), overlayText);
		writeText(path.join(staging, "META.json"), renderJson(meta));
		writeText(path.join(staging, "VERIFICATION.md"), verification);
		const errors = keyErrors(staging, targetKey, o.root);
		if (errors.length) throw new Error(`published key fails validation: ${errors.join("; ")}`);
		if (exists) {
			previous = mkdtempSync(path.join(o.root, `.${targetKey}-previous-`));
			renameSync(targetDir, path.join(previous, targetKey));
		}
		renameSync(staging, targetDir);
		const broken = inheritors(o.root, targetKey).flatMap((key) =>
			keyErrors(path.join(o.root, key), key, o.root).map((error) => `${key}/${error}`),
		);
		if (broken.length) throw new Error(`keys inheriting from ${targetKey} would break: ${broken.join("; ")}`);
		if (index) writeIndex(o.root);
	} catch (e) {
		if (index) {
			if (previousIndex === undefined) rmSync(indexPath, { force: true });
			else writeFileSync(indexPath, previousIndex);
		}
		if (previous) {
			rmSync(targetDir, { recursive: true, force: true });
			renameSync(path.join(previous, targetKey), targetDir);
		} else if (!exists) {
			rmSync(targetDir, { recursive: true, force: true });
		}
		rmSync(staging, { recursive: true, force: true });
		if (previous) rmSync(previous, { recursive: true, force: true });
		throw e;
	}
	if (previous) rmSync(previous, { recursive: true, force: true });
	return targetDir;
}

export function publishAndIndex(o: PublishOptions): string {
	return publishRelease(o, true);
}

function main(): number {
	const { values } = parseArgs({
		options: {
			"inherit-from": { type: "string" },
			classmap: { type: "string" },
			overlay: { type: "string" },
			"derived-from": { type: "string" },
			"migrate-report": { type: "string" },
			"required-paths-from": { type: "string" },
			"drop-required": { type: "string", multiple: true, default: [] },
			stale: { type: "string", multiple: true, default: [] },
			note: { type: "string", multiple: true, default: [] },
			replace: { type: "boolean", default: false },
			"spotify-version": { type: "string" },
			"static-report": { type: "string" },
			"cdp-report": { type: "string" },
			root: { type: "string", default: ROOT },
			generated: { type: "string", default: localDate() },
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
		const options: PublishOptions = {
			root: values.root,
			spotifyVersion: values["spotify-version"] as string,
			staticReport: JSON.parse(readUtf8(values["static-report"] as string)),
			cdpReport: JSON.parse(readUtf8(values["cdp-report"] as string)),
			generated: values.generated,
			minHitRate: Number(values["min-hit-rate"]),
			inheritFrom: values["inherit-from"],
			classmapPath: values.classmap,
			overlayPath: values.overlay,
			derivedFrom: values["derived-from"],
			migrateReport: values["migrate-report"] ? JSON.parse(readUtf8(values["migrate-report"])) : undefined,
			requiredFrom: values["required-paths-from"],
			dropRequired: values["drop-required"],
			stale: values.stale,
			notes: values.note,
			replace: values.replace,
		};
		const target = publishAndIndex(options);
		console.log(`published ${path.basename(target)}: ${target}`);
		return 0;
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		return 1;
	}
}

if (import.meta.main) process.exitCode = main();
