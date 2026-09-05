from __future__ import annotations

import json
import hashlib
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import promote_inherited as promote  # noqa: E402
import build_index  # noqa: E402


class PromoteInheritedTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.source = self.root / "1020094"
        self.source.mkdir()
        self.classmap = {
            "main": {
                "topbar": {"wrapper": "topbarHashAA", "retired": "retiredHashBB"},
                "playbar": {"indicator": "indicatorHashCC"},
            }
        }
        (self.source / "classmap-source.json").write_text(json.dumps(self.classmap) + "\n")
        (self.source / "css-map.json").write_text('{"customHash": "semantic-name"}\n')
        (self.source / "META.json").write_text(
            json.dumps(
                {
                    "spotify_version": "1.2.94.583",
                    "classmap_key": "1020094",
                    "status": "verified",
                    "stale_leaves": ["main.topbar.retired"],
                    "required_paths": {
                        "main.topbar.wrapper": "verified",
                        "main.playbar.indicator": "verified",
                    },
                }
            )
            + "\n"
        )
        self.static_report = {
            "target": {
                "spotify_version": "1.2.96.518",
                "css_sha256": "a" * 64,
                "classmap_sha256": hashlib.sha256(
                    (self.source / "classmap-source.json").read_bytes()
                ).hexdigest(),
            },
            "summary": {"needs_manual_check": 1, "missing_in_css": 2},
            "rows": [
                {
                    "path": "main.topbar.wrapper",
                    "class": "topbarHashAA",
                    "in_target_css": True,
                    "verdict": "needs_manual_check",
                },
                {
                    "path": "main.topbar.retired",
                    "class": "retiredHashBB",
                    "in_target_css": False,
                    "verdict": "missing_in_css",
                },
                {
                    "path": "main.playbar.indicator",
                    "class": "indicatorHashCC",
                    "in_target_css": False,
                    "verdict": "missing_in_css",
                },
            ],
        }
        self.cdp_report = {
            "cdp": {"browser": {"User-Agent": "Spotify/1.2.96.518 Chrome/146"}},
            "classmap": {
                "sha256": self.static_report["target"]["classmap_sha256"],
            },
            "mode": "both",
            "deep": True,
            "navigation": {
                "attempted": 8,
                "succeeded": 8,
                "failed": [],
            },
            "summary": {"total": 3, "hits": 1, "hitRate": 0.3333},
            "rows": [
                {"path": "main.topbar.wrapper", "hash": "topbarHashAA", "hit": True},
                {"path": "main.topbar.retired", "hash": "retiredHashBB", "hit": False},
                {"path": "main.playbar.indicator", "hash": "indicatorHashCC", "hit": False},
            ],
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_promotes_an_unchanged_map_and_records_new_stale_paths(self):
        target = promote.promote_inherited_release(
            root=self.root,
            source_key="1020094",
            spotify_version="1.2.96.518",
            static_report=self.static_report,
            cdp_report=self.cdp_report,
            generated="2026-08-12",
            min_hit_rate=0.25,
        )

        self.assertEqual(target, self.root / "1020096")
        self.assertEqual(json.loads((target / "classmap-source.json").read_text()), self.classmap)
        self.assertEqual(
            json.loads((target / "css-map.json").read_text()),
            {"customHash": "semantic-name"},
        )
        meta = json.loads((target / "META.json").read_text())
        self.assertNotIn(b"\r", (target / "META.json").read_bytes())
        self.assertEqual(meta["status"], "verified")
        self.assertEqual(meta["inherited_from"], "1020094")
        self.assertEqual(
            meta["stale_leaves"],
            ["main.topbar.retired"],
        )
        self.assertEqual(meta["unverified_leaves"], ["main.playbar.indicator"])
        self.assertEqual(meta["stats"]["static_present"], 1)
        self.assertEqual(meta["stats"]["verified_cdp"], 1)
        self.assertEqual(meta["required_paths"]["main.topbar.wrapper"], "verified_cdp")
        self.assertEqual(meta["required_paths"]["main.playbar.indicator"], "unverified")

    def test_generated_index_uses_lf_and_hashes_published_bytes(self):
        index_path = self.root / "index.json"
        with (
            mock.patch.object(build_index, "ROOT", self.root),
            mock.patch.object(build_index, "INDEX", index_path),
            mock.patch.object(sys, "argv", ["build_index.py"]),
        ):
            self.assertEqual(build_index.main(), 0)
        index_bytes = index_path.read_bytes()
        self.assertNotIn(b"\r", index_bytes)
        entry = json.loads(index_bytes)["keys"]["1020094"]
        for field in ("classmap", "cssMapOverlay", "meta"):
            self.assertEqual(
                entry[field]["sha256"],
                hashlib.sha256((self.source / entry[field]["file"]).read_bytes()).hexdigest(),
            )

    def test_refuses_a_report_from_another_spotify_version(self):
        self.cdp_report["cdp"]["browser"]["User-Agent"] = "Spotify/1.2.95.453 Chrome/146"

        with self.assertRaisesRegex(ValueError, "does not match Spotify 1.2.96.518"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_a_spotify_version_that_only_has_the_requested_prefix(self):
        self.cdp_report["cdp"]["browser"]["User-Agent"] = "Spotify/1.2.96.5189 Chrome/146"

        with self.assertRaisesRegex(ValueError, "does not match Spotify 1.2.96.518"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_source_metadata_that_does_not_match_the_source_key(self):
        source_meta = json.loads((self.source / "META.json").read_text())
        source_meta["classmap_key"] = "1020092"
        (self.source / "META.json").write_text(json.dumps(source_meta) + "\n")

        with self.assertRaisesRegex(ValueError, "source metadata key"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_live_hit_overrides_a_css_only_missing_result(self):
        for row in self.cdp_report["rows"]:
            if row["path"] == "main.playbar.indicator":
                row["hit"] = True
        self.cdp_report["summary"].update({"hits": 2, "hitRate": 0.6667})

        target = promote.promote_inherited_release(
            root=self.root,
            source_key="1020094",
            spotify_version="1.2.96.518",
            static_report=self.static_report,
            cdp_report=self.cdp_report,
            generated="2026-08-12",
            min_hit_rate=0.25,
        )

        meta = json.loads((target / "META.json").read_text())
        self.assertEqual(meta["stale_leaves"], ["main.topbar.retired"])
        self.assertEqual(meta["unverified_leaves"], [])
        self.assertEqual(meta["required_paths"]["main.playbar.indicator"], "verified_cdp")
        self.assertEqual(meta["stats"]["live_only"], 1)
        self.assertEqual(meta["stats"]["unresolved_missing"], 1)
        self.assertTrue(any("One CSS-only miss was observed live" in note for note in meta["notes"]))

    def test_refuses_a_live_report_below_the_required_hit_rate(self):
        self.cdp_report["rows"][0]["hit"] = False
        self.cdp_report["summary"].update({"hits": 0, "hitRate": 0.0})

        with self.assertRaisesRegex(ValueError, "below required 0.2500"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_a_summary_that_disagrees_with_rows(self):
        self.cdp_report["rows"][0]["hit"] = False

        with self.assertRaisesRegex(ValueError, "summary does not match rows"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_non_finite_rates_and_bypass_thresholds(self):
        self.cdp_report["summary"]["hitRate"] = float("nan")
        with self.assertRaisesRegex(ValueError, "finite"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
        self.cdp_report["summary"]["hitRate"] = 0.3333
        with self.assertRaisesRegex(ValueError, "at least 0.25"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0,
            )

    def test_refuses_shallow_or_mismatched_reports(self):
        self.cdp_report["deep"] = False
        with self.assertRaisesRegex(ValueError, "deep CDP"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_missing_mode_or_failed_deep_navigation(self):
        del self.cdp_report["mode"]
        with self.assertRaisesRegex(ValueError, "mode 'both'"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
        self.cdp_report["mode"] = "both"
        self.cdp_report["navigation"] = {
            "attempted": 8,
            "succeeded": 0,
            "failed": [f"step-{index}" for index in range(8)],
        }
        with self.assertRaisesRegex(ValueError, "deep navigation coverage"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_inconsistent_navigation_ledger(self):
        self.cdp_report["navigation"] = {"attempted": 8, "succeeded": 9, "failed": []}
        with self.assertRaisesRegex(ValueError, "navigation ledger"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
        self.cdp_report["navigation"] = {"attempted": 8, "succeeded": 7, "failed": []}
        with self.assertRaisesRegex(ValueError, "navigation ledger"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
    def test_refuses_static_summary_that_disagrees_with_rows(self):
        self.static_report["summary"] = {"missing_in_css": 0, "needs_manual_check": 3}
        with self.assertRaisesRegex(ValueError, "static summary does not match rows"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
        self.cdp_report["deep"] = True
        self.static_report["target"]["spotify_version"] = "1.2.95.453"
        with self.assertRaisesRegex(ValueError, "static report does not match"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_refuses_report_leaf_or_digest_mismatch(self):
        self.cdp_report["rows"][0]["hash"] = "anotherHashZZ"
        with self.assertRaisesRegex(ValueError, "does not match classmap"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )
        self.cdp_report["rows"][0]["hash"] = "topbarHashAA"
        self.cdp_report["classmap"]["sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "classmap digest"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )

    def test_live_verification_recovers_an_inherited_stale_path(self):
        for row in self.cdp_report["rows"]:
            if row["path"] == "main.topbar.retired":
                row["hit"] = True
        self.cdp_report["summary"].update({"hits": 2, "hitRate": 0.6667})

        target = promote.promote_inherited_release(
            root=self.root,
            source_key="1020094",
            spotify_version="1.2.96.518",
            static_report=self.static_report,
            cdp_report=self.cdp_report,
            generated="2026-08-12",
            min_hit_rate=0.25,
        )

        meta = json.loads((target / "META.json").read_text())
        self.assertNotIn("main.topbar.retired", meta["stale_leaves"])

    def test_failed_copy_leaves_no_partial_target(self):
        with mock.patch.object(promote.shutil, "copy2", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                promote.promote_inherited_release(
                    root=self.root,
                    source_key="1020094",
                    spotify_version="1.2.96.518",
                    static_report=self.static_report,
                    cdp_report=self.cdp_report,
                    generated="2026-08-12",
                    min_hit_rate=0.25,
                )
        self.assertFalse((self.root / "1020096").exists())
        self.assertEqual(list(self.root.glob(".1020096-*")), [])

    def test_index_failure_rolls_back_target_and_index(self):
        index = self.root / "index.json"
        index.write_text('{"old": true}\n')
        with mock.patch.object(
            promote.subprocess,
            "run",
            side_effect=subprocess.CalledProcessError(1, ["build_index.py"]),
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                promote.publish_inherited_release(
                    root=self.root,
                    source_key="1020094",
                    spotify_version="1.2.96.518",
                    static_report=self.static_report,
                    cdp_report=self.cdp_report,
                    generated="2026-08-12",
                    min_hit_rate=0.25,
                )
        self.assertFalse((self.root / "1020096").exists())
        self.assertEqual(index.read_text(), '{"old": true}\n')

    def test_refuses_to_overwrite_an_existing_target(self):
        (self.root / "1020096").mkdir()

        with self.assertRaisesRegex(FileExistsError, "1020096 already exists"):
            promote.promote_inherited_release(
                root=self.root,
                source_key="1020094",
                spotify_version="1.2.96.518",
                static_report=self.static_report,
                cdp_report=self.cdp_report,
                generated="2026-08-12",
                min_hit_rate=0.25,
            )


if __name__ == "__main__":
    unittest.main()
