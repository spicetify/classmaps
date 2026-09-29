from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from validate_classmaps import key_errors, render_json


class KeyValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.classmap = {"main": {"topbar": {"wrapper": "topbarHashAA", "retired": "retiredHashBB"}}}
        self.parent = self.write_key(
            "1020094", self.classmap, self.meta("1020094", "1.2.94.583", {"method": "derived", "key": None})
        )
        self.child_meta = self.meta("1020096", "1.2.96.518", {"method": "inherited", "key": "1020094"})
        self.child = self.write_key("1020096", self.classmap, self.child_meta)

    def tearDown(self):
        self.temp_dir.cleanup()

    def meta(self, key: str, version: str, source: dict) -> dict:
        return {
            "schema_version": 2,
            "classmap_key": key,
            "spotify_version": version,
            "status": "verified",
            "generated": "2026-08-12",
            "source": source,
            "required_paths": {"main.topbar.wrapper": "verified_cdp"},
            "stale_leaves": ["main.topbar.retired"],
            "unverified_leaves": [],
        }

    def write_key(self, key: str, classmap: dict, meta: dict) -> Path:
        key_dir = self.root / key
        key_dir.mkdir(exist_ok=True)
        (key_dir / "classmap.json").write_text(render_json(classmap))
        (key_dir / "META.json").write_text(render_json(meta))
        (key_dir / "VERIFICATION.md").write_text(f"# {key}\n")
        return key_dir

    def errors(self, key_dir: Path) -> list[str]:
        return key_errors(key_dir, root=self.root)

    def test_accepts_a_consistent_inherited_release(self):
        self.assertEqual(self.errors(self.parent), [])
        self.assertEqual(self.errors(self.child), [])

    def test_rejects_an_inherited_map_whose_bytes_differ_from_its_source(self):
        changed = {"main": {"topbar": {"wrapper": "semantic-name", "retired": "retiredHashBB"}}}
        self.write_key("1020096", changed, self.child_meta)
        self.assertIn(
            "classmap.json: inherited from 1020094 but its bytes differ", self.errors(self.child)
        )

    def test_rejects_a_leaf_listed_as_both_stale_and_unverified(self):
        self.child_meta["unverified_leaves"] = ["main.topbar.retired"]
        self.write_key("1020096", self.classmap, self.child_meta)
        self.assertIn("META.json: main.topbar.retired is both stale and unverified", self.errors(self.child))

    def test_rejects_a_required_status_that_disagrees_with_the_leaf_lists(self):
        self.child_meta["required_paths"]["main.topbar.wrapper"] = "unverified"
        self.write_key("1020096", self.classmap, self.child_meta)
        self.assertIn(
            "META.json: main.topbar.wrapper is unverified but unverified_leaves disagrees",
            self.errors(self.child),
        )

    def test_rejects_free_text_path_statuses(self):
        self.child_meta["required_paths"]["main.topbar.wrapper"] = "verified (present in target CSS)"
        self.write_key("1020096", self.classmap, self.child_meta)
        self.assertTrue(any("unknown status" in e for e in self.errors(self.child)))

    def test_rejects_empty_groups_and_padded_class_strings(self):
        self.write_key(
            "1020096", {"main": {"panel": {}, "topbar": {"wrapper": " a  b"}}}, self.child_meta
        )
        errors = self.errors(self.child)
        self.assertIn("classmap.json: main.panel: empty group", errors)
        self.assertIn(
            "classmap.json: main.topbar.wrapper: classes must be single-space separated with no padding",
            errors,
        )

    def test_rejects_non_canonical_json_and_stray_classmap_files(self):
        (self.child / "classmap.json").write_text(json.dumps(self.classmap, indent="\t"))
        (self.child / "classmap-19f856aefd5.json").write_text("{}\n")
        errors = self.errors(self.child)
        self.assertIn(
            "classmap.json: not canonical (2-space indent, sorted keys, trailing newline)", errors
        )
        self.assertIn("classmap-19f856aefd5.json: not part of the published layout", errors)

    def test_rejects_metadata_that_names_another_build(self):
        self.child_meta["spotify_version"] = "1.2.97.270"
        self.write_key("1020096", self.classmap, self.child_meta)
        self.assertIn("META.json: spotify_version does not belong to 1020096", self.errors(self.child))


if __name__ == "__main__":
    unittest.main()
