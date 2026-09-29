import assert from "node:assert/strict";
import { test } from "node:test";

import { exposeErrors, renderExpose } from "./validate-expose.ts";

const patch = { name: "Tippy.js", pattern: "([\\w$]+)\\.setDefaultProps=", replace: "Spicetify.Tippy=${1};${0}", once: false, onMiss: "warn", hits: { "1.2.96": 2 } };
const errors = (changes: Record<string, unknown>) => exposeErrors(renderExpose({ version: 1, patches: [{ ...patch, ...changes }] }));

test("accepts a well-formed patch", () => assert.deepEqual(errors({}), []));

test("rejects a null onMiss, which the CLI cannot deserialize", () => {
	assert.ok(errors({ onMiss: null }).includes("Tippy.js: `onMiss` must be `warn` or `quiet`"));
});

test("counts groups in Rust-style named groups and leading flags", () => {
	assert.deepEqual(errors({ pattern: "(?s)(?P<store>a.b)", replace: "${1}" }), []);
	assert.ok(errors({ pattern: "(?P<store>a)", replace: "${2}" }).some((e) => e.includes("has 1 group(s)")));
});

test("requires hit counts per major.minor.patch build", () => {
	assert.ok(errors({ hits: {} }).some((e) => e.includes("`hits`")));
	assert.ok(errors({ hits: { "1.2": 1 } }).some((e) => e.includes("`hits`")));
	assert.ok(errors({ hits: { "1.2.96": -1 } }).some((e) => e.includes("`hits`")));
});
