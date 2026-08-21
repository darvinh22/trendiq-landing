import { calculateConfidenceScore } from "../lib/scoring/confidenceEngine";
import { calculateTrendMomentum } from "../lib/scoring/momentumEngine";
import { calculateTrendIQScore } from "../lib/scoring/scoreEngine";
import {
  buildMockHistoricalSnapshots,
  buildProductTrendSnapshot,
  mockTrendSignalProviders,
  RAY_BAN_META_PRODUCT_ID,
} from "../lib/data";
import type { DataProvenanceSummary, ProductCommerce, ProductTrendSnapshot } from "../lib/data";
import type {
  ConfidenceScoreResult,
  ScoreVersion,
  TrendIQScoreResult,
  TrendIQSignalInputs,
  TrendPoint,
  TrendStatus,
} from "../lib/scoring/types";

export type { TrendPoint, TrendStatus } from "../lib/scoring/types";

export type Category =
  | "Tech"
  | "Gadgets"
  | "AI Products"
  | "Home"
  | "Fitness"
  | "Fashion"
  | "Travel"
  | "Viral TikTok"
  | "Consumer Trends";

// API-ready shape: when a real endpoint exists, swap the hardcoded `trend`
// objects below with the response — components need zero changes.
export interface TrendData {
  history: TrendPoint[];  // exactly 7 entries, Mon→Sun
  changePercent: number;  // signed, e.g. +34.2 or -8.1
  status: TrendStatus;
  whyMoving: string;      // one-sentence human-readable insight
  lastUpdated: string;    // ISO timestamp (simulated as today)
}

export interface Product {
  id: string;
  category: Category;
  emoji: string;
  title: string;
  subtitle: string;
  score: number;
  legacyScore?: number;
  scoreVersion: ScoreVersion;
  scoreBreakdown: TrendIQScoreResult;
  confidence: ConfidenceScoreResult;
  scoringSignals: TrendIQSignalInputs;
  commerce?: ProductCommerce;
  provenance?: DataProvenanceSummary;
  trendSnapshot?: ProductTrendSnapshot;
  trendiqSays: string;
  tiktokSays: string;
  redditSentiment: string;
  redditScore: number;
  tiktokScore: number;
  bestFor: string[];
  watchOut: string[];
  pros: string[];
  cons: string[];
  imageUrl: string;
  alternatives: { title: string; score: number }[];
  trend: TrendData;
}

type ProductSeed = Omit<
  Product,
  "score" | "legacyScore" | "scoreVersion" | "scoreBreakdown" | "confidence" | "scoringSignals"
