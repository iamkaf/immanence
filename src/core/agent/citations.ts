import type { Citation, WebSearchResult } from "../types.js";

export function citationsFromWebResults(results: WebSearchResult[]): Citation[] {
  return results.map((entry) => ({
    kind: "web" as const,
    url: entry.url,
    title: entry.title,
  }));
}
