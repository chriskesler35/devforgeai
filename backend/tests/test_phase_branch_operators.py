"""Tests for _evaluate_operator covering the full operator set.

Regression: an earlier copy of _evaluate_operator was orphaned (no def
header) inside phase_templates.py, so the live function silently
returned False for not_contains / greater_than / less_than / in / not_in.
Branch conditions using those operators would never match.

These tests pin the supported operator set, with gt/lt accepted as
backwards-compatible aliases for greater_than/less_than.
"""
from app.services.phase_templates import _evaluate_operator


# ── presence ──────────────────────────────────────────────────────────────
def test_exists_true_when_not_none():
    assert _evaluate_operator("anything", "exists", None) is True


def test_exists_false_when_none():
    assert _evaluate_operator(None, "exists", None) is False


def test_not_exists_true_when_none():
    assert _evaluate_operator(None, "not_exists", None) is True


# ── equality ──────────────────────────────────────────────────────────────
def test_equals_case_insensitive():
    assert _evaluate_operator("PASS", "equals", "pass") is True


def test_not_equals():
    assert _evaluate_operator("fail", "not_equals", "pass") is True


# ── substring ─────────────────────────────────────────────────────────────
def test_contains():
    assert _evaluate_operator("hello world", "contains", "world") is True


def test_not_contains_match_returns_true():
    """Regression: orphan-only operator. Should return True when expected absent."""
    assert _evaluate_operator("hello world", "not_contains", "xyz") is True


def test_not_contains_match_returns_false():
    """Regression: orphan-only operator. Should return False when expected present."""
    assert _evaluate_operator("hello world", "not_contains", "world") is False


# ── numeric ───────────────────────────────────────────────────────────────
def test_greater_than_verbose():
    """Regression: orphan version used 'greater_than'; the live truncated impl used 'gt'."""
    assert _evaluate_operator(5, "greater_than", 3) is True


def test_less_than_verbose():
    """Regression: orphan version used 'less_than'; the live truncated impl used 'lt'."""
    assert _evaluate_operator(2, "less_than", 7) is True


def test_gt_alias_still_works():
    """Backwards compat: pre-fix code used 'gt'; keep accepting it."""
    assert _evaluate_operator(5, "gt", 3) is True


def test_lt_alias_still_works():
    """Backwards compat: pre-fix code used 'lt'; keep accepting it."""
    assert _evaluate_operator(2, "lt", 7) is True


def test_greater_than_non_numeric_returns_false():
    assert _evaluate_operator("abc", "greater_than", 3) is False


# ── membership ────────────────────────────────────────────────────────────
def test_in_list_match():
    """Regression: orphan-only operator. Match against list."""
    assert _evaluate_operator("b", "in", ["a", "b", "c"]) is True


def test_in_list_miss():
    assert _evaluate_operator("z", "in", ["a", "b", "c"]) is False


def test_not_in_list_match():
    """Regression: orphan-only operator."""
    assert _evaluate_operator("z", "not_in", ["a", "b", "c"]) is True


# ── unknown ───────────────────────────────────────────────────────────────
def test_unknown_operator_returns_false():
    assert _evaluate_operator("anything", "no_such_op", None) is False
