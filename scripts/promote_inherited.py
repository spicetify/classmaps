#!/usr/bin/env python3
"""Promote a verified classmap to an unchanged Spotify patch release.

The command deliberately consumes reports produced by the CLI's static and
CDP verifiers. It will not copy a map when the live report belongs to another
Spotify build, the hit-rate gate failed, or either report omits classmap paths.
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

from validate_classmaps import key_errors, leaf_values, render_json, version_to_key

ROOT = Path(__file__).resolve().parent.parent
MIN_PROMOTION_HIT_RATE = 0.25
SHA256_RE = re.compile(r"[0-9a-f]{64}")


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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_release(
    source_key: str,
    target_key: str,
    spotify_version: str,
    classmap: dict,
    source_meta: dict,
    static_report: dict,
    cdp_report: dict,
    min_hit_rate: float,
) -> tuple[set[str], set[str], float]:
    if not re.fullmatch(r"\d{7}", source_key) or not re.fullmatch(r"\d{7}", target_key):
        raise ValueError("classmap keys must contain exactly seven digits")
    if source_meta.get("status") != "verified":
        raise ValueError(f"source {source_key} is not verified")
    if source_meta.get("classmap_key") != source_key:
        raise ValueError(f"source metadata key does not match {source_key}")
    if version_to_key(str(source_meta.get("spotify_version", ""))) != source_key:
        raise ValueError(f"source metadata version does not match {source_key}")
    if source_key[:3] != target_key[:3] or int(target_key) <= int(source_key):
        raise ValueError(f"{target_key} is not a newer patch in the {source_key[:3]} family")

    user_agent = cdp_report.get("cdp", {}).get("browser", {}).get("User-Agent", "")
    version_match = re.search(r"(?:^|\s)Spotify/([0-9.]+)(?=\s|$)", user_agent)
    if not version_match or version_match.group(1) != spotify_version:
        raise ValueError(f"CDP report does not match Spotify {spotify_version}: {user_agent!r}")
    if cdp_report.get("deep") is not True:
        raise ValueError("promotion requires a deep CDP verification report")
    if cdp_report.get("mode") != "both":
        raise ValueError("promotion requires CDP mode 'both'")
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
        raise ValueError("promotion requires meaningful deep navigation coverage")
    if not math.isfinite(min_hit_rate) or not MIN_PROMOTION_HIT_RATE <= min_hit_rate <= 1:
        raise ValueError(f"minimum hit rate must be finite and at least {MIN_PROMOTION_HIT_RATE}")

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


def updated_required_paths(
    source_meta: dict, unverified: set[str], live_hits: set[str]
) -> dict[str, str]:
    required = dict(source_meta.get("required_paths") or {})
    for path in required:
        if path in live_hits:
            required[path] = "verified_cdp"
        elif path in unverified:
            required[path] = "unverified"
        else:
            required[path] = "verified_static"
    return required


def verification_markdown(
    source_key: str,
    target_key: str,
    spotify_version: str,
    paths: set[str],
    missing_in_target: set[str],
    live_hits: set[str],
    cdp_report: dict,
    cdp_hit_rate: float,
    overlay_entries: int,
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
    lines = [
        f"# Spotify {spotify_version} ({target_key})",
        "",
        f"Pipeline: inherit({source_key} -> {target_key}) + static target-CSS verification + CDP e2e (deep).",
        "",
        "## Notes",
        "",
        f"- Classmap inherited byte-for-byte from {source_key}; no migration guesses were accepted.",
        f"- Static verification found {rows['static_present']}/{len(paths)} paths in the target CSS.",
        f"- CSS-only misses observed live, which remain verified: {len(live_only)}.",
        (
            f"- Deep CDP verification observed {len(live_hits)}/{len(paths)} paths with "
            f"{navigation['succeeded']}/{navigation['attempted']} successful navigation steps."
        ),
        "- Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.",
        "",
        "## Statistics at publication",
        "",
        "| Field | Value |",
        "| --- | --- |",
        *(f"| {field} | {value} |" for field, value in rows.items()),
    ]
    return "\n".join(lines) + "\n"


def build_meta(
    source_key: str,
    target_key: str,
    spotify_version: str,
    generated: str,
    source_meta: dict,
    paths: set[str],
    missing_in_target: set[str],
    live_hits: set[str],
) -> dict:
    stale = sorted(set(source_meta.get("stale_leaves") or []) - live_hits)
    unverified = missing_in_target - live_hits - set(stale)
    return {
        "schema_version": 2,
        "classmap_key": target_key,
        "spotify_version": spotify_version,
        "status": "verified",
        "generated": generated,
        "source": {"method": "inherited", "key": source_key},
        "required_paths": updated_required_paths(source_meta, unverified, live_hits),
        "stale_leaves": stale,
        "unverified_leaves": sorted(unverified),
    }


def promote_inherited_release(
    *,
    root: Path,
    source_key: str,
    spotify_version: str,
    static_report: dict,
    cdp_report: dict,
    generated: str,
    min_hit_rate: float,
) -> Path:
    target_key = version_to_key(spotify_version)
    target_dir = root / target_key
    if target_dir.exists():
        raise FileExistsError(f"{target_key} already exists")

    source_dir = root / source_key
    source_classmap = source_dir / "classmap.json"
    classmap = json.loads(source_classmap.read_text())
    source_meta = json.loads((source_dir / "META.json").read_text())
    classmap_digest = sha256(source_classmap)
    if static_report.get("target", {}).get("classmap_sha256") != classmap_digest:
        raise ValueError("static report classmap digest does not match source")
    if cdp_report.get("classmap", {}).get("sha256") != classmap_digest:
        raise ValueError("CDP report classmap digest does not match source")
    missing_in_target, live_hits, cdp_hit_rate = validate_release(
        source_key,
        target_key,
        spotify_version,
        classmap,
        source_meta,
        static_report,
        cdp_report,
        min_hit_rate,
    )

    overlay = source_dir / "css-map.json"
    overlay_entries = len(json.loads(overlay.read_text())) if overlay.is_file() else 0
    paths = set(leaf_values(classmap))
    meta = build_meta(
        source_key,
        target_key,
        spotify_version,
        generated,
        source_meta,
        paths,
        missing_in_target,
        live_hits,
    )
    verification = verification_markdown(
        source_key,
        target_key,
        spotify_version,
        paths,
        missing_in_target,
        live_hits,
        cdp_report,
        cdp_hit_rate,
        overlay_entries,
    )

    staging_dir = Path(tempfile.mkdtemp(prefix=f".{target_key}-", dir=root))
    try:
        shutil.copy2(source_classmap, staging_dir / source_classmap.name)
        if overlay.is_file():
            shutil.copy2(overlay, staging_dir / overlay.name)
        (staging_dir / "META.json").write_text(render_json(meta), encoding="utf-8", newline="\n")
        (staging_dir / "VERIFICATION.md").write_text(verification, encoding="utf-8", newline="\n")
        errors = key_errors(staging_dir, key=target_key, root=root)
        if errors:
            raise ValueError("promoted release fails validation: " + "; ".join(errors))
        staging_dir.rename(target_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    return target_dir


def publish_inherited_release(**kwargs) -> Path:
    root = kwargs["root"]
    index_path = root / "index.json"
    previous_index = index_path.read_bytes() if index_path.is_file() else None
    target = promote_inherited_release(**kwargs)
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-key", required=True)
    parser.add_argument("--spotify-version", required=True)
    parser.add_argument("--static-report", type=Path, required=True)
    parser.add_argument("--cdp-report", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--generated", default=date.today().isoformat())
    parser.add_argument("--min-hit-rate", type=float, default=0.25)
    args = parser.parse_args()

    target = publish_inherited_release(
        root=args.root,
        source_key=args.from_key,
        spotify_version=args.spotify_version,
        static_report=json.loads(args.static_report.read_text()),
        cdp_report=json.loads(args.cdp_report.read_text()),
        generated=args.generated,
        min_hit_rate=args.min_hit_rate,
    )
    print(f"promoted {args.from_key} to {target.name}: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
