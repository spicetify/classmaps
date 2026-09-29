# Agent guide

The README is the reference for the key layout, the META schema, and the
publishing steps. This file holds what the README and the scripts don't make
obvious.

- Generate every published file. `pnpm publish-key` writes a new key's
  `META.json` and `VERIFICATION.md`, `pnpm fix` formats JSON and rebuilds
  `index.json`, and `pnpm check` is done when it prints `all checks passed`.
  To change an existing key, edit its `classmap.json`, `css-map.json` or
  `META.json` fields, then run `pnpm fix`.
- Leaves hold the class exactly as the stock Spotify archive ships it. A class
  observed on a patched client has already been renamed by the css-map, so
  translate it back to the one stock hash the effective css-map (the CLI's
  `css-map.json` plus this key's overlay) rewrites to that name and the stock
  archive contains. The validator rejects names it recognises.
- An inherited key's map is byte-identical to its source. When you fix a map,
  apply the same fix to every key that inherits from it, or republish those
  keys as derived.
- Record run evidence in `VERIFICATION.md`, and keep reports, archives and
  scratch files outside the key directories. The validator rejects any file
  outside the published layout.
- Changing `expose.json` changes its published digest. The CLI's release
  workflow compares its embedded copy against that digest, so open a matching
  spicetify/cli pull request that copies the file.
