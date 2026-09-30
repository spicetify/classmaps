import assert from "node:assert/strict";
import { test } from "node:test";

import { arMembers, assess, baseKey, parsePackages, unpublished } from "./watch-spotify.ts";

// Abridged from https://repository.spotify.com/dists/testing/non-free/binary-amd64/Packages.
const PACKAGES = `Package: spotify-client
Version: 1:1.2.96.518.g366879e1
Filename: pool/non-free/s/spotify-client/spotify-client_1.2.96.518.g366879e1_amd64.deb
SHA256: 1a86581f53c2b0e2c406150665ea05e245b9e6b286390ea61d5d193ba617eb2f

Package: spotify-client-0.9.17
Version: 0.9.17.8.gd06432d.31-1
Filename: pool/non-free/s/spotify/spotify-client-0.9.17_0.9.17.8.gd06432d.31-1_amd64.deb
SHA256: 0cec1535d1c656452c6358dc244e013c761c9a329b4536ce853b0a007ce73cc6
`;

test("reads the spotify-client build from an apt index", () => {
	assert.deepEqual(parsePackages(PACKAGES, "testing"), [
		{
			version: "1.2.96.518",
			key: "1020096",
			channel: "testing",
			url: "https://repository.spotify.com/pool/non-free/s/spotify-client/spotify-client_1.2.96.518.g366879e1_amd64.deb",
			sha256: "1a86581f53c2b0e2c406150665ea05e245b9e6b286390ea61d5d193ba617eb2f",
		},
	]);
});

test("reports each unpublished key once", () => {
	const [build] = parsePackages(PACKAGES, "testing");
	assert.deepEqual(unpublished([build, { ...build, channel: "stable" }], ["1020095"]), [build]);
	assert.deepEqual(unpublished([build], ["1020096"]), []);
});

test("compares against the newest older key of the same minor", () => {
	assert.equal(baseKey(["1020095", "1020099", "1030000", "1030001"], "1030002"), "1030001");
	assert.equal(baseKey(["1020095", "1020099"], "1030000"), "1020099");
	assert.equal(baseKey(["1020099", "1030001"], "1020097"), undefined);
});

test("a missing hashed class means a migration, unless the base already knew", () => {
	const rows = [
		{ path: "main.topbar.wrapper", class: "topbarHashAA", in_target_css: true, missing_classes: [] },
		{ path: "settings.text_input", class: "e-10860-form-input", in_target_css: false, missing_classes: ["e-10860-form-input"] },
		{ path: "main.topbar.retired", class: "retiredHashBB", in_target_css: false, missing_classes: ["retiredHashBB"] },
	];
	assert.deepEqual(assess(rows), { unchanged: false, rehashed: [{ path: "main.topbar.retired", classes: ["retiredHashBB"] }] });
	assert.deepEqual(assess(rows, new Set(["main.topbar.retired"])), { unchanged: true, rehashed: [] });
});

test("reads GNU ar members with padding and slash-terminated names", () => {
	const header = (name: string, size: number) =>
		Buffer.from(`${name}/`.padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(size).padEnd(10) + "`\n");
	const archive = Buffer.concat([Buffer.from("!<arch>\n"), header("debian-binary", 4), Buffer.from("2.0\n"), header("data.tar.gz", 3), Buffer.from("abc\n")]);
	const members = arMembers(archive);
	assert.deepEqual([...members.keys()], ["debian-binary", "data.tar.gz"]);
	assert.equal(members.get("data.tar.gz")?.toString(), "abc");
});
