// filepath: src/field-key.ts
// layer: Validation | package: @apipilot/core | since: v0.1.0
// purpose: Field-key normalization for validation errors — mirrors FieldKeyNormalizer + ValidationKeyTransforms.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' validation integration, conformance runner
//   See also   : docs/validation.md#field-key-normalization (C# reference)
// -----------------------------------------------------------------------------

/**
 * Normalizes a model-binding field key to canonical camelCase form.
 * Mirrors FieldKeyNormalizer.Normalize (C#):
 *   - strips a single leading "$." JSONPath prefix
 *   - camelCases each dot-separated segment
 *   - preserves [i] bracket indices verbatim
 *   - leaves already-canonical keys unchanged
 */
export function normalizeFieldKey(raw: string): string {
  if (raw.length === 0) return raw;

  let key = raw;
  if (key.startsWith("$.")) {
    key = key.slice(2);
  }

  return key
    .split(".")
    .map((segment) => camelCaseSegment(segment))
    .join(".");
}

function camelCaseSegment(segment: string): string {
  // Preserve bracket index suffixes: "Items[0]" → base "Items", suffix "[0]"
  const bracketIndex = segment.indexOf("[");
  const base = bracketIndex >= 0 ? segment.slice(0, bracketIndex) : segment;
  const suffix = bracketIndex >= 0 ? segment.slice(bracketIndex) : "";

  return lowerFirst(base) + suffix;
}

function lowerFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Resolves the effective key transform: custom transform wins, else normalize.
 * Mirrors ValidationKeyTransforms.Resolve — single resolver shared by all paths.
 */
export function resolveKeyTransform(custom: ((raw: string) => string) | null | undefined) {
  return custom ?? normalizeFieldKey;
}
