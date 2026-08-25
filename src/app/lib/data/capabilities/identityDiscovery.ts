import {
  DEFAULT_PRODUCT_RESOLUTION_LOCALE,
  PROVIDER_IDENTITY_CACHE_VERSION,
  PROVIDER_IDENTITY_TTL_MS,
  buildProviderIdentityCacheKey,
  type ProviderIdentityCache,
} from "./cacheContracts";
import { routeProvidersForProfile } from "./router";
import type {
  CanonicalIdentityLevel,
  LiveDataCapability,
  LiveProviderId,
  ProductIdentityConfidence,
  ProductProfile,
  ProviderIdentityCandidate,
  ProviderIdentityCandidateBucket,
  ProviderIdentityCandidateClassification,
  ProviderIdentityDiscoveryReport,
  ProviderIdentityDiscoveryRequest,
  ProviderIdentityDiscoveryResult,
  ProviderIdentityDiscoveryStatus,
  ProviderIdentityEvidence,
  ProviderIdentityGroup,
  ProviderIdentityListingType,
  ProviderIdentityProviderIdGroup,
  ProviderRoutingPlan,
} from "./types";

export interface ProviderIdentityDiscoveryClient {
  discoverCandidates(request: ProviderIdentityDiscoveryRequest): Promise<ProviderIdentityCandidate[]>;
}

export interface ProviderIdentityDiscoveryOptions {
  cache?: ProviderIdentityCache;
  candidates?: ProviderIdentityCandidate[];
  client?: ProviderIdentityDiscoveryClient;
  canonicalIdentityLevel?: CanonicalIdentityLevel;
  dryRun?: boolean;
  locale?: string;
  now?: () => Date;
}

interface CandidateMatch {
  candidate: ProviderIdentityCandidate;
  confidence: ProductIdentityConfidence | "rejected";
  score: number;
  evidence: ProviderIdentityEvidence[];
  warnings: string[];
  ambiguous: boolean;
}

export interface ProviderIdentityCandidateEvaluation {
  candidate: ProviderIdentityCandidate;
  identityConfidence: ProductIdentityConfidence | "rejected";
  score: number;
  evidence: ProviderIdentityEvidence[];
  warnings: string[];
  ambiguous: boolean;
  classification: ProviderIdentityCandidateClassification;
}

const SEARCH_IDENTITY_PROVIDERS: LiveProviderId[] = ["dataforseo_trends", "dataforseo_google_ads"];
const GOOGLE_SHOPPING_PROVIDER: LiveProviderId = "dataforseo_google_shopping";
const GOOGLE_SHOPPING_REVIEW_PROVIDER: LiveProviderId = "dataforseo_google_shopping_reviews";
const REQUIRED_GOOGLE_SHOPPING_IDS = ["productId", "gid", "dataDocid"];
const ACCESSORY_PHRASES = [
  "accessory",
  "charging cable",
  "charging case",
  "charging dock",
  "case for",
  "charger for",
  "band for",
  "strap for",
  "screen protector",
  "replacement",
];
const BUNDLE_PHRASES = ["bundle", "kit", "with earbuds", "wireless earbuds", "+ charging dock"];
const CONDITION_PHRASES = ["refurbished", "renewed", "used", "pre owned", "pre-owned"];
const COLOR_TERMS = [
  "black",
  "blue",
  "bone",
  "citron",
  "gold",
  "gray",
  "grey",
  "green",
  "lunar gold",
  "midnight",
  "periwinkle",
  "pink",
  "silver",
  "slate",
  "white",
];

function roundTo(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokensFor(value: string | undefined): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length > 1 || /^[0-9]+$/.test(token));
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function containsAnyPhrase(value: string, phrases: readonly string[]): string | undefined {
  return phrases.find((phrase) => value.includes(phrase));
}

function titleContainsAllTokens(title: string, value: string | undefined): boolean {
  const titleTokens = new Set(tokensFor(title));
  const expectedTokens = tokensFor(value);

  return expectedTokens.length > 0 && expectedTokens.every((token) => titleTokens.has(token));
}

function extractSizeVariant(value: string): string | undefined {
  const normalized = normalizeText(value);
  const sizeMatch = /\b([0-9]{2,3})\s*mm\b/.exec(normalized)
    ?? /\b([0-9]{2,3})\s*gb\b/.exec(normalized)
    ?? /\b([0-9]{1,2})\s*tb\b/.exec(normalized);

  if (sizeMatch) return sizeMatch[0].replace(/\s+/g, "");
  if (/\bone size\b|\bone_size\b/.test(normalized)) return "one_size";

  return undefined;
}

function extractColorVariant(value: string): string | undefined {
  const normalized = normalizeText(value);
  const matched = COLOR_TERMS.filter((color) => normalized.includes(color));

  return matched.length ? unique(matched).join("/") : undefined;
}

function canonicalProductFamily(profile: ProductProfile, candidate: ProviderIdentityCandidate): string {
  if (candidate.canonicalProductFamily) return candidate.canonicalProductFamily;
  if (profile.brand && profile.modelGeneration) return `${profile.brand} ${profile.modelGeneration}`;

  return [profile.brand, profile.canonicalTitle].filter(Boolean).join(" ") || candidate.title;
}

function providerIdSignature(candidate: ProviderIdentityCandidate): string | undefined {
  if (!hasRequiredGoogleShoppingIds(candidate)) return undefined;

  return REQUIRED_GOOGLE_SHOPPING_IDS
    .map((field) => `${field}:${candidate.providerIds[field]}`)
    .join("|");
}

function groupKeyFor(input: {
  family: string;
  sizeVariant?: string;
  canonicalIdentityLevel: CanonicalIdentityLevel;
}): string {
  const familyKey = normalizeText(input.family);
  if (input.canonicalIdentityLevel === "size_variant") {
    return `${familyKey}:size:${input.sizeVariant ?? "unspecified"}`;
  }

  return familyKey;
}

