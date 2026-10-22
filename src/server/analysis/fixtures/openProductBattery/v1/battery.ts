/**
 * Versioned synthetic fixture battery. Not recorded live provider data.
 * cost is 0 on every payload so an offline run cannot represent real spend.
 */

export const OPEN_PRODUCT_BATTERY_VERSION = "open_product_battery_v1" as const;

export type OpenProductBatteryScenario =
  | "clear_match"
  | "ambiguous"
  | "unidentifiable"
  | "thin_evidence"
  | "accessory"
  | "bundle"
  | "used"
  | "prohibited";

export interface SyntheticShoppingItem {
  type: "google_shopping_serp";
  title: string;
  brand?: string;
  seller?: string;
  product_id?: string;
  gid?: string;
  data_docid?: string;
  rank_absolute?: number;
  is_best_match?: boolean;
  price?: number;
}

export interface SyntheticProviderResponse {
  syntheticFixture: true;
  source: "synthetic_fixture";
  notLiveData: true;
  cost: 0;
  tasks: Array<{
    status_code: number;
    cost: 0;
    result: Array<{ items: SyntheticShoppingItem[] }>;
  }>;
}

export interface ThinEvidenceFixture {
  syntheticFixture: true;
  source: "synthetic_fixture";
  notLiveData: true;
  verifiedCoveragePercent: number;
  ratingEvidenceCount: number;
  consensusQuality: number;
  note: string;
}

export interface OpenProductBatteryCase {
  id: string;
  query: string;
  scenario: OpenProductBatteryScenario;
  /** When true, the resolver must not read providerResponse. */
  doNotCallProvider: boolean;
  providerResponse: SyntheticProviderResponse;
  analysisFixture?: ThinEvidenceFixture;
}

function response(items: SyntheticShoppingItem[]): SyntheticProviderResponse {
  return {
    syntheticFixture: true,
    source: "synthetic_fixture",
    notLiveData: true,
    cost: 0,
    tasks: [{ status_code: 20000, cost: 0, result: [{ items }] }],
  };
}

function item(
  id: string,
  title: string,
  brand: string,
  seller: string,
  rank: number,
  price?: number
): SyntheticShoppingItem {
  return {
    type: "google_shopping_serp",
    title,
    brand,
    seller,
    product_id: `fixture-${id}`,
    gid: `fixture-${id}-gid`,
    data_docid: `fixture-${id}-doc`,
    rank_absolute: rank,
    is_best_match: rank === 1,
    ...(typeof price === "number" ? { price } : {}),
  };
}

function pair(
  slug: string,
  title: string,
  brand: string,
  sellers: readonly [string, string],
  price: number
): SyntheticShoppingItem[] {
  return [
    item(`${slug}-a`, title, brand, sellers[0], 1, price),
    item(`${slug}-b`, title, brand, sellers[1], 2, price),
  ];
}

const THIN: ThinEvidenceFixture = {
  syntheticFixture: true,
  source: "synthetic_fixture",
  notLiveData: true,
  verifiedCoveragePercent: 22,
  ratingEvidenceCount: 8,
  consensusQuality: 30,
  note: "Synthetic thin evidence. A recommendation must be NO_RECOMMENDATION and must not be labeled verified.",
};

function batteryCase(
  id: string,
  query: string,
  scenario: OpenProductBatteryScenario,
  items: SyntheticShoppingItem[],
  options: { doNotCallProvider?: boolean; thin?: boolean } = {}
): OpenProductBatteryCase {
  return {
    id,
    query,
    scenario,
    doNotCallProvider: options.doNotCallProvider === true,
    providerResponse: response(items),
    ...(options.thin ? { analysisFixture: THIN } : {}),
  };
}

