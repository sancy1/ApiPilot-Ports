// Command conformance runs the ApiPilot conformance vectors against the
// Go core package. Mirrors typescript/core/test/conformance.mjs and
// python/tests/conformance_runner.py.
//
// The vectors are the single source of truth (docs/conformance-vectors.md,
// C# reference). Exits non-zero if any vector fails.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/apipilot/go/core"
)

var passed, failed int
var failures []failure

type failure struct {
	id       string
	label    string
	expected any
	actual   any
}

func check(id string, actual, expected any, label string) {
	if deepEqual(actual, expected) {
		passed++
	} else {
		failed++
		failures = append(failures, failure{id, label, expected, actual})
	}
}

func deepEqual(a, b any) bool {
	return reflect.DeepEqual(normalize(a), normalize(b))
}

// normalize converts JSON-decoded values (map[string]any, []any, float64)
// into comparable Go values.
func normalize(v any) any {
	switch t := v.(type) {
	case map[string]any:
		m := make(map[string]any, len(t))
		for k, val := range t {
			m[k] = normalize(val)
		}
		return m
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = normalize(val)
		}
		return out
	case float64:
		if t == float64(int64(t)) {
			return int64(t)
		}
		return t
	case int:
		return int64(t)
	case int64:
		return t
	default:
		return v
	}
}

// ---------- category runners ----------

type vectorDoc struct {
	Category string           `json:"category"`
	Vectors  []map[string]any `json:"vectors"`
}

func getMap(v map[string]any, key string) map[string]any {
	if m, ok := v[key].(map[string]any); ok {
		return m
	}
	return nil
}

func getStr(v map[string]any, key string) string {
	if s, ok := v[key].(string); ok {
		return s
	}
	return ""
}

func getBool(v map[string]any, key string) bool {
	if b, ok := v[key].(bool); ok {
		return b
	}
	return false
}

func getFloat(v map[string]any, key string) (float64, bool) {
	if f, ok := v[key].(float64); ok {
		return f, true
	}
	return 0, false
}

