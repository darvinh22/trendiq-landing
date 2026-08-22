import { roundTo } from "../../scoring/normalization";
import { matchConfidenceRank } from "./config";
import type {
  GoogleShoppingProductCandidate,
  ProductMatchConfidence,
  ProductMatchResult,
  ReviewProductIdentityConfig,
} from "./types";

const ACCESSORY_PHRASES = [
  "case for",
  "charging case",
  "replacement lens",
  "replacement lenses",
  "replacement part",
  "screen protector",
  "nose pads",
  "temple tips",
  "strap",
  "charger",
  "accessory",
];

const EXCLUDED_PRODUCT_PHRASES = [
  "refurbished",
  "renewed",
  "used",
  "pre owned",
  "pre-owned",
  "bundle",
  "kit",
];

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokensFor(value: string | undefined): Set<string> {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function containsRayBan(value: string): boolean {
  return value.includes("ray ban") || value.includes("rayban");
}

function containsAnyPhrase(value: string, phrases: readonly string[]): string | undefined {
  return phrases.find((phrase) => value.includes(phrase));
}

function tokenCoverage(candidateTitle: string, identity: ReviewProductIdentityConfig): number {
  const candidateTokens = tokensFor(candidateTitle);
  const identityTokens = [...tokensFor(`${identity.productTitle} ${identity.brand} ${identity.canonicalSearchQuery}`)]
    .filter((token) => token.length > 1);
  const uniqueIdentityTokens = [...new Set(identityTokens)];

  if (!uniqueIdentityTokens.length) return 0;

  const overlap = uniqueIdentityTokens.filter((token) => candidateTokens.has(token)).length;
  return roundTo((overlap / uniqueIdentityTokens.length) * 100, 1);
}

function hasPersistedIdentifierMatch(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): boolean {
  const providerIds = identity.providerProductIds;
  if (!providerIds) return false;

  return Boolean(
    (providerIds.productId && providerIds.productId === candidate.identifiers.productId) ||
    (providerIds.dataDocid && providerIds.dataDocid === candidate.identifiers.dataDocid) ||
    (providerIds.gid && providerIds.gid === candidate.identifiers.gid)
  );
}

function hasAcceptedSeller(candidate: GoogleShoppingProductCandidate, identity: ReviewProductIdentityConfig): boolean {
  const seller = normalizeText(candidate.seller);
  if (!seller) return false;

  return (identity.acceptedSellers ?? []).some((acceptedSeller) =>
    seller === normalizeText(acceptedSeller)
  );
}

function generationMatches(candidateTitle: string, identity: ReviewProductIdentityConfig): boolean {
  if (!identity.generation) return true;
  return normalizeText(candidateTitle).includes(normalizeText(identity.generation));
}

function confidenceFromScore(score: number): ProductMatchConfidence {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  if (score >= 40) return "low";
  return "rejected";
}

export function evaluateGoogleShoppingProductMatch(
  candidate: GoogleShoppingProductCandidate,
  identity: ReviewProductIdentityConfig
): ProductMatchResult {
  const normalizedTitle = normalizeText(candidate.title);
  const normalizedIdentity = normalizeText(`${identity.productTitle} ${identity.brand} ${identity.canonicalSearchQuery}`);
  const reasons: string[] = [];
  const accessoryPhrase = containsAnyPhrase(normalizedTitle, ACCESSORY_PHRASES);
  const excludedPhrase = containsAnyPhrase(normalizedTitle, EXCLUDED_PRODUCT_PHRASES);

  if (accessoryPhrase) {
    return {
      confidence: "rejected",
      score: 0,
      reasons: [`excluded_accessory:${accessoryPhrase}`],
    };
  }

  if (excludedPhrase) {
    return {
      confidence: "rejected",
      score: 0,
      reasons: [`excluded_product_condition:${excludedPhrase}`],
    };
  }

  if (!containsRayBan(normalizedTitle) || !normalizedTitle.includes("meta")) {
    return {
      confidence: "rejected",
      score: 0,
      reasons: ["missing_required_ray_ban_meta_identity"],
    };
  }

  if (!generationMatches(candidate.title, identity)) {
    return {
      confidence: "rejected",
      score: 0,
      reasons: ["generation_mismatch"],
    };
  }

  let score = tokenCoverage(candidate.title, identity) * 0.65;
  reasons.push(`title_token_coverage:${roundTo(tokenCoverage(candidate.title, identity), 1)}`);

  if (normalizedTitle.includes(normalizedIdentity) || normalizedIdentity.includes(normalizedTitle)) {
    score += 10;
    reasons.push("canonical_title_phrase_match");
  }

  if (hasAcceptedSeller(candidate, identity)) {
    score += 15;
    reasons.push("accepted_seller_match");
  }

  if (hasPersistedIdentifierMatch(candidate, identity)) {
    score += 20;
    reasons.push("persisted_provider_identifier_match");
  }

  if (candidate.isBestMatch) {
    score += 5;
    reasons.push("provider_best_match");
  }

  const confidence = confidenceFromScore(Math.min(100, score));

  return {
    confidence,
    score: roundTo(Math.min(100, score), 1),
    reasons,
  };
}

export function matchConfidenceMeetsThreshold(
  confidence: ProductMatchConfidence,
  threshold: ProductMatchConfidence
): boolean {
  return matchConfidenceRank(confidence) >= matchConfidenceRank(threshold) && confidence !== "rejected";
}
