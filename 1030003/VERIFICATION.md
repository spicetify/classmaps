# Spotify 1.3.3.264 (1030003)

Pipeline: inherit(1030001 -> 1030003) + static target-CSS verification + CDP e2e (deep). Published 2026-10-01.

## Notes

- Classmap inherited byte-for-byte from 1030001; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- CSS-only misses observed live by their stock class, which remain verified: 3.
- Deep CDP verification observed 32/36 paths with 10/10 successful navigation steps.
- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| static_present | 32 |
| verified_cdp | 32 |
| live_only | 3 |
| unresolved_missing | 1 |
| cdp_hit_rate | 0.8889 |
| overlay_entries | 291 |

## Evidence

- Classmap SHA-256: `d91fa1f1b40a19c51c5c7781a46e1ac41a44c56f2ea4f10096ce3e289f5f0f85`
- Overlay SHA-256: `c0c993277547bfc8ec53f4fa0a055c6e6a470dc5dbb38e37e53ed13514f20e01`
- Target CSS SHA-256: `c93146bc811f08a413a50bc0a6eadc237c2f5a07b937f6fdbbb22a5b2dff0e14`
- CDP report generated: 2026-10-01T14:52:25.151Z
