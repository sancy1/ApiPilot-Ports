package core_test

import (
	"testing"

	"github.com/apipilot/go/core"
)

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

func TestDefaultIntegerParser(t *testing.T) {
	cases := []struct {
		raw  string
		want int
		ok   bool
	}{
		{"42", 42, true},
		{"+7", 7, true},
		{"-3", -3, true},
		{"  10  ", 10, true},
		{"", 0, false},
		{"abc", 0, false},
		{"1.5", 0, false},
		{"0x10", 0, false},
		{"1e3", 0, false},
		{"--5", 0, false},
	}
	for _, c := range cases {
		got, ok := core.DefaultIntegerParser(c.raw)
		if got != c.want || ok != c.ok {
			t.Errorf("DefaultIntegerParser(%q) = (%d,%v), want (%d,%v)", c.raw, got, ok, c.want, c.ok)
		}
	}
}

func TestCreatePageRequestValidation(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	if _, err := core.CreatePageRequest(0, 10, opts); err == nil {
		t.Error("page 0 should fail")
	}
	if _, err := core.CreatePageRequest(1, 0, opts); err == nil {
		t.Error("pageSize 0 should fail")
	}
	if _, err := core.CreatePageRequest(1, 101, opts); err == nil {
		t.Error("pageSize > max should fail")
	}
	pr, err := core.CreatePageRequest(3, 50, opts)
	if err != nil || pr.Page != 3 || pr.PageSize != 50 {
		t.Fatalf("valid request failed: %+v %v", pr, err)
	}
}

func TestComputePaginationEdgeCases(t *testing.T) {
	// Zero items → totalPages min 1.
	tp, hasNext, hasPrev := core.ComputePagination(0, 1, 20)
	if tp != 1 || hasNext || hasPrev {
		t.Fatalf("zero items: %d %v %v", tp, hasNext, hasPrev)
	}
	// Exact division.
	tp, hasNext, hasPrev = core.ComputePagination(40, 2, 20)
	if tp != 2 || hasNext || !hasPrev {
		t.Fatalf("exact division: %d %v %v", tp, hasNext, hasPrev)
	}
	// Last page.
	tp, hasNext, hasPrev = core.ComputePagination(41, 3, 20)
	if tp != 3 || hasNext || !hasPrev {
		t.Fatalf("last page: %d %v %v", tp, hasNext, hasPrev)
	}
}

func TestWirePageToInternal(t *testing.T) {
	if got := core.WirePageToInternal(1, 1); got != 1 {
		t.Fatalf("base1 page1 = %d", got)
	}
	if got := core.WirePageToInternal(0, 0); got != 1 {
		t.Fatalf("base0 page0 = %d", got)
	}
	if got := core.WirePageToInternal(5, 1); got != 5 {
		t.Fatalf("base1 page5 = %d", got)
	}
}

func TestParseSortDirection(t *testing.T) {
	for raw, want := range map[string]string{"asc": "asc", "ASC": "asc", " desc ": "desc", "Desc": "desc"} {
		got, ok := core.ParseSortDirection(raw)
		if !ok || got != want {
			t.Errorf("ParseSortDirection(%q) = (%q,%v)", raw, got, ok)
		}
	}
	for _, bad := range []string{"", "ascending", "down", "1"} {
		if _, ok := core.ParseSortDirection(bad); ok {
			t.Errorf("ParseSortDirection(%q) should fail", bad)
		}
	}
}

func TestParsePaginationQueryDefaults(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{}, opts)
	if len(parsed.Errors) != 0 {
		t.Fatalf("unexpected errors: %v", parsed.Errors)
	}
	if parsed.PageRequest.Page != 1 || parsed.PageRequest.PageSize != 20 {
		t.Fatalf("defaults = %+v", parsed.PageRequest)
	}
	if parsed.Sort != nil || parsed.Filter != nil {
		t.Fatal("sort/filter should be nil")
	}
}

