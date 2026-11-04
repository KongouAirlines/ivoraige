# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ivoraige contributors

"""Keep a narrowly identified low ASCII underscore with its word during line split."""

import math
from contextlib import contextmanager


UNDERSCORE_LINE_POLICY = "ascii-base-v1"


def _ascii_letter(char):
    value = char.char_unicode
    return isinstance(value, str) and len(value) == 1 and (
        "A" <= value <= "Z" or "a" <= value <= "z"
    )


def _candidate_bounds(chars, bounds):
    """Return per-glyph bounds for clear, same-style ASCII identifier underscores."""
    replacements = {}
    for index in range(1, len(chars) - 1):
        left, underscore, right = chars[index - 1:index + 2]
        if any(char is None for char in (left, underscore, right)):
            continue
        if underscore.char_unicode != "_" or not (
            _ascii_letter(left) and _ascii_letter(right)
        ):
            continue
        if any(char.vertical is not False for char in (left, underscore, right)):
            continue
        if left.xobj_id is None or not (
            left.xobj_id == underscore.xobj_id == right.xobj_id
        ):
            continue
        styles = [char.pdf_style for char in (left, underscore, right)]
        if any(style is None or style.font_id is None or style.font_size is None
               for style in styles):
            continue
        if not (styles[0].font_id == styles[1].font_id == styles[2].font_id
                and styles[0].font_size == styles[1].font_size == styles[2].font_size):
            continue
        em = styles[0].font_size
        if not isinstance(em, (int, float)) or not math.isfinite(em) or em <= 0:
            continue
        boxes = [char.visual_bbox.box if char.visual_bbox else None
                 for char in (left, underscore, right)]
        if any(box is None or not all(
            isinstance(value, (int, float)) and math.isfinite(value)
            for value in (box.x, box.y, box.x2, box.y2)
        ) or box.x2 <= box.x or box.y2 <= box.y
               for box in boxes):
            continue
        lbox, ubox, rbox = boxes
        if not (lbox.x < ubox.x < rbox.x):
            continue
        gaps = (ubox.x - lbox.x2, rbox.x - ubox.x2)
        if any(gap < -0.15 * em or gap > 0.5 * em for gap in gaps):
            continue
        ly1, ly2 = bounds(left)
        uy1, uy2 = bounds(underscore)
        ry1, ry2 = bounds(right)
        if not all(isinstance(value, (int, float)) and math.isfinite(value)
                   for value in (ly1, ly2, uy1, uy2, ry1, ry2)):
            continue
        if ly2 <= ly1 or uy2 <= uy1 or ry2 <= ry1:
            continue
        left_center = (ly1 + ly2) / 2
        right_center = (ry1 + ry2) / 2
        underscore_center = (uy1 + uy2) / 2
        if (abs(left_center - right_center) > 0.1 * em
                or underscore_center > min(left_center, right_center) - 0.2 * em
                or max(left_center, right_center) - underscore_center > em):
            continue
        replacements[id(underscore)] = (min(ly1, ry1), max(ly2, ry2))
    return replacements


def split_paragraph_with_underscore_bounds(finder, paragraph, formula_font_ids,
                                          original_split):
    """Run upstream's splitter with temporary bounds only for eligible underscores."""
    chars = [
        composition.pdf_character
        for composition in paragraph.pdf_paragraph_composition or []
    ]
    original_bounds = finder._get_effective_y_bounds
    replacements = _candidate_bounds(chars, original_bounds)
    if not replacements:
        return original_split(finder, paragraph, formula_font_ids)
    had_override = "_get_effective_y_bounds" in vars(finder)
    if had_override:
        previous_override = vars(finder)["_get_effective_y_bounds"]

    def guarded_bounds(char):
        return replacements.get(id(char), original_bounds(char))

    finder._get_effective_y_bounds = guarded_bounds
    try:
        return original_split(finder, paragraph, formula_font_ids)
    finally:
        if had_override:
            finder._get_effective_y_bounds = previous_override
        else:
            del finder._get_effective_y_bounds


@contextmanager
def underscore_line_scope(paragraph_finder_class, enabled=True):
    """Apply the local split guard for one BabelDOC capture or replay invocation."""
    if not enabled:
        yield
        return
    original_split = paragraph_finder_class._split_paragraph_into_lines

    def guarded_split(finder, paragraph, formula_font_ids):
        return split_paragraph_with_underscore_bounds(
            finder, paragraph, formula_font_ids, original_split
        )

    paragraph_finder_class._split_paragraph_into_lines = guarded_split
    try:
        yield
    finally:
        paragraph_finder_class._split_paragraph_into_lines = original_split
