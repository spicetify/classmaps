#!/usr/bin/env python3
"""Checks every key directory against the published layout:

    <key>/classmap.json     nested groups of class-name leaves (required)
    <key>/css-map.json      flat hash -> semantic overlay (optional)
    <key>/META.json         schema_version 2 metadata (optional for legacy keys)
    <key>/VERIFICATION.md   verification history (required beside META.json)

JSON files must be in canonical form (`render_json`). META claims are checked
against the files: leaf paths exist, the leaf lists are disjoint and agree with
`required_paths`, and an inherited map is byte-identical to its source.

    python3 scripts/validate_classmaps.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_DIR = re.compile(r"^\d{7}$")
META_FIELDS = {
    "schema_version",
    "classmap_key",
    "spotify_version",
    "status",
    "generated",
    "source",
    "required_paths",
    "stale_leaves",
    "unverified_leaves",
}
STATUSES = {"verified", "unverified"}
SOURCE_METHODS = {"derived", "inherited"}
PATH_STATUSES = {
    "verified_cdp",
    "verified_targeted",
    "verified_static",
    "verified",
    "unverified",
}
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
SPICETIFY_NAME = re.compile(r"(main|x)-[A-Za-z0-9]+-")
KNOWN_FILES = {"classmap.json", "css-map.json", "META.json", "VERIFICATION.md"}


def render_json(value: object) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"


def version_to_key(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:\..*)?", version)
    if not match:
        raise ValueError(f"need major.minor.patch, got {version!r}")
    major, minor, patch = (int(part) for part in match.groups())
    return f"{major}{minor:02d}{patch:04d}"


def leaf_values(node: object, parts: tuple[str, ...] = ()) -> dict[str, str]:
    if isinstance(node, dict):
        values: dict[str, str] = {}
        for key, value in node.items():
            values.update(leaf_values(value, (*parts, key)))
        return values
    if isinstance(node, str):
        return {".".join(parts): node}
    raise ValueError(f"invalid classmap leaf at {'.'.join(parts)}")


def classmap_errors(node: object, parts: tuple[str, ...] = ()) -> list[str]:
    where = ".".join(parts) or "<root>"
    if isinstance(node, str):
        if not node or node != " ".join(node.split()):
            return [f"{where}: classes must be single-space separated with no padding"]
        return []
    if not isinstance(node, dict):
        return [f"{where}: must be a group or a class string"]
    if not node:
        return [f"{where}: empty group"]
    errors: list[str] = []
    for key, value in node.items():
        if not key or "." in key:
            errors.append(f"{where}: group key {key!r} must be non-empty and contain no dots")
            continue
        errors += classmap_errors(value, (*parts, key))
    return errors


def load_canonical(path: Path, errors: list[str]) -> object | None:
    raw = path.read_bytes().decode("utf-8")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as e:
        errors.append(f"{path.name}: {e}")
        return None
    if raw != render_json(value):
        errors.append(f"{path.name}: not canonical (2-space indent, sorted keys, trailing newline)")
    return value


def string_list(meta: dict, field: str, leaves: dict[str, str], errors: list[str]) -> set[str]:
    items = meta.get(field)
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        errors.append(f"META.json: {field} must be a list of paths")
        return set()
    if items != sorted(set(items)):
        errors.append(f"META.json: {field} must be sorted and unique")
    for path in items:
        if path not in leaves:
            errors.append(f"META.json: {field} names {path}, which is not a classmap leaf")
    return set(items)


def meta_errors(meta: object, key: str, leaves: dict[str, str], root: Path, classmap: bytes) -> list[str]:
    if not isinstance(meta, dict):
        return ["META.json: must be an object"]
    errors: list[str] = []
    fields = set(meta)
    if fields != META_FIELDS:
        errors.append(
            f"META.json: fields must be exactly {sorted(META_FIELDS)}; "
            f"missing={sorted(META_FIELDS - fields)}, extra={sorted(fields - META_FIELDS)}"
        )
    if meta.get("schema_version") != 2:
        errors.append("META.json: schema_version must be 2")
    if meta.get("classmap_key") != key:
        errors.append(f"META.json: classmap_key must be {key}")
    try:
        if version_to_key(str(meta.get("spotify_version", ""))) != key:
            errors.append(f"META.json: spotify_version does not belong to {key}")
    except ValueError as e:
        errors.append(f"META.json: spotify_version: {e}")
    if meta.get("status") not in STATUSES:
        errors.append(f"META.json: status must be one of {sorted(STATUSES)}")
    generated = str(meta.get("generated"))
    try:
        if not ISO_DATE.fullmatch(generated):
            raise ValueError(generated)
        date.fromisoformat(generated)
    except ValueError:
        errors.append("META.json: generated must be a YYYY-MM-DD date")

    source = meta.get("source")
    if not isinstance(source, dict) or set(source) != {"method", "key"}:
        errors.append("META.json: source must be {method, key}")
    elif source["method"] not in SOURCE_METHODS:
        errors.append(f"META.json: source.method must be one of {sorted(SOURCE_METHODS)}")
    elif source["key"] is not None and not (
        isinstance(source["key"], str) and KEY_DIR.match(source["key"]) and source["key"] < key
    ):
        errors.append("META.json: source.key must be null or an older seven-digit key")
    elif source["method"] == "inherited":
        parent = root / str(source["key"]) / "classmap.json"
        if source["key"] is None or not parent.is_file():
            errors.append("META.json: an inherited map needs an existing source.key")
        elif source["key"][:3] != key[:3]:
            errors.append("META.json: an inherited map must come from the same major.minor family")
        elif parent.read_bytes() != classmap:
            errors.append(f"classmap.json: inherited from {source['key']} but its bytes differ")

    stale = string_list(meta, "stale_leaves", leaves, errors)
    unverified = string_list(meta, "unverified_leaves", leaves, errors)
    for path in sorted(stale & unverified):
        errors.append(f"META.json: {path} is both stale and unverified")

    required = meta.get("required_paths")
    if not isinstance(required, dict):
        errors.append("META.json: required_paths must be an object")
        return errors
    for path, status in required.items():
        if path not in leaves:
            errors.append(f"META.json: required path {path} is not a classmap leaf")
        if status not in PATH_STATUSES:
            errors.append(f"META.json: required path {path} has unknown status {status!r}")
        if path in stale:
            errors.append(f"META.json: required path {path} is stale")
        if (status == "unverified") != (path in unverified):
            errors.append(f"META.json: {path} is {status} but unverified_leaves disagrees")
    return errors


def key_errors(key_dir: Path, key: str | None = None, root: Path = ROOT) -> list[str]:
    key = key or key_dir.name
    errors: list[str] = []
    for extra in sorted(p.name for p in key_dir.iterdir() if p.name not in KNOWN_FILES):
        errors.append(f"{extra}: not part of the published layout")

    classmap_path = key_dir / "classmap.json"
    if not classmap_path.is_file():
        return errors + ["classmap.json: missing"]
    classmap = load_canonical(classmap_path, errors)
    if classmap is None:
        return errors
    tree_errors = classmap_errors(classmap)
    errors += [f"classmap.json: {e}" for e in tree_errors]
    if tree_errors:
        return errors
    leaves = leaf_values(classmap)

    semantic: set[str] = set()
    overlay_path = key_dir / "css-map.json"
    if overlay_path.is_file():
        overlay = load_canonical(overlay_path, errors)
        if overlay is not None and not (
            isinstance(overlay, dict)
            and all(isinstance(k, str) and isinstance(v, str) and k and v for k, v in overlay.items())
        ):
            errors.append("css-map.json: must map class names to semantic names")
        elif isinstance(overlay, dict):
            semantic = set(overlay.values())
    for path, value in leaves.items():
        for token in value.split():
            if token in semantic or SPICETIFY_NAME.match(token):
                errors.append(f"classmap.json: {path} stores the Spicetify name {token}, not the stock class")

    meta_path = key_dir / "META.json"
    if meta_path.is_file():
        meta = load_canonical(meta_path, errors)
        if meta is not None:
            errors += meta_errors(meta, key, leaves, root, classmap_path.read_bytes())
        if not (key_dir / "VERIFICATION.md").is_file():
            errors.append("VERIFICATION.md: required beside META.json")
    return errors


def main() -> int:
    failed = False
    keys = sorted(p for p in ROOT.iterdir() if p.is_dir() and KEY_DIR.match(p.name))
    for key_dir in keys:
        for error in key_errors(key_dir):
            print(f"{key_dir.name}/{error}", file=sys.stderr)
            failed = True
    if failed:
        return 1
    print(f"{len(keys)} classmap keys ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
