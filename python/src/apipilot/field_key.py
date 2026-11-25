"""Field-key normalization — mirrors FieldKeyNormalizer (C#).

Normalizes a model-binding field key to canonical camelCase form:
strips a single leading "$." JSONPath prefix, camelCases each
dot-separated segment, preserves ``[i]`` bracket indices verbatim.
"""

from __future__ import annotations

from collections.abc import Callable


def _lower_first(s: str) -> str:
    return s[:1].lower() + s[1:] if s else s


def _camel_case_segment(segment: str) -> str:
    bracket = segment.find("[")
    if bracket >= 0:
        base, suffix = segment[:bracket], segment[bracket:]
    else:
        base, suffix = segment, ""
    return _lower_first(base) + suffix


def normalize_field_key(raw: str) -> str:
    """Normalizes a raw field key to canonical camelCase form."""
    if not raw:
        return raw
    key = raw.removeprefix("$.")
    return ".".join(_camel_case_segment(seg) for seg in key.split("."))


def resolve_key_transform(
    custom: Callable[[str], str] | None,
) -> Callable[[str], str]:
    """Resolves the effective key transform: custom wins, else normalize.

    Mirrors ValidationKeyTransforms.Resolve — single resolver shared by
    all paths.
    """
    return custom if custom is not None else normalize_field_key
