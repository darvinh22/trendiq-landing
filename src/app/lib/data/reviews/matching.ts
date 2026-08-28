import { roundTo } from "../../scoring/normalization";
import { matchConfidenceRank } from "./config";
import type {
  GoogleShoppingProductCandidate,
  ProductMatchConfidence,
  ProductMatchResult,
  ReviewIdentityDecision,
  ReviewProductIdentityConfig,
} from "./types";

const ACCESSORY_PHRASES = [
  "compatible with",
  "case for",
  "charging cable",
  "charging case",
  "charging dock",
  "band for",
  "replacement lens",
  "replacement lenses",
  "replacement part",
  "screen protector",
  "nose pads",
  "strap for",
  "temple tips",
  "strap",
  "charger",
  "accessory",
];

const CONDITION_PHRASES = [
  "refurbished",
  "renewed",
  "used",
  "pre owned",
  "pre-owned",
];

const BUNDLE_PHRASES = [
  "bundle",
  "kit",
];

const IDENTITY_NOISE_TERMS = new Set([
  "best",
  "buy",
  "review",
  "reviews",
  "shop",
]);

const LISTING_NOISE_TERMS = new Set([
  "and",
  "best",
  "buy",
  "for",
  "genuine",
  "latest",
  "new",
  "official",
  "original",
  "product",
  "review",
  "reviews",
  "shop",
  "the",
  "with",
]);

const PRODUCT_CATEGORY_TERMS = [
  "blender",
  "camera",
  "device",
  "dryer",
  "earbud",
  "earbuds",
  "glasses",
  "headphone",
  "headphones",
  "laptop",
  "maker",
  "monitor",
  "phone",
  "printer",
  "ring",
  "router",
  "speaker",
  "styler",
  "sunglasses",
  "tablet",
  "tracker",
  "vacuum",
  "watch",
  "smartwatch",
  "smartwatches",
];

const PRODUCT_CATEGORY_ALIASES: Record<string, string> = {
  earbuds: "earbud",
  headphones: "headphone",
  smartwatch: "watch",
  smartwatches: "watch",
};

const TITLE_DESCRIPTOR_TERMS = new Set([
  ...PRODUCT_CATEGORY_TERMS,
  "bluetooth",
  "cream",
  "device",
  "fi",
  "fitness",
  "gps",
  "ice",
  "smart",
  "wi",
  "wifi",
  "wireless",
]);

const COSMETIC_VARIANT_TERMS = new Set([
  "aluminum",
  "black",
  "blue",
  "bone",
  "bronze",
  "citron",
  "color",
  "colour",
  "gold",
  "gray",
  "green",
  "grey",
  "large",
  "medium",
  "midnight",
  "pink",
  "platinum",
  "purple",
  "red",
  "rose",
  "silver",
  "size",
  "small",
  "steel",
  "titanium",
  "white",
  "xl",
]);

type IdentifierField = keyof GoogleShoppingProductCandidate["identifiers"];

interface BrandEvidence {
  matched: boolean;
  contradiction: boolean;
  reason?: string;
}

interface ModelEvidence {
  matched: boolean;
  ambiguousVariant: boolean;
  contradictionReason?: string;
  missingReason?: string;
  reasons: string[];
}

