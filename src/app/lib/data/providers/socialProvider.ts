import { normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "social" as const;
const label = "Social momentum";
const provider = "mock_social";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const socialProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const social = RAY_BAN_META_SIGNAL_INPUTS.socialMomentum;
    const growth = RAY_BAN_META_SIGNAL_INPUTS.growthVelocity;
    const sustainability = RAY_BAN_META_SIGNAL_INPUTS.hypeSustainability;

    return [
      {
        source,
        signalType: "socialMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "weeklySocialMentions",
        },
        value: social.mentions7d,
        // Social mention volume is log-scaled from 100 weekly mentions to
        // 50,000, which keeps niche products visible without over-rewarding scale.
        normalizedValue: normalize(normalizeLogScale(social.mentions7d, 100, 50000)),
        previousValue: 25610,
        percentChange: social.mentionGrowthPercent,
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 89,
        metadata: {
          provider,
          providerMetric: "weeklySocialMentions",
          engineField: "mentions7d",
          engineValue: social.mentions7d,
        },
      },
      {
        source,
        signalType: "socialMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "mentionGrowthPercent",
        },
        value: social.mentionGrowthPercent,
        normalizedValue: normalize(normalizeLinear(social.mentionGrowthPercent, -25, 150)),
        previousValue: 39.2,
        percentChange: social.mentionGrowthPercent,
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 88,
        metadata: {
          provider,
          providerMetric: "mentionGrowthPercent",
          engineField: "mentionGrowthPercent",
          engineValue: social.mentionGrowthPercent,
        },
      },
      {
        source,
        signalType: "socialMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "engagementRatePercent",
        },
        value: social.engagementRatePercent,
        // Engagement is normalized from 1% to 12%; higher values are capped so
        // viral content does not swamp the broader TrendIQ Score.
        normalizedValue: normalize(normalizeLinear(social.engagementRatePercent, 1, 12)),
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 86,
        metadata: {
          provider,
          providerMetric: "engagementRatePercent",
          engineField: "engagementRatePercent",
          engineValue: social.engagementRatePercent,
        },
      },
      {
        source,
        signalType: "socialMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "creatorPostCount",
        },
        value: social.creatorPostCount,
        // Creator participation is log-scaled from 10 posts to 5,000 so broad
        // adoption matters more than any one oversized creator spike.
        normalizedValue: normalize(normalizeLogScale(social.creatorPostCount, 10, 5000)),
        sampleSize: social.creatorPostCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 87,
        metadata: {
          provider,
          providerMetric: "creatorPostCount",
          engineField: "creatorPostCount",
          engineValue: social.creatorPostCount,
        },
      },
      {
        source,
        signalType: "growthVelocity",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "socialAccelerationPercent",
        },
        value: growth.accelerationPercent,
        // Acceleration uses -40% to +60% because v1 treats sharp slowdowns and
        // quick accelerations as separate from the displayed momentum label.
        normalizedValue: normalize(normalizeLinear(growth.accelerationPercent, -40, 60)),
        percentChange: growth.accelerationPercent,
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 85,
        metadata: {
          provider,
          providerMetric: "socialAccelerationPercent",
          engineField: "accelerationPercent",
          engineValue: growth.accelerationPercent,
        },
      },
      {
        source,
        signalType: "growthVelocity",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "consecutiveGrowthDays",
        },
        value: growth.consecutiveGrowthDays,
        // Seven consecutive days is the max v1 streak; zero means no current
        // confirmed streak from the mock provider set.
        normalizedValue: normalize(normalizeLinear(growth.consecutiveGrowthDays, 0, 7)),
        sampleSize: 7,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 82,
        metadata: {
          provider,
          providerMetric: "consecutiveGrowthDays",
          engineField: "consecutiveGrowthDays",
          engineValue: growth.consecutiveGrowthDays,
        },
      },
      {
        source,
        signalType: "hypeSustainability",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "repeatMentionRate",
        },
        value: sustainability.repeatMentionRatePercent,
        // Repeat mentions below 5% look one-off; 60%+ suggests recurring
        // interest from people revisiting the product.
        normalizedValue: normalize(normalizeLinear(sustainability.repeatMentionRatePercent, 5, 60)),
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 80,
        metadata: {
          provider,
          providerMetric: "repeatMentionRate",
          engineField: "repeatMentionRatePercent",
          engineValue: sustainability.repeatMentionRatePercent,
        },
      },
      {
        source,
        signalType: "hypeSustainability",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "sourceHalfLifeDays",
        },
        value: sustainability.sourceHalfLifeDays,
        // Source half-life uses 1-30 days. Durable attention beyond a month is
        // capped for the MVP because it belongs more to historical modeling.
        normalizedValue: normalize(normalizeLinear(sustainability.sourceHalfLifeDays, 1, 30)),
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 78,
        metadata: {
          provider,
          providerMetric: "sourceHalfLifeDays",
          engineField: "sourceHalfLifeDays",
          engineValue: sustainability.sourceHalfLifeDays,
        },
      },
      {
        source,
        signalType: "hypeSustainability",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "creatorConcentration",
        },
        value: sustainability.creatorConcentrationPercent,
        // Creator concentration is inverse-normalized: lower concentration is
        // healthier because hype is spread across more independent voices.
        normalizedValue: normalize(normalizeInverseLinear(sustainability.creatorConcentrationPercent, 15, 85)),
        sampleSize: social.creatorPostCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 79,
        metadata: {
          provider,
          providerMetric: "creatorConcentration",
          engineField: "creatorConcentrationPercent",
          engineValue: sustainability.creatorConcentrationPercent,
        },
      },
      {
        source,
        signalType: "hypeSustainability",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "evergreenInterestPercent",
        },
        value: sustainability.evergreenInterestPercent,
        // Evergreen interest maps 10% to weak durability and 80% to strong
        // durable demand outside a single viral moment.
        normalizedValue: normalize(normalizeLinear(sustainability.evergreenInterestPercent, 10, 80)),
        sampleSize: social.mentions7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 80,
        metadata: {
          provider,
          providerMetric: "evergreenInterestPercent",
          engineField: "evergreenInterestPercent",
          engineValue: sustainability.evergreenInterestPercent,
        },
      },
    ];
  },
};