function providerIdsFromSignature(signature: string | undefined): Record<string, string> {
  if (!signature) return {};

  return Object.fromEntries(signature.split("|").map((part) => {
    const separator = part.indexOf(":");
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
}

function evidence(input: {
  field: string;
  expected?: string | string[];
  observed?: string | string[];
  score?: number;
  passed: boolean;
  reason: string;
}): ProviderIdentityEvidence {
  return input;
}

function confidenceRank(confidence: ProductIdentityConfidence): number {
  const ranks: Record<ProductIdentityConfidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return ranks[confidence];
}

function strongerConfidence(
  current: ProductIdentityConfidence,
  discovered: ProductIdentityConfidence
): ProductIdentityConfidence {
  return confidenceRank(discovered) > confidenceRank(current) ? discovered : current;
}

function confidenceFromScore(score: number): ProductIdentityConfidence | "rejected" {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  if (score >= 45) return "low";
  return "rejected";
}

function tokenCoverage(candidateTitle: string, profile: ProductProfile): number {
  const candidateTokens = new Set(tokensFor(candidateTitle));
  const identityTokens = unique(tokensFor([
    profile.brand,
    profile.canonicalTitle,
    profile.query,
    profile.modelGeneration,
    ...profile.aliases,
  ].filter(Boolean).join(" ")));

  if (!identityTokens.length) return 0;

  const overlap = identityTokens.filter((token) => candidateTokens.has(token)).length;
  return roundTo((overlap / identityTokens.length) * 100);
}

function brandMatches(candidate: ProviderIdentityCandidate, profile: ProductProfile): boolean {
  if (!profile.brand) return false;

  const expected = normalizeText(profile.brand);
  const observed = normalizeText(candidate.brand ?? candidate.title);

  return observed.split(" ").includes(expected) ||
    observed.includes(expected) ||
    normalizeText(candidate.title).includes(expected);
}

function hasGenerationMatch(candidate: ProviderIdentityCandidate, profile: ProductProfile): boolean {
  if (!profile.modelGeneration) return true;

  const titleTokens = new Set(tokensFor(candidate.title));
  const generationTokens = tokensFor(profile.modelGeneration);

  return generationTokens.length > 0 && generationTokens.every((token) => titleTokens.has(token));
}

function hasAliasPhrase(candidate: ProviderIdentityCandidate, profile: ProductProfile): boolean {
  const title = normalizeText(candidate.title);
  const phrases = unique([profile.canonicalTitle, profile.query, ...profile.aliases].map(normalizeText));

  return phrases.some((phrase) => phrase.length > 0 && title.includes(phrase));
}

function hasRequiredGoogleShoppingIds(candidate: ProviderIdentityCandidate): boolean {
  return REQUIRED_GOOGLE_SHOPPING_IDS.every((field) => Boolean(candidate.providerIds[field]));
}

function listingTypeForBucket(bucket: ProviderIdentityCandidateBucket): ProviderIdentityListingType {
  switch (bucket) {
    case "bundle/kit":
      return "bundle";
    case "accessory":
      return "accessory";
    case "refurbished/used":
      return "condition_variant";
    case "different-size":
    case "legitimate-variant":
      return "variant_listing";
    case "brand/title-conflict":
    case "different-generation/model":
    case "unrelated":
      return "unrelated";
    case "incomplete-provider-identity":
      return "retailer_listing";
    case "canonical-product-equivalent":
    default:
      return "canonical_product";
  }
}

function conditionForTitle(normalizedTitle: string): "new" | "refurbished" | "used" {
  if (normalizedTitle.includes("refurbished") || normalizedTitle.includes("renewed")) return "refurbished";
  if (
    normalizedTitle.includes("used") ||
    normalizedTitle.includes("pre owned") ||
    normalizedTitle.includes("pre-owned")
  ) {
    return "used";
  }

  return "new";
}

export function classifyProviderIdentityCandidate(input: {
  profile: ProductProfile;
  candidate: ProviderIdentityCandidate;
  canonicalIdentityLevel?: CanonicalIdentityLevel;
}): ProviderIdentityCandidateClassification {
  const { profile, candidate } = input;
  const canonicalIdentityLevel = input.canonicalIdentityLevel ?? "product_family";
  const normalizedTitle = normalizeText(candidate.title);
  const accessoryPhrase = containsAnyPhrase(normalizedTitle, ACCESSORY_PHRASES);
  const bundlePhrase = containsAnyPhrase(normalizedTitle, BUNDLE_PHRASES);
  const conditionPhrase = containsAnyPhrase(normalizedTitle, CONDITION_PHRASES);
  const sizeVariant = candidate.sizeVariant ?? extractSizeVariant(candidate.title);
  const colorVariant = candidate.colorVariant ?? extractColorVariant(candidate.title);
  const family = canonicalProductFamily(profile, candidate);
  const brandMatch = brandMatches(candidate, profile);
  const generationMatch = hasGenerationMatch(candidate, profile);
  const providerIdComplete = hasRequiredGoogleShoppingIds(candidate);
  const signature = providerIdSignature(candidate);
  const condition = candidate.condition ?? conditionForTitle(normalizedTitle);
  const bundleStatus = candidate.bundleStatus ??
    (accessoryPhrase ? "accessory" : bundlePhrase ? "bundle" : "standalone");
  const evidenceItems: ProviderIdentityEvidence[] = [
    evidence({
      field: "brand",
      expected: profile.brand,
      observed: candidate.brand ?? candidate.title,
      passed: brandMatch,
      reason: brandMatch ? "brand_match" : "brand_missing_or_conflicting",
    }),
    evidence({
      field: "modelGeneration",
      expected: profile.modelGeneration,
      observed: candidate.title,
      passed: generationMatch,
      reason: generationMatch ? "model_generation_match" : "model_generation_mismatch",
    }),
    evidence({
      field: "providerIds",
      expected: REQUIRED_GOOGLE_SHOPPING_IDS,
      observed: Object.keys(candidate.providerIds),
      passed: providerIdComplete,
      reason: providerIdComplete ? "required_provider_ids_present" : "missing_required_provider_ids",
    }),
  ];
  const warnings: string[] = [];
  let bucket: ProviderIdentityCandidateBucket = "canonical-product-equivalent";

  if (!brandMatch) {
    bucket = "brand/title-conflict";
  } else if (!generationMatch) {
    bucket = "different-generation/model";
  } else if (conditionPhrase) {
    bucket = "refurbished/used";
    warnings.push(`Rejected non-canonical condition candidate: ${conditionPhrase}.`);
    evidenceItems.push(evidence({
      field: "condition",
      observed: candidate.title,
      passed: false,
      reason: `excluded_condition:${conditionPhrase}`,
    }));
  } else if (accessoryPhrase) {
    bucket = "accessory";
    warnings.push(`Rejected accessory candidate: ${accessoryPhrase}.`);
    evidenceItems.push(evidence({
      field: "candidate_type",
      observed: candidate.title,
      passed: false,
      reason: `excluded_accessory:${accessoryPhrase}`,
    }));
  } else if (bundlePhrase) {
    bucket = "bundle/kit";
    warnings.push(`Bundle candidate requires manual identity review: ${bundlePhrase}.`);
    evidenceItems.push(evidence({
      field: "bundle_guardrail",
      observed: candidate.title,
      passed: false,
      reason: `bundle_or_kit:${bundlePhrase}`,
    }));
  } else if (!providerIdComplete) {
    bucket = "incomplete-provider-identity";
  } else if (sizeVariant && canonicalIdentityLevel === "size_variant") {
    bucket = "different-size";
  } else if (sizeVariant || colorVariant) {
    bucket = sizeVariant ? "different-size" : "legitimate-variant";
  }

  return {
    candidate: {
      ...candidate,
      canonicalProductFamily: family,
      modelGeneration: candidate.modelGeneration ?? profile.modelGeneration,
      sizeVariant,
      colorVariant,
      bundleStatus,
      condition,
      listingType: candidate.listingType ?? listingTypeForBucket(bucket),
    },
    bucket,
    canonicalProductFamily: family,
    modelGeneration: candidate.modelGeneration ?? profile.modelGeneration,
    sizeVariant,
    colorVariant,
    bundleStatus,
    condition,
    listingType: candidate.listingType ?? listingTypeForBucket(bucket),
    groupKey: groupKeyFor({ family, sizeVariant, canonicalIdentityLevel }),
    providerIdComplete,
    providerIdSignature: signature,
    evidence: evidenceItems,
    warnings,
  };
}

function evaluateProviderIdentityCandidate(
  candidate: ProviderIdentityCandidate,
  profile: ProductProfile,
  canonicalIdentityLevel: CanonicalIdentityLevel = "product_family"
): CandidateMatch {
  const normalizedTitle = normalizeText(candidate.title);
  const warnings: string[] = [];
  const evidenceItems: ProviderIdentityEvidence[] = [];
  const classification = classifyProviderIdentityCandidate({ profile, candidate, canonicalIdentityLevel });
  const accessoryPhrase = classification.bucket === "accessory"
    ? classification.evidence.find((item) => item.reason.startsWith("excluded_accessory:"))?.reason.split(":")[1]
    : undefined;
  const bundlePhrase = classification.bucket === "bundle/kit"
    ? classification.evidence.find((item) => item.reason.startsWith("bundle_or_kit:"))?.reason.split(":")[1]
    : undefined;
  const conditionPhrase = classification.bucket === "refurbished/used"
    ? classification.evidence.find((item) => item.reason.startsWith("excluded_condition:"))?.reason.split(":")[1]
    : undefined;
  const titleCoverage = tokenCoverage(candidate.title, profile);
  const brandMatch = brandMatches(candidate, profile);
  const generationMatch = hasGenerationMatch(candidate, profile);
  const aliasPhraseMatch = hasAliasPhrase(candidate, profile);
  const providerIdsPresent = hasRequiredGoogleShoppingIds(candidate);
  let score = titleCoverage * 0.55;

  evidenceItems.push(evidence({
    field: "title_token_coverage",
    expected: [profile.brand, profile.canonicalTitle, profile.modelGeneration].filter((value): value is string =>
      Boolean(value)
    ),
    observed: candidate.title,
    score: titleCoverage,
    passed: titleCoverage >= 65,
    reason: `title_token_coverage:${titleCoverage}`,
  }));

  evidenceItems.push(evidence({
    field: "brand",
    expected: profile.brand,
    observed: candidate.brand ?? candidate.title,
    passed: brandMatch,
    reason: brandMatch ? "brand_match" : "brand_missing_or_conflicting",
  }));

  evidenceItems.push(evidence({
    field: "modelGeneration",
    expected: profile.modelGeneration,
    observed: candidate.title,
    passed: generationMatch,
    reason: generationMatch ? "model_generation_match" : "model_generation_mismatch",
  }));

  evidenceItems.push(evidence({
    field: "providerIds",
    expected: REQUIRED_GOOGLE_SHOPPING_IDS,
    observed: Object.keys(candidate.providerIds),
    passed: providerIdsPresent,
    reason: providerIdsPresent ? "required_provider_ids_present" : "missing_required_provider_ids",
  }));

  if (bundlePhrase) {
    warnings.push(`Bundle candidate requires manual identity review: ${bundlePhrase}.`);
    return {
      candidate,
      confidence: "low",
      score: 40,
      evidence: [
        ...evidenceItems,
        evidence({
          field: "bundle_guardrail",
          observed: candidate.title,
          passed: false,
          reason: `bundle_or_kit:${bundlePhrase}`,
        }),
      ],
      warnings,
      ambiguous: true,
    };
  }

  if (accessoryPhrase) {
    warnings.push(`Rejected accessory candidate: ${accessoryPhrase}.`);
    return {
      candidate,
      confidence: "rejected",
      score: 0,
      evidence: [
        ...evidenceItems,
        evidence({
          field: "candidate_type",
          observed: candidate.title,
          passed: false,
          reason: `excluded_accessory:${accessoryPhrase}`,
        }),
      ],
      warnings,
      ambiguous: false,
    };
  }

  if (conditionPhrase) {
    warnings.push(`Rejected non-canonical condition candidate: ${conditionPhrase}.`);
    return {
      candidate,
      confidence: "rejected",
      score: 0,
      evidence: [
        ...evidenceItems,
        evidence({
          field: "condition",
          observed: candidate.title,
          passed: false,
          reason: `excluded_condition:${conditionPhrase}`,
        }),
      ],
      warnings,
      ambiguous: false,
    };
  }

  if (!brandMatch || !generationMatch || !providerIdsPresent) {
    return {
      candidate,
      confidence: "rejected",
      score: 0,
      evidence: evidenceItems,
      warnings,
      ambiguous: false,
    };
  }

  score += 20;
  if (generationMatch && profile.modelGeneration) score += 15;
  if (aliasPhraseMatch) score += 10;
  if (candidate.isBestMatch) score += 5;
  if (typeof candidate.rankAbsolute === "number" && candidate.rankAbsolute <= 3) score += 5;

  const cappedScore = roundTo(Math.min(100, score));

  return {
    candidate,
    confidence: confidenceFromScore(cappedScore),
    score: cappedScore,
    evidence: evidenceItems,
    warnings,
    ambiguous: false,
  };
}

export function evaluateProviderIdentityCandidates(input: {
  profile: ProductProfile;
  provider: LiveProviderId;
  candidates: ProviderIdentityCandidate[];
  canonicalIdentityLevel?: CanonicalIdentityLevel;
}): ProviderIdentityCandidateEvaluation[] {
  const canonicalIdentityLevel = input.canonicalIdentityLevel ?? "product_family";

  return input.candidates
    .filter((candidate) => candidate.provider === input.provider)
    .map((candidate) => evaluateProviderIdentityCandidate(candidate, input.profile, canonicalIdentityLevel))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.candidate.rankAbsolute ?? 9999) - (b.candidate.rankAbsolute ?? 9999);
    })
    .map((match) => ({
      candidate: match.candidate,
      identityConfidence: match.confidence,
      score: match.score,
      evidence: match.evidence,
      warnings: match.warnings,
      ambiguous: match.ambiguous,
      classification: classifyProviderIdentityCandidate({
        profile: input.profile,
        candidate: match.candidate,
        canonicalIdentityLevel,
      }),
    }));
}

