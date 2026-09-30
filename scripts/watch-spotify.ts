// Watches Spotify's Linux apt channels for builds that have no classmap key,
// statically verifies the newest key's map against each one, and opens an
// issue saying whether the build looks unchanged (publish an inherited key)
// or rehashed (migrate).
//
//   node scripts/watch-spotify.ts --cli ../cli --dry-run
//   node scripts/watch-spotify.ts --cli ../cli          # opens issues with gh
//   node scripts/watch-spotify.ts --cli ../cli --dry-run --only 1020096   # re-assess a published build
//
// Only Linux builds are public without a signed-in client; macOS and Windows
// releases still need a person to notice them.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { isHashLike, keyDirs, readUtf8, ROOT, sha256, versionToKey } from "./lib.ts";

const REPOSITORY = "https://repository.spotify.com";
const CHANNELS = ["stable", "testing"];

export type Build = { version: string; key: string; channel: string; url: string; sha256: string };
type StaticRow = { path: string; class: string; in_target_css: boolean; missing_classes?: string[] };

/** The spotify-client entries of an apt Packages index. */
export function parsePackages(text: string, channel: string): Build[] {
	return text
		.split(/\n\n+/)
		.map((stanza) => Object.fromEntries(stanza.split("\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()])))
		.filter((fields) => fields.Package === "spotify-client" && fields.Version && fields.Filename)
		.map((fields) => {
			// "1:1.2.96.518.g366879e1" is reported by the client as 1.2.96.518.
			const version = fields.Version.replace(/^\d+:/, "").split(".").slice(0, 4).join(".");
			return { version, key: versionToKey(version), channel, url: `${REPOSITORY}/${fields.Filename}`, sha256: fields.SHA256 };
		});
}

/** Builds whose key is not published, one per key. */
export function unpublished(builds: Build[], published: string[]): Build[] {
	const byKey = new Map<string, Build>();
	for (const build of builds) if (!published.includes(build.key) && !byKey.has(build.key)) byKey.set(build.key, build);
	return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The key to compare against: the newest older key of the same minor, else the newest older key. */
export function baseKey(published: string[], key: string): string | undefined {
	const older = published.filter((k) => k < key).sort();
	return older.filter((k) => k.slice(0, 3) === key.slice(0, 3)).at(-1) ?? older.at(-1);
}

/**
 * Whether the base map still fits: a hashed class missing from the target
 * CSS means Spotify rehashed that component, so the map needs a migration.
 * Leaves the base key already records as stale or unverified don't count.
 */
export function assess(rows: StaticRow[], known: Set<string> = new Set()): { unchanged: boolean; rehashed: { path: string; classes: string[] }[] } {
	const rehashed = rows
		.filter((row) => !known.has(row.path))
		.map((row) => ({ path: row.path, classes: (row.missing_classes ?? []).filter(isHashLike) }))
		.filter((row) => row.classes.length);
	return { unchanged: rehashed.length === 0, rehashed };
}

export function issueTitle(build: Build): string {
	return `Spotify ${build.version.split(".").slice(0, 3).join(".")} needs a classmap (${build.key})`;
}

export function issueBody(build: Build, base: string, rows: StaticRow[], known: Set<string> = new Set()): string {
	const { unchanged, rehashed } = assess(rows, known);
	const present = rows.filter((row) => row.in_target_css).length;
	const lines = [
		`Spotify \`${build.version}\` is on the Linux \`${build.channel}\` channel, and no classmap key \`${build.key}\` is published.`,
		"",
		`Static verification of the \`${base}\` map against its stock CSS found ${present}/${rows.length} leaves.`,
		"",
	];
	if (unchanged) {
		lines.push(
			`No hashed class is missing, so \`${base}\`'s map most likely still fits. Publish an inherited key after a deep CDP run on this build:`,
			"",
			"```sh",
			`pnpm publish-key --inherit-from ${base} --spotify-version ${build.version} \\`,
			`  --static-report static.json --cdp-report cdp.json`,
			"```",
		);
	} else {
		lines.push(
			`${rehashed.length} leaves lost a hashed class, so Spotify rehashed them and the map needs a migration:`,
			"",
			...rehashed.map((row) => `- \`${row.path}\`: ${row.classes.map((c) => `\`${c}\``).join(", ")}`),
			"",
			"Follow “Changed classes” in the README.",
		);
	}
	lines.push("", `Package: ${build.url} (SHA-256 \`${build.sha256}\`)`);
	return `${lines.join("\n")}\n`;
}

/** The members of an ar archive (a .deb), by name. */
export function arMembers(archive: Buffer): Map<string, Buffer> {
	if (archive.toString("latin1", 0, 8) !== "!<arch>\n") throw new Error("not an ar archive");
	const members = new Map<string, Buffer>();
	let offset = 8;
	while (offset + 60 <= archive.length) {
		const name = archive.toString("latin1", offset, offset + 16).trim().replace(/\/$/, "");
		const size = Number(archive.toString("latin1", offset + 48, offset + 58).trim());
		members.set(name, archive.subarray(offset + 60, offset + 60 + size));
		offset += 60 + size + (size % 2);
	}
	return members;
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.text();
}

async function staticRows(build: Build, base: string, cli: string, work: string): Promise<StaticRow[]> {
	const bytes = Buffer.from(await (await fetch(build.url)).arrayBuffer());
	if (sha256(bytes) !== build.sha256) throw new Error(`${build.url}: SHA-256 does not match the Packages index`);
	const data = [...arMembers(bytes)].find(([name]) => name.startsWith("data.tar"));
	if (!data) throw new Error(`${build.url}: no data archive in the package`);
	writeFileSync(path.join(work, data[0]), data[1]);
	execFileSync("tar", ["-xf", data[0], "./usr/share/spotify/Apps/xpui.spa"], { cwd: work });
	const report = path.join(work, "static.json");
	execFileSync(
		process.execPath,
		[
			path.join(cli, "scripts/classmap-capture.ts"),
			"verify",
			"--classmap",
			path.join(ROOT, base, "classmap.json"),
			"--css-map",
			path.join(cli, "css-map.json"),
			"--target-spa",
			path.join(work, "usr/share/spotify/Apps/xpui.spa"),
			"--target-version",
			build.version,
			"--out",
			report,
		],
		{ stdio: "ignore" },
	);
	return JSON.parse(readUtf8(report)).rows;
}

function issueExists(title: string): boolean {
	const found = execFileSync("gh", ["issue", "list", "--state", "all", "--search", `in:title "${title}"`, "--json", "title"], {
		encoding: "utf8",
	});
	return (JSON.parse(found) as { title: string }[]).some((issue) => issue.title === title);
}

async function main(): Promise<number> {
	const { values } = parseArgs({
		options: { cli: { type: "string" }, "dry-run": { type: "boolean", default: false }, only: { type: "string" } },
	});
	if (!values.cli) throw new Error("--cli <spicetify/cli checkout> is required");
	const published = keyDirs(ROOT).filter((key) => key !== values.only);
	const builds: Build[] = [];
	for (const channel of CHANNELS) {
		// eslint-disable-next-line no-await-in-loop
		builds.push(...parsePackages(await fetchText(`${REPOSITORY}/dists/${channel}/non-free/binary-amd64/Packages`), channel));
	}
	const pending = unpublished(builds, published).filter((build) => !values.only || build.key === values.only);
	if (!pending.length) console.log(`every Linux build has a key (${builds.map((b) => b.key).join(", ")})`);
	for (const build of pending) {
		const title = issueTitle(build);
		if (!values["dry-run"] && issueExists(title)) {
			console.log(`${title}: issue already exists`);
			continue;
		}
		const base = baseKey(published, build.key);
		if (!base) throw new Error(`no published key older than ${build.key}`);
		const work = mkdtempSync(path.join(tmpdir(), "spotify-watch-"));
		try {
			// eslint-disable-next-line no-await-in-loop
			const meta = JSON.parse(readUtf8(path.join(ROOT, base, "META.json")));
			const known = new Set<string>([...meta.stale_leaves, ...meta.unverified_leaves]);
			const body = issueBody(build, base, await staticRows(build, base, values.cli, work), known);
			if (values["dry-run"]) console.log(`# ${title}\n\n${body}`);
			else execFileSync("gh", ["issue", "create", "--title", title, "--body", body], { stdio: "inherit" });
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}
	return 0;
}

if (import.meta.main) {
	main().then(
		(code) => (process.exitCode = code),
		(e: Error) => {
			console.error(`error: ${e.message}`);
			process.exitCode = 1;
		},
	);
}

