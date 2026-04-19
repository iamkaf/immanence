import type { ImmanenceConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { WebSearchResult } from "../types.js";
import { braveWebSearch } from "./braveProvider.js";

export async function searchWeb(config: ImmanenceConfig, query: string, maxResults = 5): Promise<WebSearchResult[]> {
  if (!config.braveApiKey) {
    throw new AppError("SEARCH_UNAVAILABLE", "Web search is not configured. Set BRAVE_SEARCH_API_KEY to enable it.", 400);
  }
  return await braveWebSearch(config.braveApiKey, query, maxResults);
}
