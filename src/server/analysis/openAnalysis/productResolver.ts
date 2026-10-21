import { createHash } from "node:crypto";
import {
  buildProviderIdentityGroups,
  classifyProviderIdentityCandidate,
} from "../../../app/lib/data/capabilities/identityDiscovery";
import type {
  ProductProfile,
  ProviderIdentityCandidate,
  ProviderIdentityGroup,
} from "../../../app/lib/data/capabilities/types";

export const OPEN_IDENTITY_THRESHOLDS = {
  resolvedMinScore: 70,
  resolvedMinLead: 15,
  resolvedMinSellers: 2,
  ambiguousMinScore: 50,
  maxOptions: 3,
} as const;

export const IDENTITY_AND_SPECS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PRICE_AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;
export const ANALYSIS_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RESOLVES_PER_DAY = 100;
export const MAX_ANALYSES_PER_HOUR = 5;
export const MAX_ANALYSES_PER_DAY = 20;

const VARIANT_TOKENS = new Set(["ultra", "plus", "pro", "max", "mini", "lite", "air", "oled", "fe", "field"]);
const COLORS = [
  "black", "blue", "bone", "citron", "gold", "gray", "grey", "green", "lunar gold",
  "midnight", "periwinkle", "pink", "silver", "slate", "white",
];

export type OpenAbstainReason =
  | "not_found"
  | "low_confidence"
  | "accessory"
  | "bundle"
  | "used"
  | "prohibited"
  | "query_not_actionable";

export interface ShoppingCandidate {
  candidate: ProviderIdentityCandidate;
  price: number | null;
}

export interface ResolvedIdentityOption {
  candidateId: string;
  title: string;
  brand: string | null;
  identityKey: string;
  profile: ProductProfile;
  price: number | null;
}

export type IdentityDecision =
  | {
      status: "resolved";
      evidenceDate: string;
      identityKey: string;
      title: string;
      brand: string | null;
      model: string | null;
      profile: ProductProfile;
      price: number | null;
      sellerCount: number;
      score: number;
      lead: number;
    }
  | {
      status: "ambiguous";
      evidenceDate: string;
      options: ResolvedIdentityOption[];
    }
  | {
      status: "abstain";
      reason: Exclude<OpenAbstainReason, "prohibited" | "query_not_actionable">;
      message: string;
    };

const ABSTAIN_MESSAGE = "We can't identify this product reliably.";

export function abstainMessage(reason: OpenAbstainReason): string {
  if (reason === "accessory") return "This looks like an accessory, which TrendIQ does not analyze as a product.";
  if (reason === "bundle") return "This looks like a bundle, which TrendIQ does not analyze as a single product.";
  if (reason === "used") return "TrendIQ does not analyze used or refurbished listings.";
  if (reason === "prohibited") return "TrendIQ does not analyze this kind of product.";
  if (reason === "query_not_actionable") return "Enter a product name between 3 and 120 characters.";
  return ABSTAIN_MESSAGE;
}

export function sanitizeProductQuery(input: string):
  | { ok: true; query: string }
  | { ok: false; reason: "query_not_actionable"; query?: string }
  | { ok: false; reason: "prohibited"; query: string } {
  const withoutLinks = input
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/[<>]/g, " ");
  const query = withoutLinks.replace(/\s+/g, " ").trim();
  if (query.length < 3 || query.length > 120) return { ok: false, reason: "query_not_actionable" };
  if (isProhibitedQuery(query)) return { ok: false, reason: "prohibited", query };
  return { ok: true, query };
}

export function isProhibitedQuery(query: string): boolean {
  return PROHIBITED_QUERY.test(query);
}

const PROHIBITED_QUERY = new RegExp(
  [
    String.raw`\b(firearm|firearms|ammunition|rifle|pistol|handgun|silencer|suppressor|explosive|explosives|grenade|ar-15|glock|ak-47)\b`,
    String.raw`\b(sex toy|dildo|vibrator|pornography)\b`,
    String.raw`\b(cocaine|heroin|methamphetamine|fentanyl|oxycodone|adderall|xanax|percocet|sildenafil|viagra)\b`,
    String.raw`\b(prescription drug|prescription medication|rx only)\b`,
  ].join("|"),
  "i"
);

