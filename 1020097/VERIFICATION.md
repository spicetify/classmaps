# Spotify 1.2.97.270 (1020097)

Pipeline: inherit(1020096 -> 1020097) + static target-CSS verification + CDP e2e (deep).

## Notes

- Classmap inherited byte-for-byte from 1020096; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- 0 CSS-only misses were observed live and remain verified.
- Deep CDP verification observed 21/36 paths on the routes and transient surfaces exercised by the verifier.
- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 36 |
| static_present | 32 |
| verified_cdp | 21 |
| live_only | 0 |
| unresolved_missing | 4 |
| stale | 2 |
| cdp_hit_rate | 0.5833 |
| overlay_entries | 3 |

## Verification summary at publication

- Needs manual check: 32
- Missing in CSS: 4
