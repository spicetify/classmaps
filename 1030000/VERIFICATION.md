# Spotify 1.3.0.277 (1030000)

Pipeline: exact stock-CSS signature migration from 1020097 + static target-CSS verification + deep CDP e2e on macOS and Windows + targeted live DOM/CSSOM probes.

## Notes

- Spotify 1.3.0 is a CSS-module rehash, so this key was derived rather than inherited from a 1.2.x classmap.
- The 280-entry css-map overlay was generated only from unique exact selector/declaration signatures shared by the stock 1.2.97 and 1.3.0 xpui stylesheets; 82 ambiguous signatures were excluded and 0 generated mappings conflicted with targeted live overrides.
- Historical deep CDP runs observed 23/36 paths on stock macOS and 24/36 paths on the patched Windows 1.3.0.277 client. The Windows report records 7/8 successful navigation steps; context-menu activation was not confirmed.
- Targeted CDP probes verified both modal families and the two settings container hashes that the deep verifier did not render.
- The remaining search chip-group and Encore control literals are absent from the static xpui stylesheet because Encore loads them at runtime; exact e-10860 selectors were verified recursively in the live CSSOM and the corresponding chip/control instances were observed in the DOM.
- Confirmed settings.section.container (HdwEUcX8xijMdU7doYPt -> x-settings-section) and settings.header.container (Hwax_pfCzrntLhnYXiqL -> x-settings-outputSectionHeader) bridge correctly across both platforms.
- The source artifacts were Spotify's notarized 1.3.0.277 macOS DMG and Windows Desktop 1.3.0.277 stock installation.
- The topbar, navigation-link and outer search-container leaves retain their original role-specific classes. The Windows-observed opacity, no-drag and inner-form helper classes coexist with them and are not substitutes for their layout or styling.
- The headline statistics and targeted checks describe the historical verification runs. Current candidate coverage is recorded under the macos_2026_09_29 run.
- On 2026-09-30 the modal, sort-box and context-menu leaves, which had been stored as their css-map names, were rewritten to their stock hashes from the 291-entry overlay. The css-map stages each back to the same name, and the map is again byte-identical to 1030001.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| inherited | 0 |
| static_present | 7 |
| verified_cdp | 24 |
| verified_targeted | 12 |
| live_only | 19 |
| unresolved_missing | 0 |
| stale | 0 |
| cdp_hit_rate | 0.6667 |
| overlay_entries | 291 |

## Verification summary at publication

- Deep DOM hits: 24
- Targeted live hits: 12
- Target static hits: 7
- Target static misses verified live: 19
- Deep navigation attempted: 8
- Deep navigation succeeded: 7
- CSS overlay conflicts: 0
- CSS overlay ambiguous excluded: 82

## Regression checks

### topbar_right_button

- Date: 2026-09-15
- Spotify version: 1.3.0.277
- Path: main.topbar.right.button_t.wrapper
- Class: nR3ekhH3c1IU7dX9smcR
- Staged class: main-topBar-buddyFeed
- Before hitbox (px): 16 x 16
- After hitbox (px): 32 x 32
- Native hitbox (px): 32 x 32
- Gap (px): 8
- Verification: Measured Bookmark, Full App Display, and Popup Lyrics after Rust apply and a client restart. Their hitboxes and gaps match the native notification and activity buttons. The unchanged 1.2.97 classmap resolves to the same semantic class, whose archived CSS also specifies 32px width and height.

### root_containers

- Date: 2026-09-15
- Spotify version: 1.3.0.277
- Mappings:
  - `bQetA_KiP9n0DQVcGa7m`: Root__globalNav
  - `PIP22o58Crv8RXY4wB2o`: Root__nav-bar
  - `itzKVxWhS4n59fp_KIVc`: Root__now-playing-bar
- Verification: Stock CSS and live child controls confirm the global-nav, left-sidebar, and now-playing-bar roles. After applying with Rust CLI 3.0.0-beta.17 on macOS Spotify 1.3.0.277, all three hooks exist and Text's Spicetify scheme paints them rgb(46, 40, 55). Navigation borders and spacing return; no Text CSS change was needed. Unthemed container rectangles, padding, borders, and backgrounds match the pre-apply measurements. Flow's player occupies its own 200px right column without overlapping the main view. Profile navigation, library sorting, the compact-library toggle and restoration, a Settings select, Bookmark, and the queue were exercised through pointer events. Module and native toolbar buttons retain 32px hitboxes and 8px gaps.
- Previous version check:
  - Spotify version: 1.2.94
  - Method: archived stock CSS inspection
  - Verification: The embedded CSS-map already maps qPaMr9Jzt0_Doy3C, vEHGULrufZMHBNrp, and YdGOYWQYr6kqh7KU to the same three hooks. Their stock declarations preserve the same grid areas, sizing, and player gutters as 1.3.0; black library and player container backgrounds are already present in 1.2.94. Older version maps remain unchanged. This is archived CSS evidence, not a live older-client check.

