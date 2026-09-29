# Spotify 1.2.96.518 (1020096)

Pipeline: inherit(1020094 -> 1020096) + static target-CSS verification + CDP e2e (deep).

## Notes

- Classmap inherited byte-for-byte from 1020094; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- One CSS-only miss was observed live and remains verified.
- Deep CDP verification observed 20/36 paths on the routes and transient surfaces exercised by the verifier.
- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 36 |
| static_present | 32 |
| verified_cdp | 20 |
| live_only | 1 |
| unresolved_missing | 3 |
| stale | 2 |
| cdp_hit_rate | 0.5556 |
| overlay_entries | 3 |

## Verification summary at publication

- Needs manual check: 32
- Missing in CSS: 4
