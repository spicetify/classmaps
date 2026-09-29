import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const KEY_DIR = /^\d{7}$/;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Classmap = { [key: string]: Classmap | string };

/** Orders strings by code point, as Python's sorted() does. */
export function compareCodePoints(a: string, b: string): number {
	const x = Array.from(a);
	const y = Array.from(b);
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const diff = (x[i].codePointAt(0) as number) - (y[i].codePointAt(0) as number);
		if (diff) return diff;
	}
	return x.length - y.length;
}

function render(value: Json, pad: string): string {
	const inner = `${pad}  `;
	if (Array.isArray(value)) {
		if (!value.length) return "[]";
		return `[\n${value.map((item) => inner + render(item, inner)).join(",\n")}\n${pad}]`;
	}
	if (value && typeof value === "object") {
		const keys = Object.keys(value).sort(compareCodePoints);
		if (!keys.length) return "{}";
		return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${render(value[key], inner)}`).join(",\n")}\n${pad}}`;
	}
	return JSON.stringify(value);
}

/** Canonical form: 2-space indent, keys sorted by code point, trailing newline. */
export function renderJson(value: unknown): string {
	return `${render(value as Json, "")}\n`;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Reads a UTF-8 file, rejecting invalid bytes instead of replacing them. */
export function readUtf8(file: string): string {
	try {
		return UTF8.decode(readFileSync(file));
	} catch (e) {
		if (e instanceof TypeError) throw new Error("not valid UTF-8");
		throw e;
	}
}

/** Whether a class looks like a Spotify CSS-module hash; mirrors the CLI's classmap-capture.ts. */
export function isHashLike(token: string): boolean {
	const length = Array.from(token).length;
	if (length < 4 || length > 25) return false;
	if (token.includes("-") && token.toLowerCase() === token && token.toUpperCase() !== token) return false;
	if (token.startsWith("spotify") || token.startsWith("encore")) return false;
	const hasUpper = /\p{Lu}/u.test(token);
	const hasLower = /\p{Ll}/u.test(token);
	if (hasUpper && hasLower) return true;
	return token.includes("_") && (hasUpper || /\p{Nd}/u.test(token));
}

export function isFile(file: string): boolean {
	return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
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
