# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ivoraige contributors

"""Synthetic line-split regressions against installed BabelDOC 0.6.4."""

import unittest
from pathlib import Path
from unittest.mock import patch

with patch.object(Path, "home", return_value=Path("/tmp/ivoraige-underscore-test-cache")):
    from babeldoc.format.pdf.document_il.il_version_1 import (
        Box, PdfCharacter, PdfParagraph, PdfParagraphComposition, PdfStyle,
        VisualBbox,
    )
    from babeldoc.format.pdf.document_il.midend.paragraph_finder import ParagraphFinder
    from babeldoc.format.pdf.document_il.midend.styles_and_formulas import StylesAndFormulas

from underscore_line import (UNDERSCORE_LINE_POLICY, UNDERSCORE_LINE_POLICY_V2,
                             underscore_line_scope)


def glyph(symbol, x, y, *, font="F", size=10, xobj=1, vertical=False,
          nominal_y=None, visual_height=1):
    box = Box(x=x, y=y, x2=x + 0.8, y2=y + visual_height)
    nominal = Box(x=x, y=y if nominal_y is None else nominal_y,
                  x2=x + 0.8, y2=(y + 1 if nominal_y is None else nominal_y + size))
    return PdfCharacter(
        char_unicode=symbol, box=nominal, visual_bbox=VisualBbox(box=box),
        pdf_style=PdfStyle(font_id=font, font_size=size),
        xobj_id=xobj, vertical=vertical, render_order=int(x * 10),
    )


def lines(chars, enabled, policy=UNDERSCORE_LINE_POLICY):
    paragraph = PdfParagraph(pdf_paragraph_composition=[
        PdfParagraphComposition(pdf_character=char) for char in chars
    ])
    finder = object.__new__(ParagraphFinder)
    finder.update_paragraph_data(paragraph)
    with underscore_line_scope(ParagraphFinder, enabled=enabled, policy=policy):
        finder._split_paragraph_into_lines(paragraph, set())
    return [[char.char_unicode for char in part.pdf_line.pdf_character]
            for part in paragraph.pdf_paragraph_composition if part.pdf_line]


class UnderscoreLineTests(unittest.TestCase):
    def test_only_bracketed_low_ascii_identifier_joins_baseline(self):
        chars = [glyph("X", 0, 8), glyph("_", 1, 0), glyph("Y", 2, 8)]
        self.assertEqual(UNDERSCORE_LINE_POLICY, "ascii-base-v1")
        self.assertEqual(lines(chars, False), [["X", "Y"], ["_"]])
        self.assertEqual(lines(chars, True), [["X", "_", "Y"]])
        self.assertEqual([char.box.y for char in chars], [8, 0, 8])

    def test_v2_uses_matching_nominal_baselines_when_ink_centers_differ(self):
        chars = [glyph("X", 0, 8, size=12, nominal_y=8, visual_height=3),
                 glyph("_", 1, 0, size=12, nominal_y=8),
                 glyph("Y", 2, 8, size=12, nominal_y=8, visual_height=6)]
        self.assertEqual(UNDERSCORE_LINE_POLICY_V2, "ascii-base-v2")
        self.assertEqual(lines(chars, False), [["X", "Y"], ["_"]])
        self.assertEqual(lines(chars, True), [["X", "Y"], ["_"]])
        self.assertEqual(lines(chars, True, UNDERSCORE_LINE_POLICY_V2),
                         [["X", "_", "Y"]])
        self.assertEqual([char.box.y for char in chars], [8, 8, 8])
        self.assertEqual([char.visual_bbox.box.y for char in chars], [8, 0, 8])
        self.assertEqual([char.render_order for char in chars], [0, 10, 20])
        styles = object.__new__(StylesAndFormulas)
        grouped = styles._group_classified_characters(
            [(char, True, False) for char in chars], 0)
        self.assertEqual([char.char_unicode for char in grouped[0].pdf_formula.pdf_character],
                         ["X", "_", "Y"])

    def test_non_identifier_and_distinct_baselines_keep_upstream_split(self):
        cases = [
            [glyph("_", 0, 0), glyph("X", 1, 8), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0), glyph("2", 2, 0)],
            [glyph("X", 0, 8), glyph("_", 1, 0), glyph("Y", 2, 0)],
            [glyph("א", 0, 8), glyph("_", 1, 0), glyph("ב", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0), glyph("+", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0, font="G"), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0, size=8), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0, xobj=2), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 0, vertical=True), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 20, 0), glyph("Y", 21, 8)],
            [glyph("X", 0, 8), glyph("_", 1, -20), glyph("Y", 2, 8)],
            [glyph("X", 0, 8), glyph("_", 1, 20), glyph("Y", 2, 8)],
        ]
        for chars in cases:
            with self.subTest(chars=[char.char_unicode for char in chars],
                              y=[char.box.y for char in chars]):
                self.assertEqual(lines(chars, True, UNDERSCORE_LINE_POLICY_V2),
                                 lines(chars, False))

    def test_v2_rejects_invalid_and_mismatched_nominal_boxes(self):
        chars = [glyph("X", 0, 8, nominal_y=8), glyph("_", 1, 0, nominal_y=8),
                 glyph("Y", 2, 10, nominal_y=8)]
        self.assertEqual(lines(chars, True, UNDERSCORE_LINE_POLICY_V2), lines(chars, False))
        for damaged in (float("nan"), float("inf"), -5):
            chars = [glyph("X", 0, 8, nominal_y=8),
                     glyph("_", 1, 0, nominal_y=8),
                     glyph("Y", 2, 8, nominal_y=8)]
            chars[1].box.y2 = damaged
            with self.subTest(damaged=damaged):
                self.assertEqual(lines(chars, True, UNDERSCORE_LINE_POLICY_V2),
                                 lines(chars, False))
        chars = [glyph("X", 0, 8, nominal_y=8),
                 glyph("_", 1, 0, nominal_y=6),
                 glyph("Y", 2, 8, nominal_y=8)]
        self.assertEqual(lines(chars, True, UNDERSCORE_LINE_POLICY_V2),
                         lines(chars, False))

    def test_scope_restores_upstream_method_on_exit_and_error(self):
        original = ParagraphFinder._split_paragraph_into_lines
        with underscore_line_scope(ParagraphFinder, enabled=False):
            self.assertIs(ParagraphFinder._split_paragraph_into_lines, original)
        with self.assertRaisesRegex(ValueError, "synthetic"):
            with underscore_line_scope(ParagraphFinder):
                self.assertIsNot(ParagraphFinder._split_paragraph_into_lines, original)
                raise ValueError("synthetic")
        self.assertIs(ParagraphFinder._split_paragraph_into_lines, original)


if __name__ == "__main__":
    unittest.main()
