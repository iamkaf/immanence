import { AppError } from "../errors.js";
import type { WebSearchResult } from "../types.js";

type BraveSearchResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

export async function braveWebSearch(
  apiKey: string,
  query: string,
  maxResults = 5,
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(maxResults, 1), 10)));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new AppError(
      "SEARCH_UNAVAILABLE",
      `Brave search failed with status ${response.status}.`,
      502,
    );
  }

  const payload = (await response.json()) as BraveSearchResponse;
  return (payload.web?.results ?? [])
    .filter((entry) => entry.title && entry.url)
    .map((entry) => ({
      title: entry.title ?? entry.url ?? "Untitled",
      url: entry.url ?? "",
      snippet: entry.description ?? "",
      source: "brave" as const,
    }));
}