> & {
  score: number;
};

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    id: "ray-ban-meta",
    category: "Tech",
    emoji: "🔥",
    title: "Ray-Ban Meta Glasses",
    subtitle: "Smart glasses with built-in AI",
    score: 87,
    trendiqSays:
      "Surprisingly useful — especially for creators and hands-free moments. The AI assistant integration is more natural than expected, and the form factor finally feels wearable.",
    tiktokSays:
      "Creators are going wild — #RayBanMeta has 2.4B views. The hands-free filming content is dominating tech TikTok right now.",
    redditSentiment:
      "r/tech and r/gadgets are mostly positive. Users love the discreet design but flag battery life as a recurring pain point.",
    redditScore: 78,
    tiktokScore: 92,
    bestFor: ["Creators", "Travel", "Convenience"],
    watchOut: ["4-hour battery", "Limited prescription options", "US-only AI features"],
    pros: ["Looks like normal glasses", "Seamless Meta AI integration", "Great audio quality", "Lightweight"],
    cons: ["Short battery life", "Privacy concerns", "AI features US-only", "Limited app ecosystem"],
    imageUrl: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&h=400&fit=crop&auto=format",
    commerce: {
      merchants: [
        {
          merchantName: "TrendIQ demo merchant",
          productUrl: "https://example.com/products/ray-ban-meta-glasses",
          price: 299,
          currency: "USD",
          lastUpdated: "2026-08-11T00:00:00Z",
        },
      ],
    },
    alternatives: [
      { title: "Snap Spectacles 5", score: 62 },
      { title: "Bose Frames Alto", score: 71 },
      { title: "Amazon Echo Frames", score: 58 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 52 },
        { day: "Tue", value: 58 },
        { day: "Wed", value: 61 },
        { day: "Thu", value: 70 },
        { day: "Fri", value: 74 },
        { day: "Sat", value: 82 },
        { day: "Sun", value: 88 },
      ],
      changePercent: 34.2,
      status: "Rising",
      whyMoving: "A viral hands-free cooking video hit 18M views this week, driving a second wave of creator adoption.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "apple-vision-pro",
    category: "Tech",
    emoji: "⚡",
    title: "Apple Vision Pro",
    subtitle: "Spatial computing headset",
    score: 79,
    trendiqSays:
      "The most impressive tech demo of the decade, but still searching for its killer use case. Best for developers and early adopters — not yet a daily driver for most.",
    tiktokSays:
      "Reaction videos are massive. #VisionPro has 4.1B views. The 'wearing it in public' content is peak tech culture right now.",
    redditSentiment:
      "r/VisionPro community is passionate but honest — most say it's incredible tech that needs 2-3 more iterations to be truly mainstream.",
    redditScore: 72,
    tiktokScore: 88,
    bestFor: ["Developers", "Productivity", "Entertainment"],
    watchOut: ["$3,499 price tag", "Limited app library", "Not for glasses wearers"],
    pros: ["Stunning display quality", "Seamless Apple ecosystem", "Incredible spatial audio", "Impressive eye tracking"],
    cons: ["Extremely expensive", "Heavy for long sessions", "Limited killer apps", "Battery tethered"],
    imageUrl: "https://images.unsplash.com/photo-1617471346061-5d329ab9c574?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "Meta Quest 3", score: 81 },
      { title: "Samsung XR Headset", score: 67 },
      { title: "Pico 4 Ultra", score: 63 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 76 },
        { day: "Tue", value: 71 },
        { day: "Wed", value: 68 },
        { day: "Thu", value: 64 },
        { day: "Fri", value: 60 },
        { day: "Sat", value: 58 },
        { day: "Sun", value: 55 },
      ],
      changePercent: -12.1,
      status: "Cooling",
      whyMoving: "Post-launch hype is settling as early adopters hit the $3,499 price barrier and app library gaps become apparent.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "whoop-5",
    category: "Fitness",
    emoji: "💪",
    title: "WHOOP 5.0",
    subtitle: "Advanced fitness & recovery tracker",
    score: 84,
    trendiqSays:
      "The gold standard for serious athletes and biohackers. WHOOP 5.0's new AI coaching makes recovery science accessible to anyone who's willing to commit to the data-driven lifestyle.",
    tiktokSays:
      "Fitness influencers are obsessed. #WHOOP has 890M views. Morning recovery score reveals are a whole genre on FitTok.",
    redditSentiment:
      "r/whoop is extremely active. Mostly positive — users swear by the recovery data, though some question the $30/month subscription model.",
    redditScore: 81,
    tiktokScore: 85,
    bestFor: ["Athletes", "Biohackers", "Fitness", "Sleep tracking"],
    watchOut: ["Monthly subscription required", "Steep learning curve", "No screen"],
    pros: ["Best recovery tracking", "Continuous health monitoring", "No screen = no distraction", "Accurate sleep stages"],
    cons: ["$30/month subscription", "No display on device", "Bulkier than competitors", "App can be overwhelming"],
    imageUrl: "https://images.unsplash.com/photo-1510017803434-a899398421b3?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "Oura Ring 4", score: 88 },
      { title: "Garmin Fenix 8", score: 82 },
      { title: "Apple Watch Ultra 2", score: 80 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 60 },
        { day: "Tue", value: 63 },
        { day: "Wed", value: 62 },
        { day: "Thu", value: 67 },
        { day: "Fri", value: 72 },
        { day: "Sat", value: 74 },
        { day: "Sun", value: 78 },
      ],
      changePercent: 28.1,
      status: "Rising",
      whyMoving: "The v5 AI coaching update launched Thursday and generated a surge of upgrade content across fitness communities.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "oura-ring-4",
    category: "Fitness",
    emoji: "💎",
    title: "Oura Ring 4",
    subtitle: "Smart ring for health tracking",
    score: 88,
    trendiqSays:
      "The most elegant health tracker ever made. The Ring 4 nails the balance of fashion accessory and serious biometric device. Sleep tracking accuracy is best-in-class.",
    tiktokSays:
      "#OuraRing has 1.2B views. Celebrity endorsements from Jennifer Aniston and Gwyneth Paltrow made this a luxury status symbol as much as a health tool.",
    redditSentiment:
      "r/ouraring is highly positive. Users consistently praise sleep tracking accuracy and the sleek design. Subscription criticism is the only real pushback.",
    redditScore: 85,
    tiktokScore: 90,
    bestFor: ["Sleep tracking", "Fashion", "Biohackers", "Minimalists"],
    watchOut: ["$5.99/month membership", "No real-time HR during workouts", "Sizing can be tricky"],
    pros: ["Gorgeous design", "Best sleep tracking accuracy", "7-day battery", "Lightweight and comfortable"],
    cons: ["Subscription required for insights", "Workout tracking lags competitors", "No GPS", "Sizing issues"],
    imageUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "WHOOP 5.0", score: 84 },
      { title: "Samsung Galaxy Ring", score: 74 },
      { title: "RingConn Gen 2", score: 67 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 48 },
        { day: "Tue", value: 55 },
        { day: "Wed", value: 63 },
        { day: "Thu", value: 74 },
        { day: "Fri", value: 82 },
        { day: "Sat", value: 89 },
        { day: "Sun", value: 95 },
      ],
      changePercent: 67.4,
      status: "Exploding",
      whyMoving: "A wave of celebrity health influencers posted 'day in my life with Oura' content simultaneously this week, sending searches through the roof.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "bambu-lab-a1",
    category: "Gadgets",
    emoji: "🛠️",
    title: "Bambu Lab A1 Mini",
    subtitle: "Best-value consumer 3D printer",
    score: 91,
    trendiqSays:
      "The 3D printer that finally makes additive manufacturing accessible. Near-zero calibration, multi-color printing, and a thriving community make this the obvious entry point for curious creators.",
    tiktokSays:
      "#BambuLab has 780M views. 'First print out of the box' videos are going viral — people are shocked by how easy it is.",
    redditSentiment:
      "r/3Dprinting is obsessed. Routinely cited as the best printer under $400. Some privacy concerns about cloud connectivity.",
    redditScore: 89,
    tiktokScore: 87,
    bestFor: ["Creators", "Makers", "Students", "Home projects"],
    watchOut: ["Chinese company data concerns", "Proprietary filament push", "Limited open-source"],
    pros: ["Incredibly easy setup", "Multi-color printing", "Fast and accurate", "Active community"],
    cons: ["Cloud connectivity required", "Proprietary ecosystem push", "Noisy operation", "Limited build volume"],
    imageUrl: "https://images.unsplash.com/photo-1631700611307-37dbcb89ef7e?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "Prusa MK4S", score: 84 },
      { title: "Creality K1C", score: 76 },
      { title: "Bambu Lab X1C", score: 93 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 71 },
        { day: "Tue", value: 73 },
        { day: "Wed", value: 70 },
        { day: "Thu", value: 74 },
        { day: "Fri", value: 72 },
        { day: "Sat", value: 75 },
        { day: "Sun", value: 73 },
      ],
      changePercent: 2.8,
      status: "Stable",
      whyMoving: "Steady community momentum with consistent weekly tutorials. No single spike — just sustained organic growth from the maker community.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "claude-3-5",
    category: "AI Products",
    emoji: "🤖",
    title: "Claude (Anthropic)",
    subtitle: "AI assistant for thinking & writing",
    score: 93,
    trendiqSays:
      "The AI assistant that feels the most like talking to a brilliant, thoughtful colleague. Claude excels at nuanced reasoning, long documents, and creative work where other AIs feel robotic.",
    tiktokSays:
      "#ClaudeAI is rising fast. Productivity creators are featuring it heavily for research workflows and coding. #AIProductivity has 3.2B views.",
    redditSentiment:
      "r/ClaudeAI is among the most positive AI subreddits. Users consistently praise its reasoning quality, refusal calibration, and writing voice.",
    redditScore: 91,
    tiktokScore: 89,
    bestFor: ["Writing", "Research", "Coding", "Analysis"],
    watchOut: ["Knowledge cutoff", "No image generation", "Premium plan required for best models"],
    pros: ["Best long-context reasoning", "Excellent coding ability", "Natural conversation style", "Strong safety balance"],
    cons: ["No real-time internet", "No image generation", "Rate limits on free tier", "Knowledge cutoff"],
    imageUrl: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "ChatGPT-4o", score: 90 },
      { title: "Gemini Ultra", score: 86 },
      { title: "Perplexity Pro", score: 82 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 44 },
        { day: "Tue", value: 52 },
        { day: "Wed", value: 61 },
        { day: "Thu", value: 73 },
        { day: "Fri", value: 84 },
        { day: "Sat", value: 91 },
        { day: "Sun", value: 97 },
      ],
      changePercent: 89.3,
      status: "Exploding",
      whyMoving: "A major model capability update this week sent benchmark results viral across every AI community simultaneously.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "dyson-airwrap",
    category: "Home",
    emoji: "✨",
    title: "Dyson Airwrap 2025",
    subtitle: "Multi-styler with Coanda effect",
    score: 85,
    trendiqSays:
      "The luxury hair tool that actually lives up to its hype. The 2025 update adds a new long-barrel attachment and improved motor that genuinely reduces styling time by 40% for most hair types.",
    tiktokSays:
      "#DysonAirwrap has dominated BeautyTok for 3 years straight with 8.4B views. The 'first use' transformation videos never get old.",
    redditSentiment:
      "r/HaircareScience and r/beauty are consistently positive. Main criticism is the price — but users say it replaces multiple tools.",
    redditScore: 82,
    tiktokScore: 94,
    bestFor: ["Fine hair", "Thick hair", "Travel", "Gifting"],
    watchOut: ["$599 price point", "Learning curve", "Heavy for long sessions"],
    pros: ["Replaces 6+ tools", "No extreme heat damage", "Long-lasting results", "Premium build quality"],
    cons: ["Very expensive", "Takes practice to master", "Heavy", "Attachments can be confusing"],
    imageUrl: "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "Shark FlexStyle", score: 78 },
      { title: "Revlon One-Step", score: 72 },
      { title: "Dyson Supersonic", score: 83 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 68 },
        { day: "Tue", value: 65 },
        { day: "Wed", value: 67 },
        { day: "Thu", value: 64 },
        { day: "Fri", value: 66 },
        { day: "Sat", value: 63 },
        { day: "Sun", value: 64 },
      ],
      changePercent: -5.4,
      status: "Stable",
      whyMoving: "Seasonal post-summer lull. Interest is steady but slightly off peak — expected to rebound ahead of holiday gifting season.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
  {
    id: "peak-design-bag",
    category: "Travel",
    emoji: "🎒",
    title: "Peak Design Travel Bag 45L",
    subtitle: "Premium carry-on travel backpack",
    score: 89,
    trendiqSays:
      "The last travel bag you'll ever need to buy. Obsessively engineered for frequent travelers who refuse to check bags. Every detail is considered, from the origami expansion system to the MagSafe-inspired accessory clips.",
    tiktokSays:
      "#PeakDesign has 620M views on TikTok. Gear creators and digital nomads obsessively film the packing system — it's genuinely satisfying to watch.",
    redditSentiment:
      "r/onebag considers it the gold standard. Users consistently say it transforms travel. The price is steep but universally considered worth it.",
    redditScore: 92,
    tiktokScore: 83,
    bestFor: ["Travel", "Digital nomads", "Photography", "One-bag travel"],
    watchOut: ["$299 price tag", "Overkill for casual travelers", "Limited color options"],
    pros: ["Incredible organization", "TSA carry-on approved", "Lifetime warranty", "Beautiful design"],
    cons: ["Very expensive", "Heavy empty (2.05 kg)", "Few color choices", "Over-engineered for casual use"],
    imageUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&h=400&fit=crop&auto=format",
    alternatives: [
      { title: "Nomatic Travel Pack", score: 82 },
      { title: "Aer Travel Pack 3", score: 84 },
      { title: "Tom Bihn Synik", score: 80 },
    ],
    trend: {
      history: [
        { day: "Mon", value: 55 },
        { day: "Tue", value: 59 },
        { day: "Wed", value: 64 },
        { day: "Thu", value: 66 },
        { day: "Fri", value: 69 },
        { day: "Sat", value: 71 },
        { day: "Sun", value: 74 },
      ],
      changePercent: 22.3,
      status: "Rising",
      whyMoving: "Back-to-travel season is driving 'one-bag Europe trip' content, with Peak Design featuring in nearly every top packing video.",
      lastUpdated: "2026-08-11T00:00:00Z",
    },
  },
];

