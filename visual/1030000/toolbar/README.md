# Spotify 1.3.0 toolbar reference

These cropped screenshots cover the right toolbar on macOS, with Text 0.1.5
(Spotify scheme) and the unthemed client. `baseline/` contains the reviewed,
fixed rendering. `evidence.json` records capture settings and comparisons.

## Spacing regression

The former `main.topbar.right.button_t.wrapper` value supplied Encore's
`--condensed-all` class. The first three module controls shrank to 16 × 16 CSS
pixels while native controls remained 32 × 32. Mapping the wrapper to
`nR3ekhH3c1IU7dX9smcR`, rewritten as `main-topBar-buddyFeed`, restores matching
32 × 32 controls and 8-pixel gaps.

Before, reproduced from the former staged class value:

![Text toolbar with three cramped module controls](before/text--home.png)

After, captured from the applied candidate:

![Text toolbar with evenly spaced module and native controls](baseline/text--home.png)

The `before/` images reproduce the old mapped classes on the live DOM; they
are not historical captures from a previous Spotify build. The probe restores
the original classes after each capture. The fixed images come from the local
classmap applied through the Rust CLI followed by a Spotify restart.

The comparison reports a resized toolbar, rather than stretching the smaller
image to generate a misleading pixel diff. Repeat captures of the fixed
client must match the reference; inspect `evidence.json` for measured results.

## Reproduce

From the modules checkout, use the environment recorded in `evidence.json` and
the [visual verification procedure](../../../README.md#visual-verification).
Copy both reference PNGs into the output directory's `baseline/`, then run:

```sh
node scripts/theme-report.ts --themes text --routes / --port 9229 \
  --selector .main-actionButtons --out /tmp/classmap-toolbar
```

Keep Bookmark, Full App Display, and Popup Lyrics enabled, with the native
notifications and activity controls visible. Use the recorded viewport and
zoom; changed display scaling requires review, not automatic acceptance.

## Coverage limits

The Bookmark control opened and closed its sidebar through CDP mouse input.
The previous 1.2.97 map remains unchanged and its archived CSS specifies the
same native hitbox; that version was not rerun live. Windows, Linux, keyboard
focus, and other surfaces were not verified by this capture.

Flow 0.1.2 (Pink) was also tried, but its right-side player occluded the toolbar.
That capture is not an accepted baseline or a compatibility pass. It remains
a separate follow-up; screenshots containing its artwork stay outside git.
This scoped correction does not certify all of Spotify 1.3.0.
