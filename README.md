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

Inspect the reports and complete [visual verification](#visual-verification).
If no replacements are justified, promote the inherited map from this
repository:

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

## Visual verification

Use `scripts/theme-report.ts` in the modules checkout to compare complete
Spotify page states with the shared approved references. This review is required
before publication. Read [AGENTS.md](AGENTS.md) for the completion criteria.
Screenshots remain separate from classmap indexes and runtime support checks.

### Capture the classmaps suite

With dependencies installed and Spotify running with CDP enabled, run the
named suite from the modules repository:

```sh
node scripts/theme-report.ts --port 9229 --suite classmaps \
  --baseline-dir ../classmaps/visual/baseline --baseline-ref origin/main \
  --out /tmp/classmaps-candidate-run-1
```

The script opens the generated HTML report in your default browser when it
finishes. Pass `--no-open` to leave it on disk without opening a browser.

Set `--baseline-ref` to the PR target branch. For a baseline directory inside a
Git checkout, the tool reads that directory from the selected Git ref, ignoring
replacement images proposed on the working branch. You can instead extract the
PR target branch's references to a directory outside Git and pass that path to
`--baseline-dir`. An absent reference is reported as missing coverage.

The suite captures the full viewport at 1440 × 1000 CSS pixels, device scale
factor 1, and English UI. It uses Text's **Spicetify** scheme and an unthemed
reference. Select **Albums** in **Your Library** before starting; the suite
refuses to capture if that filter is not active or playlist rows remain.
Each theme has these seven states:

| State | Filename |
| --- | --- |
| Home | `home.png` |
| Home with the profile dropdown open | `home-profile.png` |
| Settings at the top | `settings-top.png` |
| Settings scrolled to Your Library | `settings-library.png` |
| Search landing page | `search.png` |
| Liked Songs | `liked-songs.png` |
| Spicetify Settings | `spicetify-settings.png` |

Keep real album artwork and music content. Mask credentials, personal account
identifiers, and playlist titles and artwork still recommended on Home while
preserving their layout. Inspect every PNG
for privacy and confirm that it shows the requested state. Record the client,
theme, and module versions in the run report. After capture, verify that cleanup
restored the original theme, scheme, route, and client configuration.

Apply the candidate through the v3 CLI, restart Spotify, and run the complete
suite twice with separate output directories. Inspect all current images,
`shots.json`, the HTML reports, and available pixel diffs. Separate changing
content from layout changes. Inspect small localized differences even when
their share of the full screenshot is small. Resized images, missing references,
failed navigation, missing controls, and captures that never settle require
review and remain incomplete coverage. A successful exit code is not approval.

Exercise the affected controls through the UI, including dropdowns, Settings
controls, library controls, and topbar and player actions. Check Text's
navigation and player colors, panel borders, spacing, and player gutters.
Check unthemed styling and the previous supported line too. Distinguish live
verification from archived CSS inspection, and report any untested platform.

### Propose shared references

The approved set lives at `visual/baseline/<theme>/<state>.png`, with `text` and
`unthemed` theme directories. Filenames are independent of Spotify versions.
Keep candidate captures, diffs, HTML, and run reports outside Git. Baseline PNGs
are the only committed visual artifacts.

After reviewing a complete run, prepare replacement candidates outside Git:

```sh
node scripts/theme-report.ts --suite classmaps \
  --baseline-dir ../classmaps/visual/baseline --baseline-ref origin/main \
  --out /tmp/classmaps-candidate-run-1 --no-capture \
  --prepare-baseline /tmp/classmaps-proposed-baseline
```

Preparation requires all 14 stable states and successful cleanup. The
destination must be new and outside Git. This command prepares candidates; it
does not approve them. The classmaps suite rejects `--accept`.

Propose reviewed PNGs at `visual/baseline/<theme>/<state>.png` in the classmaps
PR. Explain intentional UI changes and incomplete coverage in its description.
Continue comparing against the PR target branch's approved references until
the user approves and merges the PR. This also applies to the initial set,
which has no approved reference yet. Git history preserves previous baselines.
Do not include screenshots in `index.json`, link them from `META.json`, or use
them as runtime support evidence.

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
