#!/usr/bin/env python3
"""Runs every check CI runs. With --fix, first rewrites the JSON files in
canonical form and rebuilds index.json.

    python3 scripts/check.py
    python3 scripts/check.py --fix
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from validate_classmaps import KEY_DIR, ROOT, render_json

SCRIPTS = Path(__file__).resolve().parent


def fix() -> None:
    for key_dir in sorted(p for p in ROOT.iterdir() if p.is_dir() and KEY_DIR.match(p.name)):
        for name in ("classmap.json", "css-map.json", "META.json"):
            path = key_dir / name
            if path.is_file():
                path.write_bytes(render_json(json.loads(path.read_text(encoding="utf-8"))).encode("utf-8"))
    expose = ROOT / "expose.json"
    doc = json.loads(expose.read_text(encoding="utf-8"))
    expose.write_bytes((json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    subprocess.run([sys.executable, str(SCRIPTS / "build_index.py")], check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fix", action="store_true", help="format JSON and rebuild index.json first")
    args = parser.parse_args()
    if args.fix:
        fix()

    steps = [
        ["build_index.py", "--check"],
        ["validate_classmaps.py"],
        ["validate_expose.py"],
        ["-m", "unittest", "discover", "-s", str(SCRIPTS)],
    ]
    failed = []
    for step in steps:
        command = [sys.executable, *(step if step[0] == "-m" else [str(SCRIPTS / step[0]), *step[1:]])]
        if subprocess.run(command, cwd=ROOT).returncode != 0:
            failed.append(" ".join(step))
    if failed:
        print(f"failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
