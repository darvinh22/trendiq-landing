import type {
  ProductIdentityConfidence,
  ProductMeasurementQueryCandidate,
  ProductMeasurementQueryCandidateKind,
  ProductMeasurementQuerySourceField,
  ProductProfile,
} from "./types";

const SOURCE_FIELD_ORDER: readonly ProductMeasurementQuerySourceField[] = [
  "query",
  "canonicalTitle",
  "brand",
  "modelGeneration",
  "aliases",
];

const CONFIDENCE_ORDER: Record<ProductIdentityConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

interface CandidateDraft {
  query: string | undefined;
  kind: ProductMeasurementQueryCandidateKind;
  sourceFields: ProductMeasurementQuerySourceField[];
  confidence: ProductIdentityConfidence;
  currentlyExecutable: boolean;
}

function normalizeQueryText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/g, "-");
}

function dedupeKey(value: string): string {
  return normalizeQueryText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueSourceFields(fields: ProductMeasurementQuerySourceField[]): ProductMeasurementQuerySourceField[] {
  const fieldSet = new Set(fields);

  return SOURCE_FIELD_ORDER.filter((field) => fieldSet.has(field));
}

function strongerConfidence(
  left: ProductIdentityConfidence,
  right: ProductIdentityConfidence
): ProductIdentityConfidence {
  return CONFIDENCE_ORDER[right] > CONFIDENCE_ORDER[left] ? right : left;
}

function hasLetter(value: string): boolean {
  return /[a-z]/i.test(value);
}

function isBrandOnly(query: string, brand?: string): boolean {
  return Boolean(brand && dedupeKey(query) === dedupeKey(brand));
}

function isWeakCandidate(
  query: string,
  kind: ProductMeasurementQueryCandidateKind,
  profile: ProductProfile
): boolean {
  if (!dedupeKey(query)) return true;
  if (kind !== "exact" && isBrandOnly(query, profile.brand)) return true;
  if ((kind === "model" || kind === "product_family") && !hasLetter(query)) return true;

  return false;
}

function isTrailingGenerationToken(token: string): boolean {
  return (
    /^v?\d+(?:\.\d+)?$/i.test(token) ||
    /^\d{4}$/.test(token) ||
    /^\d+(?:st|nd|rd|th)$/i.test(token)
  );
}

function modelFamilyFromGeneration(modelGeneration: string | undefined): string | undefined {
  const model = normalizeQueryText(modelGeneration);
  const tokens = model.split(" ").filter(Boolean);

  if (tokens.length < 2) return undefined;
  while (tokens.length > 1 && isTrailingGenerationToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const family = tokens.join(" ");
  return family && dedupeKey(family) !== dedupeKey(model) ? family : undefined;
}

function productFamilyQuery(profile: ProductProfile): string | undefined {
  const brand = normalizeQueryText(profile.brand);
  const family = modelFamilyFromGeneration(profile.modelGeneration);

  if (!brand || !family) return undefined;
  if (dedupeKey(family).startsWith(`${dedupeKey(brand)} `)) return family;

  return `${brand} ${family}`;
}

function isCurrentlyExecutableAlias(profile: ProductProfile, query: string): boolean {
  const queryKey = dedupeKey(query);
  return profile.aliases.some((alias) => dedupeKey(alias) === queryKey);
}

export function buildMeasurementQueryCandidates(profile: ProductProfile): ProductMeasurementQueryCandidate[] {
  const candidates = new Map<string, ProductMeasurementQueryCandidate>();
  const drafts: CandidateDraft[] = [
    {
      query: profile.query,
      kind: "exact",
      sourceFields: ["query"],
      confidence: profile.identityConfidence,
      currentlyExecutable: true,
    },
    {
      query: profile.modelGeneration,
      kind: "model",
      sourceFields: ["modelGeneration"],
      confidence: profile.identityConfidence,
      currentlyExecutable: false,
    },
    {
      query: productFamilyQuery(profile),
      kind: "product_family",
      sourceFields: ["brand", "modelGeneration"],
      confidence: profile.identityConfidence,
      currentlyExecutable: false,
    },
    {
      query: profile.canonicalTitle,
      kind: "alias",
      sourceFields: ["canonicalTitle"],
      confidence: profile.identityConfidence,
      currentlyExecutable: isCurrentlyExecutableAlias(profile, profile.canonicalTitle),
    },
    ...profile.aliases.map((alias) => ({
      query: alias,
      kind: "alias" as const,
      sourceFields: ["aliases" as const],
      confidence: profile.identityConfidence,
      currentlyExecutable: true,
    })),
  ];

  for (const draft of drafts) {
    const query = normalizeQueryText(draft.query);
    if (isWeakCandidate(query, draft.kind, profile)) continue;

    const key = dedupeKey(query);
    const existing = candidates.get(key);
    if (existing) {
      candidates.set(key, {
        ...existing,
        sourceFields: uniqueSourceFields([...existing.sourceFields, ...draft.sourceFields]),
        confidence: strongerConfidence(existing.confidence, draft.confidence),
        currentlyExecutable: existing.currentlyExecutable || draft.currentlyExecutable,
      });
      continue;
    }

    candidates.set(key, {
      query,
      kind: draft.kind,
      sourceFields: uniqueSourceFields(draft.sourceFields),
      confidence: draft.confidence,
      currentlyExecutable: draft.currentlyExecutable,
      rank: 0,
    });
  }

  return [...candidates.values()].map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
}

export function withMeasurementQueryCandidates(profile: ProductProfile): ProductProfile {
  const profileWithoutCandidates = {
    ...profile,
    measurementQueries: undefined,
  };

  return {
    ...profile,
    measurementQueries: buildMeasurementQueryCandidates(profileWithoutCandidates),
  };
}