function candidateIdentityScore(classification: ProviderIdentityCandidateClassification, profile: ProductProfile): number {
  if ([
    "accessory",
    "bundle/kit",
    "refurbished/used",
    "brand/title-conflict",
    "different-generation/model",
    "unrelated",
  ].includes(classification.bucket)) {
    return 0;
  }

  let score = tokenCoverage(classification.candidate.title, profile) * 0.55;

  score += 20;
  if (classification.modelGeneration) score += 15;
  if (hasAliasPhrase(classification.candidate, profile)) score += 10;
  if (classification.providerIdComplete) score += 5;
  if (classification.candidate.isBestMatch) score += 5;
  if (typeof classification.candidate.rankAbsolute === "number" && classification.candidate.rankAbsolute <= 3) {
    score += 5;
  }

  return roundTo(Math.min(100, score));
}

function isGroupEligible(classification: ProviderIdentityCandidateClassification): boolean {
  return [
    "canonical-product-equivalent",
    "legitimate-variant",
    "different-size",
    "incomplete-provider-identity",
  ].includes(classification.bucket);
}

function groupConfidence(score: number): ProductIdentityConfidence {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  return "low";
}

function rankValues(members: ProviderIdentityCandidateClassification[]): number[] {
  return members
    .map((member) => member.candidate.rankAbsolute)
    .filter((rank): rank is number => typeof rank === "number")
    .sort((a, b) => a - b);
}

