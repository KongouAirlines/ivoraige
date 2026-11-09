# SPDX-License-Identifier: AGPL-3.0-only
"""Optional installed-engine regression; no model, PDF, or downloaded assets.

Run explicitly with a matching BabelDOC runtime. The regular preflight tests
remain dependency-free. PyMuPDF's built-in Helvetica supplies real font metrics.
"""
import importlib.metadata as metadata
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as N
from unittest.mock import patch

from layout_fit import fitted_layout_scope


def require_layout_runtime(babeldoc, pymupdf, python):
    expected = ("0.6.4", "1.26.7", (3, 13))
    actual = (babeldoc, pymupdf, tuple(python[:2]))
    if actual != expected:
        raise RuntimeError(f"Layout regression requires {expected}; found {actual}")


class InstalledLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reject mismatched runtimes before importing the optional engine.
        require_layout_runtime(metadata.version("babeldoc"), metadata.version("PyMuPDF"), sys.version_info)
        cls.cache = tempfile.TemporaryDirectory(prefix="ivoraige-layout-test-")
        with patch.object(Path, "home", return_value=Path(cls.cache.name)):
            import pymupdf
            from babeldoc import const
            from babeldoc.format.pdf.document_il.il_version_1 import Box, PdfStyle
            from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting, TypesettingUnit
        require_layout_runtime(const.__version__, pymupdf.VersionBind, sys.version_info)
        cls.font = pymupdf.Font("helv")
        cls.Box, cls.Style = Box, PdfStyle
        cls.Engine, cls.Unit = Typesetting, TypesettingUnit

    @classmethod
    def tearDownClass(cls):
        cls.cache.cleanup()

    def run_layout(self, enabled, *, bottom=-22, width=70, height=24,
                   after_bottom=None, override_scale=None, right=None, after_right=None):
        owner = object.__new__(self.Engine)
        owner.is_cjk = False
        owner.font_mapper = N(base_font=self.font)
        owner.get_max_bottom_space = lambda box, page: bottom
        owner.get_max_right_space = lambda box, page: box.x2 if right is None else right
        paragraph = N(box=self.Box(x=0,y=0,x2=width,y2=height),
                      first_line_indent=False, debug_id="synthetic")
        style = self.Style(font_id="SYNTHETIC", font_size=12)
        def units():
            return [self.Unit(unicode=c, font=self.font, font_size=12,
                              style=style, xobj_id=-1)
                    for c in "An invented heading with ordinary alphabetic words"]
        page = N(pdf_curve=[], pdf_form=[])
        with fitted_layout_scope(self.Engine, enabled):
            best = owner._get_optimal_scale(paragraph, page, units())
            self.assertEqual(paragraph.box.y, 0)
            if after_bottom is not None:
                owner.get_max_bottom_space = lambda box, page: after_bottom
            if after_right is not None:
                owner.get_max_right_space = lambda box, page: after_right
            owner.retypeset_with_precomputed_scale(
                paragraph, page, units(), best if override_scale is None else override_scale)
        return best, paragraph

    def test_fit_box_and_scale_stay_together_without_skipping_real_fit(self):
        best, original = self.run_layout(False)
        fixed_best, fixed = self.run_layout(True)
        self.assertAlmostEqual(best, .7)
        self.assertAlmostEqual(original.scale, .65)
        self.assertAlmostEqual(fixed_best, .7)
        self.assertAlmostEqual(fixed.scale, .7)
        self.assertEqual(fixed.box.y, -20)
        self.assertTrue(fixed.pdf_paragraph_composition)
        for composition in fixed.pdf_paragraph_composition:
            box = composition.pdf_character.box
            self.assertGreaterEqual(box.x, fixed.box.x - 1e-8)
            self.assertLessEqual(box.x2, fixed.box.x2 + 1e-8)
            self.assertGreaterEqual(box.y, fixed.box.y - 1e-8)
            self.assertLessEqual(box.y2, fixed.box.y2 + 1e-8)

    def test_obstacle_or_global_scale_change_keeps_upstream_fallback(self):
        for kwargs in ({"after_bottom": -5}, {"override_scale": .6},
                       {"bottom": 0}, {"width": 300, "height": 40}):
            with self.subTest(kwargs=kwargs):
                _, baseline = self.run_layout(False, **kwargs)
                _, fixed = self.run_layout(True, **kwargs)
                self.assertAlmostEqual(fixed.scale, baseline.scale)
                self.assertEqual(fixed.box, baseline.box)

    def test_horizontal_space_and_later_blocker_keep_boundaries(self):
        _, fixed = self.run_layout(True, bottom=0, right=160)
        self.assertGreater(fixed.box.x2, 70)
        self.assertLessEqual(fixed.box.x2, 155)
        for composition in fixed.pdf_paragraph_composition:
            self.assertLessEqual(composition.pdf_character.box.x2, fixed.box.x2 + 1e-8)
        _, baseline = self.run_layout(False, bottom=0, right=160, after_right=75)
        _, blocked = self.run_layout(True, bottom=0, right=160, after_right=75)
        self.assertEqual(blocked.box, baseline.box)
        self.assertAlmostEqual(blocked.scale, baseline.scale)


if __name__ == "__main__":
    unittest.main()
