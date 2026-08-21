import { normalizeLinear, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "merchant" as const;
const label = "Merchant availability";
const provider = "mock_merchant";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const merchantProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const purchaseIntent = RAY_BAN_META_SIGNAL_INPUTS.purchaseIntent;

    return [
      {
        source,
        signalType: "purchaseIntent",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "addToCartRate",
        },
        value: purchaseIntent.addToCartRatePercent,
        // Add-to-cart intent starts at 1% and caps at 18%, a realistic range for
        // consumer-product demo traffic rather than paid placement strength.
        normalizedValue: normalize(normalizeLinear(purchaseIntent.addToCartRatePercent, 1, 18)),
        sampleSize: 4100,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 82,
        metadata: {
          provider,
          providerMetric: "addToCartRate",
          engineField: "addToCartRatePercent",
          engineValue: purchaseIntent.addToCartRatePercent,
        },
      },
      {
        source,
        signalType: "purchaseIntent",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "productDetailClickThroughRate",
        },
        value: purchaseIntent.affiliateClickThroughRatePercent,
        // The score engine field keeps its v1 name, but this mock is just a
        // generic product-detail click-through proxy with no affiliate IDs.
        normalizedValue: normalize(normalizeLinear(purchaseIntent.affiliateClickThroughRatePercent, 0.5, 12)),
        sampleSize: 4100,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 80,
        metadata: {
          provider,
          providerMetric: "productDetailClickThroughRate",
          engineField: "affiliateClickThroughRatePercent",
          engineValue: purchaseIntent.affiliateClickThroughRatePercent,
        },
      },
      {
        source,
        signalType: "purchaseIntent",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "merchantSaveRate",
        },
        value: purchaseIntent.saveRatePercent,
        // Save rate uses 1%-20%; saved products indicate consideration even
        // before a direct purchase action.
        normalizedValue: normalize(normalizeLinear(purchaseIntent.saveRatePercent, 1, 20)),
        sampleSize: 4100,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 81,
        metadata: {
          provider,
          providerMetric: "merchantSaveRate",
          engineField: "saveRatePercent",
          engineValue: purchaseIntent.saveRatePercent,
        },
      },
    ];
  },
};
