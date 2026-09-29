// Checks classmap roles after the CSS-map rewrite used during staging.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ROOT } from "./lib.ts";

const load = (file: string) => JSON.parse(readFileSync(path.join(ROOT, "1030000", file), "utf8"));

function assertUniqueHooks(expected: Record<string, string>): void {
	const overlay: Record<string, string> = load("css-map.json");
	for (const [source, target] of Object.entries(expected)) {
		assert.equal(overlay[source], target);
		assert.equal(Object.values(overlay).filter((v) => v === target).length, 1, target);
	}
}

test("Spotify 1.3.0 topbar buttons keep the native hitbox after staging", () => {
	const overlay: Record<string, string> = load("css-map.json");
	const wrapper: string = load("classmap.json").main.topbar.right.button_t.wrapper;
	const staged = wrapper.split(" ").map((token) => overlay[token] ?? token);
	assert.ok(
		staged.includes("main-topBar-buddyFeed"),
		"The toolbar wrapper must retain the native button hitbox, not just a generic Encore class that exists in the DOM.",
	);
	assert.ok(!staged.some((token) => token.includes("--condensed-")), "Mapped classes must not strip the icon-only button padding.");
});

test("Spotify 1.3.0 restores the seek bar and time label hooks", () => {
	// Roles checked against the stock CSS and live playback controls.
	assertUniqueHooks({
		Ox6fJ7l6WeB1wD0MqHXb: "playback-bar",
		LppHcR524PsiPr4sz5IV: "playback-bar__progress-time-elapsed",
		TcCS0BhwDXw_s2HufffR: "main-playbackBarRemainingTime-container",
	});
});

test("the settings toggle hides the native input behind its indicator", () => {
	assert.equal(load("css-map.json").utdiMuyxdKvPowN1CIBs, "x-toggle-input");
});

test("Spotify 1.3.0 restores the three layout container hooks", () => {
	// Verified against stock grid-area declarations and live child controls.
	assertUniqueHooks({
		bQetA_KiP9n0DQVcGa7m: "Root__globalNav",
		PIP22o58Crv8RXY4wB2o: "Root__nav-bar",
		itzKVxWhS4n59fp_KIVc: "Root__now-playing-bar",
	});
});
