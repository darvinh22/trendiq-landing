import { VALIDATION_PRODUCT_PROFILES } from "../../app/lib/data/capabilities/profiles";
import type { ProductProfile } from "../../app/lib/data/capabilities/types";

const CONTROLLED_PRODUCT_IDS = ["ray-ban-meta"] as const;

const catalog = new Map<string, ProductProfile>(
  CONTROLLED_PRODUCT_IDS.map((productId) => [productId, VALIDATION_PRODUCT_PROFILES[productId]])
);

function cloneProfile(profile: ProductProfile): ProductProfile {
  return JSON.parse(JSON.stringify(profile)) as ProductProfile;
}

export function getControlledProductProfile(productId: string): ProductProfile | undefined {
  const profile = catalog.get(productId);
  return profile ? cloneProfile(profile) : undefined;
}

export function listControlledProductIds(): readonly string[] {
  return [...catalog.keys()];
}
