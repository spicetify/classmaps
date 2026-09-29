#!/usr/bin/env python3
"""Publish a classmap key from the CLI's static and deep CDP verification reports.

An inherited key copies an older key's map and overlay byte-for-byte:

    python3 scripts/publish_key.py --inherit-from 1020094 \\
      --spotify-version 1.2.96.518 \\
      --static-report static.json --cdp-report cdp.json

A derived key publishes a new candidate map:

    python3 scripts/publish_key.py --classmap candidate.json --css-map overlay.json \\
      --derived-from 1030001 --spotify-version 1.3.2.100 \\
      --static-report static.json --cdp-report cdp.json \\
      --stale main.topbar.right.upgrade_button.wrapper \\
      --note "The upgrade button has no rendered instance on a premium account."

Both reports must be bound to the published map and Spotify build. The command
writes classmap.json, css-map.json, META.json and VERIFICATION.md, validates the
new key, and rebuilds index.json, rolling everything back if a step fails.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from validate_classmaps import KEY_DIR, key_errors, leaf_values, render_json, version_to_key

ROOT = Path(__file__).resolve().parent.parent
MIN_HIT_RATE = 0.25
SHA256_RE = re.compile(r"[0-9a-f]{64}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_text(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def report_rows(
    report: dict,
    name: str,
    expected_values: dict[str, str],
    value_field: str,
) -> dict[str, dict]:
    rows = {row.get("path"): row for row in report.get("rows", []) if row.get("path")}
    missing = expected_values.keys() - rows.keys()
    extra = rows.keys() - expected_values.keys()
    if missing or extra:
        raise ValueError(
            f"{name} paths do not match classmap; missing={sorted(missing)}, extra={sorted(extra)}"
        )
    mismatched = [
        path for path, value in expected_values.items() if rows[path].get(value_field) != value
    ]
    if mismatched:
        raise ValueError(f"{name} does not match classmap at {sorted(mismatched)}")
    return rows


def check_source(source_key: str, target_key: str, source_meta: dict, inherited: bool) -> None:
    if not KEY_DIR.fullmatch(source_key):
        raise ValueError("classmap keys must contain exactly seven digits")
    if source_meta.get("status") != "verified":
        raise ValueError(f"source {source_key} is not verified")
    if source_meta.get("classmap_key") != source_key:
        raise ValueError(f"source metadata key does not match {source_key}")
    if version_to_key(str(source_meta.get("spotify_version", ""))) != source_key:
        raise ValueError(f"source metadata version does not match {source_key}")
    if int(target_key) <= int(source_key):
        raise ValueError(f"{target_key} is not newer than {source_key}")
    if inherited and source_key[:3] != target_key[:3]:
        raise ValueError(f"{target_key} is not a newer patch in the {source_key[:3]} family")


def check_reports(
    spotify_version: str,
    classmap: dict,
    classmap_digest: str,
    static_report: dict,
    cdp_report: dict,
    min_hit_rate: float,
) -> tuple[set[str], set[str], float]:
    """Returns the paths missing from the target CSS, the live hits, and the hit rate."""
    if static_report.get("target", {}).get("classmap_sha256") != classmap_digest:
        raise ValueError("static report classmap digest does not match the published map")
    if cdp_report.get("classmap", {}).get("sha256") != classmap_digest:
        raise ValueError("CDP report classmap digest does not match the published map")

    user_agent = cdp_report.get("cdp", {}).get("browser", {}).get("User-Agent", "")
    version_match = re.search(r"(?:^|\s)Spotify/([0-9.]+)(?=\s|$)", user_agent)
    if not version_match or version_match.group(1) != spotify_version:
        raise ValueError(f"CDP report does not match Spotify {spotify_version}: {user_agent!r}")
    if cdp_report.get("deep") is not True:
        raise ValueError("publication requires a deep CDP verification report")
    if cdp_report.get("mode") != "both":
        raise ValueError("publication requires CDP mode 'both'")
    navigation = cdp_report.get("navigation", {})
    attempted = navigation.get("attempted")
    succeeded = navigation.get("succeeded")
    failed = navigation.get("failed")
    if (
        not isinstance(attempted, int)
        or not isinstance(succeeded, int)
        or not isinstance(failed, list)
        or attempted < 0
        or succeeded < 0
        or succeeded > attempted
        or len(failed) != attempted - succeeded
    ):
        raise ValueError("CDP navigation ledger is inconsistent")
    if attempted < 8 or succeeded < 4:
        raise ValueError("publication requires meaningful deep navigation coverage")
    if not math.isfinite(min_hit_rate) or not MIN_HIT_RATE <= min_hit_rate <= 1:
        raise ValueError(f"minimum hit rate must be finite and at least {MIN_HIT_RATE}")

    static_target = static_report.get("target", {})
    if static_target.get("spotify_version") != spotify_version:
        raise ValueError(f"static report does not match Spotify {spotify_version}")
    if not SHA256_RE.fullmatch(str(static_target.get("css_sha256", ""))):
        raise ValueError("static report has no valid target CSS digest")

    values = leaf_values(classmap)
    static_rows = report_rows(static_report, "static report", values, "class")
    cdp_rows = report_rows(cdp_report, "CDP report", values, "hash")
    live_hits = {path for path, row in cdp_rows.items() if row.get("hit") is True}
    total = len(cdp_rows)
    hits = len(live_hits)
    hit_rate = hits / total if total else 0.0
    summary = cdp_report.get("summary", {})
    reported_rate = summary.get("hitRate")
    if not isinstance(reported_rate, (int, float)) or not math.isfinite(reported_rate):
        raise ValueError("CDP summary hit rate must be finite")
    if (
        summary.get("total") != total
        or summary.get("hits") != hits
        or abs(float(reported_rate) - round(hit_rate, 4)) > 0.00005
    ):
        raise ValueError("CDP summary does not match rows")
    if hit_rate < min_hit_rate:
        raise ValueError(f"CDP hit rate {hit_rate:.4f} is below required {min_hit_rate:.4f}")

    missing_in_target = {path for path, row in static_rows.items() if not row.get("in_target_css")}
    static_summary: dict[str, int] = {}
    for row in static_rows.values():
        verdict = str(row.get("verdict"))
        static_summary[verdict] = static_summary.get(verdict, 0) + 1
    if static_report.get("summary") != static_summary:
        raise ValueError("static summary does not match rows")
    return missing_in_target, live_hits, round(hit_rate, 4)


def required_statuses(
    required: dict, unverified: set[str], live_hits: set[str]
) -> dict[str, str]:
    statuses = {}
    for path in required:
        if path in live_hits:
            statuses[path] = "verified_cdp"
        elif path in unverified:
            statuses[path] = "unverified"
        else:
            statuses[path] = "verified_static"
    return statuses


def verification_markdown(
    target_key: str,
    spotify_version: str,
    method: str,
    source_key: str | None,
    paths: set[str],
    missing_in_target: set[str],
    live_hits: set[str],
    cdp_report: dict,
    cdp_hit_rate: float,
    overlay_entries: int,
    notes: list[str],
) -> str:
    live_only = missing_in_target & live_hits
    navigation = cdp_report["navigation"]
    rows = {
        "leaves": len(paths),
        "static_present": len(paths - missing_in_target),
        "verified_cdp": len(live_hits),
        "live_only": len(live_only),
        "unresolved_missing": len(missing_in_target - live_hits),
        "cdp_hit_rate": cdp_hit_rate,
        "overlay_entries": overlay_entries,
    }
    if method == "inherited":
        step = f"inherit({source_key} -> {target_key})"
        origin = [f"- Classmap inherited byte-for-byte from {source_key}; no migration guesses were accepted."]
    else:
        step = f"derive({source_key or 'stock CSS'} -> {target_key})"
        origin = [f"- Classmap derived from {source_key}." if source_key else "- Classmap derived from the stock CSS."]
    lines = [
        f"# Spotify {spotify_version} ({target_key})",
        "",
        f"Pipeline: {step} + static target-CSS verification + CDP e2e (deep).",
        "",
        "## Notes",
        "",
        *origin,
        f"- Static verification found {rows['static_present']}/{len(paths)} paths in the target CSS.",
        f"- CSS-only misses observed live, which remain verified: {len(live_only)}.",
        (
            f"- Deep CDP verification observed {len(live_hits)}/{len(paths)} paths with "
            f"{navigation['succeeded']}/{navigation['attempted']} successful navigation steps."
        ),
        "- Unresolved new misses remain usable but are marked unverified; stale paths stay blocked.",
        *(f"- {note}" for note in notes),
        "",
        "## Statistics at publication",
        "",
        "| Field | Value |",
        "| --- | --- |",
        *(f"| {field} | {value} |" for field, value in rows.items()),
    ]
    return "\n".join(lines) + "\n"


def newest_verified_key(root: Path, below: str) -> str | None:
    keys = sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and KEY_DIR.fullmatch(p.name) and p.name < below and (p / "META.json").is_file()
    )
    return keys[-1] if keys else None


def publish_release(
    *,
    root: Path,
    spotify_version: str,
    static_report: dict,
    cdp_report: dict,
    generated: str,
    min_hit_rate: float,
    inherit_from: str | None = None,
    classmap_path: Path | None = None,
    overlay_path: Path | None = None,
    derived_from: str | None = None,
    required_from: str | None = None,
    stale: tuple[str, ...] = (),
    notes: tuple[str, ...] = (),
) -> Path:
    if (inherit_from is None) == (classmap_path is None):
        raise ValueError("pass exactly one of --inherit-from or --classmap")
    if inherit_from is not None and (overlay_path or derived_from or stale):
        raise ValueError("an inherited key takes its map, overlay and stale paths from its source")

    target_key = version_to_key(spotify_version)
    target_dir = root / target_key
    if target_dir.exists():
        raise FileExistsError(f"{target_key} already exists")

    source_key = inherit_from or derived_from
    source_meta: dict = {}
    if source_key is not None:
        source_meta = json.loads((root / source_key / "META.json").read_text(encoding="utf-8"))
        check_source(source_key, target_key, source_meta, inherited=inherit_from is not None)

    if inherit_from is not None:
        classmap_bytes = (root / inherit_from / "classmap.json").read_bytes()
        source_overlay = root / inherit_from / "css-map.json"
        overlay = json.loads(source_overlay.read_text(encoding="utf-8")) if source_overlay.is_file() else None
    else:
        classmap_bytes = classmap_path.read_bytes()
        overlay = json.loads(overlay_path.read_text(encoding="utf-8")) if overlay_path else None
    classmap = json.loads(classmap_bytes)

    missing_in_target, live_hits, cdp_hit_rate = check_reports(
        spotify_version, classmap, sha256(classmap_bytes), static_report, cdp_report, min_hit_rate
    )

    if inherit_from is not None:
        stale_paths = sorted(set(source_meta.get("stale_leaves") or []) - live_hits)
        doubted = missing_in_target | set(source_meta.get("unverified_leaves") or [])
        required = source_meta.get("required_paths") or {}
    else:
        stale_paths = sorted(set(stale))
        doubted = set(missing_in_target)
        required_key = required_from or derived_from or newest_verified_key(root, target_key)
        required = {}
        if required_key is not None:
            required_meta = json.loads((root / required_key / "META.json").read_text(encoding="utf-8"))
            required = required_meta.get("required_paths") or {}
    unverified = doubted - live_hits - set(stale_paths)

    meta = {
        "schema_version": 2,
        "classmap_key": target_key,
        "spotify_version": spotify_version,
        "status": "verified",
        "generated": generated,
        "source": {"method": "inherited" if inherit_from else "derived", "key": source_key},
        "required_paths": required_statuses(required, unverified, live_hits),
        "stale_leaves": stale_paths,
        "unverified_leaves": sorted(unverified),
    }
    verification = verification_markdown(
        target_key,
        spotify_version,
        meta["source"]["method"],
        source_key,
        set(leaf_values(classmap)),
        missing_in_target,
        live_hits,
        cdp_report,
        cdp_hit_rate,
        len(overlay or {}),
        list(notes),
    )

    staging_dir = Path(tempfile.mkdtemp(prefix=f".{target_key}-", dir=root))
    try:
        if inherit_from is not None:
            (staging_dir / "classmap.json").write_bytes(classmap_bytes)
        else:
            write_text(staging_dir / "classmap.json", render_json(classmap))
        if overlay is not None:
            write_text(staging_dir / "css-map.json", render_json(overlay))
        write_text(staging_dir / "META.json", render_json(meta))
        write_text(staging_dir / "VERIFICATION.md", verification)
        errors = key_errors(staging_dir, key=target_key, root=root)
        if errors:
            raise ValueError("published key fails validation: " + "; ".join(errors))
        staging_dir.rename(target_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    return target_dir


def publish_and_index(**kwargs) -> Path:
    root = kwargs["root"]
    index_path = root / "index.json"
    previous_index = index_path.read_bytes() if index_path.is_file() else None
    target = publish_release(**kwargs)
    try:
        subprocess.run([sys.executable, str(root / "scripts/build_index.py")], check=True)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        if previous_index is None:
            index_path.unlink(missing_ok=True)
        else:
            index_path.write_bytes(previous_index)
        raise
    return target


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--inherit-from", metavar="KEY", help="copy this key's map and overlay")
    origin.add_argument("--classmap", type=Path, help="candidate map for a derived key")
    parser.add_argument("--css-map", type=Path, help="overlay for a derived key")
    parser.add_argument("--derived-from", metavar="KEY", help="key the candidate was migrated from")
    parser.add_argument(
        "--required-paths-from",
        metavar="KEY",
        help="key whose required_paths to track (default: --derived-from, else the newest key)",
    )
    parser.add_argument("--stale", action="append", default=[], metavar="PATH", help="mark a leaf stale")
    parser.add_argument("--note", action="append", default=[], help="add a line to VERIFICATION.md")
    parser.add_argument("--spotify-version", required=True)
    parser.add_argument("--static-report", type=Path, required=True)
    parser.add_argument("--cdp-report", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--generated", default=date.today().isoformat())
    parser.add_argument("--min-hit-rate", type=float, default=MIN_HIT_RATE)
    args = parser.parse_args()

    target = publish_and_index(
        root=args.root,
        spotify_version=args.spotify_version,
        static_report=json.loads(args.static_report.read_text(encoding="utf-8")),
        cdp_report=json.loads(args.cdp_report.read_text(encoding="utf-8")),
        generated=args.generated,
        min_hit_rate=args.min_hit_rate,
        inherit_from=args.inherit_from,
        classmap_path=args.classmap,
        overlay_path=args.css_map,
        derived_from=args.derived_from,
        required_from=args.required_paths_from,
        stale=tuple(args.stale),
        notes=tuple(args.note),
    )
    print(f"published {target.name}: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
