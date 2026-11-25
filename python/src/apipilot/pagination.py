"""Pagination — mirrors ApiPilot.Core.Pagination (C#).

Options, PageRequest validation, query parsing, and result math.
Internal PageRequest is always 1-based; the wire page-number base is
converted at the boundary.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .envelope import ApiPagination


@dataclass(frozen=True, slots=True)
class PaginationParameterNames:
    """Query parameter names."""

    page: str = "page"
    page_size: str = "pageSize"
    sort: str = "sort"
    direction: str = "direction"


SortDirection = str  # "asc" | "desc"


@dataclass(frozen=True, slots=True)
class SortRequest:
    field: str
    direction: SortDirection


@dataclass(frozen=True, slots=True)
class FilterRequest:
    parameters: dict[str, str]


@dataclass(frozen=True, slots=True)
class PageRequest:
    """Validated 1-based page request."""

    page: int
    page_size: int


@dataclass(slots=True)
class PaginationOptions:
    """Pagination options — the ten transformations T1–T10."""

    default_page_size: int = 20  # T1
    max_page_size: int = 100  # T2
    page_number_base: int = 1  # T3
    success_status_code: int = 200  # T4
    strict_query_validation: bool = False  # T5
    parameter_names: PaginationParameterNames = field(
        default_factory=PaginationParameterNames
    )  # T6
    integer_parser: Callable[[str], int | None] | None = None  # T7
    sort_parser: Callable[[str, SortDirection], SortRequest | None] | None = None  # T8
    sort_direction_parser: Callable[[str], SortDirection | None] | None = None  # T9
    is_filter_parameter: Callable[[str], bool] | None = None  # T10

    def __post_init__(self) -> None:
        if self.integer_parser is None:
            object.__setattr__(self, "integer_parser", default_integer_parser)


_INT_RE = re.compile(r"^[+-]?\d+$")


def default_integer_parser(raw: str) -> int | None:
    """int.TryParse equivalent — optional sign, digits only."""
    trimmed = raw.strip()
    if not _INT_RE.match(trimmed):
        return None
    try:
        return int(trimmed, 10)
    except ValueError:
        return None


def create_page_request(
    page: int, page_size: int, options: PaginationOptions
) -> PageRequest:
    """Creates a PageRequest with validation. Raises ValueError on violation."""
    if page < 1:
        raise ValueError("Page must be at least 1.")
    if page_size < 1:
        raise ValueError("PageSize must be at least 1.")
    if page_size > options.max_page_size:
        raise ValueError(
            f"PageSize must not exceed the configured maximum of {options.max_page_size}."
        )
    return PageRequest(page=page, page_size=page_size)


def page_request_from_query(
    page: int | None, page_size: int | None, options: PaginationOptions
) -> PageRequest:
    """FromQuery: fills None with defaults (page 1, default_page_size)."""
    return create_page_request(
        page if page is not None else 1,
        page_size if page_size is not None else options.default_page_size,
        options,
    )


def parse_sort_direction(raw: str | None) -> SortDirection | None:
    """Default direction parser: asc/desc case-insensitive, trimmed."""
    if raw is None:
        return None
    trimmed = raw.strip().lower()
    if trimmed == "asc":
        return "asc"
    if trimmed == "desc":
        return "desc"
    return None


def compute_pagination(
    total_items: int, page: int, page_size: int
) -> tuple[int, bool, bool]:
    """Returns (total_pages, has_next, has_previous). totalPages min 1."""
    total_pages = max(1, math.ceil(total_items / page_size))
    return total_pages, page < total_pages, page > 1


def build_pagination(total_items: int, page: int, page_size: int) -> ApiPagination:
    """Builds the full ApiPagination block."""
    total_pages, has_next, has_previous = compute_pagination(
        total_items, page, page_size
    )
    return ApiPagination(
        page=page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
        has_next=has_next,
        has_previous=has_previous,
    )


DEFAULT_PAGINATION_OPTIONS = PaginationOptions()


def wire_page_to_internal(wire_page: int, page_number_base: int) -> int:
    """Converts a wire page number to the internal 1-based page."""
    return wire_page - page_number_base + 1


@dataclass(slots=True)
class ParsedPaginationQuery:
    page_request: PageRequest
    sort: SortRequest | None
    filter: FilterRequest | None
    errors: dict[str, list[str]]


def _first(query: dict[str, Any], key: str) -> str | None:
    value = query.get(key)
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return str(value)


def parse_pagination_query(
    query: dict[str, Any], options: PaginationOptions
) -> ParsedPaginationQuery:
    """Parses and validates pagination query parameters.

    Mirrors PaginationEndpointFilter logic — the adapter supplies the
    query mapping. Returns field-name → messages for VALIDATION_ERROR.
    """
    errors: dict[str, list[str]] = {}
    names = options.parameter_names

    def add_error(field_name: str, message: str) -> None:
        errors.setdefault(field_name, []).append(message)

    parser = options.integer_parser or default_integer_parser

    # --- page ---
    wire_page: int | None = None
    raw_page = _first(query, names.page)
    if raw_page is not None and raw_page != "":
        wire_page = parser(raw_page)
        if wire_page is None:
            add_error(names.page, "The page value is not valid.")
        elif wire_page < options.page_number_base:
            add_error(
                names.page,
                f"The page value must be at least {options.page_number_base}.",
            )

    # --- pageSize ---
    page_size: int | None = None
    raw_page_size = _first(query, names.page_size)
    if raw_page_size is not None and raw_page_size != "":
        page_size = parser(raw_page_size)
        if page_size is None:
            add_error(names.page_size, "The pageSize value is not valid.")
        elif page_size < 1:
            add_error(names.page_size, "The pageSize value must be at least 1.")
        elif page_size > options.max_page_size:
            add_error(
                names.page_size,
                f"The pageSize value must not exceed {options.max_page_size}.",
            )

    # --- sort ---
    sort: SortRequest | None = None
    raw_sort = _first(query, names.sort)
    raw_direction = _first(query, names.direction)
    sort_present = (raw_sort not in (None, "")) or (raw_direction not in (None, ""))
    if sort_present:
        field_name = raw_sort or ""
        direction: SortDirection | None = None
        if raw_direction not in (None, ""):
            direction_parser = options.sort_direction_parser or parse_sort_direction
            direction = direction_parser(raw_direction)
            if direction is None:
                add_error(names.direction, "The direction value is not valid.")
        else:
            direction = "asc"
        if field_name == "":
            add_error(
                names.sort, "The sort field is required when direction is specified."
            )
        elif direction is not None:
            if options.sort_parser:
                sort = options.sort_parser(field_name, direction)
                if sort is None:
                    add_error(names.sort, "The sort expression is not valid.")
            else:
                sort = SortRequest(field=field_name, direction=direction)

    # --- filters / strict validation ---
    filter_request: FilterRequest | None = None
    control_names = {names.page, names.page_size, names.sort, names.direction}
    filter_params: dict[str, str] = {}
    for key, value in query.items():
        if key in control_names or value is None:
            continue
        str_value = (
            value[0]
            if isinstance(value, (list, tuple)) and value
            else (str(value) if not isinstance(value, (list, tuple)) else None)
        )
        if str_value is None:
            continue

        if options.is_filter_parameter:
            is_filter = options.is_filter_parameter(key)
        else:
            is_filter = not options.strict_query_validation
        if options.strict_query_validation and not is_filter:
            add_error(key, "This query parameter is not recognized.")
            continue
        if is_filter:
            filter_params[key] = str_value

    if filter_params:
        filter_request = FilterRequest(parameters=filter_params)

    # --- build PageRequest (internal 1-based) ---
    page_request = PageRequest(page=1, page_size=options.default_page_size)
    if not errors:
        effective_wire_page = (
            wire_page if wire_page is not None else options.page_number_base
        )
        internal_page = wire_page_to_internal(
            effective_wire_page, options.page_number_base
        )
        effective_page_size = (
            page_size if page_size is not None else options.default_page_size
        )
        try:
            page_request = create_page_request(
                internal_page, effective_page_size, options
            )
        except ValueError:
            pass  # Bounds already validated above; safety net.

    return ParsedPaginationQuery(
        page_request=page_request, sort=sort, filter=filter_request, errors=errors
    )
