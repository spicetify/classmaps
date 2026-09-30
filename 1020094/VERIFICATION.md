# Spotify 1.2.94.583 (1020094)

Pipeline: derive(1020092 -> 1020094) + static target-CSS verification + CDP e2e (deep). Published 2026-09-30.

## Notes

- Classmap derived from 1020092.
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
| overlay_entries | 4 |

## Evidence

- Classmap SHA-256: `dc5212855a7b460980548d296313bfaf76696d9f5a43aa456289990273eefec3`
- Overlay SHA-256: `63828d9b3b7ad07d4a8dda92a22706a491c12106e817c12f0b701e289fd07efc`
- Target CSS SHA-256: `1f06bd75d2a9e2fc0cf3287f8e536eb58543932f9a75d43f59b154a63d713d74`
- CDP report generated: 2026-09-30T14:55:43.139Z

## Earlier verification

Pipeline: migrate(1020092 -> 1020094) + static verify + CDP e2e (deep) on live 1.2.94.583.

### Notes

- 27 of 28 good 1020092 leaves survived unchanged into 1.2.94 (identity); the only non-identity migrate hit was the known artist-artistDiscography-topBar false friend and was reverted to stale.
- CDP e2e (deep navigation) on a live stock 1.2.94.583 client verified 20 leaves by hashed-class DOM presence, including the two settings fixes hand-mapped during 1020092 verification.
- settings.button.wrapper is present in 1.2.94 CSS but was not rendered during navigation (proxy section requires settings scroll); left unverified.
- modal.track_credits.* remapped to trackCreditsModalV2 classes (Spotify replaced the V1 modal); V2 hashes verified in live DOM via View credits.
- modal.widget_generator.* verified in live DOM via Share > Embed, including content.container (ywtSYUL2xRwVlvSo, previously stale).
- scrollable_text.container/wrapper remapped via css-map reverse lookup (single candidate in spa) and verified in live DOM on a search results page.
- search_chips.wrapper_wrapper remapped to the 1.2.9x search results chips bar (qZHfdckfFVY5AURF), DOM-verified; search_chips.chip corrected from the home filterChips class to the search page chip link (U4idT8HUFwfj7PWP).
- main.topbar.left.button_t.wrapper remapped to main-globalNav-link-icon (_Bg_zSvFrEutyacG), live on the nav buttons custom navlinks clone.
- Retired in 1.2.9x (kept stale, no candidate hash anywhere in the spa): topbar.left.button.icon.wrapper (icon span unclassed), topbar.right.upgrade_button.wrapper (no Upgrade button surface).
- settings.text_input remapped to the Encore form control classes (e-10451-form-input e-10451-form-control encore-text-body-medium), CDP-verified on a live 1.2.94.583 settings page (Search locations input). Multi-class value; valid for className contexts, which is the leaf's only use.
- The qnaFIKUJ9oUIkN97 overlay has pointer-events:none, an absolute three-column panel-gap grid, and black child backgrounds in the stock xpui-snapshot.css. It supplies the existing Flow theme main-layoutResizer-seam child-background rule. No visibility-state mapping is added because its element role has not been verified.

### Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| identity_from_1020092 | 27 |
| verified | 33 |
| verified_cdp | 21 |
| stale | 2 |
| verify_rate | 0.9167 |
| threshold | 0.55 |
| css_map_entries | 2585 |
| unverified | 1 |

### Migration guards

- playbar!=actionBar
- content!=closeBtn
- settings!=equalizer/NPV/actionBar
- semantic-only requires target CSS presence (sem>=0.75)

### CSS overlay

- File: css-map.json
- Entries: 4
- Note: Flat hash -> semantic bridge for the classic preprocess pipeline. The layout resizer seam is identified from stock 1.2.94.583 CSS; its Flow theme hover and resize behavior has not been verified live.
