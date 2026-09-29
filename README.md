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
keys. `python3 scripts/validate_classmaps.py` enforces the layout, and CI runs
it on every pull request.

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

## Unchanged patch release

From the CLI repository, generate reports bound to the exact Spotify version,
classmap digest, target CSS digest, and a deep live CDP run:

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

Inspect the reports. If no replacements are justified, promote the inherited
map from this repository:

```sh
python3 scripts/promote_inherited.py \
  --from-key 1020094 \
  --spotify-version 1.2.96.518 \
  --static-report /tmp/1020096-static.json \
  --cdp-report /tmp/1020096-cdp.json
```

The promoter refuses mismatched versions, maps, leaf values, shallow CDP runs,
inconsistent summaries, low hit rates, and existing targets. It writes
`META.json` and `VERIFICATION.md`, validates the new key, copies through a
temporary directory, and rolls back both the release and `index.json` if
publication preparation fails. Newly absent paths are marked `unverified`;
only paths already known to be stale remain blocked by the CLI.

If migration proposes changed hashes, do not use inheritance. Run the full
capture pipeline from the CLI repository and verify each changed leaf before
publishing it.


## Exposure patches

`expose.json` is the set of regex rewrites the CLI applies to the extracted
`xpui-modules.js` so `Spicetify.Platform`, `Spicetify.Snackbar`, and the
other globals exist. It is
one file for every build: the CLI fetches it through `index.json` beside the
classmaps, verifies its digest, and falls back to the copy embedded in the
binary when it cannot. A Spotify update that reshapes the minified code is
answered here, with a data commit, instead of a CLI release.

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
python3 scripts/validate_expose.py
python3 scripts/build_index.py
```

Both run in CI. `onMiss: quiet` is for a patch that is expected to miss on
some supported builds; a `warn` miss is reported by `apply` as
`api exposure patches that did not match`. Keep the CLI repository's own
`expose.json` in step with this one when cutting a release: it is only the
offline baseline, but a stale one degrades a first run without network.