/**
 * Cache key for a shopper query. The full NFKC text is kept, then whitespace is
 * collapsed and ASCII case is folded. Stripping to ASCII would map distinct
 * non-Latin queries onto one empty key. Compatibility forms such as fullwidth
 * digits fold together. Letters that only look similar, such as Latin and
 * Cyrillic, stay different.
 */
export function queryHash(query: string): string {
  const folded = query.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return sha256(folded);
}

export function decideIdentity(input: {
  query: string;
  candidates: ShoppingCandidate[];
  now: Date;
}): IdentityDecision {
  const evidenceDate = input.now.toISOString();
  const listings = input.candidates.filter((entry) => entry.candidate.title.trim());
  if (!listings.length) {
    return { status: "abstain", reason: "not_found", message: abstainMessage("not_found") };
  }

  const withFamilies = assignFamilies(listings.map((entry) => entry.candidate));
  const priced = new Map<string, number | null>();
  withFamilies.forEach((candidate, index) => {
    priced.set(priceKey(candidate), listings[index]?.price ?? null);
  });
  const profile = previewProfile(input.query, withFamilies);
  const groups = buildProviderIdentityGroups({
    profile,
    provider: "dataforseo_google_shopping",
    candidates: withFamilies,
  });
  const [top, second] = groups;
  const lead = top ? roundTo(top.score - (second?.score ?? 0)) : 0;

  if (
    top &&
    top.score >= OPEN_IDENTITY_THRESHOLDS.resolvedMinScore &&
    lead >= OPEN_IDENTITY_THRESHOLDS.resolvedMinLead &&
    top.sellerCount >= OPEN_IDENTITY_THRESHOLDS.resolvedMinSellers &&
    top.sizeVariants.length <= 1
  ) {
    const built = optionFromGroup(top, priced, evidenceDate);
    return {
      status: "resolved",
      evidenceDate,
      identityKey: built.identityKey,
      title: built.title,
      brand: built.brand,
      model: top.modelGeneration ?? null,
      profile: built.profile,
      price: built.price,
      sellerCount: top.sellerCount,
      score: top.score,
      lead,
    };
  }

  const ambiguous = top &&
    top.score >= OPEN_IDENTITY_THRESHOLDS.ambiguousMinScore &&
    (lead < OPEN_IDENTITY_THRESHOLDS.resolvedMinLead || top.sizeVariants.length > 1);
  if (ambiguous && top) {
    const options = (top.sizeVariants.length > 1 && lead >= OPEN_IDENTITY_THRESHOLDS.resolvedMinLead
      ? optionsFromMembers(top, priced, evidenceDate)
      : groups.slice(0, OPEN_IDENTITY_THRESHOLDS.maxOptions).map((group) => optionFromGroup(group, priced, evidenceDate))
    ).slice(0, OPEN_IDENTITY_THRESHOLDS.maxOptions);
    if (options.length) return { status: "ambiguous", evidenceDate, options };
  }

  return { status: "abstain", reason: rejectionReason(withFamilies, profile), message: abstainMessage(rejectionReason(withFamilies, profile)) };
}

export function readShoppingCandidates(payload: unknown): ShoppingCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const tasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  const items: ShoppingCandidate[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const results = (task as { result?: unknown }).result;
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const rawItems = (result as { items?: unknown }).items;
      if (!Array.isArray(rawItems)) continue;
      for (const raw of rawItems) {
        const mapped = mapShoppingItem(raw);
        if (mapped) items.push(mapped);
      }
    }
  }
  return items.slice(0, 40);
}

