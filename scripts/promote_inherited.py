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

ROOT = Path(__file__).resolve().parent.parent
MIN_PROMOTION_HIT_RATE = 0.25
SHA256_RE = re.compile(r"[0-9a-f]{64}")


def version_to_key(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:\..*)?", version)
    if not match:
        raise ValueError(f"need major.minor.patch, got {version!r}")
    major, minor, patch = (int(part) for part in match.groups())
    return f"{major}{minor:02d}{patch:04d}"


def classmap_file(key_dir: Path) -> Path:
    direct = key_dir / "classmap.json"
    if direct.is_file():
        return direct
    candidates = sorted(key_dir.glob("classmap-*.json"))
    if not candidates:
        raise FileNotFoundError(f"no classmap in {key_dir}")
    return candidates[-1]


def leaf_paths(node: object, parts: tuple[str, ...] = ()) -> set[str]:
    if isinstance(node, dict):
        paths: set[str] = set()
        for key, value in node.items():
            paths |= leaf_paths(value, (*parts, key))
        return paths
    if isinstance(node, str):
        return {".".join(parts)}
    raise ValueError(f"invalid classmap leaf at {'.'.join(parts)}")


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


def leaf_values(node: object, parts: tuple[str, ...] = ()) -> dict[str, str]:
    if isinstance(node, dict):
        values: dict[str, str] = {}
        for key, value in node.items():
            values.update(leaf_values(value, (*parts, key)))
        return values
    if isinstance(node, str):
        return {".".join(parts): node}
    raise ValueError(f"invalid classmap leaf at {'.'.join(parts)}")


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
        elif str(required[path]).startswith("verified"):
            required[path] = "verified (inherited; present in target CSS)"
    return required


def verification_notes(
    source_key: str,
    paths: set[str],
    missing_in_target: set[str],
    live_hits: set[str],
) -> list[str]:
    live_only = missing_in_target & live_hits
    live_only_note = (
        "One CSS-only miss was observed live and remains verified."
        if len(live_only) == 1
        else f"{len(live_only)} CSS-only misses were observed live and remain verified."
    )
    return [
        f"Classmap inherited byte-for-byte from {source_key}; no migration guesses were accepted.",
        (
            f"Static verification found {len(paths - missing_in_target)}/{len(paths)} paths "
            "in the target CSS."
        ),
        live_only_note,
        (
            f"Deep CDP verification observed {len(live_hits)}/{len(paths)} paths on the "
            "routes and transient surfaces exercised by the verifier."
        ),
        "Unresolved new misses remain usable but are marked unverified; inherited stale paths stay blocked.",
    ]


def build_meta(
    source_key: str,
    target_key: str,
    spotify_version: str,
    generated: str,
    classmap: dict,
    source_meta: dict,
    static_report: dict,
    cdp_report: dict,
    missing_in_target: set[str],
    live_hits: set[str],
    overlay_entries: int,
    cdp_hit_rate: float,
) -> dict:
    paths = leaf_paths(classmap)
    live_only = missing_in_target & live_hits
    stale = sorted(set(source_meta.get("stale_leaves") or []) - live_hits)
    unverified = missing_in_target - live_hits - set(stale)
    return {
        "spotify_version": spotify_version,
        "classmap_key": target_key,
        "status": "verified",
        "generated": generated,
        "inherited_from": source_key,
        "pipeline": (
            f"inherit({source_key} -> {target_key}) + static target-CSS verification "
            "+ CDP e2e (deep)"
        ),
        "stats": {
            "leaves": len(paths),
            "inherited": len(paths),
            "static_present": len(paths - missing_in_target),
            "verified_cdp": len(live_hits),
            "live_only": len(live_only),
            "unresolved_missing": len(missing_in_target - live_hits),
            "stale": len(stale),
            "cdp_hit_rate": cdp_hit_rate,
            "overlay_entries": overlay_entries,
        },
        "required_paths": updated_required_paths(source_meta, unverified, live_hits),
        "stale_leaves": stale,
        "unverified_leaves": sorted(unverified),
        "notes": verification_notes(source_key, paths, missing_in_target, live_hits),
        "verification_summary": static_report.get("summary", {}),
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
    source_classmap = classmap_file(source_dir)
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
    meta = build_meta(
        source_key,
        target_key,
        spotify_version,
        generated,
        classmap,
        source_meta,
        static_report,
        cdp_report,
        missing_in_target,
        live_hits,
        overlay_entries,
        cdp_hit_rate,
    )

    staging_dir = Path(tempfile.mkdtemp(prefix=f".{target_key}-", dir=root))
    try:
        shutil.copy2(source_classmap, staging_dir / source_classmap.name)
        if overlay.is_file():
            shutil.copy2(overlay, staging_dir / overlay.name)
        (staging_dir / "META.json").write_text(
            json.dumps(meta, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n"
        )
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