function providerIdGroupSignature(member: ProviderIdentityCandidateClassification): string {
  return REQUIRED_GOOGLE_SHOPPING_IDS
    .map((field) => `${field}:${member.candidate.providerIds[field] ?? "<missing>"}`)
    .join("|");
}

function completenessForProviderIdGroup(
  members: ProviderIdentityCandidateClassification[]
): "complete" | "incomplete" {
  return members.every((member) => member.providerIdComplete) ? "complete" : "incomplete";
}

function consistencyFromMemberScores(
  members: ProviderIdentityCandidateClassification[],
  profile: ProductProfile
): ProductIdentityConfidence {
  const scores = members.map((member) => candidateIdentityScore(member, profile));
  const lowestScore = Math.min(...scores);

  return groupConfidence(lowestScore);
}

function variantConsistencyFor(input: {
  sizeVariants: string[];
  productGroupSizeVariants: string[];
}): ProductIdentityConfidence {
  if (input.sizeVariants.length > 1) return "low";
  if (input.sizeVariants.length === 1) return "high";
  if (input.productGroupSizeVariants.length > 1) return "medium";
  return "high";
}

function scopeForProviderIdGroup(input: {
  completeness: "complete" | "incomplete";
  sizeVariants: string[];
  productGroupSizeVariants: string[];
  sellerCount: number;
}): ProviderIdentityProviderIdGroup["scope"] {
  if (input.completeness === "incomplete") return "listing_specific";
  if (input.sizeVariants.length > 1) return "mixed_or_unclear";
  if (input.sizeVariants.length === 1) return "size_variant";
  if (input.productGroupSizeVariants.length > 1) return "mixed_or_unclear";
  if (input.sellerCount > 1) return "product_family";
  return "listing_specific";
}

function scoreForConsistency(confidence: ProductIdentityConfidence, highPoints: number, mediumPoints: number): number {
  if (confidence === "high") return highPoints;
  if (confidence === "medium") return mediumPoints;
  return 0;
}

function providerIdEvidenceScore(input: {
  completeness: "complete" | "incomplete";
  candidateCount: number;
  sellerDiversity: number;
  bestRank?: number;
  titleConsistency: ProductIdentityConfidence;
  variantConsistency: ProductIdentityConfidence;
  scope: ProviderIdentityProviderIdGroup["scope"];
}): number {
  let score = input.completeness === "complete" ? 35 : 5;

  score += Math.min(24, Math.max(0, input.sellerDiversity - 1) * 12);
  score += Math.min(10, Math.max(0, input.candidateCount - 1) * 4);
  score += scoreForConsistency(input.titleConsistency, 15, 8);
  score += scoreForConsistency(input.variantConsistency, 15, 8);
  if (typeof input.bestRank === "number" && input.bestRank <= 3) score += 5;
  else if (typeof input.bestRank === "number" && input.bestRank <= 10) score += 3;
  if (input.scope === "listing_specific") score -= 15;
  if (input.scope === "mixed_or_unclear") score -= 20;

  return roundTo(Math.max(0, Math.min(100, score)));
}

function providerIdGroupPersistence(input: {
  completeness: "complete" | "incomplete";
  sellerDiversity: number;
  titleConsistency: ProductIdentityConfidence;
  variantConsistency: ProductIdentityConfidence;
  scope: ProviderIdentityProviderIdGroup["scope"];
  canonicalIdentityLevel: CanonicalIdentityLevel;
  productGroupSizeVariants: string[];
}): { safe: boolean; reason: string } {
  if (input.completeness === "incomplete") {
    return { safe: false, reason: "provider_id_set_incomplete" };
  }

  if (input.titleConsistency === "low") {
    return { safe: false, reason: "provider_id_titles_inconsistent" };
  }

  if (input.variantConsistency === "low") {
    return { safe: false, reason: "conflicting_size_scope_for_provider_id_set" };
  }

  if (input.scope === "mixed_or_unclear") {
    return { safe: false, reason: "provider_id_scope_mixed_or_unclear" };
  }

  if (input.sellerDiversity < 2) {
    return { safe: false, reason: "provider_id_set_not_confirmed_across_independent_sellers" };
  }

  if (
    input.canonicalIdentityLevel === "product_family" &&
    input.scope === "size_variant" &&
    input.productGroupSizeVariants.length > 1
  ) {
    return {
      safe: false,
      reason: "provider_id_set_is_size_variant_but_product_family_has_multiple_sizes",
    };
  }

  return { safe: true, reason: "high_confidence_provider_id_group_confirmed_by_multiple_sellers" };
}