func TestParsePaginationQueryInvalidPage(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{"page": {"abc"}}, opts)
	if _, ok := parsed.Errors["page"]; !ok {
		t.Fatalf("expected page error: %v", parsed.Errors)
	}
}

func TestParsePaginationQueryPageBelowBase(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{"page": {"0"}}, opts)
	if _, ok := parsed.Errors["page"]; !ok {
		t.Fatalf("expected page error: %v", parsed.Errors)
	}
}

func TestParsePaginationQueryPageSizeTooBig(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{"pageSize": {"500"}}, opts)
	if _, ok := parsed.Errors["pageSize"]; !ok {
		t.Fatalf("expected pageSize error: %v", parsed.Errors)
	}
}

func TestParsePaginationQueryDirectionWithoutSort(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{"direction": {"desc"}}, opts)
	if _, ok := parsed.Errors["sort"]; !ok {
		t.Fatalf("expected sort error: %v", parsed.Errors)
	}
}

func TestParsePaginationQueryBadDirection(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{
		"sort": {"name"}, "direction": {"sideways"},
	}, opts)
	if _, ok := parsed.Errors["direction"]; !ok {
		t.Fatalf("expected direction error: %v", parsed.Errors)
	}
}

func TestParsePaginationQuerySortDefaultsAsc(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{"sort": {"Name"}}, opts)
	if parsed.Sort == nil || parsed.Sort.Field != "Name" || parsed.Sort.Direction != "asc" {
		t.Fatalf("sort = %+v", parsed.Sort)
	}
}

func TestParsePaginationQueryFilters(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{
		"status": {"active"}, "page": {"2"},
	}, opts)
	if parsed.Filter == nil || parsed.Filter.Parameters["status"] != "active" {
		t.Fatalf("filter = %+v", parsed.Filter)
	}
	if _, isControl := parsed.Filter.Parameters["page"]; isControl {
		t.Fatal("page leaked into filters")
	}
}

func TestParsePaginationQueryStrictValidation(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	opts.StrictQueryValidation = true
	parsed := core.ParsePaginationQuery(map[string][]string{"unknown": {"x"}}, opts)
	if _, ok := parsed.Errors["unknown"]; !ok {
		t.Fatalf("expected unknown-param error: %v", parsed.Errors)
	}
}

func TestParsePaginationQueryCustomNames(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	opts.ParameterNames = core.PaginationParameterNames{
		Page: "p", PageSize: "ps", Sort: "s", Direction: "d",
	}
	parsed := core.ParsePaginationQuery(map[string][]string{
		"p": {"3"}, "ps": {"10"}, "s": {"name"}, "d": {"desc"},
	}, opts)
	if len(parsed.Errors) != 0 {
		t.Fatalf("errors: %v", parsed.Errors)
	}
	if parsed.PageRequest.Page != 3 || parsed.PageRequest.PageSize != 10 {
		t.Fatalf("pageRequest = %+v", parsed.PageRequest)
	}
	if parsed.Sort == nil || parsed.Sort.Direction != "desc" {
		t.Fatalf("sort = %+v", parsed.Sort)
	}
}

func TestParsePaginationQueryCustomPageNumberBase(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	opts.PageNumberBase = 0
	parsed := core.ParsePaginationQuery(map[string][]string{"page": {"0"}}, opts)
	if len(parsed.Errors) != 0 {
		t.Fatalf("errors: %v", parsed.Errors)
	}
	if parsed.PageRequest.Page != 1 {
		t.Fatalf("internal page = %d", parsed.PageRequest.Page)
	}
}

func TestParsePaginationQueryEmptyValuesIgnored(t *testing.T) {
	opts := core.DefaultPaginationOptions()
	parsed := core.ParsePaginationQuery(map[string][]string{
		"page": {""}, "pageSize": {""}, "sort": {""},
	}, opts)
	if len(parsed.Errors) != 0 {
		t.Fatalf("empty values should be ignored: %v", parsed.Errors)
	}
}
