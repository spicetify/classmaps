# Spotify 1.3.1.234 (1030001)

Pipeline: inherit(1030000 -> 1030001) + static target-CSS verification + CDP e2e (deep).

## Notes

- Classmap inherited byte-for-byte from 1030000; no migration guesses were accepted.
- Static verification found 32/36 paths in the target CSS.
- 3 CSS-only misses were observed live and remain verified.
- Deep CDP verification observed 24/36 paths on the routes and transient surfaces exercised by the verifier.
- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.
- The CSS overlay includes the four entity-header, action-bar and Home background hooks added to 1030000 on 2026-09-29. Their selectors and layout declarations also occur in the signed Spotify 1.3.1.234 macOS ARM64 stock archive; the 36-leaf classmap remains unchanged.
- The headline statistics describe the original promotion. The patched macOS candidate run and its narrower observed coverage are recorded under Verification runs.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 36 |
| static_present | 32 |
| verified_cdp | 24 |
| live_only | 3 |
| unresolved_missing | 1 |
| stale | 0 |
| cdp_hit_rate | 0.6667 |
| overlay_entries | 291 |

## Verification summary at publication

- Needs manual check: 32
- Missing in CSS: 4

## Verification runs

### macos_arm64_2026_09_29

- Spotify version: 1.3.1.234
- Client state: patched
- CLI version: 3.0.0-beta.17
- CLI source: d74970010d22a9497bf84070a6ff75801a74657f
- Stock SPA SHA-256: `97824b5bc802dcdf7b13b35c790da1d49dd8c5415294375f585f393de2eb4c61`
- Apply: Passed using the candidate 1030001 classmap and 291-entry CSS overlay.
- Live workflows:
  - Opened Module Store through its topbar button.
  - Opened native Settings from the account menu; 14 sections and 22 toggles matched.
  - Searched for Burial and opened its artist page through the search result. All three entity/action-bar background hooks are present; Ziro hides the color and action-bar layers.
  - Home header hook is present and hidden by Ziro.
- Theme: Existing local Ziro 0.1.6 override; no claim of published-theme validation.
- Limitations:
  - Windows and Linux were not rerun.
  - The output-device Settings header was not rendered.
  - The candidate map was selected through SPICETIFY_CLASSMAPS_DIR; the published feed path was not exercised.
  - The deep verifier did not confirm context-menu activation.
- OS: macOS
- Architecture: arm64
- CLI path: ~/.spicetify/spicetify
- Daemon: Stopped during isolated-client verification; no daemon runtime claim.
- Classmap SHA-256: `17d9575c38a5a7cce9d6bb28665aff0c6e88b4ce4d94955bad297e19c97b33dc`
- Deep hits: 15
- Deep total: 36
- Deep navigation succeeded: 7
- Deep navigation attempted: 8
