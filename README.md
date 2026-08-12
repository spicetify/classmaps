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
