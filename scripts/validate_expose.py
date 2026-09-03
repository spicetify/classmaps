#!/usr/bin/env python3
"""Checks expose.json before it is published: the schema the CLI reads, every
pattern compiles, and every `${N}` in a template names a group the pattern
has. Python's `re` is close to the Rust regex crate for the syntax these
patterns use; the CLI is the final authority and skips a pattern it cannot
compile, so a construct only one side accepts still surfaces at apply as a
`did not match` warning rather than a crash.

    python3 scripts/validate_expose.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPOSE = ROOT / "expose.json"
TEMPLATE_REF = re.compile(r"\$\{(\d+)\}|\$(\d+)")


def main() -> int:
    try:
        doc = json.loads(EXPOSE.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"expose.json: {e}", file=sys.stderr)
        return 1

    errors: list[str] = []
    patches = doc.get("patches")
    if not isinstance(patches, list) or not patches:
        errors.append("`patches` must be a non-empty list")
        patches = []

    names: set[str] = set()
    for i, patch in enumerate(patches):
        where = f"patches[{i}]"
        if not isinstance(patch, dict):
            errors.append(f"{where}: not an object")
            continue
        name = patch.get("name")
        if not isinstance(name, str) or not name:
            errors.append(f"{where}: missing `name`")
            name = where
        if name in names:
            errors.append(f"{name}: duplicate name")
        names.add(name)

        pattern = patch.get("pattern")
        replace = patch.get("replace")
        if not isinstance(pattern, str) or not pattern:
            errors.append(f"{name}: missing `pattern`")
            continue
        if not isinstance(replace, str):
            errors.append(f"{name}: missing `replace`")
            continue
        try:
            groups = re.compile(pattern).groups
        except re.error as e:
            errors.append(f"{name}: pattern does not compile: {e}")
            continue
        for m in TEMPLATE_REF.finditer(replace):
            n = int(m.group(1) or m.group(2))
            if n > groups:
                errors.append(f"{name}: template references ${{{n}}} but the pattern has {groups} group(s)")
        if "once" in patch and not isinstance(patch["once"], bool):
            errors.append(f"{name}: `once` must be a boolean")
        if patch.get("onMiss", "warn") not in ("warn", "quiet"):
            errors.append(f"{name}: `onMiss` must be `warn` or `quiet`")

    for e in errors:
        print(e, file=sys.stderr)
    if errors:
        return 1
    print(f"expose.json: {len(patches)} patches ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
