"""Check classmap roles after the CSS-map rewrite used during staging."""

import json
import unittest

from build_index import ROOT, classmap_file


class TopbarButtonContractTests(unittest.TestCase):
    def test_spotify_130_topbar_buttons_keep_the_native_hitbox_after_staging(self):
        key = ROOT / "1030000"
        mapping = json.loads(classmap_file(key).read_text())
        overlay = json.loads((key / "css-map.json").read_text())
        wrapper = mapping["main"]["topbar"]["right"]["button_t"]["wrapper"]
        staged = [overlay.get(token, token) for token in wrapper.split()]
        self.assertIn(
            "main-topBar-buddyFeed", staged,
            "The toolbar wrapper must retain the native button hitbox, "
            "not just a generic Encore class that exists in the DOM.",
        )
        self.assertFalse(
            any("--condensed-" in token for token in staged),
            "Mapped classes must not strip the icon-only button padding.",
        )


class PlaybackBarContractTests(unittest.TestCase):
    def test_spotify_130_restores_seek_bar_and_time_label_hooks(self):
        overlay = json.loads((ROOT / "1030000" / "css-map.json").read_text())
        # Roles checked against the stock CSS and live playback controls.
        expected = {
            "Ox6fJ7l6WeB1wD0MqHXb": "playback-bar",
            "LppHcR524PsiPr4sz5IV": "playback-bar__progress-time-elapsed",
            "TcCS0BhwDXw_s2HufffR": "main-playbackBarRemainingTime-container",
        }
        for source, target in expected.items():
            with self.subTest(control=target):
                self.assertEqual(overlay.get(source), target)
                self.assertEqual(list(overlay.values()).count(target), 1)


class RootContainerContractTests(unittest.TestCase):
    def test_settings_toggle_hides_the_native_input_behind_its_indicator(self):
        overlay = json.loads((ROOT / "1030000" / "css-map.json").read_text())
        self.assertEqual(overlay.get("utdiMuyxdKvPowN1CIBs"), "x-toggle-input")

    def test_spotify_130_restores_the_three_layout_container_hooks(self):
        overlay = json.loads((ROOT / "1030000" / "css-map.json").read_text())
        # Verified against stock grid-area declarations and live child controls.
        expected = {
            "bQetA_KiP9n0DQVcGa7m": "Root__globalNav",
            "PIP22o58Crv8RXY4wB2o": "Root__nav-bar",
            "itzKVxWhS4n59fp_KIVc": "Root__now-playing-bar",
        }
        for source, target in expected.items():
            with self.subTest(container=target):
                self.assertEqual(overlay.get(source), target)
                self.assertEqual(list(overlay.values()).count(target), 1)


if __name__ == "__main__":
    unittest.main()
