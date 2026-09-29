// Checks expose.json before it is published: the schema the CLI reads, every
// pattern compiles, and every `${N}` in a template names a group the pattern
// has. V8's regex engine is close to the Rust regex crate for the syntax these
// patterns use; the CLI is the final authority and skips a pattern it cannot
// compile, so a construct only one side accepts still surfaces at apply as a
// `did not match` warning rather than a crash.
//
//   node scripts/validate-expose.ts

import { readFileSync } from "node:fs";
import path from "node:path";

import { ROOT } from "./lib.ts";

const TEMPLATE_REF = /\$\{(\d+)\}|\$(\d+)/g;
const BUILD = /^\d+\.\d+\.\d+$/;

export function renderExpose(doc: unknown): string {
	return `${JSON.stringify(doc, null, 2)}\n`;
}

function groupCount(pattern: string): number {
	return (new RegExp(`${pattern}|`).exec("") as RegExpExecArray).length - 1;
}

export function exposeErrors(raw: string): string[] {
	let doc: Record<string, unknown>;
	try {
		doc = JSON.parse(raw);
	} catch (e) {
		return [`expose.json: ${(e as Error).message}`];
	}
	const errors: string[] = [];
	if (raw !== renderExpose(doc)) errors.push("expose.json: not canonical (2-space indent, trailing newline)");

	const patches = Array.isArray(doc.patches) ? doc.patches : [];
	if (!patches.length) errors.push("`patches` must be a non-empty list");

	const names = new Set<string>();
	patches.forEach((patch: Record<string, unknown>, i: number) => {
		const where = `patches[${i}]`;
		if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
			errors.push(`${where}: not an object`);
			return;
		}
		let name = patch.name;
		if (typeof name !== "string" || !name) {
			errors.push(`${where}: missing \`name\``);
			name = where;
		}
		if (names.has(name as string)) errors.push(`${name}: duplicate name`);
		names.add(name as string);

		const { pattern, replace } = patch;
		if (typeof pattern !== "string" || !pattern) {
			errors.push(`${name}: missing \`pattern\``);
			return;
		}
		if (typeof replace !== "string") {
			errors.push(`${name}: missing \`replace\``);
			return;
		}
		let groups: number;
		try {
			groups = groupCount(pattern);
		} catch (e) {
			errors.push(`${name}: pattern does not compile: ${(e as Error).message}`);
			return;
		}
		for (const m of replace.matchAll(TEMPLATE_REF)) {
			const n = Number(m[1] ?? m[2]);
			if (n > groups) {
				errors.push(`${name}: template references \${${n}} but the pattern has ${groups} group(s)`);
			}
		}
		if ("once" in patch && typeof patch.once !== "boolean") errors.push(`${name}: \`once\` must be a boolean`);
		if (!["warn", "quiet"].includes((patch.onMiss ?? "warn") as string)) {
			errors.push(`${name}: \`onMiss\` must be \`warn\` or \`quiet\``);
		}
		const hits = patch.hits;
		const validHits =
			typeof hits === "object" &&
			hits !== null &&
			!Array.isArray(hits) &&
			Object.keys(hits).length > 0 &&
			Object.entries(hits).every(([build, n]) => BUILD.test(build) && Number.isInteger(n) && (n as number) >= 0);
		if (!validHits) errors.push(`${name}: \`hits\` must map major.minor.patch builds to match counts`);
		if ("note" in patch && (typeof patch.note !== "string" || !patch.note)) {
			errors.push(`${name}: \`note\` must be a non-empty string when present`);
		}
	});
	return errors;
}

export function validateExpose(root = ROOT): number {
	const raw = readFileSync(path.join(root, "expose.json"), "utf8");
	const errors = exposeErrors(raw);
	for (const e of errors) console.error(e);
	if (errors.length) return 1;
	console.log(`expose.json: ${JSON.parse(raw).patches.length} patches ok`);
	return 0;
}

if (import.meta.main) process.exitCode = validateExpose();
