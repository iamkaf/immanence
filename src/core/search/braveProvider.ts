import { AppError } from "../errors.js";
import type { WebSearchResult } from "../types.js";
import { z } from "zod";

const braveSearchResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().optional(),
            url: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

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

  const payload = braveSearchResponseSchema.parse(await response.json());
  return (payload.web?.results ?? []).flatMap((entry): WebSearchResult[] =>
    entry.title && entry.url
      ? [
          {
            title: entry.title,
            url: entry.url,
            snippet: entry.description ?? "",
            source: "brave",
          },
        ]
      : [],
  );
}