function mapShoppingItem(raw: unknown): ShoppingCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (item.type && item.type !== "google_shopping_serp") return null;
  if (typeof item.title !== "string" || !item.title.trim()) return null;
  const providerIds: Record<string, string> = {};
  if (typeof item.product_id === "string" && item.product_id.trim()) providerIds.productId = item.product_id.trim();
  if (typeof item.gid === "string" && item.gid.trim()) providerIds.gid = item.gid.trim();
  if (typeof item.data_docid === "string" && item.data_docid.trim()) providerIds.dataDocid = item.data_docid.trim();
  const price = typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null;
  return {
    price,
    candidate: {
      provider: "dataforseo_google_shopping",
      title: item.title.trim(),
      brand: typeof item.brand === "string" ? item.brand.trim() : undefined,
      seller: typeof item.seller === "string" ? item.seller.trim() : undefined,
      providerIds,
      rankAbsolute: typeof item.rank_absolute === "number" ? item.rank_absolute : undefined,
      isBestMatch: item.is_best_match === true,
    },
  };
}

function rejectionReason(
  candidates: ProviderIdentityCandidate[],
  profile: ProductProfile
): "not_found" | "low_confidence" | "accessory" | "bundle" | "used" {
  if (!candidates.length) return "not_found";
  const buckets = candidates.map((candidate) => classifyProviderIdentityCandidate({ profile, candidate }).bucket);
  if (buckets.every((bucket) => bucket === "accessory")) return "accessory";
  if (buckets.every((bucket) => bucket === "bundle/kit")) return "bundle";
  if (buckets.every((bucket) => bucket === "refurbished/used")) return "used";
  const rejectedOnly = buckets.every((bucket) =>
    bucket === "accessory" || bucket === "bundle/kit" || bucket === "refurbished/used"
  );
  if (rejectedOnly) {
    const accessory = buckets.filter((bucket) => bucket === "accessory").length;
    const bundle = buckets.filter((bucket) => bucket === "bundle/kit").length;
    const used = buckets.filter((bucket) => bucket === "refurbished/used").length;
    const winner = Math.max(accessory, bundle, used);
    if (winner === accessory) return "accessory";
    if (winner === bundle) return "bundle";
    return "used";
  }
  if (buckets.some((bucket) =>
    bucket === "canonical-product-equivalent" ||
    bucket === "legitimate-variant" ||
    bucket === "different-size" ||
    bucket === "incomplete-provider-identity"
  )) {
    return "low_confidence";
  }
  return "not_found";
}

function priceKey(candidate: ProviderIdentityCandidate): string {
  return `${candidate.title}|${candidate.seller ?? ""}|${candidate.rankAbsolute ?? ""}`;
}

function optionFromGroup(
  group: ProviderIdentityGroup,
  prices: Map<string, number | null>,
  evidenceDate: string
): ResolvedIdentityOption {
  const title = group.strongestCandidate.title;
  const brand = group.strongestCandidate.brand ?? null;
  const identityKey = normalize(group.canonicalProductFamily);
  return {
    candidateId: `cand_${sha256(identityKey).slice(0, 16)}`,
    title,
    brand,
    identityKey,
    price: prices.get(priceKey(group.strongestCandidate)) ?? null,
    profile: profileForIdentity({
      identityKey,
      title,
      brand,
      model: group.modelGeneration,
      providerIds: group.providerIdsSafeToPersist ? group.providerIds : undefined,
      evidenceDate,
      confidence: group.score >= 85 ? "high" : "medium",
    }),
  };
}