### settings_toggle_input

- Date: 2026-09-15
- Spotify version: 1.3.0.277
- Class: utdiMuyxdKvPowN1CIBs
- Staged class: x-toggle-input
- Verification: The native checkbox uses opacity:0, pointer-events:none, and position:absolute in five stock stylesheets. The missing semantic hook left stdlib Settings rows showing both a native checkbox and their styled indicator. Reapply restores the shared input styling; live Spicetify Settings inputs have opacity 0 and absolute positioning while their toggle indicators remain visible. Regression coverage fails without the mapping.

### playback_bar

- Date: 2026-09-16
- Spotify version: 1.3.0.277
- Mappings:
  - `Ox6fJ7l6WeB1wD0MqHXb`: playback-bar
  - `LppHcR524PsiPr4sz5IV`: playback-bar__progress-time-elapsed
  - `TcCS0BhwDXw_s2HufffR`: main-playbackBarRemainingTime-container
- Verification: Stock CSS and live playback controls confirm the container, elapsed-time, and duration roles. Applied through Rust CLI 3.0.0-beta.17 on macOS with published Text 0.1.6. Text restores its full-width 16px seek track. Text 0.1.6 returns the absolutely positioned timestamp spans to normal flow and aligns the seek handle. Pointer seeking, ArrowRight seeking, and the duration/remaining-time toggle passed through UI input.
- Previous version check: Archived Spotify 1.2.94 CSS maps o9SONbmdTWwKgbUo, _xaGcuWD6w4FNkGu, and jYB3Yggec0UDIsZh to the same hooks and preserves their container and timestamp roles. Older maps are unchanged. No older client was run live.

### entity_header_backgrounds

- Date: 2026-09-29
- Spotify version: 1.3.0.277
- Mappings:
  - `kMUtWcOMOZmCWTMAc_gu`: main-entityHeader-background
  - `ELsCw_Koqs_Q2dLHtg7z`: main-entityHeader-overlay
  - `M7ECcaA17LC8UqL2GKVD`: main-actionBarBackground-background
  - `dqwQhIudKoD98eWJzj5E`: main-home-homeHeader
- Verification: Stock CSS confirms the roles: kMUtWc is the absolute full-size header layer that carries the inline colour, ELsCw adds the dark gradient on a second kMUtWc layer, M7ECcaA is the 232px z-index -1 gradient behind the action bar, and dqwQhIud is the Home header gradient hidden by its Jyc7 modifier. Spotify 1.3 dropped the separate backgroundColor modifier, so the colour layer maps to the shared background hook. Applied with SPICETIFY_CLASSMAPS_DIR through Rust CLI 3.0.0-beta.17 on macOS: on Burial (avatar header), Liked Songs and Home the readable classes are present, Ziro 0.1.5 hides the action-bar gradient and Home header, and Text renders its flat header. All 14 first-party themes reference these hooks and matched nothing on 1.3.0 before.
- Previous version check: The base css-map maps older hashes to the same four hooks; dribbblish and matte select .main-entityHeader-background.main-entityHeader-overlay, matching the two-class overlay layer. No older client was run live.

## Verification runs

### windows_2026_09_16

- Classmap SHA-256: `879140c1dddb65b2ff14440c34abe3b2d166274a1309ce3214108e21c8430bc7`
- Client state: patched
- CDP: https://github.com/user-attachments/files/32311568/1030000-cdp.json
- Static: https://github.com/user-attachments/files/32311573/1030000-static.json
- Navigation attempted: 8
- Navigation succeeded: 7
- Note: Historical evidence for the contributor map before restoring the topbar, navigation-link and outer-search-container roles.

### macos_2026_09_29

- Spotify version: 1.3.0.277
- OS: macOS
- Architecture: arm64
- Client state: patched
- CLI version: 3.0.0-beta.17
- Classmap SHA-256: `f0a79a96c949b016686a4b4f2feaefee6540652135799133bfa3d1b1411f18d5`
- Deep hits: 17
- Deep total: 36
- Deep navigation succeeded: 7
- Deep navigation attempted: 8
- Targeted: Home is a centered circular 48px button using main-globalNav-navLink. Native Settings has 14 correctly mapped sections and 22 toggle inputs.
- Limitations:
  - Windows and Linux were not rerun.
  - The output-device Settings header was not rendered.
  - The candidate map was selected through SPICETIFY_CLASSMAPS_DIR; the published feed path was not exercised.
  - The deep verifier did not confirm context-menu activation.
- CLI source: d74970010d22a9497bf84070a6ff75801a74657f
- CLI path: ~/.spicetify/spicetify
- Daemon: Stopped during isolated-client verification; no daemon runtime claim.