// Mock v1 signals use API-shaped raw metrics instead of final scores. They are
// intentionally kept outside the product copy so a future data adapter can
// replace this record without touching the UI or product content.
const MOCK_SIGNAL_INPUTS: Record<string, TrendIQSignalInputs> = {
  "ray-ban-meta": {
    socialMomentum: {
      mentions7d: 42000,
      mentionGrowthPercent: 64,
      engagementRatePercent: 9.8,
      creatorPostCount: 3200,
    },
    searchMomentum: {
      searchVolume7d: 185000,
      searchGrowthPercent: 46,
      queryShareOfCategoryPercent: 18,
    },
    sentiment: {
      positiveMentionPercent: 74,
      negativeMentionPercent: 12,
    },
    reviewQuality: {
      averageRating: 4.4,
      reviewCount: 2900,
      verifiedPurchasePercent: 85,
      recentAverageRating: 4.3,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 26,
      addToCartRatePercent: 10.5,
      affiliateClickThroughRatePercent: 7.2,
      saveRatePercent: 14,
    },
    growthVelocity: {
      trendChangePercent: 34.2,
      accelerationPercent: 18,
      consecutiveGrowthDays: 5,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 42,
      sourceHalfLifeDays: 18,
      creatorConcentrationPercent: 38,
      evergreenInterestPercent: 52,
    },
    confidence: {
      observationCount: 9300,
      sourceCount: 6,
      newestSignalAgeHours: 8,
      agreeingSignalCount: 6,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "apple-vision-pro": {
    socialMomentum: {
      mentions7d: 52000,
      mentionGrowthPercent: -8,
      engagementRatePercent: 8,
      creatorPostCount: 4500,
    },
    searchMomentum: {
      searchVolume7d: 220000,
      searchGrowthPercent: -12,
      queryShareOfCategoryPercent: 23,
    },
    sentiment: {
      positiveMentionPercent: 64,
      negativeMentionPercent: 20,
    },
    reviewQuality: {
      averageRating: 4.2,
      reviewCount: 1500,
      verifiedPurchasePercent: 78,
      recentAverageRating: 4,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 18,
      addToCartRatePercent: 4,
      affiliateClickThroughRatePercent: 3.2,
      saveRatePercent: 9,
    },
    growthVelocity: {
      trendChangePercent: -12.1,
      accelerationPercent: -28,
      consecutiveGrowthDays: 0,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 30,
      sourceHalfLifeDays: 12,
      creatorConcentrationPercent: 44,
      evergreenInterestPercent: 48,
    },
    confidence: {
      observationCount: 10500,
      sourceCount: 6,
      newestSignalAgeHours: 12,
      agreeingSignalCount: 5,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "whoop-5": {
    socialMomentum: {
      mentions7d: 26000,
      mentionGrowthPercent: 42,
      engagementRatePercent: 8.6,
      creatorPostCount: 2100,
    },
    searchMomentum: {
      searchVolume7d: 105000,
      searchGrowthPercent: 34,
      queryShareOfCategoryPercent: 14,
    },
    sentiment: {
      positiveMentionPercent: 76,
      negativeMentionPercent: 10,
    },
    reviewQuality: {
      averageRating: 4.5,
      reviewCount: 5200,
      verifiedPurchasePercent: 88,
      recentAverageRating: 4.4,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 24,
      addToCartRatePercent: 8.5,
      affiliateClickThroughRatePercent: 5.8,
      saveRatePercent: 12,
    },
    growthVelocity: {
      trendChangePercent: 28.1,
      accelerationPercent: 12,
      consecutiveGrowthDays: 5,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 46,
      sourceHalfLifeDays: 22,
      creatorConcentrationPercent: 34,
      evergreenInterestPercent: 61,
    },
    confidence: {
      observationCount: 8100,
      sourceCount: 5,
      newestSignalAgeHours: 6,
      agreeingSignalCount: 6,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "oura-ring-4": {
    socialMomentum: {
      mentions7d: 61000,
      mentionGrowthPercent: 104,
      engagementRatePercent: 10.6,
      creatorPostCount: 3800,
    },
    searchMomentum: {
      searchVolume7d: 190000,
      searchGrowthPercent: 86,
      queryShareOfCategoryPercent: 20,
    },
    sentiment: {
      positiveMentionPercent: 82,
      negativeMentionPercent: 8,
    },
    reviewQuality: {
      averageRating: 4.6,
      reviewCount: 9600,
      verifiedPurchasePercent: 90,
      recentAverageRating: 4.55,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 30,
      addToCartRatePercent: 11,
      affiliateClickThroughRatePercent: 8,
      saveRatePercent: 16,
    },
    growthVelocity: {
      trendChangePercent: 67.4,
      accelerationPercent: 42,
      consecutiveGrowthDays: 6,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 44,
      sourceHalfLifeDays: 20,
      creatorConcentrationPercent: 52,
      evergreenInterestPercent: 58,
    },
    confidence: {
      observationCount: 12000,
      sourceCount: 6,
      newestSignalAgeHours: 4,
      agreeingSignalCount: 6,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "bambu-lab-a1": {
    socialMomentum: {
      mentions7d: 47000,
      mentionGrowthPercent: 30,
      engagementRatePercent: 9.4,
      creatorPostCount: 4100,
    },
    searchMomentum: {
      searchVolume7d: 160000,
      searchGrowthPercent: 22,
      queryShareOfCategoryPercent: 19,
    },
    sentiment: {
      positiveMentionPercent: 88,
      negativeMentionPercent: 5,
    },
    reviewQuality: {
      averageRating: 4.85,
      reviewCount: 10500,
      verifiedPurchasePercent: 92,
      recentAverageRating: 4.82,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 33,
      addToCartRatePercent: 15,
      affiliateClickThroughRatePercent: 11,
      saveRatePercent: 19,
    },
    growthVelocity: {
      trendChangePercent: 18,
      accelerationPercent: 10,
      consecutiveGrowthDays: 5,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 58,
      sourceHalfLifeDays: 30,
      creatorConcentrationPercent: 24,
      evergreenInterestPercent: 76,
    },
    confidence: {
      observationCount: 9800,
      sourceCount: 5,
      newestSignalAgeHours: 10,
      agreeingSignalCount: 7,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "claude-3-5": {
    socialMomentum: {
      mentions7d: 68000,
      mentionGrowthPercent: 125,
      engagementRatePercent: 11.2,
      creatorPostCount: 4900,
    },
    searchMomentum: {
      searchVolume7d: 230000,
      searchGrowthPercent: 110,
      queryShareOfCategoryPercent: 22,
    },
    sentiment: {
      positiveMentionPercent: 86,
      negativeMentionPercent: 6,
    },
    reviewQuality: {
      averageRating: 4.7,
      reviewCount: 18000,
      verifiedPurchasePercent: 72,
      recentAverageRating: 4.75,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 32,
      addToCartRatePercent: 13,
      affiliateClickThroughRatePercent: 9,
      saveRatePercent: 18,
    },
    growthVelocity: {
      trendChangePercent: 89.3,
      accelerationPercent: 55,
      consecutiveGrowthDays: 7,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 50,
      sourceHalfLifeDays: 24,
      creatorConcentrationPercent: 36,
      evergreenInterestPercent: 64,
    },
    confidence: {
      observationCount: 15000,
      sourceCount: 6,
      newestSignalAgeHours: 2,
      agreeingSignalCount: 7,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "dyson-airwrap": {
    socialMomentum: {
      mentions7d: 58000,
      mentionGrowthPercent: 5,
      engagementRatePercent: 9.7,
      creatorPostCount: 4700,
    },
    searchMomentum: {
      searchVolume7d: 210000,
      searchGrowthPercent: 3,
      queryShareOfCategoryPercent: 24,
    },
    sentiment: {
      positiveMentionPercent: 80,
      negativeMentionPercent: 9,
    },
    reviewQuality: {
      averageRating: 4.55,
      reviewCount: 25000,
      verifiedPurchasePercent: 86,
      recentAverageRating: 4.5,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 29,
      addToCartRatePercent: 10,
      affiliateClickThroughRatePercent: 7,
      saveRatePercent: 17,
    },
    growthVelocity: {
      trendChangePercent: -5.4,
      accelerationPercent: -8,
      consecutiveGrowthDays: 0,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 58,
      sourceHalfLifeDays: 30,
      creatorConcentrationPercent: 31,
      evergreenInterestPercent: 74,
    },
    confidence: {
      observationCount: 13500,
      sourceCount: 6,
      newestSignalAgeHours: 18,
      agreeingSignalCount: 6,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
  "peak-design-bag": {
    socialMomentum: {
      mentions7d: 30000,
      mentionGrowthPercent: 35,
      engagementRatePercent: 8.8,
      creatorPostCount: 2300,
    },
    searchMomentum: {
      searchVolume7d: 90000,
      searchGrowthPercent: 29,
      queryShareOfCategoryPercent: 15,
    },
    sentiment: {
      positiveMentionPercent: 87,
      negativeMentionPercent: 5,
    },
    reviewQuality: {
      averageRating: 4.78,
      reviewCount: 12500,
      verifiedPurchasePercent: 91,
      recentAverageRating: 4.74,
    },
    purchaseIntent: {
      buyingKeywordSharePercent: 34,
      addToCartRatePercent: 12,
      affiliateClickThroughRatePercent: 9,
      saveRatePercent: 19,
    },
    growthVelocity: {
      trendChangePercent: 22.3,
      accelerationPercent: 14,
      consecutiveGrowthDays: 5,
    },
    hypeSustainability: {
      repeatMentionRatePercent: 60,
      sourceHalfLifeDays: 30,
      creatorConcentrationPercent: 25,
      evergreenInterestPercent: 78,
    },
    confidence: {
      observationCount: 9000,
      sourceCount: 5,
      newestSignalAgeHours: 9,
      agreeingSignalCount: 7,
      totalSignalCount: 7,
      completeSignalCount: 35,
      expectedSignalCount: 35,
    },
  },
};

function buildDataLayerProduct(seed: ProductSeed): Product {
  const historicalSnapshots = buildMockHistoricalSnapshots(seed.id);
  const snapshot = buildProductTrendSnapshot(seed.id, mockTrendSignalProviders, {
    timestamp: seed.trend.lastUpdated,
    historicalSnapshots,
  });

  return {
    ...seed,
    legacyScore: seed.score,
    score: snapshot.trendIQScore.score,
    scoreVersion: snapshot.trendIQScore.scoreVersion,
    scoreBreakdown: snapshot.trendIQScore,
    confidence: snapshot.confidence,
    scoringSignals: snapshot.aggregatedSignals,
    provenance: snapshot.provenance,
    trendSnapshot: snapshot,
    trend: {
      ...seed.trend,
      changePercent: snapshot.trendStatus.changePercent,
      status: snapshot.trendStatus.status,
      lastUpdated: snapshot.timestamp,
    },
  };
}

function buildProduct(seed: ProductSeed): Product {
  if (seed.id === RAY_BAN_META_PRODUCT_ID) {
    return buildDataLayerProduct(seed);
  }

  const scoringSignals = MOCK_SIGNAL_INPUTS[seed.id];

  if (!scoringSignals) {
    throw new Error(`Missing mock scoring signals for product: ${seed.id}`);
  }

  const scoreBreakdown = calculateTrendIQScore(scoringSignals);
  const confidence = calculateConfidenceScore(scoringSignals.confidence);
  const momentum = calculateTrendMomentum({
    changePercent: seed.trend.changePercent,
    history: seed.trend.history,
  });

  return {
    ...seed,
    legacyScore: seed.score,
    score: scoreBreakdown.score,
    scoreVersion: scoreBreakdown.scoreVersion,
    scoreBreakdown,
    confidence,
    scoringSignals,
    trend: {
      ...seed.trend,
      changePercent: momentum.changePercent,
      status: momentum.status,
    },
  };
}

export const PRODUCTS: Product[] = PRODUCT_SEEDS.map(buildProduct);

export const CATEGORIES: Category[] = [
  "Tech",
  "Gadgets",
  "AI Products",
  "Home",
  "Fitness",
  "Fashion",
  "Travel",
  "Viral TikTok",
  "Consumer Trends",
];