function buildProviderIdGroups(input: {
  members: ProviderIdentityCandidateClassification[];
  profile: ProductProfile;
  canonicalIdentityLevel: CanonicalIdentityLevel;
  productGroupSizeVariants: string[];
}): ProviderIdentityProviderIdGroup[] {
  const grouped = input.members.reduce<Map<string, ProviderIdentityCandidateClassification[]>>((map, member) => {
    const signature = providerIdGroupSignature(member);
    const existing = map.get(signature) ?? [];
    existing.push(member);
    map.set(signature, existing);
    return map;
  }, new Map());

  return [...grouped.entries()]
    .map(([signature, members]) => {
      const ranks = rankValues(members);
      const sellers = unique(members.map((member) => member.candidate.seller).filter((seller): seller is string =>
        Boolean(seller)
      ));
      const titles = unique(members.map((member) => member.candidate.title));
      const sizeVariants = unique(members.map((member) => member.sizeVariant).filter((size): size is string =>
        Boolean(size)
      ));
      const colorVariants = unique(members.map((member) => member.colorVariant).filter((color): color is string =>
        Boolean(color)
      ));
      const bundleStatuses = unique(members.map((member) => member.bundleStatus));
      const conditions = unique(members.map((member) => member.condition));
      const listingTypes = unique(members.map((member) => member.listingType));
      const completeness = completenessForProviderIdGroup(members);
      const titleConsistency = consistencyFromMemberScores(members, input.profile);
      const variantConsistency = variantConsistencyFor({
        sizeVariants,
        productGroupSizeVariants: input.productGroupSizeVariants,
      });
      const scope = scopeForProviderIdGroup({
        completeness,
        sizeVariants,
        productGroupSizeVariants: input.productGroupSizeVariants,
        sellerCount: sellers.length,
      });
      const evidenceScore = providerIdEvidenceScore({
        completeness,
        candidateCount: members.length,
        sellerDiversity: sellers.length,
        bestRank: ranks[0],
        titleConsistency,
        variantConsistency,
        scope,
      });
      const persistence = providerIdGroupPersistence({
        completeness,
        sellerDiversity: sellers.length,
        titleConsistency,
        variantConsistency,
        scope,
        canonicalIdentityLevel: input.canonicalIdentityLevel,
        productGroupSizeVariants: input.productGroupSizeVariants,
      });
      const identityConfidence = persistence.safe
        ? "high"
        : completeness === "complete" && evidenceScore >= 65
          ? "medium"
          : "low";

      return {
        signature,
        providerIds: completeness === "complete" ? providerIdsFromSignature(signature) : {},
        canonicalProductFamily: members[0].canonicalProductFamily,
        modelGeneration: members[0].modelGeneration,
        sizeVariant: sizeVariants.length === 1 ? sizeVariants[0] : undefined,
        sizeVariants,
        colorVariants,
        sellers,
        candidateCount: members.length,
        bestRank: ranks[0],
        ranks,
        titles,
        bundleStatuses,
        conditions,
        listingTypes,
        titleConsistency,
        sellerDiversity: sellers.length,
        identityCompleteness: completeness,
        variantConsistency,
        scope,
        evidenceScore,
        identityConfidence,
        providerIdsSafeToPersist: persistence.safe,
        persistenceReason: persistence.reason,
        warnings: persistence.safe ? [] : [persistence.reason],
      } satisfies ProviderIdentityProviderIdGroup;
    })
    .sort((a, b) => {
      if (b.evidenceScore !== a.evidenceScore) return b.evidenceScore - a.evidenceScore;
      if (b.candidateCount !== a.candidateCount) return b.candidateCount - a.candidateCount;
      return (a.bestRank ?? 9999) - (b.bestRank ?? 9999);
    });
}

function providerIdPersistence(input: {
  providerIdGroups: ProviderIdentityProviderIdGroup[];
}): {
  safe: boolean;
  ids: Record<string, string>;
  reason: string;
  confidence: ProductIdentityConfidence;
  selectedProviderIdGroup?: ProviderIdentityProviderIdGroup;
} {
  const completeGroups = input.providerIdGroups.filter((group) => group.identityCompleteness === "complete");

  if (!completeGroups.length) {
    return {
      safe: false,
      ids: {},
      reason: "no_complete_provider_id_set_in_selected_group",
      confidence: "low",
    };
  }

  const highConfidenceGroups = completeGroups.filter((group) => group.providerIdsSafeToPersist);

  if (!highConfidenceGroups.length) {
    const topGroup = completeGroups[0];

    return {
      safe: false,
      ids: {},
      reason: topGroup.persistenceReason,
      confidence: topGroup.identityConfidence,
      selectedProviderIdGroup: topGroup,
    };
  }

  const [topGroup, secondGroup] = highConfidenceGroups;
  if (!secondGroup || topGroup.evidenceScore - secondGroup.evidenceScore > 10) {
    return {
      safe: true,
      ids: topGroup.providerIds,
      reason: topGroup.persistenceReason,
      confidence: "high",
      selectedProviderIdGroup: topGroup,
    };
  }

  return {
    safe: false,
    ids: {},
    reason: "multiple_high_confidence_provider_id_groups_in_identity_group",
    confidence: "medium",
    selectedProviderIdGroup: topGroup,
  };
}

