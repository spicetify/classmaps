# Spicetify classmaps

Classmaps are published per Spotify `major.minor.patch` key because the CLI
must select an exact, auditable ABI for each client build. Patch releases that
keep the same classes do not need a speculative migration: verify the previous
map against the new client, then promote it as an inherited release.

## Key layout

Each key directory holds the files below. `index.json` lists them with their
SHA-256 digests, and the CLI downloads only what the index names.

| File | Required | Contents |
| --- | --- | --- |
| `classmap.json` | Yes | Nested groups whose leaves are Spotify's stock class strings. |
| `css-map.json` | No | Flat overlay from stock class to Spicetify name for this build. |
| `META.json` | For verified keys | The fields the CLI and tooling read, described below. |
| `VERIFICATION.md` | With `META.json` | Pipeline, notes, statistics, and verification runs. |

Leaves store the class exactly as it appears in the stock client, never the
Spicetify name the css-map rewrites it to. The CLI rewrites staged modules in
the same css-map pass as the client, so both forms reach the same DOM class,
but only the stock form can be checked against a stock archive. Keys
1020038, 1020040, and 1020045 predate the pipeline and have no `META.json`.

Every JSON file uses two-space indentation and ends with a newline.
`classmap.json`, `css-map.json`, `META.json`, and `index.json` also sort their
keys. `pnpm check` enforces the layout, and CI runs it on every pull request.

## META.json

`META.json` contains exactly these fields. Put anything else, such as notes,
counts, or run details, in `VERIFICATION.md`.

| Field | Meaning |
| --- | --- |
| `schema_version` | Always `2`. |
| `classmap_key` | The directory name. |
| `spotify_version` | The full Spotify build the key was verified on. |
| `status` | `verified` or `unverified`. The CLI only trusts `verified`. |
| `generated` | ISO date of first publication. |
| `source` | `{"method": "inherited" \| "derived", "key": "<older key>" \| null}`. |
| `required_paths` | Status of each path the ecosystem depends on. |
| `stale_leaves` | Paths known to be wrong. The CLI refuses to resolve them. |
| `unverified_leaves` | Paths not observed on this build. They still resolve. |

An `inherited` key's `classmap.json` must be byte-identical to its source
key's map. If you change a map, you must also change every key that inherits
from it, or record that key as `derived`.

Each `required_paths` value is one of the following statuses:

- `verified_cdp`: observed in the live DOM by the deep CDP verifier.
- `verified_targeted`: observed by a targeted live DOM or CSSOM probe.
- `verified_static`: present in the stock target CSS but not observed live.
- `verified`: verified before the method was recorded (1020092 and 1020094).
- `unverified`: not observed. The path must also be in `unverified_leaves`.

A required path can't be stale.

Digests recorded in `VERIFICATION.md` identify the exact file that was tested.
On September 30, 2026, every map was renamed to `classmap.json` and
reformatted, and the 1020099 and 1030000 leaves stored as Spicetify names were
rewritten to their stock classes. Those older digests therefore no longer
match the published bytes, but the classes the CLI stages are unchanged.

## Publishing a key

You never write `META.json`, `VERIFICATION.md`, or `index.json` by hand.
`pnpm publish-key` generates them from two CLI verification reports,
formats the map and overlay, validates the new key, and rebuilds the index.
It refuses mismatched versions, maps, leaf values, shallow CDP runs,
inconsistent summaries, low hit rates, and existing targets. If any step
fails, it rolls back both the key and `index.json`.

To publish a key, follow these steps:

1. From the CLI repository, verify the candidate map against the stock client
   of the new build. For an unchanged patch release, the candidate is the
   previous key's `classmap.json`. For a derived key, it's the output of
   `classmap_capture.py migrate` or your edited copy.

   ```sh
   python3 scripts/classmap_capture.py verify \
     --classmap ../classmaps/1020094/classmap.json \
     --css-map css-map.json \
     --target-spa "/path/to/stock/xpui.spa" \
     --target-version 1.2.96.518 \
     --out /tmp/1020096-static.json

   node scripts/classmap_cdp_verify.mjs \
     --port 9229 --mode both --deep \
     --classmap ../classmaps/1020094/classmap.json \
     --css-map css-map.json \
     --out /tmp/1020096-cdp.json
   ```

