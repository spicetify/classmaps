# Spotify 1.2.97.270 (1020097)

Pipeline: inherit(1020096 -> 1020097) + static target-CSS verification + CDP e2e (deep). Published 2026-09-30.

## Notes

- Classmap inherited byte-for-byte from 1020096; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- CSS-only misses observed live by their stock class, which remain verified: 0.
- Deep CDP verification observed 29/36 paths with 10/10 successful navigation steps.
- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.
- Replaces an earlier verification of this key, kept below under Earlier verification.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| static_present | 32 |
| verified_cdp | 29 |
| live_only | 0 |
| unresolved_missing | 4 |
| cdp_hit_rate | 0.8056 |
| overlay_entries | 3 |

## Evidence

- Classmap SHA-256: `dc5212855a7b460980548d296313bfaf76696d9f5a43aa456289990273eefec3`
- Overlay SHA-256: `8c05d9ca347e4e13fb31013df4c42bdbf16046408b989afe4d0ea6a25037800e`
- Target CSS SHA-256: `15afbe4b3bb33606ab2e1ecaae17886f5fda182dcc2cbcade34906e32872112e`
- CDP report generated: 2026-09-30T14:55:57.755Z

## Earlier verification

Pipeline: inherit(1020096 -> 1020097) + static target-CSS verification + CDP e2e (deep).

### Notes

- Classmap inherited byte-for-byte from 1020096; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- 0 CSS-only misses were observed live and remain verified.
- Deep CDP verification observed 21/36 paths on the routes and transient surfaces exercised by the verifier.
- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.

### Statistics at publication

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

### Verification summary at publication

- Needs manual check: 32
- Missing in CSS: 4
