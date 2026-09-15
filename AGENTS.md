# Classmap verification

Before generating, inheriting, or changing a classmap, read the capture and
[visual verification procedure](README.md#visual-verification). Selector hits
prove that a class exists, not that it still provides the expected styling or
behavior. Keep semantic roles working across supported Spotify versions.

## Required review before publication

Treat the screenshots as a review gate alongside the static and deep CDP
reports, including when promoting an unchanged map.

1. Capture the known-good client before applying the candidate. Reuse
   `modules/scripts/theme-report.ts`; start with one or two representative
   themes and the unthemed client. Keep viewport, zoom, theme versions,
   schemes, modules, and control states consistent.
2. Apply the candidate through the v3 CLI and restart Spotify. Capture the
   same surfaces against the saved baseline. Read `shots.json` and inspect
   the actual PNGs and diffs, including resized, new, and unstable frames.
3. Exercise each changed control through the UI. For toolbar classes, check
   module and native buttons together, including focus and opening/closing a
   harmless panel. A screenshot alone does not prove a button works.
4. For a new Spotify line, cover navigation, library, settings controls,
   menus/modals, topbar, and playbar. For a scoped correction, cover affected
   surfaces. Check the previous supported line too; distinguish live evidence
   from archived CSS checks. Keep unrelated version maps unchanged.
5. Commit privacy-reviewed reference PNGs, changed before/after images, and
   available delta images under `visual/<key>/<surface>/`. Record the actual
   environment, classmap digest, inspected outcomes, and coverage gaps there;
   link that evidence from `META.json`. Regenerate the index last.

Missing themes, absent controls, occlusion, absent baselines, and captures that
never settle mean incomplete coverage, not a pass. Fix regressions before
accepting replacement baselines. Accept intentional design changes only after
reviewing their diffs; preserve the previous image in the change for review.
Keep private artwork, avatars, library contents, and account data out of git.

CI checks data contracts and integrity; it does not run Spotify. The promotion
script's success does not replace this agent-driven visual and functional gate.
