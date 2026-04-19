import type { Citation } from "../types.js";

function fileCitationKey(citation: Citation) {
  if (citation.kind !== "file") return null;
  return `${citation.repo}:${citation.commitSha}:${citation.path}`;
}

export function countDistinctFileCitations(citations: Citation[]) {
  return new Set(
    citations
      .map((citation) => fileCitationKey(citation))
      .filter((key): key is string => !!key),
  ).size;
}

export function buildStopExplorationMessage(args: {
  turn: number;
  maxTurns: number;
  citations: Citation[];
}) {
  const distinctFileCitations = countDistinctFileCitations(args.citations);
  if (args.turn < 3 || distinctFileCitations < 3) return null;

  const turnsRemaining = args.maxTurns - args.turn;
  const urgency =
    args.turn >= 4
      ? [
          "Your next response must be the final answer unless no canonical source-of-truth file has been read yet.",
          "Do not call validators, tests, workflows, or other downstream consumers for extra confirmation.",
        ].join(" ")
      : [
          "Your next response should usually be the final answer.",
          "At most one more tool call is acceptable, and only if you still have not read the canonical source-of-truth file.",
        ].join(" ");

  return [
    "You already have enough repository evidence to answer.",
    `You have evidence from ${distinctFileCitations} distinct files and ${turnsRemaining} turns remaining.`,
    "Prefer the strongest source-of-truth evidence you already have over additional confirmation reads.",
    urgency,
  ].join(" ");
}
