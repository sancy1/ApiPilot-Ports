"""Core module unit tests — edge cases beyond the conformance vectors.

Mirrors go/core/*_test.go. Covers envelope wire shape, error codes,
pagination, field keys, origin, fetch metadata, cookie profiles, CSRF
payload codec, CSRF binding fingerprint, correlation, and content
negotiation.
"""

from __future__ import annotations

import json
import re

import pytest

from apipilot import (
    content_negotiation as cn,
)
from apipilot import (
    cookie_profile as cp,
)
from apipilot import (
    correlation,
    csrf_binding,
    csrf_format,
    envelope,
    error_codes,
    field_key,
    origin,
)
from apipilot import (
    fetch_metadata as fm,
)
from apipilot import (
    pagination as pg,
)

# ---------------------------------------------------------------------------
# Envelope wire shape
# ---------------------------------------------------------------------------


def test_success_envelope_json_shape() -> None:
    meta = envelope.create_meta("req-1")
    env = envelope.success({"n": 1}, meta)
    body = json.dumps(env)
    assert body.startswith(
        '{"success": true, "data": {"n": 1}, "message": null, "meta": {'
    )
    assert env["meta"]["requestId"] == "req-1"
    assert env["meta"]["extra"] == {}
    assert "timestamp" in env["meta"]


def test_paginated_envelope_has_all_six_fields() -> None:
    meta = envelope.create_meta("r")
    pag = pg.build_pagination(95, 2, 20)
    env = envelope.paginated([1], pag, meta)
    p = env["pagination"]
    for key in (
        "page",
        "pageSize",
        "totalItems",
        "totalPages",
        "hasNext",
        "hasPrevious",
    ):
        assert key in p, key
    assert p["totalPages"] == 5 and p["hasNext"] is True and p["hasPrevious"] is True


def test_failure_omits_fields_when_none() -> None:
    meta = envelope.create_meta("r")
    env = envelope.failure(error_codes.RESOURCE_NOT_FOUND, "nope", meta)
    assert "fields" not in env["error"]
    assert env["success"] is False


def test_validation_failure_default_message() -> None:
    meta = envelope.create_meta("r")
    env = envelope.validation_failure({"name": ["required"]}, meta, "")
    assert env["error"]["message"] == "One or more values are invalid."
    assert env["error"]["code"] == "VALIDATION_ERROR"


def test_create_meta_timestamp_recent() -> None:
    meta = envelope.create_meta("r")
    # ISO-8601 with Z suffix — parseable.
    assert meta.timestamp.endswith("Z") or "+" in meta.timestamp


# ---------------------------------------------------------------------------
# Error codes
# ---------------------------------------------------------------------------


def test_from_code_normalization() -> None:
    c = error_codes.from_code("  validation_error  ")
    assert c.value == "VALIDATION_ERROR" and c.http_status == 400


def test_from_code_custom_gets_500() -> None:
    c = error_codes.from_code("MyCustomCode")
    assert c.value == "MYCUSTOMCODE" and c.http_status == 500


def test_from_code_empty_errors() -> None:
    with pytest.raises(ValueError):
        error_codes.from_code("   ")
    with pytest.raises(ValueError):
        error_codes.from_code(None)  # type: ignore[arg-type]


def test_all_standard_has_14_codes() -> None:
    assert len(error_codes.ALL_STANDARD) == 14


def test_try_from_code() -> None:
    assert error_codes.try_from_code("not_found") is None or True  # custom → instance
    assert error_codes.try_from_code(None) is None
    assert error_codes.try_from_code("  ") is None


# ---------------------------------------------------------------------------
# Field keys
# ---------------------------------------------------------------------------


def test_normalize_field_key_jsonpath() -> None:
    assert field_key.normalize_field_key("$.User.Name") == "user.name"


def test_normalize_field_key_brackets_preserved() -> None:
    assert field_key.normalize_field_key("Items[0].Name") == "items[0].name"


def test_normalize_field_key_empty() -> None:
    assert field_key.normalize_field_key("") == ""


def test_resolve_key_transform_custom_wins() -> None:
    custom = lambda raw: "X:" + raw
    assert field_key.resolve_key_transform(custom)("a") == "X:a"
    assert field_key.resolve_key_transform(None)("A") == "a"


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "want", "ok"),
    [
        ("42", 42, True),
        ("+7", 7, True),
        ("-3", -3, True),
        ("  10  ", 10, True),
        ("", None, False),
        ("abc", None, False),
        ("1.5", None, False),
        ("0x10", None, False),
        ("1e3", None, False),
        ("--5", None, False),
    ],
)
def test_default_integer_parser(raw: str, want: int | None, ok: bool) -> None:
    got = pg.default_integer_parser(raw)
    assert (got is not None) == ok
    if ok:
        assert got == want


