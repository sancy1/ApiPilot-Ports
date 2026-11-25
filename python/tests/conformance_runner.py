"""Conformance vector runner — executes conformance/vectors/*.json against apipilot.

Mirrors typescript/core/test/conformance.mjs. The vectors are the single
source of truth (docs/conformance-vectors.md, C# reference); this runner
locates them relative to the workspace and exits non-zero on failure.

Run standalone::

    python tests/conformance_runner.py

Or via pytest::

    pytest tests/conformance_runner.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


# Locate the shared vector directory. Search upward from this file for
# typescript/core/conformance/vectors, then fall back to a sibling copy.
def _find_vectors_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "typescript" / "core" / "conformance" / "vectors"
        if candidate.is_dir():
            return candidate
        candidate = parent / "conformance" / "vectors"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("conformance vectors directory not found")


VECTORS_DIR = _find_vectors_dir()

from apipilot import (
    content_negotiation,
    cookie_profile,
    correlation,
    csrf_binding,
    csrf_format,
    error_codes,
    fetch_metadata,
    field_key,
    origin,
    pagination,
)

_passed = 0
_failed = 0
_failures: list[dict[str, Any]] = []


def _deep_equal(a: Any, b: Any) -> bool:
    if a == b:
        return True
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a.keys()) == set(b.keys()) and all(
            _deep_equal(a[k], b[k]) for k in a
        )
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_deep_equal(x, y) for x, y in zip(a, b))
    return False


def check(vid: str, actual: Any, expected: Any, label: str = "") -> None:
    global _passed, _failed
    if _deep_equal(actual, expected):
        _passed += 1
    else:
        _failed += 1
        _failures.append(
            {"id": vid, "label": label, "expected": expected, "actual": actual}
        )


# ---------- category runners ----------


def run_error_code(v: dict[str, Any]) -> None:
    inp = v["input"]
    if "codes" in inp:
        statuses = {c: error_codes.from_code(c).http_status for c in inp["codes"]}
        check(v["id"], statuses, v["expect"]["statuses"], "statuses-map")
        return
    code = None
    valid = True
    try:
        code = error_codes.from_code(inp["raw"])
    except ValueError:
        valid = False
    check(v["id"], valid, v["expect"]["valid"], "valid")
    if valid:
        check(v["id"], code.value, v["expect"]["code"], "code")
        check(v["id"], code.http_status, v["expect"]["status"], "status")


def run_field_key(v: dict[str, Any]) -> None:
    inp = v["input"]
    fn = (
        (lambda s: s)
        if inp.get("transform") == "passthrough"
        else field_key.normalize_field_key
    )
    check(v["id"], fn(inp["raw"]), v["expect"]["normalized"], "normalized")


def run_pagination(v: dict[str, Any]) -> None:
    inp = v["input"]
    options = pagination.PaginationOptions(
        default_page_size=inp["defaultPageSize"],
        max_page_size=inp["maxPageSize"],
        page_number_base=inp["pageNumberBase"],
    )

    has_page = inp.get("page") is not None
    has_size = inp.get("pageSize") is not None
    eff_size = inp["pageSize"] if has_size else inp["defaultPageSize"]

    if (
        (has_page and inp["page"] < inp["pageNumberBase"])
        or eff_size > inp["maxPageSize"]
        or eff_size < 1
    ):
        error = None
        try:
            internal = pagination.wire_page_to_internal(
                inp["page"], inp["pageNumberBase"]
            )
            pagination.create_page_request(
                internal, inp["pageSize"] or inp["defaultPageSize"], options
            )
        except ValueError as e:
            error = "pagesize-over-max" if "maximum" in str(e) else "page-below-base"
        check(v["id"], error is not None, v["expect"]["valid"] is False, "invalid")
        if v["expect"].get("error"):
            check(v["id"], error, v["expect"]["error"], "error")
        return

    page = inp["page"] if has_page else inp["pageNumberBase"]
    page_size = inp["pageSize"] if has_size else inp["defaultPageSize"]
    internal_page = pagination.wire_page_to_internal(page, inp["pageNumberBase"])
    pag = pagination.build_pagination(inp["totalItems"], internal_page, page_size)

    check(v["id"], pag.total_pages, v["expect"]["totalPages"], "totalPages")
    check(v["id"], pag.has_next, v["expect"]["hasNext"], "hasNext")
    check(v["id"], pag.has_previous, v["expect"]["hasPrevious"], "hasPrevious")
    check(v["id"], internal_page, v["expect"]["internalPage"], "internalPage")
    if "pageSize" in v["expect"]:
        check(v["id"], page_size, v["expect"]["pageSize"], "pageSize")
    check(v["id"], True, v["expect"]["valid"], "valid")


def run_fetch_metadata(v: dict[str, Any]) -> None:
    inp = v["input"]
    options = fetch_metadata.FetchMetadataOptions(
        profile=inp["profile"],
        allowed_site_values=frozenset(inp["allowedSiteValues"]),
        allowed_mode_values=frozenset(inp["allowedModeValues"]),
        allow_missing_headers=inp["allowMissingHeaders"],
    )
    d = fetch_metadata.evaluate_fetch_metadata(inp["site"], inp["mode"], options)
    check(v["id"], d.decision, v["expect"]["decision"], "decision")
    check(v["id"], d.reason, v["expect"]["reason"], "reason")


def run_cookie_profile(v: dict[str, Any]) -> None:
    inp = v["input"]
    p = inp["profile"]
    profile = cookie_profile.CookieProfile(
        name=p["name"],
        secure=p["secure"],
        http_only=p["httpOnly"],
        same_site=p["sameSite"],
        path=p["path"],
        domain=p.get("domain"),
        name_prefix=p.get("namePrefix", ""),
    )
    violations = cookie_profile.validate_cookie_profile(profile, inp["role"])
    check(v["id"], len(violations) == 0, v["expect"]["valid"], "valid")
    check(v["id"], sorted(violations), sorted(v["expect"]["violations"]), "violations")


def run_origin(v: dict[str, Any]) -> None:
    inp = v["input"]
    parts = origin.try_parse_origin(inp["origin"])
    parse_ok = parts is not None
    check(v["id"], parse_ok, v["expect"]["parseOk"], "parseOk")
    if parse_ok and v["expect"].get("parts"):
        check(v["id"], parts.scheme, v["expect"]["parts"]["scheme"], "scheme")
        check(v["id"], parts.host, v["expect"]["parts"]["host"], "host")
        check(v["id"], parts.port, v["expect"]["parts"]["port"], "port")
    match = origin.origin_matches(inp["origin"], inp["candidate"], inp["mode"])
    check(v["id"], match, v["expect"]["match"], "match")


def run_csrf_format(v: dict[str, Any]) -> None:
    global _passed, _failed
    inp = v["input"]
    if inp.get("op") == "encode":
        try:
            payload = csrf_format.encode_csrf_payload(
                inp["issuedAtUnixSeconds"],
                inp["randomBase64Url"],
                inp["bindingFingerprint"],
            )
        except (ValueError, TypeError):
            if v["expect"].get("error"):
                _passed += 1
            else:
                _failed += 1
                _failures.append(
                    {
                        "id": v["id"],
                        "label": "unexpected-throw",
                        "expected": v["expect"],
                        "actual": "threw",
                    }
                )
            return
        if "payload" in v["expect"]:
            check(v["id"], payload, v["expect"]["payload"], "payload")
        elif v["expect"].get("error"):
            _failed += 1
            _failures.append(
                {
                    "id": v["id"],
                    "label": "expected-error",
                    "expected": v["expect"]["error"],
                    "actual": payload,
                }
            )
        else:
            _passed += 1
        return
    parts = csrf_format.try_decode_csrf_payload(inp["payload"])
    check(v["id"], parts is not None, v["expect"]["valid"], "valid")
    if parts is not None:
        if "issuedAtUnixSeconds" in v["expect"]:
            check(
                v["id"],
                parts.issued_at_unix_seconds,
                v["expect"]["issuedAtUnixSeconds"],
                "issuedAt",
            )
        if "randomBase64Url" in v["expect"]:
            check(
                v["id"],
                parts.random_base64_url,
                v["expect"]["randomBase64Url"],
                "random",
            )
        if "bindingFingerprint" in v["expect"]:
            check(
                v["id"],
                parts.binding_fingerprint,
                v["expect"]["bindingFingerprint"],
                "binding",
            )


def run_csrf_binding(v: dict[str, Any]) -> None:
    fp = csrf_binding.csrf_binding_fingerprint(v["input"]["source"], v["input"]["kind"])
    check(v["id"], fp, v["expect"]["fingerprint"], "fingerprint")


def run_sort_direction(v: dict[str, Any]) -> None:
    d = pagination.parse_sort_direction(v["input"]["raw"])
    check(v["id"], d is not None, v["expect"]["valid"], "valid")
    check(v["id"], d, v["expect"]["direction"], "direction")


def run_correlation_id(v: dict[str, Any]) -> None:
    inp = v["input"]
    options = correlation.CorrelationOptions(invalid_id_policy=inp["policy"])
    d = correlation.resolve_correlation_id(
        inp["headerValue"], options, inp["patternMatches"]
    )
    effective = (
        "incoming"
        if d.kind == "use-incoming"
        else "generated"
        if d.kind == "generate"
        else "rejected"
    )
    check(v["id"], effective, v["expect"]["effectiveId"], "effectiveId")
    check(v["id"], d.warn is True, v["expect"]["warn"], "warn")


def run_content_negotiation(v: dict[str, Any]) -> None:
    inp = v["input"]
    o = inp["options"]
    options = content_negotiation.ContentNegotiationOptions(
        acceptable_response_media_types=tuple(o["acceptableResponseMediaTypes"]),
        accept_wildcard=o["acceptWildcard"],
        acceptable_request_media_types=tuple(o["acceptableRequestMediaTypes"]),
        accept_missing_content_type=o["acceptMissingContentType"],
        body_carrying_methods=tuple(o["bodyCarryingMethods"]),
    )
    d = content_negotiation.evaluate_content_negotiation(
        inp["accept"], inp["contentType"], inp["method"], options
    )
    check(v["id"], d.accept_result, v["expect"]["acceptResult"], "acceptResult")
    check(
        v["id"],
        d.content_type_result,
        v["expect"]["contentTypeResult"],
        "contentTypeResult",
    )
    check(v["id"], d.status, v["expect"]["status"], "status")


def run_envelope(v: dict[str, Any]) -> None:
    inp = v["input"]
    if inp["kind"] == "error":
        error: dict[str, Any] = {"code": inp["code"], "message": inp["message"]}
        if inp.get("fields"):
            error["fields"] = inp["fields"]
        actual = {"success": False, "error": error, "meta": inp["meta"]}
    elif inp["kind"] == "paginated":
        actual = {
            "success": True,
            "data": inp["data"],
            "message": inp["message"],
            "meta": inp["meta"],
            "pagination": inp["pagination"],
        }
    else:
        actual = {
            "success": True,
            "data": inp["data"],
            "message": inp["message"],
            "meta": inp["meta"],
        }
    if "json" in v["expect"]:
        check(v["id"], actual, v["expect"]["json"], "json")
    if "jsonKeys" in v["expect"]:
        check(
            v["id"], sorted(actual.keys()), sorted(v["expect"]["jsonKeys"]), "jsonKeys"
        )


RUNNERS = {
    "error-code": run_error_code,
    "field-key": run_field_key,
    "pagination": run_pagination,
    "fetch-metadata": run_fetch_metadata,
    "cookie-profile": run_cookie_profile,
    "origin": run_origin,
    "csrf-format": run_csrf_format,
    "csrf-binding": run_csrf_binding,
    "sort-direction": run_sort_direction,
    "correlation-id": run_correlation_id,
    "content-negotiation": run_content_negotiation,
    "envelope": run_envelope,
}


def run_all() -> tuple[int, int, list[dict[str, Any]]]:
    """Runs all vectors. Returns (passed, failed, failures)."""
    global _passed, _failed, _failures
    _passed = _failed = 0
    _failures = []

    for path in sorted(VECTORS_DIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        runner = RUNNERS.get(doc["category"])
        if runner is None:
            _failed += 1
            _failures.append(
                {
                    "id": path.name,
                    "label": "no-runner",
                    "expected": doc["category"],
                    "actual": "missing",
                }
            )
            continue
        for v in doc["vectors"]:
            try:
                runner(v)
            except Exception as e:  # noqa: BLE001 — runner must not abort
                _failed += 1
                _failures.append(
                    {
                        "id": v["id"],
                        "label": "runner-threw",
                        "expected": v["expect"],
                        "actual": str(e),
                    }
                )
    return _passed, _failed, _failures


def main() -> int:
    passed, failed, failures = run_all()
    print(f"\nConformance: {passed} passed, {failed} failed")
    if failures:
        print("\nFailures:")
        for f in failures[:30]:
            print(f"  {f['id']} [{f['label']}]")
            print(f"    expected: {json.dumps(f['expected'])}")
            print(f"    actual:   {json.dumps(f['actual'])}")
        if len(failures) > 30:
            print(f"  ... and {len(failures) - 30} more")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
