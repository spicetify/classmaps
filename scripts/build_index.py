#!/usr/bin/env python3
"""Regenerates index.json, the manifest the CLI fetches to resolve a classmap.

Run after adding or updating a classmap directory:

    python3 scripts/build_index.py          # rewrite index.json
    python3 scripts/build_index.py --check   # fail if it is out of date

Output is deterministic (no timestamps) so --check is a plain diff.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.json"
KEY_DIR = re.compile(r"^\d+$")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def classmap_file(key_dir: Path) -> Path | None:
    """The classmap the CLI would pick: classmap.json, else the highest-sorting
    classmap-*.json. Mirrors find_classmap_file in the Rust CLI."""
    direct = key_dir / "classmap.json"
    if direct.is_file():
        return direct
    hashed = sorted(key_dir.glob("classmap-*.json"))
    return hashed[-1] if hashed else None


def entry_for(key_dir: Path) -> dict | None:
    classmap = classmap_file(key_dir)
    if classmap is None:
        return None

    entry: dict = {"classmap": {"file": classmap.name, "sha256": sha256(classmap)}}

    for name, field in (("META.json", "meta"), ("css-map.json", "cssMapOverlay")):
        path = key_dir / name
        if path.is_file():
            entry[field] = {"file": name, "sha256": sha256(path)}

    meta_path = key_dir / "META.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            meta = {}
        for src, dst in (("spotify_version", "spotifyVersion"), ("status", "status")):
            if src in meta:
                entry[dst] = meta[src]

    return entry


def build() -> dict:
    keys = {}
    for key_dir in sorted(p for p in ROOT.iterdir() if p.is_dir() and KEY_DIR.match(p.name)):
        entry = entry_for(key_dir)
        if entry is None:
            print(f"skipping {key_dir.name}: no classmap file", file=sys.stderr)
            continue
        keys[key_dir.name] = entry
    index = {"version": 1, "keys": keys}
    # The exposure patch set is one file for every build, so it sits beside the
    # keys rather than under one; older CLIs ignore the entry.
    expose = ROOT / "expose.json"
    if expose.is_file():
        index["expose"] = {"file": expose.name, "sha256": sha256(expose)}
    return index


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if index.json is stale")
    args = parser.parse_args()

    rendered = json.dumps(build(), indent="\t", sort_keys=True) + "\n"

    if args.check:
        current = INDEX.read_text() if INDEX.is_file() else ""
        if current != rendered:
            print("index.json is out of date; run scripts/build_index.py", file=sys.stderr)
            return 1
        print("index.json is up to date")
        return 0

    INDEX.write_text(rendered)
    print(f"wrote {INDEX.relative_to(ROOT)} ({len(build()['keys'])} keys)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