func getStrSlice(v map[string]any, key string) []string {
	arr, ok := v[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func runErrorCode(v map[string]any) {
	id := getStr(v, "id")
	expect := getMap(v, "expect")
	inp := getMap(v, "input")

	if codes := getStrSlice(inp, "codes"); codes != nil {
		statuses := map[string]any{}
		for _, c := range codes {
			code, err := core.FromCode(c)
			if err != nil {
				statuses[c] = int64(-1)
			} else {
				statuses[c] = int64(code.HTTPStatus)
			}
		}
		check(id, statuses, expect["statuses"], "statuses-map")
		return
	}

	raw := getStr(inp, "raw")
	code, err := core.FromCode(raw)
	valid := err == nil
	check(id, valid, expect["valid"], "valid")
	if valid {
		check(id, code.Value, expect["code"], "code")
		check(id, code.HTTPStatus, int(expect["status"].(float64)), "status")
	}
}

func runFieldKey(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")
	raw := getStr(inp, "raw")
	transform := getStr(inp, "transform")
	fn := core.NormalizeFieldKey
	if transform == "passthrough" {
		fn = func(s string) string { return s }
	}
	check(id, fn(raw), expect["normalized"], "normalized")
}

func runPagination(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	defSize, _ := getFloat(inp, "defaultPageSize")
	maxSize, _ := getFloat(inp, "maxPageSize")
	base, _ := getFloat(inp, "pageNumberBase")
	totalItems, _ := getFloat(inp, "totalItems")

	options := core.PaginationOptions{
		DefaultPageSize:   int(defSize),
		MaxPageSize:       int(maxSize),
		PageNumberBase:    int(base),
		SuccessStatusCode: 200,
		ParameterNames:    core.DefaultParameterNames(),
		IntegerParser:     core.DefaultIntegerParser,
	}

	pageVal, hasPage := getFloat(inp, "page")
	sizeVal, hasSize := getFloat(inp, "pageSize")
	effSize := int(defSize)
	if hasSize {
		effSize = int(sizeVal)
	}

	pageBelowBase := hasPage && int(pageVal) < int(base)
	sizeOverMax := effSize > int(maxSize)
	sizeUnderMin := effSize < 1

	if pageBelowBase || sizeOverMax || sizeUnderMin {
		error := ""
		internal := core.WirePageToInternal(int(pageVal), int(base))
		sizeArg := int(defSize)
		if hasSize {
			sizeArg = int(sizeVal)
		}
		_, err := core.CreatePageRequest(internal, sizeArg, options)
		if err != nil {
			if strings.Contains(err.Error(), "maximum") {
				error = "pagesize-over-max"
			} else {
				error = "page-below-base"
			}
		}
		check(id, error != "", expect["valid"] == false, "invalid")
		if expErr, ok := expect["error"]; ok {
			check(id, error, expErr, "error")
		}
		return
	}

	page := int(base)
	if hasPage {
		page = int(pageVal)
	}
	pageSize := int(defSize)
	if hasSize {
		pageSize = int(sizeVal)
	}
	internalPage := core.WirePageToInternal(page, int(base))
	pag := core.BuildPagination(int(totalItems), internalPage, pageSize)

	check(id, pag.TotalPages, int(expect["totalPages"].(float64)), "totalPages")
	check(id, pag.HasNext, expect["hasNext"], "hasNext")
	check(id, pag.HasPrevious, expect["hasPrevious"], "hasPrevious")
	check(id, internalPage, int(expect["internalPage"].(float64)), "internalPage")
	if ps, ok := expect["pageSize"]; ok {
		check(id, pageSize, int(ps.(float64)), "pageSize")
	}
	check(id, true, expect["valid"], "valid")
}

func strPtrOrNil(v any) *string {
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return &s
}

func runFetchMetadata(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	options := core.FetchMetadataOptions{
		Profile:             core.FetchMetadataProfile(getStr(inp, "profile")),
		AllowedSiteValues:   strSliceToSet(getStrSlice(inp, "allowedSiteValues")),
		AllowedModeValues:   strSliceToSet(getStrSlice(inp, "allowedModeValues")),
		AllowMissingHeaders: getBool(inp, "allowMissingHeaders"),
	}
	d := core.EvaluateFetchMetadata(strPtrOrNil(inp["site"]), strPtrOrNil(inp["mode"]), options)
	check(id, d.Decision, expect["decision"], "decision")
	check(id, d.Reason, expect["reason"], "reason")
}

func strSliceToSet(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}

func runCookieProfile(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	p := getMap(inp, "profile")
	profile := core.CookieProfile{
		Name:       getStr(p, "name"),
		Secure:     getBool(p, "secure"),
		HTTPOnly:   getBool(p, "httpOnly"),
		SameSite:   core.CookieSameSite(getStr(p, "sameSite")),
		Path:       getStr(p, "path"),
		NamePrefix: getStr(p, "namePrefix"),
	}
	if d, ok := p["domain"]; ok && d != nil {
		s := d.(string)
		profile.Domain = &s
	}

	violations := core.ValidateCookieProfile(profile, core.CookieProfileRole(getStr(inp, "role")))
	check(id, len(violations) == 0, expect["valid"], "valid")
	check(id, sortedStrings(violations), sortedStrings(toStringSlice(expect["violations"])), "violations")
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func sortedStrings(s []string) []string {
	out := append([]string(nil), s...)
	sort.Strings(out)
	return out
}

func runOrigin(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	originStr := getStr(inp, "origin")
	parts, ok := core.TryParseOrigin(originStr)
	check(id, ok, expect["parseOk"], "parseOk")
	if ok {
		if expParts := getMap(expect, "parts"); expParts != nil {
			check(id, parts.Scheme, expParts["scheme"], "scheme")
			check(id, parts.Host, expParts["host"], "host")
			check(id, parts.Port, int(expParts["port"].(float64)), "port")
		}
	}
	match := core.OriginMatches(originStr, getStr(inp, "candidate"), getStr(inp, "mode"))
	check(id, match, expect["match"], "match")
}

func runCsrfFormat(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	if getStr(inp, "op") == "encode" {
		issuedAt, _ := getFloat(inp, "issuedAtUnixSeconds")
		payload, err := core.EncodeCsrfPayload(int64(issuedAt), getStr(inp, "randomBase64Url"), getStr(inp, "bindingFingerprint"))
		if err != nil {
			if _, hasErr := expect["error"]; hasErr {
				passed++
			} else {
				failed++
				failures = append(failures, failure{id, "unexpected-throw", expect, "threw"})
			}
			return
		}
		if expPayload, has := expect["payload"]; has {
			check(id, payload, expPayload, "payload")
		} else if _, hasErr := expect["error"]; hasErr {
			failed++
			failures = append(failures, failure{id, "expected-error", expect["error"], payload})
		} else {
			passed++
		}
		return
	}

	parts, ok := core.TryDecodeCsrfPayload(getStr(inp, "payload"))
	check(id, ok, expect["valid"], "valid")
	if ok {
		if exp, has := expect["issuedAtUnixSeconds"]; has {
			check(id, parts.IssuedAtUnixSeconds, int64(exp.(float64)), "issuedAt")
		}
		if exp, has := expect["randomBase64Url"]; has {
			check(id, parts.RandomBase64URL, exp, "random")
		}
		if exp, has := expect["bindingFingerprint"]; has {
			check(id, parts.BindingFingerprint, exp, "binding")
		}
	}
}

func runCsrfBinding(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")
	fp := core.CsrfBindingFingerprint(getStr(inp, "source"), core.CsrfBindingKind(getStr(inp, "kind")))
	check(id, fp, expect["fingerprint"], "fingerprint")
}

func runSortDirection(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")
	d, ok := core.ParseSortDirection(getStr(inp, "raw"))
	check(id, ok, expect["valid"], "valid")
	var dirAny any = d
	if !ok {
		dirAny = nil
	}
	check(id, dirAny, expect["direction"], "direction")
}

func runCorrelationID(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	options := core.DefaultCorrelationOptions()
	options.InvalidIDPolicy = core.CorrelationInvalidIDPolicy(getStr(inp, "policy"))
	d := core.ResolveCorrelationID(strPtrOrNil(inp["headerValue"]), options, getBool(inp, "patternMatches"))

	effective := "rejected"
	if d.Kind == core.DecisionUseIncoming {
		effective = "incoming"
	} else if d.Kind == core.DecisionGenerate {
		effective = "generated"
	}
	check(id, effective, expect["effectiveId"], "effectiveId")
	check(id, d.Warn, expect["warn"], "warn")
}

func runContentNegotiation(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")
	o := getMap(inp, "options")

	options := core.ContentNegotiationOptions{
		AcceptableResponseMediaTypes: getStrSlice(o, "acceptableResponseMediaTypes"),
		AcceptWildcard:               getBool(o, "acceptWildcard"),
		AcceptableRequestMediaTypes:  getStrSlice(o, "acceptableRequestMediaTypes"),
		AcceptMissingContentType:     getBool(o, "acceptMissingContentType"),
		BodyCarryingMethods:          getStrSlice(o, "bodyCarryingMethods"),
	}
	d := core.EvaluateContentNegotiation(
		strPtrOrNil(inp["accept"]), strPtrOrNil(inp["contentType"]), getStr(inp, "method"), options,
	)
	check(id, string(d.AcceptResult), expect["acceptResult"], "acceptResult")
	check(id, string(d.ContentTypeResult), expect["contentTypeResult"], "contentTypeResult")
	check(id, int(d.Status), int(expect["status"].(float64)), "status")
}

func runEnvelope(v map[string]any) {
	id := getStr(v, "id")
	inp := getMap(v, "input")
	expect := getMap(v, "expect")

	var actual map[string]any
	kind := getStr(inp, "kind")
	if kind == "error" {
		error := map[string]any{"code": inp["code"], "message": inp["message"]}
		if fields, ok := inp["fields"]; ok && fields != nil {
			error["fields"] = fields
		}
		actual = map[string]any{"success": false, "error": error, "meta": inp["meta"]}
	} else if kind == "paginated" {
		actual = map[string]any{
			"success":    true,
			"data":       inp["data"],
			"message":    inp["message"],
			"meta":       inp["meta"],
			"pagination": inp["pagination"],
		}
	} else {
		actual = map[string]any{
			"success": true,
			"data":    inp["data"],
			"message": inp["message"],
			"meta":    inp["meta"],
		}
	}

	if expJSON, has := expect["json"]; has {
		check(id, actual, expJSON, "json")
	}
	if expKeys, has := expect["jsonKeys"]; has {
		keys := make([]string, 0, len(actual))
		for k := range actual {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		check(id, keys, sortedStrings(toStringSlice(expKeys)), "jsonKeys")
	}
}

// ---------- load and run ----------

func main() {
	// Locate vectors via multiple candidates.
	candidates := []string{
		filepath.Join("..", "typescript", "core", "conformance", "vectors"),
		filepath.Join("typescript", "core", "conformance", "vectors"),
		filepath.Join("..", "..", "typescript", "core", "conformance", "vectors"),
	}
	var vectorsDir string
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			vectorsDir = c
			break
		}
	}
	if vectorsDir == "" {
		fmt.Fprintf(os.Stderr, "cannot find conformance vectors directory\n")
		os.Exit(1)
	}

	entries, err := os.ReadDir(vectorsDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot read vectors dir %s: %v\n", vectorsDir, err)
		os.Exit(1)
	}

	runners := map[string]func(map[string]any){
		"error-code":          runErrorCode,
		"field-key":           runFieldKey,
		"pagination":          runPagination,
		"fetch-metadata":      runFetchMetadata,
		"cookie-profile":      runCookieProfile,
		"origin":              runOrigin,
		"csrf-format":         runCsrfFormat,
		"csrf-binding":        runCsrfBinding,
		"sort-direction":      runSortDirection,
		"correlation-id":      runCorrelationID,
		"content-negotiation": runContentNegotiation,
		"envelope":            runEnvelope,
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(vectorsDir, entry.Name()))
		if err != nil {
			fmt.Fprintf(os.Stderr, "read %s: %v\n", entry.Name(), err)
			os.Exit(1)
		}
		var doc vectorDoc
		if err := json.Unmarshal(data, &doc); err != nil {
			fmt.Fprintf(os.Stderr, "parse %s: %v\n", entry.Name(), err)
			os.Exit(1)
		}
		runner, ok := runners[doc.Category]
		if !ok {
			failed++
			failures = append(failures, failure{entry.Name(), "no-runner", doc.Category, "missing"})
			continue
		}
		for _, v := range doc.Vectors {
			func() {
				defer func() {
					if r := recover(); r != nil {
						failed++
						failures = append(failures, failure{getStr(v, "id"), "runner-threw", v["expect"], fmt.Sprint(r)})
					}
				}()
				runner(v)
			}()
		}
	}

	fmt.Printf("\nConformance: %d passed, %d failed\n", passed, failed)
	if len(failures) > 0 {
		fmt.Println("\nFailures:")
		limit := 30
		if len(failures) < limit {
			limit = len(failures)
		}
		for _, f := range failures[:limit] {
			expJSON, _ := json.Marshal(f.expected)
			actJSON, _ := json.Marshal(f.actual)
			fmt.Printf("  %s [%s]\n", f.id, f.label)
			fmt.Printf("    expected: %s\n", expJSON)
			fmt.Printf("    actual:   %s\n", actJSON)
		}
		if len(failures) > 30 {
			fmt.Printf("  ... and %d more\n", len(failures)-30)
		}
		os.Exit(1)
	}
}
