// filepath: src/fetch-metadata.ts
// layer: Security | package: @apipilot/core | since: v0.1.0
// purpose: Fetch Metadata policy evaluation — mirrors FetchMetadataEvaluator (pure core).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' fetch-metadata middleware, conformance runner
//   See also   : docs/fetch-metadata.md (C# reference)
// -----------------------------------------------------------------------------

export type FetchMetadataProfile = "off" | "compat" | "strict";

export interface FetchMetadataOptions {
  profile: FetchMetadataProfile;
  /** Case-insensitive membership, mirroring C# HashSet(StringComparer.OrdinalIgnoreCase). */
  allowedSiteValues: readonly string[];
  /** Case-insensitive membership. */
  allowedModeValues: readonly string[];
  allowMissingHeaders: boolean;
}

export const DEFAULT_FETCH_METADATA_OPTIONS: FetchMetadataOptions = {
  profile: "off",
  allowedSiteValues: ["same-origin", "same-site", "none"],
  allowedModeValues: ["cors", "same-origin", "navigate"],
  allowMissingHeaders: true,
};

export type FetchMetadataRejectionReason =
  | "none"
  | "missingSiteHeader"
  | "malformedSiteHeader"
  | "disallowedSiteValue"
  | "disallowedModeValue";

export interface FetchMetadataDecision {
  decision: "allow" | "reject";
  reason: FetchMetadataRejectionReason;
}

const SPEC_SITE_VALUES = new Set(["same-origin", "same-site", "cross-site", "none"]);

const ALLOW: FetchMetadataDecision = { decision: "allow", reason: "none" };

function containsCaseInsensitive(set: readonly string[], value: string): boolean {
  const lower = value.toLowerCase();
  return set.some((entry) => entry.toLowerCase() === lower);
}

/**
 * Evaluates Sec-Fetch-Site / Sec-Fetch-Mode against the configured profile.
 * Mirrors FetchMetadataEvaluator exactly:
 *   - Off: allow everything.
 *   - Compat and Strict produce IDENTICAL decisions here — the profile
 *     distinction exists only for startup validation (Strict + cross-site
 *     in AllowedSiteValues fails closed). Both non-Off profiles apply:
 *       missing/malformed site → AllowMissingHeaders ? allow : reject
 *       present well-formed site → case-insensitive allow-list check
 *       present mode → case-insensitive allow-list check
 *   - AllowMissingHeaders governs ONLY missing/malformed — never a
 *     present disallowed value.
 *   - Site spec-set membership is case-insensitive (OrdinalIgnoreCase).
 */
export function evaluateFetchMetadata(
  site: string | null,
  mode: string | null,
  options: FetchMetadataOptions,
): FetchMetadataDecision {
  if (options.profile === "off") return ALLOW;

  const siteMissing = site === null || site === "";
  const siteWellFormed = !siteMissing && SPEC_SITE_VALUES.has(site.toLowerCase());

  if (!siteWellFormed) {
    if (options.allowMissingHeaders) return ALLOW;
    return {
      decision: "reject",
      reason: siteMissing ? "missingSiteHeader" : "malformedSiteHeader",
    };
  }

  // Present and well-formed — AllowMissingHeaders is not consulted.
  if (!containsCaseInsensitive(options.allowedSiteValues, site)) {
    return { decision: "reject", reason: "disallowedSiteValue" };
  }

  if (mode !== null && mode !== "" && !containsCaseInsensitive(options.allowedModeValues, mode)) {
    return { decision: "reject", reason: "disallowedModeValue" };
  }

  return ALLOW;
}
