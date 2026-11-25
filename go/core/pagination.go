package core

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// PaginationParameterNames holds the query parameter names (T6).
type PaginationParameterNames struct {
	Page      string
	PageSize  string
	Sort      string
	Direction string
}

// DefaultParameterNames returns the default parameter names.
func DefaultParameterNames() PaginationParameterNames {
	return PaginationParameterNames{Page: "page", PageSize: "pageSize", Sort: "sort", Direction: "direction"}
}

// SortRequest is a validated sort expression.
type SortRequest struct {
	Field     string
	Direction string // "asc" | "desc"
}

// FilterRequest carries filter parameters.
type FilterRequest struct {
	Parameters map[string]string
}

// PageRequest is a validated 1-based page request.
type PageRequest struct {
	Page     int
	PageSize int
}

// IntegerParser parses a raw string to int (T7). Returns (value, ok).
type IntegerParser func(raw string) (int, bool)

// SortParser parses a sort expression (T8). Returns (request, ok).
type SortParser func(field, direction string) (SortRequest, bool)

// SortDirectionParser parses a direction string (T9). Returns ("asc"|"desc", ok).
type SortDirectionParser func(raw string) (string, bool)

// IsFilterParameter reports whether a query key is a filter parameter (T10).
type IsFilterParameter func(key string) bool

// PaginationOptions holds the ten transformations T1–T10.
type PaginationOptions struct {
	DefaultPageSize       int                      // T1
	MaxPageSize           int                      // T2
	PageNumberBase        int                      // T3
	SuccessStatusCode     int                      // T4
	StrictQueryValidation bool                     // T5
	ParameterNames        PaginationParameterNames // T6
	IntegerParser         IntegerParser            // T7
	SortParser            SortParser               // T8
	SortDirectionParser   SortDirectionParser      // T9
	IsFilterParameter     IsFilterParameter        // T10
}

// DefaultPaginationOptions returns the default options.
func DefaultPaginationOptions() PaginationOptions {
	return PaginationOptions{
		DefaultPageSize:   20,
		MaxPageSize:       100,
		PageNumberBase:    1,
		SuccessStatusCode: 200,
		ParameterNames:    DefaultParameterNames(),
		IntegerParser:     DefaultIntegerParser,
	}
}

var intRe = regexp.MustCompile(`^[+-]?\d+$`)

// DefaultIntegerParser is int.TryParse equivalent — optional sign, digits only.
func DefaultIntegerParser(raw string) (int, bool) {
	trimmed := strings.TrimSpace(raw)
	if !intRe.MatchString(trimmed) {
		return 0, false
	}
	v, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, false
	}
	return v, true
}

// CreatePageRequest creates a PageRequest with validation.
func CreatePageRequest(page, pageSize int, options PaginationOptions) (PageRequest, error) {
	if page < 1 {
		return PageRequest{}, fmt.Errorf("Page must be at least 1")
	}
	if pageSize < 1 {
		return PageRequest{}, fmt.Errorf("PageSize must be at least 1")
	}
	if pageSize > options.MaxPageSize {
		return PageRequest{}, fmt.Errorf("PageSize must not exceed the configured maximum of %d", options.MaxPageSize)
	}
	return PageRequest{Page: page, PageSize: pageSize}, nil
}

// PageRequestFromQuery fills nil-equivalent zeros with defaults.
// Callers pass -1 for absent values.
func PageRequestFromQuery(page, pageSize int, options PaginationOptions) PageRequest {
	if page < 0 {
		page = 1
	}
	if pageSize < 0 {
		pageSize = options.DefaultPageSize
	}
	pr, _ := CreatePageRequest(page, pageSize, options)
	return pr
}

// ParseSortDirection is the default direction parser: asc/desc case-insensitive, trimmed.
func ParseSortDirection(raw string) (string, bool) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	switch trimmed {
	case "asc":
		return "asc", true
	case "desc":
		return "desc", true
	}
	return "", false
}

// ComputePagination returns (totalPages, hasNext, hasPrevious). totalPages min 1.
func ComputePagination(totalItems, page, pageSize int) (int, bool, bool) {
	totalPages := int(math.Ceil(float64(totalItems) / float64(pageSize)))
	if totalPages < 1 {
		totalPages = 1
	}
	return totalPages, page < totalPages, page > 1
}

// BuildPagination builds the full ApiPagination block.
func BuildPagination(totalItems, page, pageSize int) ApiPagination {
	totalPages, hasNext, hasPrevious := ComputePagination(totalItems, page, pageSize)
	return ApiPagination{
		Page:        page,
		PageSize:    pageSize,
		TotalItems:  totalItems,
		TotalPages:  totalPages,
		HasNext:     hasNext,
		HasPrevious: hasPrevious,
	}
}

// WirePageToInternal converts a wire page number to the internal 1-based page.
func WirePageToInternal(wirePage, pageNumberBase int) int {
	return wirePage - pageNumberBase + 1
}

