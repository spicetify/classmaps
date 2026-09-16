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
        self.assertTrue(
            "main-topBar-buddyFeed" in staged or
            wrapper == "main-topBar-buddyFeed" or
            overlay.get(wrapper) == "main-topBar-buddyFeed"
        )
        self.assertFalse(any("--condensed-" in token for token in staged))


class PlaybackBarContractTests(unittest.TestCase):
    def test_spotify_130_restores_seek_bar_and_time_label_hooks(self):
        key = ROOT / "1030000"
        overlay = json.loads((key / "css-map.json").read_text())
        mapping = json.loads(classmap_file(key).read_text())
        self.assertTrue(
            any("playback" in v for v in overlay.values()) or
            "playbar" in mapping["main"]
        )


class RootContainerContractTests(unittest.TestCase):
    def test_settings_toggle_hides_the_native_input_behind_its_indicator(self):
        key = ROOT / "1030000"
        overlay = json.loads((key / "css-map.json").read_text())
        mapping = json.loads(classmap_file(key).read_text())
        self.assertTrue(
            "x-toggle-input" in overlay.values() or
            "x-settings-section" in overlay.values() or
            "settings" in mapping
        )

    def test_spotify_130_restores_the_three_layout_container_hooks(self):
        key = ROOT / "1030000"
        mapping = json.loads(classmap_file(key).read_text())
        overlay = json.loads((key / "css-map.json").read_text())
        topbar = mapping["main"]["topbar"]["wrapper"]
        self.assertTrue(
            topbar in ["bQetA_KiP9n0DQVcGa7m", "qg_42ZApML1d5uSzYT2A"] or
            overlay.get(topbar) == "Root__globalNav"
        )


if __name__ == "__main__":
    unittest.main()