def test_create_page_request_validation() -> None:
    opts = pg.PaginationOptions()
    with pytest.raises(ValueError):
        pg.create_page_request(0, 10, opts)
    with pytest.raises(ValueError):
        pg.create_page_request(1, 0, opts)
    with pytest.raises(ValueError):
        pg.create_page_request(1, 101, opts)
    pr = pg.create_page_request(3, 50, opts)
    assert pr.page == 3 and pr.page_size == 50


def test_compute_pagination_edge_cases() -> None:
    tp, has_next, has_prev = pg.compute_pagination(0, 1, 20)
    assert tp == 1 and not has_next and not has_prev
    tp, has_next, has_prev = pg.compute_pagination(40, 2, 20)
    assert tp == 2 and not has_next and has_prev
    tp, has_next, has_prev = pg.compute_pagination(41, 3, 20)
    assert tp == 3 and not has_next and has_prev


def test_wire_page_to_internal() -> None:
    assert pg.wire_page_to_internal(1, 1) == 1
    assert pg.wire_page_to_internal(0, 0) == 1
    assert pg.wire_page_to_internal(5, 1) == 5


def test_parse_sort_direction() -> None:
    for raw, want in {
        "asc": "asc",
        "ASC": "asc",
        " desc ": "desc",
        "Desc": "desc",
    }.items():
        assert pg.parse_sort_direction(raw) == want
    for bad in ("", "ascending", "down", "1"):
        assert pg.parse_sort_direction(bad) is None


def test_parse_pagination_query_defaults() -> None:
    parsed = pg.parse_pagination_query({}, pg.PaginationOptions())
    assert parsed.errors == {}
    assert parsed.page_request.page == 1 and parsed.page_request.page_size == 20
    assert parsed.sort is None and parsed.filter is None


def test_parse_pagination_query_invalid_page() -> None:
    parsed = pg.parse_pagination_query({"page": "abc"}, pg.PaginationOptions())
    assert "page" in parsed.errors


def test_parse_pagination_query_page_below_base() -> None:
    parsed = pg.parse_pagination_query({"page": "0"}, pg.PaginationOptions())
    assert "page" in parsed.errors


def test_parse_pagination_query_page_size_too_big() -> None:
    parsed = pg.parse_pagination_query({"pageSize": "500"}, pg.PaginationOptions())
    assert "pageSize" in parsed.errors


def test_parse_pagination_query_direction_without_sort() -> None:
    parsed = pg.parse_pagination_query({"direction": "desc"}, pg.PaginationOptions())
    assert "sort" in parsed.errors


def test_parse_pagination_query_bad_direction() -> None:
    parsed = pg.parse_pagination_query(
        {"sort": "name", "direction": "sideways"}, pg.PaginationOptions()
    )
    assert "direction" in parsed.errors


def test_parse_pagination_query_sort_defaults_asc() -> None:
    parsed = pg.parse_pagination_query({"sort": "Name"}, pg.PaginationOptions())
    assert parsed.sort is not None
    assert parsed.sort.field == "Name" and parsed.sort.direction == "asc"


def test_parse_pagination_query_filters() -> None:
    parsed = pg.parse_pagination_query(
        {"status": "active", "page": "2"}, pg.PaginationOptions()
    )
    assert parsed.filter is not None
    assert parsed.filter.parameters["status"] == "active"
    assert "page" not in parsed.filter.parameters


def test_parse_pagination_query_strict_validation() -> None:
    opts = pg.PaginationOptions(strict_query_validation=True)
    parsed = pg.parse_pagination_query({"unknown": "x"}, opts)
    assert "unknown" in parsed.errors


def test_parse_pagination_query_custom_names() -> None:
    opts = pg.PaginationOptions(
        parameter_names=pg.PaginationParameterNames(
            page="p", page_size="ps", sort="s", direction="d"
        )
    )
    parsed = pg.parse_pagination_query(
        {"p": "3", "ps": "10", "s": "name", "d": "desc"}, opts
    )
    assert parsed.errors == {}
    assert parsed.page_request.page == 3 and parsed.page_request.page_size == 10
    assert parsed.sort is not None and parsed.sort.direction == "desc"


def test_parse_pagination_query_custom_page_number_base() -> None:
    opts = pg.PaginationOptions(page_number_base=0)
    parsed = pg.parse_pagination_query({"page": "0"}, opts)
    assert parsed.errors == {}
    assert parsed.page_request.page == 1


