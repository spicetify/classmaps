# Spotify 1.2.99.317 (1020099)

Pipeline: derive(1020097 -> 1020099) + static target-CSS verification + CDP e2e (deep). Published 2026-09-30.

## Notes

- Classmap derived from 1020097.
- Static verification found 36/36 paths in the target CSS.
- CSS-only misses observed live by their stock class, which remain verified: 0.
- Deep CDP verification observed 32/36 paths with 10/10 successful navigation steps.
- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.
- Marked stale although observed live: main.topbar.right.upgrade_button.wrapper.
- Replaces an earlier verification of this key, kept below under Earlier verification.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| static_present | 36 |
| verified_cdp | 32 |
| live_only | 0 |
| unresolved_missing | 0 |
| cdp_hit_rate | 0.8889 |
| overlay_entries | 2 |

## Evidence

- Classmap SHA-256: `dbbdd2c325bc6ff55b903867596e9371952320841248ad04997ee0ea7cf00fb7`
- Overlay SHA-256: `b4d8016a12301d6be24369dba618093813ad33376617ee6a7fc651d06c959600`
- Target CSS SHA-256: `12c8c98de652cbf9dce89965cb3f983ddd83bea9633bc813018a470104743a40`
- CDP report generated: 2026-09-30T11:52:32.463Z

## Earlier verification

Pipeline: runtime CDP extraction (Spotify --remote-debugging-port=9222) + live DOM/CSS verification + static xpui CSS cross-check.

### Notes

- Values were extracted from the live 1.2.99.317 client over CDP (port 9222), not guessed.
- The Encore build tag moved from e-10451 to e-10810.
- Topbar merged into Root__globalNav; wrapper class oy96nRTKcIs7wm5K observed on [data-testid=global-nav-bar].
- Playbar controls use encore legacy-button shapes; active state = legacy-button-primary.
- Search category chips render through the encore chip factory (e-10810-chip-group* rules verified in CSS).
- The extraction ran on a patched client, so 17 leaves (navigation links, both modal families, settings containers, sort box, search container, context menu and the search expand icon) were first recorded as their css-map names. The stock 1.2.99.317 archive contains only the hashed classes. On 2026-09-30 those leaves were rewritten to the one stock hash per name present in that archive; the css-map stages each back to the same name.
- upgrade_button has no rendered instance on this premium account; value taken from the encore legacy-button-primary factory shape (stale-marked, same policy as 1020097).
- Historical extraction observed 25/36 leaves in the DOM and 11/36 only in live CSS. The headline statistics retain that extraction; the 2026-09-29 run is recorded under Verification runs.
- The settings overlay now maps KsnD09q3oqAjJX3e to x-settings-outputSectionHeader and fNaaQ0Cp8Yzy19j8 to x-settings-section. The old hashes belong to a concert-location dialog in the exact 1.2.99 archive.
- Tertiary button leaves include both legacy-button and legacy-button-tertiary, plus generic icon-only padding where applicable. The playbar retains its small-size modifier; the medium modifier has no CSS rule.
- The left button icon was observed by the current deep verifier and is no longer stale. Matching the generic primary-button classes does not establish the unrendered upgrade-button role, so that leaf remains stale.

### Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 2 |
| static_present | 36 |
| verified_cdp | 25 |
| live_only | 0 |
| unresolved_missing | 0 |
| stale | 1 |
| cdp_hit_rate | 0.6944 |
| overlay_entries | 2 |

### Verification summary at publication

- CDP DOM probes: 47
- CSS classes live: 4726
- DOM hits: 25
- CSS only hits: 11
- Misses: 0
- Scope: Historical 2026-09-05 extraction; CSS presence is not DOM observation.

### Verification runs

#### macos_arm64_2026_09_29

- Spotify version: 1.2.99.317
- OS: macOS
- Architecture: arm64
- Client state: patched
- CLI version: 3.0.0-beta.17
- CLI source: d74970010d22a9497bf84070a6ff75801a74657f
- CLI path: ~/.spicetify/spicetify
- Daemon: Stopped during isolated-client verification; no daemon runtime claim.
- Classmap SHA-256: `d015b23c52199fe287ad60f1da8c34c168349d6dd3b9f6a66e874bda1740c2e6`
- Deep hits: 24
- Deep total: 36
- Deep navigation succeeded: 7
- Deep navigation attempted: 8
- Limitations:
  - Windows and Linux were not rerun.
  - The output-device Settings header was not rendered.
  - The candidate map was selected through SPICETIFY_CLASSMAPS_DIR; the published feed path was not exercised.
  - The deep verifier did not confirm context-menu activation.
  - The upgrade-button role and transient modal families were not exercised.
- Apply: Passed using the candidate 1020099 classmap and corrected two-entry settings overlay.
- Live workflows:
  - Opened native Settings from the account menu; 14 correctly mapped sections render as grids with aligned labels and controls.
  - Opened Module Store through its topbar button. Home and Store retain circular 48px hit areas.
- Theme: Existing local Ziro 0.1.6 override; no claim of published-theme validation.
