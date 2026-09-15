# Classmap verification

Before generating, inheriting, or changing a classmap, read the capture and
[visual verification procedure](README.md#visual-verification). Selector hits
prove that a class exists, not that it still provides the expected styling or
behavior. Keep semantic roles working across supported Spotify versions.

## Required review before publication

Complete the README's named `classmaps` suite twice against the candidate after
applying it through the v3 CLI and restarting Spotify. Compare with the PR target
branch's approved baseline, even when the working branch proposes replacements.
Inspect every requested page state and image, including small localized diffs,
resized images, missing references, and unstable captures.

Exercise affected controls through the UI. Verify navigation and player scheme
colors, panel borders, toolbar spacing, dropdowns, Settings controls, and
unthemed styling. For toolbar classes, check module and native buttons together,
including focus and opening and closing a harmless panel. Check the previous
supported line too; distinguish live evidence from archived CSS checks. Keep
unrelated version maps unchanged. Confirm capture cleanup restored the original
client configuration.

Missing themes, absent controls, failed navigation, occlusion, missing baselines,
and captures that never settle mean incomplete coverage. Report those gaps and
fix regressions before proposing replacement references. Select Albums in Your
Library before capturing and verify that playlist rows are absent. Preserve real
album artwork and music content; mask credentials, personal account identifiers,
and playlist titles and artwork still recommended on Home without changing layout.

Commit only reviewed baseline candidate PNGs under
`visual/baseline/<theme>/<state>.png`. Keep captures, diffs, and reports outside
Git. Explain intentional changes in the classmaps PR. Candidates become approved
references only when the user approves and merges that PR; never automatically
accept or merge them. Keep screenshots independent of `META.json`, publication
indexes, and runtime support verification. Regenerate the index after data edits.

CI checks data contracts and integrity; it does not run Spotify. Promotion
success does not replace this visual and functional review.
