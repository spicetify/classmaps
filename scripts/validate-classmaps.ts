// Checks every key directory against the published layout:
//
//   <key>/classmap.json     nested groups of class-name leaves (required)
//   <key>/css-map.json      flat hash -> semantic overlay (optional)
//   <key>/META.json         schema_version 2 metadata (optional for legacy keys)
//   <key>/VERIFICATION.md   verification history (required beside META.json)
//
// JSON files must be in canonical form (renderJson). META claims are checked
// against the files: leaf paths exist, the leaf lists are disjoint and agree
// with required_paths, and an inherited map is byte-identical to its source.
//
//   node scripts/validate-classmaps.ts

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	type Classmap,
	compareCodePoints,
	isFile,
	KEY_DIR,
	keyDirs,
	leafValues,
	readUtf8,
	renderJson,
	ROOT,
	sha256,
	versionToKey,
} from "./lib.ts";

const META_FIELDS = [
	"classmap_key",
	"generated",
	"required_paths",
	"schema_version",
	"source",
	"spotify_version",
	"stale_leaves",
	"status",
	"unverified_leaves",
	"verified_classmap_sha256",
];
const STATUSES = ["unverified", "verified"];
const SOURCE_METHODS = ["derived", "inherited"];
const PATH_STATUSES = ["unverified", "verified", "verified_cdp", "verified_static", "verified_targeted"];
const KNOWN_FILES = new Set(["classmap.json", "css-map.json", "META.json", "VERIFICATION.md"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SPICETIFY_NAME = /^(main|x)-[A-Za-z0-9]+-/;
const SHA256 = /^[0-9a-f]{64}$/;
// The characters Python's str.split() treats as whitespace.
const WHITESPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

type Meta = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classmapErrors(node: unknown, parts: string[] = []): string[] {
	const where = parts.join(".") || "<root>";
	if (typeof node === "string") {
		const normal = node.split(WHITESPACE).filter(Boolean).join(" ");
		return node && node === normal ? [] : [`${where}: classes must be single-space separated with no padding`];
	}
	if (!isObject(node)) return [`${where}: must be a group or a class string`];
	if (Object.keys(node).length === 0) return [`${where}: empty group`];
	const errors: string[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (!key || key.includes(".")) {
			errors.push(`${where}: group key ${JSON.stringify(key)} must be non-empty and contain no dots`);
			continue;
		}
		errors.push(...classmapErrors(value, [...parts, key]));
	}
	return errors;
}

function loadCanonical(file: string, errors: string[]): unknown {
	let raw: string;
	let value: unknown;
	try {
		raw = readUtf8(file);
		value = JSON.parse(raw);
	} catch (e) {
		errors.push(`${path.basename(file)}: ${(e as Error).message}`);
		return undefined;
	}
	if (raw !== renderJson(value)) {
		errors.push(`${path.basename(file)}: not canonical (2-space indent, sorted keys, trailing newline)`);
	}
	return value;
}

function stringList(meta: Meta, field: string, leaves: Map<string, string>, errors: string[]): Set<string> {
	const items = meta[field];
	if (!Array.isArray(items) || !items.every((i) => typeof i === "string")) {
		errors.push(`META.json: ${field} must be a list of paths`);
		return new Set();
	}
	const sorted = [...new Set(items)].sort(compareCodePoints);
	if (sorted.length !== items.length || sorted.some((item, i) => item !== items[i])) {
		errors.push(`META.json: ${field} must be sorted and unique`);
	}
	for (const leaf of items) {
		if (!leaves.has(leaf)) errors.push(`META.json: ${field} names ${leaf}, which is not a classmap leaf`);
	}
	return new Set(items);
}

function isValidDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function metaErrors(meta: unknown, key: string, leaves: Map<string, string>, root: string, classmap: Buffer): string[] {
	if (!isObject(meta)) return ["META.json: must be an object"];
	const errors: string[] = [];
	const fields = Object.keys(meta).sort();
	const missing = META_FIELDS.filter((f) => !fields.includes(f));
	const extra = fields.filter((f) => !META_FIELDS.includes(f));
	if (missing.length || extra.length) {
		errors.push(
			`META.json: fields must be exactly ${JSON.stringify(META_FIELDS)}; ` +
				`missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`,
		);
	}
	if (meta.schema_version !== 2) errors.push("META.json: schema_version must be 2");
	if (meta.classmap_key !== key) errors.push(`META.json: classmap_key must be ${key}`);
	try {
		if (versionToKey(String(meta.spotify_version ?? "")) !== key) {
			errors.push(`META.json: spotify_version does not belong to ${key}`);
		}
	} catch (e) {
		errors.push(`META.json: spotify_version: ${(e as Error).message}`);
	}
	if (!STATUSES.includes(meta.status as string)) {
		errors.push(`META.json: status must be one of ${JSON.stringify(STATUSES)}`);
	}
	if (!isValidDate(String(meta.generated))) errors.push("META.json: generated must be a YYYY-MM-DD date");

	const source = meta.source;
	if (!isObject(source) || Object.keys(source).sort().join() !== "key,method") {
		errors.push("META.json: source must be {method, key}");
	} else if (!SOURCE_METHODS.includes(source.method as string)) {
		errors.push(`META.json: source.method must be one of ${JSON.stringify(SOURCE_METHODS)}`);
	} else if (
		source.key !== null &&
		!(typeof source.key === "string" && KEY_DIR.test(source.key) && source.key < key)
	) {
		errors.push("META.json: source.key must be null or an older seven-digit key");
	} else if (source.method === "inherited") {
		const parent = source.key === null ? "" : path.join(root, source.key as string, "classmap.json");
		if (!parent || !isFile(parent)) {
			errors.push("META.json: an inherited map needs an existing source.key");
		} else if ((source.key as string).slice(0, 3) !== key.slice(0, 3)) {
			errors.push("META.json: an inherited map must come from the same major.minor family");
		} else if (!readFileSync(parent).equals(classmap)) {
			errors.push(`classmap.json: inherited from ${source.key} but its bytes differ`);
		}
	}

	const digest = meta.verified_classmap_sha256;
	if (digest !== null && !(typeof digest === "string" && SHA256.test(digest))) {
		errors.push("META.json: verified_classmap_sha256 must be null or a SHA-256 digest");
	} else if (digest !== null && digest !== sha256(classmap)) {
		errors.push("classmap.json: its bytes differ from the map that was verified; republish the key with --replace");
	}

	const stale = stringList(meta, "stale_leaves", leaves, errors);
	const unverified = stringList(meta, "unverified_leaves", leaves, errors);
	for (const leaf of [...stale].filter((p) => unverified.has(p)).sort()) {
		errors.push(`META.json: ${leaf} is both stale and unverified`);
	}

	const required = meta.required_paths;
	if (!isObject(required)) {
		errors.push("META.json: required_paths must be an object");
		return errors;
	}
	for (const [leaf, status] of Object.entries(required)) {
		if (!leaves.has(leaf)) errors.push(`META.json: required path ${leaf} is not a classmap leaf`);
		if (!PATH_STATUSES.includes(status as string)) {
			errors.push(`META.json: required path ${leaf} has unknown status ${JSON.stringify(status)}`);
		}
		if (stale.has(leaf)) errors.push(`META.json: required path ${leaf} is stale`);
		if ((status === "unverified") !== unverified.has(leaf)) {
			errors.push(`META.json: ${leaf} is ${status} but unverified_leaves disagrees`);
		}
	}
	return errors;
}

export function keyErrors(keyDir: string, key = path.basename(keyDir), root = ROOT): string[] {
	const errors: string[] = [];
	for (const extra of readdirSync(keyDir).filter((name) => !KNOWN_FILES.has(name)).sort()) {
		errors.push(`${extra}: not part of the published layout`);
	}

	const classmapPath = path.join(keyDir, "classmap.json");
	if (!isFile(classmapPath)) return [...errors, "classmap.json: missing"];
	const classmap = loadCanonical(classmapPath, errors);
	if (classmap === undefined) return errors;
	const treeErrors = classmapErrors(classmap);
	errors.push(...treeErrors.map((e) => `classmap.json: ${e}`));
	if (treeErrors.length) return errors;
	const leaves = leafValues(classmap as Classmap);

	let semantic = new Set<string>();
	const overlayPath = path.join(keyDir, "css-map.json");
	if (isFile(overlayPath)) {
		const overlay = loadCanonical(overlayPath, errors);
		if (overlay !== undefined) {
			const valid =
				isObject(overlay) && Object.entries(overlay).every(([k, v]) => k && typeof v === "string" && v);
			if (!valid) errors.push("css-map.json: must map class names to semantic names");
			else semantic = new Set(Object.values(overlay) as string[]);
		}
	}
	for (const [leaf, value] of leaves) {
		for (const token of value.split(WHITESPACE)) {
			if (semantic.has(token) || SPICETIFY_NAME.test(token)) {
				errors.push(`classmap.json: ${leaf} stores the Spicetify name ${token}, not the stock class`);
			}
		}
	}

	const metaPath = path.join(keyDir, "META.json");
	if (isFile(metaPath)) {
		const meta = loadCanonical(metaPath, errors);
		if (meta !== undefined) errors.push(...metaErrors(meta, key, leaves, root, readFileSync(classmapPath)));
		if (!isFile(path.join(keyDir, "VERIFICATION.md"))) {
			errors.push("VERIFICATION.md: required beside META.json");
		}
	}
	return errors;
}

export function validateClassmaps(root = ROOT): number {
	const keys = keyDirs(root);
	let failed = false;
	for (const key of keys) {
		for (const error of keyErrors(path.join(root, key), key, root)) {
			console.error(`${key}/${error}`);
			failed = true;
		}
	}
	if (failed) return 1;
	console.log(`${keys.length} classmap keys ok`);
	return 0;
}

if (import.meta.main) process.exitCode = validateClassmaps();