2. Inspect the reports. If no leaf needs a new class, publish an inherited key
   from this repository:

   ```sh
   pnpm publish-key --inherit-from 1020094 \
     --spotify-version 1.2.96.518 \
     --static-report /tmp/1020096-static.json \
     --cdp-report /tmp/1020096-cdp.json
   ```

   Otherwise, publish the candidate as a derived key. Pass each decision the
   reports can't make as a flag: `--stale PATH` for a leaf whose class is known
   to be wrong, and `--note TEXT` for anything a reviewer needs to know.

   ```sh
   pnpm publish-key --classmap /tmp/1030002.json \
     --css-map /tmp/1030002-css-map.json --derived-from 1030001 \
     --spotify-version 1.3.2.100 \
     --static-report /tmp/1030002-static.json \
     --cdp-report /tmp/1030002-cdp.json \
     --stale main.topbar.right.upgrade_button.wrapper \
     --note "The upgrade button has no rendered instance on a premium account."
   ```

3. Run `pnpm check` and open a pull request.

The publisher marks a path `unverified` when it's missing from the target CSS
and wasn't observed live. An inherited key also keeps its source's
`unverified` paths until the deep CDP run observes them, and its stale paths
until a live hit clears them. A derived key tracks the `required_paths` of
`--derived-from`, or of the newest key when you don't pass one.

## Checks

`pnpm check` runs everything CI runs: the type check, the index check, the key
validator, the exposure patch validator, and the unit tests. The scripts are
TypeScript that Node 24 or later runs directly, and `pnpm install` only adds
the type checker. Run `pnpm fix` to rewrite every JSON file in canonical form
and rebuild `index.json`.

## Exposure patches

`expose.json` is the set of regex rewrites the CLI applies to the extracted
`xpui-modules.js` so `Spicetify.Platform`, `Spicetify.Snackbar`, and the
other globals exist. It is one file for every build: the CLI fetches it
through `index.json` beside the classmaps, verifies its digest, and falls back
to the copy embedded in the binary when it cannot. A Spotify update that
reshapes the minified code is answered here, with a data commit, instead of a
CLI release.

To change a pattern, measure it against real bundles first. From the CLI
repository, with the unpatched `xpui-modules.js` of each build you care about
(extract it from the client's `v8_context_snapshot.bin`, or from a deb out of
Spotify's pool without installing it):

```sh
SPICETIFY_EXPOSE_PATCHES=../classmaps/expose.json \
SPICETIFY_EXPOSE_BUNDLES=/path/1.2.84.js:/path/1.2.96.js \
  cargo test -p spicetify expose_hits_on_real_bundles -- --ignored --nocapture
```

Each patch has these fields:

| Field | Meaning |
| --- | --- |
| `name` | Unique label that `apply` reports. |
| `pattern` | Regex matched against `xpui-modules.js`. |
| `replace` | Capture-group template: `${0}` is the whole match, `${N}` is group N, and `$$` is a literal dollar. |
| `once` | Stop after the first match. |
| `onMiss` | `warn` or `quiet`, described below. |
| `hits` | Measured match count per `major.minor.patch` build. |
| `note` | Optional explanation that doesn't fit the other fields. |

Record the hit counts in the patch's `hits`, then:

```sh
pnpm fix
```

CI runs the same checks. `onMiss: quiet` is for a patch that is expected to
miss on some supported builds; a `warn` miss is reported by `apply` as
`api exposure patches that did not match`. Keep the CLI repository's own
`expose.json` in step with this one when cutting a release: it is only the
offline baseline, but a stale one degrades a first run without network.
