"""Check classmap roles after the CSS-map rewrite used during staging."""

import json
import unittest

from build_index import ROOT, classmap_file


class TopbarButtonContractTests(unittest.TestCase):
    def test_modern_topbar_buttons_keep_the_native_hitbox_after_staging(self):
        for key in sorted(ROOT.iterdir()):
            if not key.name.isdigit() or int(key.name) < 1030000:
                continue
            with self.subTest(key=key.name):
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


if __name__ == "__main__":
    unittest.main()
