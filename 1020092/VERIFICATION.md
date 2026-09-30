# Spotify 1.2.92.147 (1020092)

Pipeline: derive(stock CSS -> 1020092) + static target-CSS verification + CDP e2e (deep). Published 2026-09-30.

## Notes

- Classmap derived from the stock CSS.
- Static verification found 32/36 paths in the target CSS.
- CSS-only misses observed live by their stock class, which remain verified: 0.
- Deep CDP verification observed 25/36 paths with 10/10 successful navigation steps.
- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.
- Derived from 1020040, which is no longer published.
- Replaces an earlier verification of this key, kept below under Earlier verification.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| static_present | 32 |
| verified_cdp | 25 |
| live_only | 0 |
| unresolved_missing | 4 |
| cdp_hit_rate | 0.6944 |
| overlay_entries | 3 |

## Evidence

- Classmap SHA-256: `7b0ec24ad5bf62b6d71279e6311dd36222938b63f6968e1719250596317b7812`
- Overlay SHA-256: `8c05d9ca347e4e13fb31013df4c42bdbf16046408b989afe4d0ea6a25037800e`
- Target CSS SHA-256: `3886e4c8961e0c187af7a9f9862a259d82a040b05ba25c57f234fb4a093436f2`
- CDP report generated: 2026-09-30T13:36:40.937Z

## Earlier verification

Pipeline: migrate(1020040 -> 1020092) + static verify + CDP e2e (deep) + manual DOM probe.

### Notes

- CDP e2e (deep navigation: home/search/library/playlist/context menu/settings) verified 19 leaves by hashed-class DOM presence on a stock 1.2.92.148 client.
- modal.track_credits.* remapped to trackCreditsModalV2 classes (Spotify replaced the V1 modal); V2 hashes verified in live DOM via View credits.
- modal.widget_generator.* verified in live DOM via Share > Embed, including content.container (ywtSYUL2xRwVlvSo, previously stale).
- scrollable_text.container/wrapper remapped via css-map reverse lookup (single candidate in spa) and verified in live DOM on a search results page.
- search_chips.wrapper_wrapper remapped to the 1.2.9x search results chips bar (qZHfdckfFVY5AURF), DOM-verified; search_chips.chip corrected from the home filterChips class to the search page chip link (U4idT8HUFwfj7PWP).
- main.topbar.left.button_t.wrapper remapped to main-globalNav-link-icon (_Bg_zSvFrEutyacG), live on the nav buttons custom navlinks clone.
- Retired in 1.2.9x (kept stale, no candidate hash anywhere in the spa): topbar.left.button.icon.wrapper (icon span unclassed), topbar.right.upgrade_button.wrapper (no Upgrade button surface), settings.text_input (settings inputs are Encore form controls now).

### Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| verified | 33 |
| verified_cdp | 19 |
| verified_dom_probe | 2 |
| stale | 3 |
| verify_rate | 0.9167 |
| threshold | 0.55 |
| css_map_entries | 2585 |

### Migration guards

- playbar!=actionBar
- content!=closeBtn
- settings!=equalizer/NPV/actionBar
- semantic-only requires target CSS presence (sem>=0.75)
