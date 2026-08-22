import { merchantProvider } from "./merchantProvider";
import { redditProvider } from "./redditProvider";
import { reviewsProvider } from "./reviewsProvider";
import { socialProvider } from "./socialProvider";
import { searchProvider } from "../search";

export { googleTrendsProvider } from "./googleTrendsProvider";
export { merchantProvider } from "./merchantProvider";
export {
  createRedditTrendSignalProvider,
  mockRedditProvider,
  RedditTrendSignalProvider,
  redditProvider,
} from "./redditProvider";
export {
  createReviewQualitySignalProvider,
  mockReviewsProvider,
  ReviewQualitySignalProvider,
  reviewsProvider,
} from "./reviewsProvider";
export { socialProvider } from "./socialProvider";
export {
  createSearchTrendSignalProvider,
  mockSearchProvider,
  searchProvider,
  SearchTrendSignalProvider,
} from "../search";

export const mockTrendSignalProviders = [
  searchProvider,
  redditProvider,
  reviewsProvider,
  socialProvider,
  merchantProvider,
] as const;