export function buildProviderIdentityGroups(input: {
  profile: ProductProfile;
  provider: LiveProviderId;
  candidates: ProviderIdentityCandidate[];
  canonicalIdentityLevel?: CanonicalIdentityLevel;
}): ProviderIdentityGroup[] {
  const canonicalIdentityLevel = input.canonicalIdentityLevel ?? "product_family";
  const classifications = input.candidates
    .filter((candidate) => candidate.provider === input.provider)
    .map((candidate) => classifyProviderIdentityCandidate({
      profile: input.profile,
      candidate,
      canonicalIdentityLevel,
    }))
    .filter(isGroupEligible);
  const grouped = classifications.reduce<Map<string, ProviderIdentityCandidateClassification[]>>((map, classification) => {
    const existing = map.get(classification.groupKey) ?? [];
    existing.push(classification);
    map.set(classification.groupKey, existing);
    return map;
  }, new Map());

  return [...grouped.entries()]
    .map(([groupKey, members]) => {
      const scoredMembers = members
        .map((member) => ({
          member,
          score: candidateIdentityScore(member, input.profile),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.member.candidate.rankAbsolute ?? 9999) - (b.member.candidate.rankAbsolute ?? 9999);
        });
      const strongest = scoredMembers[0];
      const sellerCount = unique(members.map((member) => member.candidate.seller).filter((seller): seller is string =>
        Boolean(seller)
      )).length;
      const sizeVariants = unique(members.map((member) => member.sizeVariant).filter((size): size is string =>
        Boolean(size)
      ));
      const colorVariants = unique(members.map((member) => member.colorVariant).filter((color): color is string =>
        Boolean(color)
      ));
      const providerIdGroups = buildProviderIdGroups({
        members,
        profile: input.profile,
        canonicalIdentityLevel,
        productGroupSizeVariants: sizeVariants,
      });
      const confirmationBonus = Math.min(8, Math.max(0, members.length - 1) * 2);
      const sellerDiversityBonus = Math.min(4, Math.max(0, sellerCount - 1));
      const score = roundTo(Math.min(100, strongest.score + confirmationBonus + sellerDiversityBonus));
      const persistence = providerIdPersistence({ providerIdGroups });
      const warnings = unique([
        ...members.flatMap((member) => member.warnings),
        ...(sizeVariants.length > 1 && canonicalIdentityLevel === "product_family"
          ? ["Multiple physical sizes map to this product-family identity."]
          : []),
        ...(!persistence.safe ? [persistence.reason] : []),
      ]);

      return {
        groupKey,
        canonicalProductFamily: strongest.member.canonicalProductFamily,
        modelGeneration: strongest.member.modelGeneration,
        sizeVariant: canonicalIdentityLevel === "size_variant" ? strongest.member.sizeVariant : undefined,
        sizeVariants,
        colorVariants,
        members,
        strongestCandidate: strongest.member.candidate,
        score,
        identityConfidence: groupConfidence(score),
        providerIds: persistence.safe ? persistence.ids : {},
        providerIdsSafeToPersist: persistence.safe,
        providerIdPersistenceReason: persistence.reason,
        providerIdConfidence: persistence.confidence,
        providerIdGroups,
        selectedProviderIdGroup: persistence.selectedProviderIdGroup,
        sellerCount,
        warnings,
        evidence: [
          evidence({
            field: "identity_group_score",
            score,
            passed: score >= 65,
            reason: `identity_group_score:${score}`,
          }),
          evidence({
            field: "identity_group_members",
            observed: String(members.length),
            passed: members.length > 0,
            reason: `equivalent_candidate_count:${members.length}`,
          }),
          evidence({
            field: "seller_diversity",
            observed: String(sellerCount),
            passed: sellerCount > 0,
            reason: `seller_diversity:${sellerCount}`,
          }),
          evidence({
            field: "provider_id_persistence",
            passed: persistence.safe,
            reason: persistence.reason,
          }),
          evidence({
            field: "provider_id_confidence",
            observed: persistence.confidence,
            passed: persistence.confidence === "high",
            reason: `provider_id_confidence:${persistence.confidence}`,
          }),
        ],
      } satisfies ProviderIdentityGroup;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.strongestCandidate.rankAbsolute ?? 9999) - (b.strongestCandidate.rankAbsolute ?? 9999);
    });
}

function result(input: {
  request: ProviderIdentityDiscoveryRequest;
  status: ProviderIdentityDiscoveryStatus;
  identityConfidence?: ProductIdentityConfidence;
  providerIds?: Record<string, string>;
  candidate?: ProviderIdentityCandidate;
  selectedGroup?: ProviderIdentityGroup;
  candidateCount?: number;
  identityGroupCount?: number;
  discoveredAt: string;
  cacheStatus: ProviderIdentityDiscoveryResult["cacheStatus"];
  cacheKey?: string;
  evidence?: ProviderIdentityEvidence[];
  warnings?: string[];
}): ProviderIdentityDiscoveryResult {
  const { request, candidate } = input;

  return {
    provider: request.provider,
    status: input.status,
    identityConfidence: input.identityConfidence ?? "low",
    providerIds: input.providerIds ?? {},
    canonicalTitle: candidate?.title,
    brand: candidate?.brand ?? request.profile.brand,
    modelGeneration: request.profile.modelGeneration,
    matchedVariant: candidate?.matchedVariant,
    warnings: input.warnings ?? [],
    evidence: input.evidence ?? [],
    selectedCandidate: candidate,
    selectedGroup: input.selectedGroup,
    candidateCount: input.candidateCount ?? 0,
    identityGroupCount: input.identityGroupCount,
    discoveredAt: input.discoveredAt,
    cacheStatus: input.cacheStatus,
    cacheKey: input.cacheKey,
  };
}

function searchIdentityResult(
  request: ProviderIdentityDiscoveryRequest,
  discoveredAt: string
): ProviderIdentityDiscoveryResult {
  return result({
    request,
    status: "resolved",
    identityConfidence: request.profile.identityConfidence,
    discoveredAt,
    cacheStatus: "disabled",
    evidence: [
      evidence({
        field: "query",
        observed: request.profile.query,
        passed: Boolean(request.profile.query),
        reason: "search_provider_uses_query_identity",
      }),
      evidence({
        field: "aliases",
        observed: request.profile.aliases,
        passed: request.profile.aliases.length > 0,
        reason: "search_provider_uses_alias_identity",
      }),
    ],
    warnings: ["Search providers use query and alias identity; no provider product IDs are required."],
  });
}

function blockedResult(
  request: ProviderIdentityDiscoveryRequest,
  discoveredAt: string,
  reason: string,
  cacheStatus: ProviderIdentityDiscoveryResult["cacheStatus"],
  cacheKey?: string
): ProviderIdentityDiscoveryResult {
  return result({
    request,
    status: "blocked",
    discoveredAt,
    cacheStatus,
    cacheKey,
    evidence: [
      evidence({
        field: "provider_policy",
        observed: request.provider,
        passed: false,
        reason,
      }),
    ],
    warnings: [reason],
  });
}

