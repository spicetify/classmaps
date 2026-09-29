import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const KEY_DIR = /^\d{7}$/;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Classmap = { [key: string]: Classmap | string };

function sortKeys(value: Json): Json {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeys(value[key])]),
		);
	}
	return value;
}

/** Canonical form: 2-space indent, sorted keys, trailing newline. */
export function renderJson(value: unknown): string {
	return `${JSON.stringify(sortKeys(value as Json), null, 2)}\n`;
}

export function writeText(file: string, text: string): void {
	writeFileSync(file, text, "utf8");
}

export function sha256(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

export function versionToKey(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:\..*)?$/.exec(version);
	if (!match) throw new Error(`need major.minor.patch, got ${JSON.stringify(version)}`);
	const [major, minor, patch] = match.slice(1).map(Number);
	return `${major}${String(minor).padStart(2, "0")}${String(patch).padStart(4, "0")}`;
}

export function leafValues(node: Classmap | string, parts: string[] = []): Map<string, string> {
	const values = new Map<string, string>();
	if (typeof node === "string") {
		values.set(parts.join("."), node);
		return values;
	}
	if (!node || typeof node !== "object" || Array.isArray(node)) {
		throw new Error(`invalid classmap leaf at ${parts.join(".")}`);
	}
	for (const [key, value] of Object.entries(node)) {
		for (const [leaf, cls] of leafValues(value, [...parts, key])) values.set(leaf, cls);
	}
	return values;
}

export function keyDirs(root: string): string[] {
	return readdirSync(root)
		.filter((name) => KEY_DIR.test(name) && statSync(path.join(root, name)).isDirectory())
		.sort();
}
