# Spotify 1.2.84.476 (1020084)

Pipeline: css-map inversion over stock target CSS + migrate(1020040) cross-check + static target-CSS verification + CDP e2e (deep, live Linux client).

## Notes

- 1.2.84 is the current Linux build; its hashes match no published key (verified: 0/36 raw-hash hits for both 1020045 and 1020092 against this build), so this key was derived rather than inherited.
- Primary derivation inverts the CLI's embedded css-map over the classes present in the stock 1.2.84 bundle: 27/36 paths resolve to a unique hash whose semantic matches the 1020097 ABI meaning; a migrate(1020040) run agreed on 14 and was overruled on 13 where the inversion disagreed.
- The three main.playbar.buttons.button.* leaves were corrected from the migration's collapse onto the player-controls__buttons container (the known text-theme ghost-button drift); the live fullscreen button carries the corrected wrapper hash.
- Two leaves are encore literals on this build (e-91000-button__icon-wrapper, e-91000-form-input family); both are absent from the static stylesheet but verified live in the DOM (223 and 2 instances).
- Three leaves keep dead 1020097-era hashes deliberately (upgrade button not rendered on this build's sessions observed, category grid items not present in css-map for this build): a dead class is a harmless no-op where a wrong live class would misstyle.
- Deep CDP verification observed 20/36 paths by raw hash on the routes and surfaces exercised by the verifier; modal and playback-state leaves need surfaces the verifier does not open.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 0 |
| static_present | 31 |
| verified_cdp | 20 |
| live_only | 2 |
| unresolved_missing | 3 |
| stale | 3 |
| cdp_hit_rate | 0.5556 |
| overlay_entries | 0 |

## Verification summary at publication

- Needs manual check: 31
- Missing in CSS: 5