export const OPEN_PRODUCT_BATTERY: {
  version: typeof OPEN_PRODUCT_BATTERY_VERSION;
  label: "synthetic_fixture";
  notice: string;
  products: OpenProductBatteryCase[];
} = {
  version: OPEN_PRODUCT_BATTERY_VERSION,
  label: "synthetic_fixture",
  notice:
    "Synthetic fixtures only. These are not recorded DataForSEO responses and must not be treated as verified live evidence.",
  products: [
    batteryCase(
      "sony-wh-1000xm5",
      "Sony WH-1000XM5",
      "clear_match",
      pair("sony-xm5", "Sony WH-1000XM5 Wireless Headphones", "Sony", ["Best Buy", "Sony"], 328)
    ),
    batteryCase(
      "apple-airpods-pro-2",
      "Apple AirPods Pro 2",
      "clear_match",
      pair("airpods-pro-2", "Apple AirPods Pro 2", "Apple", ["Apple", "Amazon"], 189)
    ),
    batteryCase(
      "nintendo-switch-oled",
      "Nintendo Switch OLED",
      "clear_match",
      pair("switch-oled", "Nintendo Switch OLED", "Nintendo", ["Nintendo", "Walmart"], 349)
    ),
    batteryCase(
      "kindle-paperwhite",
      "Kindle Paperwhite",
      "clear_match",
      pair("kindle-pw", "Kindle Paperwhite", "Amazon", ["Amazon", "Best Buy"], 149)
    ),
    batteryCase(
      "bose-qc-ultra",
      "Bose QuietComfort Ultra Headphones",
      "clear_match",
      pair("bose-qc-ultra", "Bose QuietComfort Ultra Headphones", "Bose", ["Bose", "Best Buy"], 429)
    ),
    batteryCase("samsung-galaxy-s24", "Samsung Galaxy S24", "ambiguous", [
      ...pair("s24", "Samsung Galaxy S24", "Samsung", ["Samsung", "Best Buy"], 799),
      ...pair("s24-ultra", "Samsung Galaxy S24 Ultra", "Samsung", ["Samsung", "Amazon"], 1299),
    ]),
    batteryCase("ipad-air", "iPad Air", "ambiguous", [
      ...pair("ipad-air-11", "Apple iPad Air 11", "Apple", ["Apple", "Best Buy"], 599),
      ...pair("ipad-air-13", "Apple iPad Air 13", "Apple", ["Apple", "Amazon"], 799),
    ]),
    batteryCase("instant-pot-duo", "Instant Pot Duo", "ambiguous", [
      ...pair("instant-6", "Instant Pot Duo 6 Quart", "Instant Pot", ["Instant Pot", "Target"], 89),
      ...pair("instant-8", "Instant Pot Duo 8 Quart", "Instant Pot", ["Instant Pot", "Walmart"], 119),
    ]),
    batteryCase("lego-millennium-falcon", "Lego Millennium Falcon", "ambiguous", [
      ...pair("falcon-75192", "Lego Millennium Falcon 75192", "Lego", ["Lego", "Target"], 849),
      ...pair("falcon-75257", "Lego Millennium Falcon 75257", "Lego", ["Lego", "Amazon"], 169),
    ]),
    batteryCase("blue-gadget", "blue gadget thing", "unidentifiable", [
      item("toaster", "Acme Toaster Oven", "Acme", "Acme", 1, 40),
      item("lamp", "Northwind Desk Lamp", "Northwind", "Northwind", 2, 35),
    ]),
    batteryCase("xyzzy-plugh-9000", "xyzzy plugh 9000", "unidentifiable", []),
    batteryCase("best-headphones", "best headphones", "unidentifiable", [
      item("misc-sony", "Sony WH-1000XM5 Wireless Headphones", "Sony", "Best Buy", 1, 328),
      item("misc-bose", "Bose QuietComfort Ultra Headphones", "Bose", "Bose", 2, 429),
    ]),
    batteryCase(
      "anker-soundcore-q45",
      "Anker Soundcore Space Q45",
      "thin_evidence",
      pair("anker-q45", "Anker Soundcore Space Q45", "Anker", ["Anker", "Amazon"], 99),
      { thin: true }
    ),
    batteryCase(
      "framework-laptop-13",
      "Framework Laptop 13",
      "thin_evidence",
      pair("framework-13", "Framework Laptop 13", "Framework", ["Framework", "Newegg"], 999),
      { thin: true }
    ),
    batteryCase(
      "teenage-engineering-op1",
      "Teenage Engineering OP-1 Field",
      "thin_evidence",
      pair("op1-field", "Teenage Engineering OP-1 Field", "Teenage Engineering", ["Teenage Engineering", "Sweetwater"], 1999),
      { thin: true }
    ),
    batteryCase("xm5-charging-case", "Sony WH-1000XM5", "accessory", [
      item("xm5-case-a", "Sony WH-1000XM5 charging case", "Sony", "Best Buy", 1, 29),
      item("xm5-case-b", "Sony WH-1000XM5 charging case", "Sony", "Amazon", 2, 29),
    ]),
    batteryCase("airpods-case", "AirPods Pro 2", "accessory", [
      item("airpods-case-a", "case for AirPods Pro 2", "Apple", "Apple", 1, 29),
      item("airpods-case-b", "case for AirPods Pro 2", "Apple", "Amazon", 2, 27),
    ]),
    batteryCase("switch-oled-bundle", "Nintendo Switch OLED", "bundle", [
      item("switch-bundle-a", "Nintendo Switch OLED bundle", "Nintendo", "Walmart", 1, 399),
      item("switch-bundle-b", "Nintendo Switch OLED bundle", "Nintendo", "Target", 2, 399),
    ]),
    batteryCase("dyson-v15-used", "Dyson V15 Detect", "used", [
      item("dyson-used-a", "Dyson V15 Detect refurbished", "Dyson", "Amazon", 1, 449),
      item("dyson-used-b", "Dyson V15 Detect refurbished", "Dyson", "eBay", 2, 399),
    ]),
    batteryCase(
      "prohibited-oxycodone",
      "oxycodone 30 mg tablets",
      "prohibited",
      [item("must-not-be-read", "Oxycodone tablets", "Pharmacy", "Pharmacy", 1, 10)],
      { doNotCallProvider: true }
    ),
  ],
};

export function assertBatteryShape(): void {
  if (OPEN_PRODUCT_BATTERY.version !== OPEN_PRODUCT_BATTERY_VERSION) {
    throw new Error("open_product_battery_version_mismatch");
  }
  if (OPEN_PRODUCT_BATTERY.products.length !== 20) {
    throw new Error("open_product_battery_must_contain_20_products");
  }
  const ids = new Set(OPEN_PRODUCT_BATTERY.products.map((product) => product.id));
  if (ids.size !== 20) throw new Error("open_product_battery_duplicate_id");
  for (const product of OPEN_PRODUCT_BATTERY.products) {
    if (product.id === "ray-ban-meta" || product.query.toLowerCase().includes("ray-ban")) {
      throw new Error("open_product_battery_must_not_include_ray_ban_meta");
    }
    const payload = product.providerResponse;
    if (!payload.syntheticFixture || payload.source !== "synthetic_fixture" || payload.notLiveData !== true) {
      throw new Error("open_product_battery_payload_must_be_labeled_synthetic");
    }
    if (payload.cost !== 0 || payload.tasks.some((task) => task.cost !== 0)) {
      throw new Error("open_product_battery_cost_must_stay_zero");
    }
  }
}