function cacheEntryToResult(input: {
  request: ProviderIdentityDiscoveryRequest;
  entry: Awaited<ReturnType<ProviderIdentityCache["get"]>>;
  discoveredAt: string;
}): ProviderIdentityDiscoveryResult | undefined {
  const entry = input.entry;
  if (!entry) return undefined;

  return {
    provider: entry.provider,
    status: "resolved",
    identityConfidence: entry.identityConfidence,
    providerIds: entry.providerIds,
    canonicalTitle: entry.canonicalTitle,
    brand: entry.brand,
    modelGeneration: entry.modelGeneration,
    matchedVariant: entry.matchedVariant,
    warnings: entry.warnings,
    evidence: entry.evidence,
    candidateCount: 0,
    discoveredAt: input.discoveredAt,
    cacheStatus: "hit",
    cacheKey: entry.cacheKey,
  };
}

async function readCachedIdentity(input: {
  request: ProviderIdentityDiscoveryRequest;
  cache?: ProviderIdentityCache;
  cacheKey: string;
  now: Date;
}): Promise<{ cached?: ProviderIdentityDiscoveryResult; cacheStatus: ProviderIdentityDiscoveryResult["cacheStatus"] }> {
  if (!input.cache) return { cacheStatus: "disabled" };

  const entry = await input.cache.get(input.cacheKey, input.request.provider);
  if (!entry) return { cacheStatus: "miss" };

  if (Date.parse(entry.expiresAt) <= input.now.getTime()) return { cacheStatus: "expired" };

  return {
    cached: cacheEntryToResult({
      request: input.request,
      entry,
      discoveredAt: input.now.toISOString(),
    }),
    cacheStatus: "hit",
  };
}

function expiresAt(discoveredAt: Date, confidence: ProductIdentityConfidence): string {
  return new Date(discoveredAt.getTime() + PROVIDER_IDENTITY_TTL_MS[confidence]).toISOString();
}

async function persistResolvedIdentity(input: {
  cache?: ProviderIdentityCache;
  cacheKey: string;
  locale: string;
  request: ProviderIdentityDiscoveryRequest;
  discovery: ProviderIdentityDiscoveryResult;
  now: Date;
}): Promise<void> {
  if (!input.cache || input.discovery.status !== "resolved") return;
  if (!Object.keys(input.discovery.providerIds).length) return;
  if (input.discovery.identityConfidence === "low") return;

  await input.cache.set({
    cacheKey: input.cacheKey,
    productId: input.request.profile.productId,
    provider: input.request.provider,
    providerIds: input.discovery.providerIds,
    identityConfidence: input.discovery.identityConfidence,
    canonicalTitle: input.discovery.canonicalTitle,
    brand: input.discovery.brand,
    modelGeneration: input.discovery.modelGeneration,
    matchedVariant: input.discovery.matchedVariant,
    warnings: input.discovery.warnings,
    evidence: input.discovery.evidence,
    resolvedAt: input.now.toISOString(),
    expiresAt: expiresAt(input.now, input.discovery.identityConfidence),
    version: PROVIDER_IDENTITY_CACHE_VERSION,
    locale: input.locale,
  });
}

function googleShoppingDiscoveryAllowed(
  request: ProviderIdentityDiscoveryRequest,
  plan: ProviderRoutingPlan
): { allowed: boolean; reason?: string } {
  const productType = request.profile.productType ?? "unknown";
  const route = plan.routes.find((candidate) =>
    candidate.provider === GOOGLE_SHOPPING_PROVIDER && candidate.capability === request.capability
  );

  if (request.provider !== GOOGLE_SHOPPING_PROVIDER) {
    return {
      allowed: false,
      reason: "Phase 3O only discovers Google Shopping product identity; detailed reviews reuse those IDs later.",
    };
  }

  if (request.capability !== "reviews") {
    return {
      allowed: false,
      reason: "Google Shopping identity discovery is only valid for review capability in Phase 3O.",
    };
  }

  if (productType === "software_saas") {
    return {
      allowed: false,
      reason: "Software/SaaS products are blocked from Google Shopping identity discovery.",
    };
  }

  if (productType === "mobile_app") {
    return {
      allowed: false,
      reason: "Mobile app products require app-store identity discovery rather than Google Shopping.",
    };
  }

  if (productType === "unknown" || request.profile.identityConfidence === "low") {
    return {
      allowed: false,
      reason: "Provider identity discovery is blocked until product classification and identity confidence improve.",
    };
  }

  if (!route || route.status === "blocked" || route.status === "unsupported") {
    return {
      allowed: false,
      reason: route?.reason ?? "Provider route is not available.",
    };
  }

  if (!request.profile.guardrails) {
    return {
      allowed: false,
      reason: "Google Shopping identity discovery requires explicit variant, bundle, accessory, or condition guardrails.",
    };
  }

  return { allowed: true };
}

async function candidateList(input: {
  request: ProviderIdentityDiscoveryRequest;
  options: ProviderIdentityDiscoveryOptions;
}): Promise<ProviderIdentityCandidate[]> {
  if (input.options.candidates) return input.options.candidates;
  if (input.options.dryRun) return [];
  if (input.options.client) return input.options.client.discoverCandidates(input.request);

  return [];
}

