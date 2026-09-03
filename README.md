# Spicetify classmaps

Classmaps are published per Spotify `major.minor.patch` key because the CLI
must select an exact, auditable ABI for each client build. Patch releases that
keep the same classes do not need a speculative migration: verify the previous
map against the new client, then promote it as an inherited release.

## Unchanged patch release

From the CLI repository, generate reports bound to the exact Spotify version,
classmap digest, target CSS digest, and a deep live CDP run:

```sh
python3 scripts/classmap_capture.py verify \
  --classmap ../classmaps/1020094/classmap-19f856aefd5.json \
  --css-map css-map.json \
  --target-spa "/path/to/stock/xpui.spa" \
  --target-version 1.2.96.518 \
  --out /tmp/1020096-static.json

node scripts/classmap_cdp_verify.mjs \
  --port 9229 --mode both --deep \
  --classmap ../classmaps/1020094/classmap-19f856aefd5.json \
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
inconsistent summaries, low hit rates, and existing targets. It copies through
a temporary directory and rolls back both the release and `index.json` if
publication preparation fails. Newly absent paths are marked `unverified`;
only paths already known to be stale remain blocked by the CLI.

If migration proposes changed hashes, do not use inheritance. Run the full
capture pipeline from the CLI repository and verify each changed leaf before
publishing it.


## Exposure patches

`expose.json` is the set of regex rewrites the CLI applies to the extracted
`xpui-modules.js` so `Spicetify.Platform`, `Spicetify.Snackbar` and friends
exist (`module/expose.rs` in the CLI repository documents the fields). It is
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

Record the hit counts in the patch's `note`, then:

```sh
python3 scripts/validate_expose.py
python3 scripts/build_index.py
```

Both run in CI. `onMiss: quiet` is for a patch that is expected to miss on
some supported builds; a `warn` miss is reported by `apply` as
`api exposure patches that did not match`. Keep the CLI repository's own
`expose.json` in step with this one when cutting a release: it is only the
offline baseline, but a stale one degrades a first run without network.
