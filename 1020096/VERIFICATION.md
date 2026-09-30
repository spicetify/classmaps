# Spotify 1.2.96.518 (1020096)

Pipeline: inherit(1020094 -> 1020096) + static target-CSS verification + CDP e2e (deep). Published 2026-09-30.

## Notes

- Classmap inherited byte-for-byte from 1020094; no migration guesses were accepted.
- Static verification found 33/36 paths in the target CSS.
- CSS-only misses observed live by their stock class, which remain verified: 0.
- Deep CDP verification observed 30/36 paths with 10/10 successful navigation steps.
- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.
- Replaces an earlier verification of this key, kept below under Earlier verification.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| static_present | 33 |
| verified_cdp | 30 |
| live_only | 0 |
| unresolved_missing | 3 |
| cdp_hit_rate | 0.8333 |
| overlay_entries | 3 |

## Evidence

- Classmap SHA-256: `dc5212855a7b460980548d296313bfaf76696d9f5a43aa456289990273eefec3`
- Overlay SHA-256: `8c05d9ca347e4e13fb31013df4c42bdbf16046408b989afe4d0ea6a25037800e`
- Target CSS SHA-256: `bd8dcdebe8e9a6b33939f17fddf410d50dab7b6215821ed73eab21def3f1dd96`
- CDP report generated: 2026-09-30T13:42:12.980Z

## Earlier verification

Pipeline: inherit(1020094 -> 1020096) + static target-CSS verification + CDP e2e (deep).

### Notes

- Classmap inherited byte-for-byte from 1020094; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- One CSS-only miss was observed live and remains verified.
- Deep CDP verification observed 20/36 paths on the routes and transient surfaces exercised by the verifier.
- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.

### Statistics at publication

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

### Verification summary at publication

- Needs manual check: 32
- Missing in CSS: 4