function matchCandidates(
  request: ProviderIdentityDiscoveryRequest,
  candidates: ProviderIdentityCandidate[],
  canonicalIdentityLevel: CanonicalIdentityLevel
): ProviderIdentityDiscoveryResult {
  const discoveredAt = new Date().toISOString();
  const candidateMatches = evaluateProviderIdentityCandidates({
    profile: request.profile,
    provider: request.provider,
    candidates,
    canonicalIdentityLevel,
  });
  const groups = buildProviderIdentityGroups({
    profile: request.profile,
    provider: request.provider,
    candidates,
    canonicalIdentityLevel,
  });

  if (!candidates.length) {
    return result({
      request,
      status: "not_found",
      discoveredAt,
      cacheStatus: "disabled",
      warnings: ["No provider identity candidates were available."],
      candidateCount: 0,
      identityGroupCount: 0,
    });
  }

  const selectedGroup = groups[0];
  const secondGroup = groups[1];

  if (!selectedGroup || selectedGroup.identityConfidence === "low") {
    const bestRejected = candidateMatches[0];
    return result({
      request,
      status: "ambiguous",
      identityConfidence: "low",
      candidate: bestRejected?.candidate,
      candidateCount: candidates.length,
      identityGroupCount: groups.length,
      discoveredAt,
      cacheStatus: "disabled",
      evidence: bestRejected?.evidence ?? [],
      warnings: unique([
        ...(bestRejected?.warnings ?? []),
        "No candidate met the deterministic identity threshold; provider IDs were not persisted.",
      ]),
    });
  }

  if (secondGroup && selectedGroup.score - secondGroup.score <= 5) {
    return result({
      request,
      status: "ambiguous",
      identityConfidence: "low",
      candidate: selectedGroup.strongestCandidate,
      candidateCount: candidates.length,
      identityGroupCount: groups.length,
      discoveredAt,
      cacheStatus: "disabled",
      evidence: selectedGroup.evidence,
      warnings: [
        "Multiple canonical identity groups scored too closely; provider IDs were not persisted.",
      ],
    });
  }

  const querySize = extractSizeVariant(request.profile.query);
  const unresolvedSizeVariant = canonicalIdentityLevel === "product_family" &&
    !querySize &&
    selectedGroup.sizeVariants.length > 1;
  const identityConfidence = selectedGroup.identityConfidence === "high" &&
    (unresolvedSizeVariant || !selectedGroup.providerIdsSafeToPersist)
      ? "medium"
      : selectedGroup.identityConfidence;

  return result({
    request,
    status: "resolved",
    identityConfidence,
    providerIds: selectedGroup.providerIdsSafeToPersist ? selectedGroup.providerIds : {},
    candidate: selectedGroup.strongestCandidate,
    selectedGroup,
    candidateCount: candidates.length,
    identityGroupCount: groups.length,
    discoveredAt,
    cacheStatus: "disabled",
    evidence: [
      ...selectedGroup.evidence,
      ...(unresolvedSizeVariant
        ? [evidence({
            field: "size_variant",
            observed: selectedGroup.sizeVariants,
            passed: false,
            reason: "multiple_size_variants_under_product_family",
          })]
        : []),
    ],
    warnings: unique([
      ...selectedGroup.warnings,
      ...(unresolvedSizeVariant
        ? ["Product-family identity contains multiple physical sizes; exact SKU/provider ID remains guarded."]
        : []),
      ...(!selectedGroup.providerIdsSafeToPersist
        ? ["Provider IDs appear listing-specific or inconsistent across equivalent candidates; IDs were not persisted."]
        : []),
    ]),
  });
}

export async function discoverProviderIdentity(
  request: ProviderIdentityDiscoveryRequest,
  options: ProviderIdentityDiscoveryOptions = {}
): Promise<ProviderIdentityDiscoveryResult> {
  const now = options.now?.() ?? new Date();
  const locale = request.locale ?? options.locale ?? DEFAULT_PRODUCT_RESOLUTION_LOCALE;
  const cacheKey = buildProviderIdentityCacheKey(request.profile, request.provider, locale);

  if (SEARCH_IDENTITY_PROVIDERS.includes(request.provider)) {
    return {
      ...searchIdentityResult(request, now.toISOString()),
      cacheKey,
    };
  }

  const beforePlan = routeProvidersForProfile(request.profile);
  const allowed = googleShoppingDiscoveryAllowed(request, beforePlan);
  if (!allowed.allowed) {
    return blockedResult(request, now.toISOString(), allowed.reason ?? "Provider identity discovery is blocked.", "disabled", cacheKey);
  }

  const cached = await readCachedIdentity({
    request,
    cache: options.cache,
    cacheKey,
    now,
  });

  if (cached.cached) return cached.cached;

  if (options.dryRun && !options.candidates) {
    return blockedResult(
      request,
      now.toISOString(),
      "Dry-run identity discovery cannot invoke provider clients.",
      cached.cacheStatus,
      cacheKey
    );
  }

  const candidates = await candidateList({ request, options });
  const canonicalIdentityLevel = options.canonicalIdentityLevel ?? "product_family";
  const matched = {
    ...matchCandidates(request, candidates, canonicalIdentityLevel),
    discoveredAt: now.toISOString(),
    cacheStatus: cached.cacheStatus,
    cacheKey,
  };

  await persistResolvedIdentity({
    cache: options.cache,
    cacheKey,
    locale,
    request,
    discovery: matched,
    now,
  });

  return matched;
}

export function enrichProductProfileWithProviderIdentity(
  profile: ProductProfile,
  discovery: ProviderIdentityDiscoveryResult
): ProductProfile {
  if (discovery.status !== "resolved" || !Object.keys(discovery.providerIds).length) return profile;

  const providerPayload = {
    ...discovery.providerIds,
    observedAt: discovery.discoveredAt,
    matchConfidence: discovery.identityConfidence,
    canonicalTitle: discovery.canonicalTitle,
    matchedVariant: discovery.matchedVariant,
  };

  return {
    ...profile,
    identityConfidence: strongerConfidence(profile.identityConfidence, discovery.identityConfidence),
    providerIds: {
      ...(profile.providerIds ?? {}),
      [discovery.provider]: providerPayload,
      ...(discovery.provider === GOOGLE_SHOPPING_PROVIDER
        ? { [GOOGLE_SHOPPING_REVIEW_PROVIDER]: providerPayload }
        : {}),
    },
  };
}

export function buildProviderIdentityDiscoveryReport(input: {
  originalQuery?: string;
  profile: ProductProfile;
  provider: LiveProviderId;
  discovery: ProviderIdentityDiscoveryResult;
  routingBefore?: ProviderRoutingPlan;
  enrichedProfile?: ProductProfile;
}): ProviderIdentityDiscoveryReport {
  const routingBefore = input.routingBefore ?? routeProvidersForProfile(input.profile);
  const enrichedProfile = input.enrichedProfile ?? enrichProductProfileWithProviderIdentity(input.profile, input.discovery);

  return {
    originalQuery: input.originalQuery ?? input.profile.query,
    canonicalProduct: input.profile.canonicalTitle,
    provider: input.provider,
    candidateCount: input.discovery.candidateCount,
    identityGroupCount: input.discovery.identityGroupCount,
    selectedCandidate: input.discovery.selectedCandidate,
    selectedGroup: input.discovery.selectedGroup,
    confidence: input.discovery.identityConfidence,
    providerIds: input.discovery.providerIds,
    warnings: input.discovery.warnings,
    cacheStatus: input.discovery.cacheStatus,
    identityResolutionStatus: input.discovery.status,
    routingBefore,
    routingAfter: routeProvidersForProfile(enrichedProfile),
    executionAllowed: false,
  };
}
