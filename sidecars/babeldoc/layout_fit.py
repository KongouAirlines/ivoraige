# SPDX-License-Identifier: AGPL-3.0-only
"""Keep BabelDOC's successful dry-run geometry with its scale, not its content.

This scoped bridge uses the pinned engine's own fit and available-space checks.
It neither substitutes a layout algorithm nor forces a minimum font size.
"""
import copy
import math
import threading
from contextlib import contextmanager

LAYOUT_FIT_POLICY = "fit-box-v1"


def rectangle(box):
    if box is None:
        return None
    values = tuple(getattr(box, name, None) for name in ("x", "y", "x2", "y2"))
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        return None
    if values[0] >= values[2] or values[1] >= values[3]:
        return None
    return values


def permitted_box(owner, paragraph, page, plan, scale):
    """Recheck expansion against the current page; changed inputs use upstream."""
    original, fitted, fitted_scale = plan
    current = rectangle(paragraph.box)
    target = rectangle(fitted)
    if current != original or target is None or not math.isclose(
        scale, fitted_scale, rel_tol=0, abs_tol=1e-9
    ):
        return None
    x, y, x2, y2 = current
    tx, ty, tx2, ty2 = target
    if tx != x or ty2 != y2 or ty > y or tx2 < x2:
        return None
    # Match the pinned engine's expansion margins. Never reuse stale free space.
    if ty < y and ty < owner.get_max_bottom_space(paragraph.box, page) + 2:
        return None
    if tx2 > x2:
        vertical_box = copy.deepcopy(paragraph.box)
        vertical_box.y = ty
        if tx2 > owner.get_max_right_space(vertical_box, page) - 5:
            return None
    return copy.deepcopy(fitted) if target != current else None


@contextmanager
def fitted_layout_scope(engine_class, enabled=True):
    if not enabled:
        yield
        return
    original_optimal = engine_class._get_optimal_scale
    original_layout = engine_class._layout_typesetting_units
    original_render = engine_class.retypeset_with_precomputed_scale
    active = threading.local()
    plans = {}

    def layout(owner, units, box, scale, line_skip, paragraph, *args, **kwargs):
        result = original_layout(owner, units, box, scale, line_skip, paragraph, *args, **kwargs)
        probe = getattr(active, "probe", None)
        if probe is not None and probe["owner"] is owner and probe["paragraph"] is paragraph and result[1]:
            probe["fit"] = (copy.deepcopy(box), scale)
        return result

    def optimal(owner, paragraph, page, units, *args, **kwargs):
        probe = {"owner": owner, "paragraph": paragraph, "fit": None}
        previous = getattr(active, "probe", None)
        original_box = rectangle(paragraph.box)
        active.probe = probe
        try:
            scale = original_optimal(owner, paragraph, page, units, *args, **kwargs)
            if original_box is not None and probe["fit"] is not None:
                box, fit_scale = probe["fit"]
                if math.isclose(scale, fit_scale, rel_tol=0, abs_tol=1e-9):
                    plans[(id(owner), id(paragraph))] = (original_box, box, scale)
            return scale
        finally:
            active.probe = previous

    def render(owner, paragraph, page, units, precomputed_scale, *args, **kwargs):
        plan = plans.pop((id(owner), id(paragraph)), None)
        if plan is not None:
            try:
                box = permitted_box(owner, paragraph, page, plan, precomputed_scale)
            except Exception:
                box = None  # Failed space checks retain the original engine path.
            if box is not None:
                paragraph.box = box
        # The original method still fits every unit and may reduce scale further.
        return original_render(owner, paragraph, page, units, precomputed_scale, *args, **kwargs)

    engine_class._get_optimal_scale = optimal
    engine_class._layout_typesetting_units = layout
    engine_class.retypeset_with_precomputed_scale = render
    try:
        yield
    finally:
        engine_class._get_optimal_scale = original_optimal
        engine_class._layout_typesetting_units = original_layout
        engine_class.retypeset_with_precomputed_scale = original_render