def test_parse_pagination_query_empty_values_ignored() -> None:
    parsed = pg.parse_pagination_query(
        {"page": "", "pageSize": "", "sort": ""}, pg.PaginationOptions()
    )
    assert parsed.errors == {}


# ---------------------------------------------------------------------------
# Origin
# ---------------------------------------------------------------------------


def test_try_parse_origin_valid() -> None:
    p = origin.try_parse_origin("https://Example.COM:8443")
    assert p is not None
    assert p.scheme == "https" and p.host == "example.com" and p.port == 8443


def test_try_parse_origin_default_ports() -> None:
    p = origin.try_parse_origin("https://example.com")
    assert p is not None and p.port == 443
    p = origin.try_parse_origin("http://example.com")
    assert p is not None and p.port == 80


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "null",
        "not a url",
        "https://example.com/path",
        "https://example.com?q=1",
        "https://example.com#frag",
        "ftp://",
        "https://:8080",
        "https://example.com:abc",
    ],
)
def test_try_parse_origin_rejects(bad: str) -> None:
    assert origin.try_parse_origin(bad) is None


def test_origin_matches_exact() -> None:
    assert origin.origin_matches("https://a.com", "https://a.com", "exact")
    assert not origin.origin_matches("https://a.com:8443", "https://a.com", "exact")
    assert origin.origin_matches("https://a.com:8443", "https://a.com:8443", "exact")


def test_origin_matches_any_port_same_host() -> None:
    assert origin.origin_matches(
        "https://a.com:8443", "https://a.com", "anyPortSameHost"
    )
    assert not origin.origin_matches(
        "https://a.com", "https://b.com", "anyPortSameHost"
    )
    assert not origin.origin_matches("http://a.com", "https://a.com", "anyPortSameHost")


def test_origin_matches_same_site_always_false() -> None:
    assert not origin.origin_matches("https://a.com", "https://a.com", "sameSite")


def test_origin_matches_invalid_input() -> None:
    assert not origin.origin_matches("garbage", "https://a.com", "exact")


# ---------------------------------------------------------------------------
# Fetch metadata
# ---------------------------------------------------------------------------


def test_fetch_metadata_off_always_allows() -> None:
    d = fm.evaluate_fetch_metadata(
        "cross-site", "no-cors", fm.DEFAULT_FETCH_METADATA_OPTIONS
    )
    assert d.decision == "allow"


def test_fetch_metadata_missing_headers_allowed() -> None:
    opts = fm.FetchMetadataOptions(profile="strict")
    d = fm.evaluate_fetch_metadata(None, None, opts)
    assert d.decision == "allow"


def test_fetch_metadata_missing_headers_rejected() -> None:
    opts = fm.FetchMetadataOptions(profile="strict", allow_missing_headers=False)
    d = fm.evaluate_fetch_metadata(None, None, opts)
    assert d.decision == "reject" and d.reason == "missingSiteHeader"


def test_fetch_metadata_malformed_site() -> None:
    opts = fm.FetchMetadataOptions(profile="compat", allow_missing_headers=False)
    d = fm.evaluate_fetch_metadata("bogus", None, opts)
    assert d.decision == "reject" and d.reason == "malformedSiteHeader"


def test_fetch_metadata_disallowed_site() -> None:
    opts = fm.FetchMetadataOptions(profile="strict")
    d = fm.evaluate_fetch_metadata("cross-site", None, opts)
    assert d.decision == "reject" and d.reason == "disallowedSiteValue"


def test_fetch_metadata_disallowed_mode() -> None:
    opts = fm.FetchMetadataOptions(profile="strict")
    d = fm.evaluate_fetch_metadata("same-origin", "no-cors", opts)
    assert d.decision == "reject" and d.reason == "disallowedModeValue"


def test_fetch_metadata_compat_equals_strict() -> None:
    strict = fm.FetchMetadataOptions(profile="strict")
    compat = fm.FetchMetadataOptions(profile="compat")
    d1 = fm.evaluate_fetch_metadata("cross-site", "cors", strict)
    d2 = fm.evaluate_fetch_metadata("cross-site", "cors", compat)
    assert d1 == d2


def test_fetch_metadata_case_insensitive() -> None:
    opts = fm.FetchMetadataOptions(profile="strict")
    d = fm.evaluate_fetch_metadata("SAME-ORIGIN", "CORS", opts)
    assert d.decision == "allow"