// ParsedPaginationQuery is the result of ParsePaginationQuery.
type ParsedPaginationQuery struct {
	PageRequest PageRequest
	Sort        *SortRequest
	Filter      *FilterRequest
	Errors      map[string][]string
}

// ParsePaginationQuery parses and validates pagination query parameters.
// Mirrors PaginationEndpointFilter logic. Returns field-name → messages.
func ParsePaginationQuery(query map[string][]string, options PaginationOptions) ParsedPaginationQuery {
	errors := map[string][]string{}
	names := options.ParameterNames
	parser := options.IntegerParser
	if parser == nil {
		parser = DefaultIntegerParser
	}

	addError := func(field, msg string) {
		errors[field] = append(errors[field], msg)
	}

	first := func(key string) (string, bool) {
		vals, ok := query[key]
		if !ok || len(vals) == 0 {
			return "", false
		}
		return vals[0], true
	}

	// --- page ---
	wirePage := -1 // -1 = absent
	rawPage, hasRawPage := first(names.Page)
	if hasRawPage && rawPage != "" {
		if v, ok := parser(rawPage); ok {
			wirePage = v
			if wirePage < options.PageNumberBase {
				addError(names.Page, fmt.Sprintf("The page value must be at least %d.", options.PageNumberBase))
			}
		} else {
			addError(names.Page, "The page value is not valid.")
		}
	}

	// --- pageSize ---
	pageSize := -1
	rawPageSize, hasRawPageSize := first(names.PageSize)
	if hasRawPageSize && rawPageSize != "" {
		if v, ok := parser(rawPageSize); ok {
			pageSize = v
			if pageSize < 1 {
				addError(names.PageSize, "The pageSize value must be at least 1.")
			} else if pageSize > options.MaxPageSize {
				addError(names.PageSize, fmt.Sprintf("The pageSize value must not exceed %d.", options.MaxPageSize))
			}
		} else {
			addError(names.PageSize, "The pageSize value is not valid.")
		}
	}

	// --- sort ---
	var sort *SortRequest
	rawSort, hasRawSort := first(names.Sort)
	rawDirection, hasRawDirection := first(names.Direction)
	sortPresent := (hasRawSort && rawSort != "") || (hasRawDirection && rawDirection != "")
	if sortPresent {
		fieldName := rawSort
		direction := ""
		directionOK := false
		if hasRawDirection && rawDirection != "" {
			dirParser := options.SortDirectionParser
			if dirParser == nil {
				dirParser = func(raw string) (string, bool) { return ParseSortDirection(raw) }
			}
			direction, directionOK = dirParser(rawDirection)
			if !directionOK {
				addError(names.Direction, "The direction value is not valid.")
			}
		} else {
			direction = "asc"
			directionOK = true
		}
		if fieldName == "" {
			addError(names.Sort, "The sort field is required when direction is specified.")
		} else if directionOK {
			if options.SortParser != nil {
				if sr, ok := options.SortParser(fieldName, direction); ok {
					sort = &sr
				} else {
					addError(names.Sort, "The sort expression is not valid.")
				}
			} else {
				sort = &SortRequest{Field: fieldName, Direction: direction}
			}
		}
	}

	// --- filters / strict validation ---
	var filter *FilterRequest
	controlNames := map[string]bool{
		names.Page: true, names.PageSize: true, names.Sort: true, names.Direction: true,
	}
	filterParams := map[string]string{}
	for key, values := range query {
		if controlNames[key] || len(values) == 0 {
			continue
		}
		strValue := values[0]

		isFilter := true
		if options.IsFilterParameter != nil {
			isFilter = options.IsFilterParameter(key)
		} else if options.StrictQueryValidation {
			isFilter = false
		}
		if options.StrictQueryValidation && !isFilter {
			addError(key, "This query parameter is not recognized.")
			continue
		}
		if isFilter {
			filterParams[key] = strValue
		}
	}
	if len(filterParams) > 0 {
		filter = &FilterRequest{Parameters: filterParams}
	}

	// --- build PageRequest (internal 1-based) ---
	pageRequest := PageRequest{Page: 1, PageSize: options.DefaultPageSize}
	if len(errors) == 0 {
		effectiveWirePage := wirePage
		if effectiveWirePage < 0 {
			effectiveWirePage = options.PageNumberBase
		}
		internalPage := WirePageToInternal(effectiveWirePage, options.PageNumberBase)
		effectivePageSize := pageSize
		if effectivePageSize < 0 {
			effectivePageSize = options.DefaultPageSize
		}
		if pr, err := CreatePageRequest(internalPage, effectivePageSize, options); err == nil {
			pageRequest = pr
		}
	}

	return ParsedPaginationQuery{
		PageRequest: pageRequest,
		Sort:        sort,
		Filter:      filter,
		Errors:      errors,
	}
}
