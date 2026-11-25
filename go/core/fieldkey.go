package core

import "strings"

// NormalizeFieldKey normalizes a raw field key to canonical camelCase form:
// strips a single leading "$." JSONPath prefix, camelCases each
// dot-separated segment, preserves "[i]" bracket indices verbatim.
// Mirrors FieldKeyNormalizer (C#).
func NormalizeFieldKey(raw string) string {
	if raw == "" {
		return raw
	}
	key := raw
	if strings.HasPrefix(key, "$.") {
		key = key[2:]
	}
	segments := strings.Split(key, ".")
	for i, seg := range segments {
		segments[i] = camelCaseSegment(seg)
	}
	return strings.Join(segments, ".")
}

func camelCaseSegment(segment string) string {
	bracket := strings.Index(segment, "[")
	var base, suffix string
	if bracket >= 0 {
		base, suffix = segment[:bracket], segment[bracket:]
	} else {
		base = segment
	}
	if base == "" {
		return segment
	}
	return strings.ToLower(base[:1]) + base[1:] + suffix
}

// KeyTransform normalizes a field key. Custom transforms win over the
// default — mirrors ValidationKeyTransforms.Resolve.
type KeyTransform func(raw string) string

// ResolveKeyTransform returns the effective key transform: custom wins,
// else NormalizeFieldKey.
func ResolveKeyTransform(custom KeyTransform) KeyTransform {
	if custom != nil {
		return custom
	}
	return NormalizeFieldKey
}