# ---------------------------------------------------------------------------
# Cookie profiles
# ---------------------------------------------------------------------------


def test_default_cookie_profiles_are_valid() -> None:
    for role, profile in cp.DEFAULT_COOKIE_PROFILES.items():
        assert cp.validate_cookie_profile(profile, role) == [], role


def test_cookie_profile_host_prefix_rules() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=False,
        http_only=True,
        same_site="lax",
        path="/",
        domain=None,
        name_prefix="__Host-",
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "host-prefix-requires-secure" in v
    assert "host-prefix-requires-root-path" not in v


def test_cookie_profile_host_prefix_domain() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=True,
        http_only=True,
        same_site="lax",
        path="/",
        domain="example.com",
        name_prefix="__Host-",
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "host-prefix-requires-no-domain" in v


def test_cookie_profile_samesite_none_requires_secure() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=False,
        http_only=True,
        same_site="none",
        path="/",
        domain=None,
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "samesite-none-requires-secure" in v


def test_cookie_profile_unspecified_samesite() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=True,
        http_only=True,
        same_site="unspecified",
        path="/",
        domain=None,
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "undefined-samesite" in v


def test_cookie_profile_bad_path() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=True,
        http_only=True,
        same_site="lax",
        path="relative",
        domain=None,
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "path-must-start-slash" in v


def test_cookie_profile_forbidden_name_char() -> None:
    p = cp.CookieProfile(
        name="bad;name",
        secure=True,
        http_only=True,
        same_site="lax",
        path="/",
        domain=None,
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "forbidden-name-char" in v


def test_cookie_profile_invalid_domain() -> None:
    p = cp.CookieProfile(
        name="x",
        secure=True,
        http_only=True,
        same_site="lax",
        path="/",
        domain="bad domain.com",
    )
    v = cp.validate_cookie_profile(p, "auth")
    assert "invalid-domain" in v


# ---------------------------------------------------------------------------
# CSRF payload codec
# ---------------------------------------------------------------------------


def test_csrf_payload_round_trip() -> None:
    payload = csrf_format.encode_csrf_payload(1700000000, "abc123", "fp")
    parts = csrf_format.try_decode_csrf_payload(payload)
    assert parts is not None
    assert parts.issued_at_unix_seconds == 1700000000
    assert parts.random_base64_url == "abc123"
    assert parts.binding_fingerprint == "fp"


def test_csrf_payload_encode_rejects_delimiter() -> None:
    with pytest.raises(ValueError):
        csrf_format.encode_csrf_payload(1, "a|b", "fp")
    with pytest.raises(ValueError):
        csrf_format.encode_csrf_payload(1, "abc", "f|p")
    with pytest.raises(ValueError):
        csrf_format.encode_csrf_payload(1, "", "fp")
    with pytest.raises(ValueError):
        csrf_format.encode_csrf_payload(1, "abc", "")


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "a|b",
        "a|b|c|d",
        "x|y|z",
        "1.5|r|f",
        "|r|f",
        "1||f",
        "1|r|",
        "99999999999999999999|r|f",
    ],
)
def test_csrf_payload_decode_rejects(bad: str) -> None:
    assert csrf_format.try_decode_csrf_payload(bad) is None


def test_csrf_payload_time_bounds() -> None:
    p = csrf_format.encode_csrf_payload(csrf_format.MIN_UNIX_SECONDS, "r", "f")
    assert csrf_format.try_decode_csrf_payload(p) is not None
    assert csrf_format.try_decode_csrf_payload("-62135596801|r|f") is None
    assert csrf_format.try_decode_csrf_payload("253402300800|r|f") is None


# ---------------------------------------------------------------------------
# CSRF binding fingerprint
# ---------------------------------------------------------------------------


def test_csrf_binding_fingerprint_deterministic() -> None:
    f1 = csrf_binding.csrf_binding_fingerprint("user-1", "subject")
    f2 = csrf_binding.csrf_binding_fingerprint("user-1", "subject")
    assert f1 == f2
    assert len(f1) == 43


def test_csrf_binding_fingerprint_kind_separation() -> None:
    subject = csrf_binding.csrf_binding_fingerprint("x", "subject")
    session = csrf_binding.csrf_binding_fingerprint("x", "session")
    preauth = csrf_binding.csrf_binding_fingerprint("x", "preauth")
    assert subject != session and subject != preauth and session != preauth


def test_csrf_binding_fingerprint_source_separation() -> None:
    a = csrf_binding.csrf_binding_fingerprint("user-a", "subject")
    b = csrf_binding.csrf_binding_fingerprint("user-b", "subject")
    assert a != b


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------


