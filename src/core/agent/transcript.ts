import type { Citation, TraceEntry } from "../types.js";

export function dedupeCitations(citations: Citation[]) {
  const seen = new Set<string>();
  const output: Citation[] = [];
  for (const citation of citations) {
    const key =
      citation.kind === "file"
        ? `${citation.repo}:${citation.commitSha}:${citation.path}:${citation.startLine}:${citation.endLine}`
        : `${citation.url}:${citation.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(citation);
  }
  return output;
}

export function summarizeTrace(trace: TraceEntry[]) {
  return trace;
}
