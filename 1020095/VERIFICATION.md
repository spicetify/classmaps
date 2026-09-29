# Spotify 1.2.95.453 (1020095)

Pipeline: derive 1020094 with three settings corrections + stock source/CSS verification + deep CDP + Linux workflow verification.

## Notes

- Linux stable Spotify 1.2.95.453.g0eeebbed tested on Ubuntu 24.04.5 x86_64, X11, emulated on Apple Silicon. No Windows, macOS or Wayland runtime claim.
- Settings header KsnD09q3oqAjJX3e belongs to the output-device section in xpui-routes-desktop-settings.js. It did not render in this Linux session and remains unverified live.
- Settings section fNaaQ0Cp8Yzy19j8 wraps real settings groups; settings buttons use the observed small Encore secondary-button classes. nHgEqWYM1q0omZ6y is a proxy-settings container, not a button.
- Removed the inherited fEEfljGMIEhhmWVi and nWR7PbHjFXQJiYNL overlays: xpui-root-dialogs.js uses them for concert-location dialog content and its section, not settings.
- The two retained overlays identify search category links and the panel-gap grid. The panel-gap stock CSS has pointer-events:none and black child backgrounds.
- Deep CDP found 22/36 leaves with seven successful navigation steps out of eight. Context-menu dispatch was not counted as successful; the profile and library sort menus were separately exercised.
- Paired 1.2.96 and 1.2.95 Flow settings checks changed and restored a toggle and quality selection, and entered/cleared settings search. Store install/removal and the profile Spicetify Settings entry worked on 1.2.95.
- Tested CLI /home/test/.spicetify/spicetify and daemon 3.0.0-beta.19 are matching local builds from a036e07de398b437288d13c1cec26217207ecabb; this is not published-artifact verification.
- The normal `spicetify spotify install` stable path failed without 1020095, then downloaded, patched and launched 1.2.95 with classmapVerified=true and classmapSpotify=1.2.95 using a temporary localhost candidate index. The native VM window returned to Home with the styled Store button; native input injection was unreliable, so interaction checks used CDP.
- The managed installer intentionally restarted the daemon during activation. Its health returned with both watchers active; service and protocol-registration files were unchanged. This is not a daemon-continuity claim.
- At an 800px-wide Flow window, scrolling a control into view shifted the settings view horizontally. The paired initial layouts matched; the full-width Store and final default-settings captures were aligned. Queue toggled active, and its empty-state panel was visible after removing Flow. Playback, credits/embed dialogs and external navigation were not exercised.

## Statistics at publication

| Field | Value |
| --- | --- |
| leaves | 36 |
| unchanged_from_1020094 | 33 |
| corrected | 3 |
| static_present | 31 |
| verified_cdp | 22 |
| live_only | 2 |
| unresolved_missing | 3 |
| stale | 2 |
| cdp_hit_rate | 0.6111 |
| overlay_entries | 2 |

## Verification summary at publication

- Needs manual check: 31
- Missing in CSS: 5

## Linux verification

- Platform: linux-x86_64
- Spotify package SHA-256: `256e2eb1ec96fbc0c51afab247298e4e6eabfabbafafd4617584f44cca2fb31f`
- Stock SPA SHA-256: `7ce05c0001be22c7b5124d9dd59dd1ab1e0c188640967836b996f0d32a62f74e`
- Classmap SHA-256: `57cbc252b22f7fd914be7c8d7fc1e932168b28ebde8a4ecaa2129297fe6010a2`
- Static report SHA-256: `51eba62de40ba5055acca2554e79d7e9f2468fe42116d66bd182815fc3f5fcb7`
- CDP report SHA-256: `08c086085bab4d37d32716d9f41ba844ae69026c346a98a05b33045795404b1b`
- Core modules:
  - Manager: 1.4.0
  - Stdlib: 1.13.1
  - Store: 1.7.8
- Theme: Flow 0.1.2, Ocean palette, removed after testing
