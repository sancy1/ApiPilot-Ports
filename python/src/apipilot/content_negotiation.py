"""Accept / Content-Type evaluation — mirrors ApiPilotContentNegotiationMiddleware (C#).

Pure decision logic: the adapter supplies header values and method;
this module returns the negotiation status (200 / 406 / 415).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(slots=True)
class ContentNegotiationOptions:
    """Content negotiation configuration."""

    acceptable_response_media_types: tuple[str, ...] = ("application/json",)
    accept_wildcard: bool = True
    acceptable_request_media_types: tuple[str, ...] = ("application/json",)
    accept_missing_content_type: bool = False
    body_carrying_methods: tuple[str, ...] = ("POST", "PUT", "PATCH")


DEFAULT_CONTENT_NEGOTIATION_OPTIONS = ContentNegotiationOptions()

NegotiationStatus = Literal[200, 406, 415]
CheckResult = Literal["accept", "reject", "skip"]


@dataclass(frozen=True, slots=True)
class NegotiationDecision:
    """Full negotiation result."""

    accept_result: CheckResult
    content_type_result: CheckResult
    status: NegotiationStatus


def _contains_ci(values: tuple[str, ...], value: str) -> bool:
    lowered = value.lower()
    return any(v.lower() == lowered for v in values)


def extract_media_type(header_value: str) -> str:
    """Takes the segment before the first ';', trimmed."""
    semi = header_value.find(";")
    segment = header_value if semi < 0 else header_value[:semi]
    return segment.strip()


def is_accept_header_acceptable(
    header_value: str | None, options: ContentNegotiationOptions
) -> bool:
    """Accept header check.

    - missing/empty → accept
    - comma-split, trim, skip empty
    - media type = before first ';' (q= and params ignored)
    - ``*/*`` accepted iff accept_wildcard (exact match)
    - otherwise case-insensitive membership
    - type wildcards like ``application/*`` are NOT honored
    """
    if header_value is None or header_value == "":
        return True

    for raw_entry in header_value.split(","):
        entry = raw_entry.strip()
        if not entry:
            continue
        media_type = extract_media_type(entry)
        if not media_type:
            continue
        if options.accept_wildcard and media_type == "*/*":
            return True
        if _contains_ci(options.acceptable_response_media_types, media_type):
            return True

    return False


def is_content_type_acceptable(
    header_value: str, options: ContentNegotiationOptions
) -> bool:
    """Content-Type check for a single header value."""
    media_type = extract_media_type(header_value)
    return _contains_ci(options.acceptable_request_media_types, media_type)


def evaluate_content_negotiation(
    accept: str | None,
    content_type: str | None,
    method: str,
    options: ContentNegotiationOptions,
) -> NegotiationDecision:
    """Full negotiation decision for a request.

    1. Accept check (only when header present) → 406
    2. Content-Type check only for body-carrying methods → 415
    Missing Content-Type on body-carrying method → reject unless
    accept_missing_content_type.
    """
    accept_result: CheckResult = (
        "accept" if is_accept_header_acceptable(accept, options) else "reject"
    )
    if accept_result == "reject":
        return NegotiationDecision(
            accept_result=accept_result, content_type_result="skip", status=406
        )

    is_body_carrying = any(
        m.lower() == method.lower() for m in options.body_carrying_methods
    )
    if not is_body_carrying:
        return NegotiationDecision(
            accept_result=accept_result, content_type_result="skip", status=200
        )

    if content_type is None or content_type == "":
        if options.accept_missing_content_type:
            return NegotiationDecision(
                accept_result=accept_result, content_type_result="accept", status=200
            )
        return NegotiationDecision(
            accept_result=accept_result, content_type_result="reject", status=415
        )

    if not is_content_type_acceptable(content_type, options):
        return NegotiationDecision(
            accept_result=accept_result, content_type_result="reject", status=415
        )

    return NegotiationDecision(
        accept_result=accept_result, content_type_result="accept", status=200
    )