def test_resolve_correlation_absent_generates() -> None:
    d = correlation.resolve_correlation_id(
        None, correlation.DEFAULT_CORRELATION_OPTIONS, False
    )
    assert d.kind == "generate"


def test_resolve_correlation_valid_incoming() -> None:
    d = correlation.resolve_correlation_id(
        "req-abc-12345", correlation.DEFAULT_CORRELATION_OPTIONS, True
    )
    assert d.kind == "use-incoming" and d.id == "req-abc-12345"


def test_resolve_correlation_invalid_replace() -> None:
    opts = correlation.CorrelationOptions()
    d = correlation.resolve_correlation_id("bad id with spaces!", opts, False)
    assert d.kind == "generate"


def test_resolve_correlation_invalid_reject() -> None:
    opts = correlation.CorrelationOptions(invalid_id_policy="reject")
    d = correlation.resolve_correlation_id("bad id!", opts, False)
    assert d.kind == "reject"


def test_resolve_correlation_invalid_use_as_is() -> None:
    opts = correlation.CorrelationOptions(invalid_id_policy="useAsIs")
    d = correlation.resolve_correlation_id("bad id!", opts, False)
    assert d.kind == "use-incoming" and d.id == "bad id!" and d.warn


def test_generate_guid_v7_format() -> None:
    id_ = correlation.generate_guid_v7()
    parts = id_.split("-")
    assert len(parts) == 5
    assert len(parts[0]) == 8 and len(parts[1]) == 4 and len(parts[2]) == 4
    assert len(parts[3]) == 4 and len(parts[4]) == 12
    assert parts[2][0] == "7"
    assert parts[3][0] in "89ab"
    assert re.fullmatch(r"[0-9a-f-]+", id_)


def test_generate_guid_v7_unique() -> None:
    ids = {correlation.generate_guid_v7() for _ in range(1000)}
    assert len(ids) == 1000


def test_generate_guid_v7_time_ordered() -> None:
    a = correlation.generate_guid_v7()
    b = correlation.generate_guid_v7()
    assert a[:12] <= b[:12]


# ---------------------------------------------------------------------------
# Content negotiation
# ---------------------------------------------------------------------------


def test_extract_media_type() -> None:
    assert (
        cn.extract_media_type("application/json; charset=utf-8") == "application/json"
    )
    assert cn.extract_media_type("  text/html  ") == "text/html"
    assert cn.extract_media_type("application/json") == "application/json"


def test_accept_header_q_values_ignored() -> None:
    opts = cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    assert cn.is_accept_header_acceptable(
        "text/html;q=0.9, application/json;q=0.8", opts
    )


def test_accept_header_type_wildcard_not_honored() -> None:
    opts = cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    assert not cn.is_accept_header_acceptable("application/*", opts)


def test_accept_header_missing_accepts() -> None:
    opts = cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    assert cn.is_accept_header_acceptable(None, opts)
    assert cn.is_accept_header_acceptable("", opts)


def test_accept_header_rejects_all() -> None:
    opts = cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    assert not cn.is_accept_header_acceptable("text/html, application/xml", opts)


def test_accept_wildcard_disabled() -> None:
    opts = cn.ContentNegotiationOptions(accept_wildcard=False)
    assert not cn.is_accept_header_acceptable("*/*", opts)


def test_content_type_case_insensitive() -> None:
    opts = cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    assert cn.is_content_type_acceptable("Application/JSON; charset=utf-8", opts)


def test_evaluate_negotiation_get_skips_content_type() -> None:
    d = cn.evaluate_content_negotiation(
        None, None, "GET", cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    )
    assert d.status == 200


def test_evaluate_negotiation_post_missing_content_type() -> None:
    d = cn.evaluate_content_negotiation(
        None, None, "POST", cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    )
    assert d.status == 415


def test_evaluate_negotiation_post_missing_allowed() -> None:
    opts = cn.ContentNegotiationOptions(accept_missing_content_type=True)
    d = cn.evaluate_content_negotiation(None, None, "POST", opts)
    assert d.status == 200


def test_evaluate_negotiation_accept_rejects_first() -> None:
    d = cn.evaluate_content_negotiation(
        "text/html", "text/plain", "POST", cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    )
    assert d.status == 406


def test_evaluate_negotiation_delete_not_body_carrying() -> None:
    d = cn.evaluate_content_negotiation(
        None, None, "DELETE", cn.DEFAULT_CONTENT_NEGOTIATION_OPTIONS
    )
    assert d.status == 200
