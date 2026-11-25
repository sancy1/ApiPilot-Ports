"""JSON serialization modes — mirrors ApiPilot.AspNetCore.Serialization (C#).

Applies naming policies, enum/date modes, and null handling to the data
payload before envelope serialization. Envelope keys are always pinned
camelCase regardless of the naming policy.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal

NamingPolicy = Literal["camelCase", "snake_case", "passthrough"]
EnumMode = Literal["string", "number"]
DateMode = Literal["iso8601", "unixSeconds"]


def _to_camel_case(key: str) -> str:
    """Lowercase the leading uppercase run (System.Text.Json camelCase)."""
    if not key:
        return key
    i = 0
    while i < len(key) and "A" <= key[i] <= "Z":
        i += 1
    if i > 1 and i < len(key) and "a" <= key[i] <= "z":
        i -= 1
    return key[:i].lower() + key[i:]


def _to_snake_case(key: str) -> str:
    out: list[str] = []
    for i, ch in enumerate(key):
        if "A" <= ch <= "Z":
            if i > 0:
                out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def apply_naming_policy(key: str, policy: str) -> str:
    if policy == "snake_case":
        return _to_snake_case(key)
    if policy == "passthrough":
        return key
    return _to_camel_case(key)


def _effective_policy(camel_case: bool, naming_policy: str | None) -> str:
    if naming_policy:
        return naming_policy
    return "camelCase" if camel_case else "passthrough"


def transform_value(
    value: Any,
    *,
    camel_case: bool,
    indent: bool | None,
    enum_mode: str,
    date_mode: str,
    property_naming_policy: str | None,
    dictionary_key_policy: str | None,
    ignore_nulls: bool,
) -> Any:
    """Recursively transform a payload per the serialization options."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if date_mode == "unixSeconds":
            dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        if enum_mode == "number":
            return value.value
        return value.name
    if isinstance(value, dict):
        policy = _effective_policy(camel_case, property_naming_policy)
        out: dict[str, Any] = {}
        for k, v in value.items():
            if ignore_nulls and v is None:
                continue
            out[apply_naming_policy(str(k), policy)] = transform_value(
                v,
                camel_case=camel_case,
                indent=indent,
                enum_mode=enum_mode,
                date_mode=date_mode,
                property_naming_policy=property_naming_policy,
                dictionary_key_policy=dictionary_key_policy,
                ignore_nulls=ignore_nulls,
            )
        return out
    if isinstance(value, (list, tuple)):
        return [
            transform_value(
                item,
                camel_case=camel_case,
                indent=indent,
                enum_mode=enum_mode,
                date_mode=date_mode,
                property_naming_policy=property_naming_policy,
                dictionary_key_policy=dictionary_key_policy,
                ignore_nulls=ignore_nulls,
            )
            for item in value
        ]
    return value


def dumps(payload: Any, options: Any = None) -> bytes:
    """Serialize an envelope to JSON bytes.

    Envelope keys are pinned — this function never applies naming policies
    to them. Callers transform the data payload via `transform_data`
    before wrapping it in an envelope.
    """
    indent = getattr(options, "indent", None) if options is not None else None
    if indent:
        text = json.dumps(payload, indent=2, ensure_ascii=False)
    else:
        text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return text.encode("utf-8")


def transform_data(data: Any, options: Any) -> Any:
    """Apply JsonOptions serialization modes to a data payload."""
    return transform_value(
        data,
        camel_case=getattr(options, "camel_case", True),
        indent=getattr(options, "indent", None),
        enum_mode=getattr(options, "enum_mode", "string") or "string",
        date_mode=getattr(options, "date_mode", "iso8601") or "iso8601",
        property_naming_policy=getattr(options, "property_naming_policy", None),
        dictionary_key_policy=(
            getattr(options, "dictionary_key_policy", None)
            or getattr(options, "property_naming_policy", None)
        ),
        ignore_nulls=getattr(options, "ignore_nulls", False),
    )
