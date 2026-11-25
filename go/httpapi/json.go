package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"
)

// Serialization modes — mirror ApiPilot.AspNetCore.Serialization (C#).

// EnumMode controls how enum-like values serialize.
type EnumMode string

const (
	// EnumAsString serializes enums by name (default; stable across ordinal changes).
	EnumAsString EnumMode = "string"
	// EnumAsNumber serializes enums by underlying numeric value.
	EnumAsNumber EnumMode = "number"
)

// DateMode controls how date/time values serialize.
type DateMode string

const (
	// DateISO8601 serializes dates as ISO 8601 strings (default).
	DateISO8601 DateMode = "iso8601"
	// DateUnixSeconds serializes dates as Unix epoch seconds (integer).
	DateUnixSeconds DateMode = "unixSeconds"
)

// NamingPolicy controls property/dictionary key casing.
type NamingPolicy string

const (
	// NamingCamelCase lowercases the leading uppercase run (default).
	NamingCamelCase NamingPolicy = "camelCase"
	// NamingSnakeCase converts to snake_case.
	NamingSnakeCase NamingPolicy = "snake_case"
	// NamingPassthrough leaves keys unchanged.
	NamingPassthrough NamingPolicy = "passthrough"
)

// Serialize marshals v to JSON applying the JsonOptions serialization modes.
// Mirrors JsonSerializerConfigurator (C#). Envelope keys are already
// camelCase so naming policies are identity on them; the transform applies
// recursively to the data payload.
func Serialize(v any, opts JsonOptions) ([]byte, error) {
	transformed := transformValue(v, opts)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if opts.Indent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(transformed); err != nil {
		return nil, err
	}
	// Encoder adds a trailing newline; trim for Content-Length parity.
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func transformValue(v any, opts JsonOptions) any {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case time.Time:
		return transformTime(t, opts)
	case *time.Time:
		if t == nil {
			return nil
		}
		return transformTime(*t, opts)
	case json.Marshaler:
		// Types with custom marshaling (e.g. core envelopes) pass through;
		// their inner data was already transformed by the caller path.
		return v
	case fmt.Stringer:
		if opts.EnumMode == EnumAsString {
			return t.String()
		}
		return v
	}

	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Map:
		out := make(map[string]any, rv.Len())
		iter := rv.MapRange()
		for iter.Next() {
			key := fmt.Sprint(iter.Key().Interface())
			val := iter.Value().Interface()
			if opts.IgnoreNulls && isNilValue(val) {
				continue
			}
			policy := effectiveNamingPolicy(opts)
			out[applyNamingPolicy(key, policy)] = transformValue(val, opts)
		}
		return out
	case reflect.Slice, reflect.Array:
		out := make([]any, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out[i] = transformValue(rv.Index(i).Interface(), opts)
		}
		return out
	case reflect.Struct:
		// Structs marshal via encoding/json tags; leave untouched except
		// time.Time handled above.
		return v
	case reflect.Ptr, reflect.Interface:
		if rv.IsNil() {
			return nil
		}
		return transformValue(rv.Elem().Interface(), opts)
	}
	return v
}

// effectiveNamingPolicy resolves the naming policy: explicit
// PropertyNamingPolicy wins; otherwise the legacy CamelCase flag;
// otherwise passthrough (zero-value JsonOptions preserves raw keys).
func effectiveNamingPolicy(opts JsonOptions) NamingPolicy {
	if opts.PropertyNamingPolicy != "" {
		return opts.PropertyNamingPolicy
	}
	if opts.CamelCase {
		return NamingCamelCase
	}
	return NamingPassthrough
}

func transformTime(t time.Time, opts JsonOptions) any {
	if opts.DateMode == DateUnixSeconds {
		return t.UTC().Unix()
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func isNilValue(v any) bool {
	if v == nil {
		return true
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Ptr, reflect.Interface, reflect.Map, reflect.Slice, reflect.Chan, reflect.Func:
		return rv.IsNil()
	}
	return false
}

// applyNamingPolicy mirrors System.Text.Json naming policies (C#):
// camelCase lowercases the leading uppercase run only (does NOT convert
// snake_case); snake_case inserts underscores before uppercase and
// lowercases; passthrough is identity.
func applyNamingPolicy(key string, policy NamingPolicy) string {
	switch policy {
	case NamingPassthrough:
		return key
	case NamingSnakeCase:
		return toSnakeCase(key)
	default: // camelCase
		return toCamelCase(key)
	}
}

func toCamelCase(s string) string {
	if s == "" {
		return s
	}
	// Lowercase the leading run of uppercase letters, but keep the last
	// uppercase if followed by a lowercase (e.g. "URLValue" -> "urlValue").
	i := 0
	for i < len(s) && s[i] >= 'A' && s[i] <= 'Z' {
		i++
	}
	if i > 1 && i < len(s) && s[i] >= 'a' && s[i] <= 'z' {
		i--
	}
	return strings.ToLower(s[:i]) + s[i:]
}

func toSnakeCase(s string) string {
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r + ('a' - 'A'))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
