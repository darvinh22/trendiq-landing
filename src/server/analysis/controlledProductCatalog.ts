import { VALIDATION_PRODUCT_PROFILES } from "../../app/lib/data/capabilities/profiles";
import type { ProductProfile } from "../../app/lib/data/capabilities/types";
import type {
  ControlledProductCatalogItem,
  ControlledProductCatalogResponse,
} from "../../app/lib/analysis/productAnalysisContract";

const CONTROLLED_PRODUCT_IDS = ["ray-ban-meta"] as const;

const PUBLIC_CATALOG: Record<(typeof CONTROLLED_PRODUCT_IDS)[number], ControlledProductCatalogItem> = {
  "ray-ban-meta": {
    productId: "ray-ban-meta",
    displayName: "Ray-Ban Meta Glasses",
    brand: "Ray-Ban",
    category: "Tech",
  },
};

const analysisProfiles = new Map<string, ProductProfile>(
  CONTROLLED_PRODUCT_IDS.map((productId) => [productId, VALIDATION_PRODUCT_PROFILES[productId]])
);

function cloneProfile(profile: ProductProfile): ProductProfile {
  return JSON.parse(JSON.stringify(profile)) as ProductProfile;
}

export function getControlledProductProfile(productId: string): ProductProfile | undefined {
  const profile = analysisProfiles.get(productId);
  return profile ? cloneProfile(profile) : undefined;
}

export function listControlledProductIds(): readonly string[] {
  return [...analysisProfiles.keys()];
}

export function getControlledProductCatalog(): ControlledProductCatalogResponse {
  return {
    version: "controlled_product_catalog_v1",
    products: CONTROLLED_PRODUCT_IDS.map((productId) => ({ ...PUBLIC_CATALOG[productId] })),
  };
}