interface IdentifierEvidence {
  verifiedMatchField?: IdentifierField;
  unverifiedMatchField?: IdentifierField;
  strongMismatch: boolean;
  candidateHasProviderIds: boolean;
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
  return normalizeText(value).split(" ").filter(Boolean);
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function containsAnyPhrase(value: string, phrases: readonly string[]): string | undefined {
  return phrases.find((phrase) => value.includes(phrase));
}

function allTokensPresent(candidateTokens: Set<string>, expectedTokens: readonly string[]): boolean {
  return expectedTokens.length > 0 && expectedTokens.every((token) => candidateTokens.has(token));
}

function isYearToken(token: string): boolean {
  return /^(19|20)[0-9]{2}$/.test(token);
}

function isNumericOrSkuToken(token: string): boolean {
  return /^[0-9]+([.][0-9]+)?[a-z]*$/.test(token);
}

function isCosmeticVariantToken(token: string, titleTokens: readonly string[], index: number): boolean {
  if (COSMETIC_VARIANT_TERMS.has(token)) return true;
  if (/^[0-9]+(mm|gb|tb)$/.test(token)) return true;
  if (/^(mm|gb|tb)$/.test(token)) return true;

  const previous = titleTokens[index - 1];
  const next = titleTokens[index + 1];
  return /^[0-9]+$/.test(token) && (previous === "size" || /^(mm|gb|tb)$/.test(next ?? ""));
}

function normalizedPhraseIncludes(normalizedTitle: string, value: string | undefined): boolean {
  const phrase = normalizeText(value);
  return phrase.length > 0 && normalizedTitle.includes(phrase);
}

function identityBrandTokens(identity: ReviewProductIdentityConfig): string[] {
  return tokensFor(identity.brand).filter((token) => token.length > 1);
}

function identityModelTokens(identity: ReviewProductIdentityConfig): string[] {
  const brandTokens = new Set(identityBrandTokens(identity));

  return unique([
    ...tokensFor(identity.generation),
    ...tokensFor(identity.productTitle),
    ...tokensFor(identity.canonicalSearchQuery),
  ].filter((token) =>
    !brandTokens.has(token) &&
    !IDENTITY_NOISE_TERMS.has(token) &&
    (token.length > 1 || /^[0-9]+$/.test(token))
  ));
}

function titleModelLikeTokens(
  titleTokens: readonly string[],
  brandTokens: readonly string[],
  modelTokens: readonly string[]
): string[] {
  const brandTokenSet = new Set(brandTokens);
  const modelTokenSet = new Set(modelTokens);

  return titleTokens.filter((token, index) => {
    if (brandTokenSet.has(token)) return false;
    if (modelTokenSet.has(token)) return true;
    if (LISTING_NOISE_TERMS.has(token)) return false;
    if (TITLE_DESCRIPTOR_TERMS.has(token)) return false;
    if (isCosmeticVariantToken(token, titleTokens, index)) return false;
    return true;
  });
}

function categoryTermsFor(value: string | undefined): string[] {
  return unique(tokensFor(value)
    .filter((token) => PRODUCT_CATEGORY_TERMS.includes(token))
    .map((token) => PRODUCT_CATEGORY_ALIASES[token] ?? token));
}

function tokenCoverage(candidateTitle: string, identity: ReviewProductIdentityConfig): number {
  const candidateTokens = new Set(tokensFor(candidateTitle));
  const identityTokens = tokensFor([
    identity.productTitle,
    identity.brand,
    identity.canonicalSearchQuery,
    identity.generation,
  ].filter(Boolean).join(" "))
    .filter((token) => token.length > 1);
  const uniqueIdentityTokens = unique(identityTokens);

  if (!uniqueIdentityTokens.length) return 0;

  const overlap = uniqueIdentityTokens.filter((token) => candidateTokens.has(token)).length;
  return roundTo((overlap / uniqueIdentityTokens.length) * 100, 1);
}

function comparableIdentifierFields(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): IdentifierField[] {
  const providerIds = identity.providerProductIds;
  if (!providerIds) return [];

  return (["productId", "dataDocid", "gid"] as IdentifierField[])
    .filter((field) => Boolean(providerIds[field] && candidate.identifiers[field]));
}

function matchingIdentifierFields(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): IdentifierField[] {
  const providerIds = identity.providerProductIds;
  if (!providerIds) return [];

  return comparableIdentifierFields(candidate, identity)
    .filter((field) => providerIds[field] === candidate.identifiers[field]);
}

function identifierEvidence(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): IdentifierEvidence {
  const matchingFields = matchingIdentifierFields(candidate, identity);
  const comparableFields = comparableIdentifierFields(candidate, identity);
  const verified = identity.providerProductIds?.matchConfidence === "high";

  return {
    verifiedMatchField: verified ? matchingFields[0] : undefined,
    unverifiedMatchField: !verified ? matchingFields[0] : undefined,
    strongMismatch: verified && comparableFields.length >= 2 && matchingFields.length === 0,
    candidateHasProviderIds: Object.values(candidate.identifiers).some((value) => Boolean(value)),
  };
}

function hasAcceptedSeller(candidate: GoogleShoppingProductCandidate, identity: ReviewProductIdentityConfig): boolean {
  const seller = normalizeText(candidate.seller);
  if (!seller) return false;

  return (identity.acceptedSellers ?? []).some((acceptedSeller) =>
    seller === normalizeText(acceptedSeller)
  );
}

function hasCanonicalPhraseMatch(normalizedTitle: string, identity: ReviewProductIdentityConfig): boolean {
  return [identity.productTitle, identity.canonicalSearchQuery, identity.generation]
    .some((phrase) => normalizedPhraseIncludes(normalizedTitle, phrase));
}

function brandEvidence(
  normalizedTitle: string,
  titleTokens: readonly string[],
  identity: ReviewProductIdentityConfig,
  modelTokens: readonly string[]
): BrandEvidence {
  const brandTokens = identityBrandTokens(identity);

  if (!brandTokens.length) return { matched: false, contradiction: false, reason: "needs_identity_missing_brand" };

  const titleTokenSet = new Set(titleTokens);
  const matched = normalizedPhraseIncludes(normalizedTitle, identity.brand) ||
    allTokensPresent(titleTokenSet, brandTokens);
  if (matched) return { matched: true, contradiction: false, reason: "match_brand" };

  const firstModelIndex = titleTokens.findIndex((token) => modelTokens.includes(token));
  const leadingTokens = firstModelIndex > 0
    ? titleTokens.slice(0, firstModelIndex).filter((token, index) =>
        !LISTING_NOISE_TERMS.has(token) &&
        !TITLE_DESCRIPTOR_TERMS.has(token) &&
        !isYearToken(token) &&
        !isCosmeticVariantToken(token, titleTokens, index)
      )
    : [];

  if (leadingTokens.length > 0) {
    return { matched: false, contradiction: true, reason: "reject_brand_contradiction" };
  }

  return { matched: false, contradiction: false, reason: "needs_identity_missing_brand" };
}

function categoryContradiction(candidateTitle: string, identity: ReviewProductIdentityConfig): boolean {
  const identityCategories = categoryTermsFor([
    identity.productTitle,
    identity.canonicalSearchQuery,
    identity.generation,
  ].filter(Boolean).join(" "));
  const candidateCategories = categoryTermsFor(candidateTitle);

  return identityCategories.length > 0 &&
    candidateCategories.length > 0 &&
    !identityCategories.some((category) => candidateCategories.includes(category));
}

function contradictionReasonForModel(
  missingTokens: readonly string[],
  unexpectedTokens: readonly string[]
): string {
  const hasNumericConflict = [...missingTokens, ...unexpectedTokens].some(isNumericOrSkuToken);
  return hasNumericConflict ? "reject_generation_mismatch" : "reject_model_contradiction";
}

function modelEvidence(
  titleTokens: readonly string[],
  identity: ReviewProductIdentityConfig,
  brandMatched: boolean,
  modelTokens: readonly string[]
): ModelEvidence {
  if (!modelTokens.length) {
    return {
      matched: false,
      ambiguousVariant: false,
      missingReason: "needs_identity_missing_model",
      reasons: [],
    };
  }

  const titleTokenSet = new Set(titleTokens);
  const matchedTokens = modelTokens.filter((token) => titleTokenSet.has(token));
  const missingTokens = modelTokens.filter((token) => !titleTokenSet.has(token));
  const modelLikeTokens = titleModelLikeTokens(titleTokens, identityBrandTokens(identity), modelTokens);
  const unexpectedTokens = modelLikeTokens.filter((token) => !modelTokens.includes(token));
  const reasons = [
    `model_token_coverage:${roundTo((matchedTokens.length / modelTokens.length) * 100, 1)}`,
  ];

  if (!matchedTokens.length && brandMatched && unexpectedTokens.length > 0) {
    return {
      matched: false,
      ambiguousVariant: false,
      contradictionReason: "reject_model_contradiction",
      reasons,
    };
  }

  if (missingTokens.length > 0 && brandMatched && unexpectedTokens.length > 0) {
    return {
      matched: false,
      ambiguousVariant: false,
      contradictionReason: contradictionReasonForModel(missingTokens, unexpectedTokens),
      reasons,
    };
  }

  if (missingTokens.length > 0) {
    return {
      matched: false,
      ambiguousVariant: false,
      missingReason: "needs_identity_missing_model",
      reasons,
    };
  }

  if (unexpectedTokens.length > 0) {
    return {
      matched: true,
      ambiguousVariant: true,
      missingReason: "needs_identity_ambiguous_variant",
      reasons,
    };
  }

  return {
    matched: true,
    ambiguousVariant: false,
    reasons,
  };
}

function confidenceFromScore(score: number): ProductMatchConfidence {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  if (score >= 40) return "low";
  return "rejected";
}

function result(input: {
  identityDecision: ReviewIdentityDecision;
  confidence: ProductMatchConfidence;
  score: number;
  reasons: string[];
}): ProductMatchResult {
  return {
    identityDecision: input.identityDecision,
    confidence: input.confidence,
    score: roundTo(Math.min(100, Math.max(0, input.score)), 1),
    reasons: unique(input.reasons),
  };
}

function reject(reason: string, reasons: string[] = []): ProductMatchResult {
  return result({
    identityDecision: "reject",
    confidence: "rejected",
    score: 0,
    reasons: [reason, ...reasons],
  });
}

function needsIdentity(score: number, reasons: string[]): ProductMatchResult {
  return result({
    identityDecision: "needs_identity",
    confidence: "low",
    score: Math.min(60, score),
    reasons,
  });
}

function match(score: number, reasons: string[]): ProductMatchResult {
  const cappedScore = Math.min(100, score);

  return result({
    identityDecision: "match",
    confidence: confidenceFromScore(cappedScore),
    score: cappedScore,
    reasons,
  });
}

export function evaluateGoogleShoppingProductMatch(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): ProductMatchResult {
  const normalizedTitle = normalizeText(candidate.title);
  const titleTokens = tokensFor(candidate.title);
  const modelTokens = identityModelTokens(identity);
  const titleCoverage = tokenCoverage(candidate.title, identity);
  const reasons: string[] = [`title_token_coverage:${titleCoverage}`];
  const accessoryPhrase = containsAnyPhrase(normalizedTitle, ACCESSORY_PHRASES);
  const conditionPhrase = containsAnyPhrase(normalizedTitle, CONDITION_PHRASES);
  const bundlePhrase = containsAnyPhrase(normalizedTitle, BUNDLE_PHRASES);
  const identifiers = identifierEvidence(candidate, identity);

  if (accessoryPhrase) {
    return reject(`excluded_accessory:${accessoryPhrase}`, reasons);
  }

  if (conditionPhrase) {
    return reject(`excluded_product_condition:${conditionPhrase}`, reasons);
  }

  if (bundlePhrase) {
    return reject(`excluded_bundle_or_kit:${bundlePhrase}`, reasons);
  }

  const brand = brandEvidence(normalizedTitle, titleTokens, identity, modelTokens);
  const model = modelEvidence(titleTokens, identity, brand.matched, modelTokens);
  reasons.push(...model.reasons);

  if (brand.contradiction) {
    return reject(brand.reason ?? "reject_brand_contradiction", reasons);
  }

  if (brand.matched && categoryContradiction(candidate.title, identity)) {
    return reject("reject_category_contradiction", reasons);
  }

  if (model.contradictionReason) {
    return reject(model.contradictionReason, reasons);
  }

  const semanticBrandModelMatch = brand.matched && model.matched;

  if (identifiers.strongMismatch && !semanticBrandModelMatch) {
    return reject("reject_identifier_contradiction", reasons);
  }

  let score = titleCoverage * 0.65;

  if (hasCanonicalPhraseMatch(normalizedTitle, identity)) {
    score += 10;
    reasons.push("canonical_title_phrase_match");
  }

  if (hasAcceptedSeller(candidate, identity)) {
    score += 15;
    reasons.push("accepted_seller_match");
  }

  if (identifiers.verifiedMatchField) {
    score += 20;
    reasons.push("persisted_provider_identifier_match");
    reasons.push(`match_verified_identifier:${identifiers.verifiedMatchField}`);
  }

  if (candidate.isBestMatch) {
    score += 5;
    reasons.push("provider_best_match");
  }

  if (identifiers.verifiedMatchField) {
    if (semanticBrandModelMatch) reasons.push("match_brand_model");
    return match(Math.max(90, score), reasons);
  }

  if (semanticBrandModelMatch) {
    reasons.push("match_brand_model");

    if (identifiers.strongMismatch) {
      reasons.push("provider_identifier_mismatch_not_canonical");
    }

    if (model.ambiguousVariant) {
      return needsIdentity(score, [...reasons, "needs_identity_ambiguous_variant"]);
    }

    return match(Math.max(85, score + 20), reasons);
  }

  if (brand.matched) {
    reasons.push("match_brand");
  } else {
    reasons.push(brand.reason ?? "needs_identity_missing_brand");
  }

  if (model.matched) {
    reasons.push("match_model");
  } else {
    reasons.push(model.missingReason ?? "needs_identity_missing_model");
  }

  if (identifiers.unverifiedMatchField) {
    reasons.push(`needs_identity_provider_identifier_not_verified:${identifiers.unverifiedMatchField}`);
  } else if (identifiers.candidateHasProviderIds) {
    reasons.push("needs_identity_provider_identifier_uncorroborated");
  }

  if (!brand.matched && !model.matched && !identifiers.candidateHasProviderIds) {
    reasons.push("needs_identity_insufficient_evidence");
  }

  return needsIdentity(score, reasons);
}

export function matchConfidenceMeetsThreshold(
  confidence: ProductMatchConfidence,
  threshold: ProductMatchConfidence
): boolean {
  return matchConfidenceRank(confidence) >= matchConfidenceRank(threshold) && confidence !== "rejected";
}