function optionsFromMembers(
  group: ProviderIdentityGroup,
  prices: Map<string, number | null>,
  evidenceDate: string
): ResolvedIdentityOption[] {
  const seen = new Set<string>();
  const options: ResolvedIdentityOption[] = [];
  for (const member of group.members) {
    const key = normalize(`${group.canonicalProductFamily}:${member.sizeVariant ?? member.candidate.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      candidateId: `cand_${sha256(key).slice(0, 16)}`,
      title: member.candidate.title,
      brand: member.candidate.brand ?? null,
      identityKey: key,
      price: prices.get(priceKey(member.candidate)) ?? null,
      profile: profileForIdentity({
        identityKey: key,
        title: member.candidate.title,
        brand: member.candidate.brand ?? null,
        model: member.modelGeneration,
        providerIds: member.providerIdComplete ? member.candidate.providerIds : undefined,
        evidenceDate,
        confidence: "medium",
      }),
    });
  }
  return options;
}

function profileForIdentity(input: {
  identityKey: string;
  title: string;
  brand: string | null;
  model?: string;
  providerIds?: Record<string, string>;
  evidenceDate: string;
  confidence: "high" | "medium";
}): ProductProfile {
  const providerPayload = input.providerIds
    ? {
        ...input.providerIds,
        observedAt: input.evidenceDate,
        matchConfidence: input.confidence,
      }
    : undefined;
  return {
    productId: `open-${sha256(input.identityKey).slice(0, 20)}`,
    source: "resolved_provider",
    query: input.title,
    canonicalTitle: input.title,
    brand: input.brand ?? undefined,
    aliases: [input.title],
    productType: "hardware",
    category: "General",
    modelGeneration: input.model,
    identityConfidence: input.confidence,
    providerIds: providerPayload
      ? {
          dataforseo_google_shopping: providerPayload,
          dataforseo_google_shopping_reviews: providerPayload,
        }
      : undefined,
    guardrails: {
      requireExactBrandMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
      excludeRefurbished: true,
    },
  };
}

function previewProfile(query: string, candidates: ProviderIdentityCandidate[]): ProductProfile {
  return {
    productId: "open-preview",
    source: "user_search",
    query,
    canonicalTitle: query,
    brand: inferBrand(query, candidates),
    aliases: [query],
    productType: "hardware",
    category: "General",
    identityConfidence: "medium",
    guardrails: {
      requireExactBrandMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
      excludeRefurbished: true,
    },
  };
}

function inferBrand(query: string, candidates: ProviderIdentityCandidate[]): string | undefined {
  const first = normalize(query).split(" ").find((token) => token.length > 2 && !/^\d+$/.test(token));
  if (!first || !candidates.length) return undefined;
  const hits = candidates.filter((candidate) => normalize(`${candidate.brand ?? ""} ${candidate.title}`).includes(first)).length;
  if (hits < Math.ceil(candidates.length / 2)) return undefined;
  const branded = candidates.find((candidate) => candidate.brand && normalize(candidate.brand).split(" ").includes(first));
  return branded?.brand ?? first;
}

function assignFamilies(candidates: ProviderIdentityCandidate[]): ProviderIdentityCandidate[] {
  const stripped = candidates.map((candidate) => ({ candidate, key: strippedTitle(candidate.title) }));
  const keys = [...new Set(stripped.map((item) => item.key))].sort((a, b) => a.length - b.length);
  return stripped.map((item) => {
    const parent = keys.find((key) =>
      key.length > 0 &&
      item.key !== key &&
      item.key.startsWith(`${key} `) &&
      !isVariantExtension(key, item.key) &&
      key.split(" ").length >= 2
    );
    return { ...item.candidate, canonicalProductFamily: parent ?? item.key };
  });
}

function isVariantExtension(shorter: string, longer: string): boolean {
  if (!longer.startsWith(`${shorter} `)) return false;
  const extra = longer.slice(shorter.length).trim().split(" ").filter(Boolean);
  return extra.some((token) => VARIANT_TOKENS.has(token) || /^\d/.test(token));
}

function strippedTitle(title: string): string {
  let text = normalize(title);
  for (const color of COLORS) {
    text = text.replace(new RegExp(`\\b${color.replace(" ", "\\s+")}\\b`, "g"), " ");
  }
  text = text.replace(/\b\d{2,3}\s*mm\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function roundTo(value: number): number {
  return Math.round(value * 10) / 10;
}

export function openProductId(identityKey: string): string {
  return `open-${sha256(normalize(identityKey)).slice(0, 20)}`;
}
