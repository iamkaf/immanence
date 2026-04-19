import { Type, type Tool } from "@mariozechner/pi-ai";

export function buildAgentTools(includeWebSearch: boolean): Tool[] {
  const tools: Tool[] = [
    {
      name: "clone",
      description:
        "Clone or reuse an additional public GitHub repository and return a stable repo handle. Do not use this for repositories already listed in the session context.",
      parameters: Type.Object({
        repo: Type.String({
          description:
            "GitHub repository in owner/name form or https://github.com/owner/name URL.",
        }),
        ref: Type.Optional(
          Type.String({ description: "Optional branch, tag, or commit." }),
        ),
        refresh: Type.Optional(
          Type.String({
            description: "Refresh mode: never, if-stale, or always.",
          }),
        ),
      }),
    },
    {
      name: "list",
      description: "List files and directories in a cloned repository.",
      parameters: Type.Object({
        repoId: Type.String({
          description:
            "Exact repository handle ID from the session context or returned by clone, for example owner-repo-1a2b3c4d. Do not use alias or repo name here.",
        }),
        path: Type.Optional(
          Type.String({
            description: "Directory path relative to the repo root.",
          }),
        ),
        depth: Type.Optional(
          Type.Number({ description: "How many directory levels to descend." }),
        ),
        includeHidden: Type.Optional(
          Type.Boolean({ description: "Whether to include hidden files." }),
        ),
      }),
    },
    {
      name: "read",
      description:
        "Read text from a repository file with optional line bounds.",
      parameters: Type.Object({
        repoId: Type.String({
          description:
            "Exact repository handle ID from the session context or returned by clone, for example owner-repo-1a2b3c4d. Do not use alias or repo name here.",
        }),
        path: Type.String({
          description: "File path relative to the repo root.",
        }),
        startLine: Type.Optional(
          Type.Number({ description: "1-based start line." }),
        ),
        endLine: Type.Optional(
          Type.Number({ description: "1-based end line." }),
        ),
      }),
    },
    {
      name: "search",
      description: "Search within a repository using ripgrep.",
      parameters: Type.Object({
        repoId: Type.String({
          description:
            "Exact repository handle ID from the session context or returned by clone, for example owner-repo-1a2b3c4d. Do not use alias or repo name here.",
        }),
        query: Type.String({ description: "Search string or regex." }),
        pathGlob: Type.Optional(
          Type.String({ description: "Optional path glob." }),
        ),
        regex: Type.Optional(
          Type.Boolean({ description: "Interpret query as regex." }),
        ),
        caseSensitive: Type.Optional(
          Type.Boolean({ description: "Use case-sensitive matching." }),
        ),
        maxResults: Type.Optional(
          Type.Number({ description: "Maximum results to return." }),
        ),
      }),
    },
  ];

  if (includeWebSearch) {
    tools.push({
      name: "web_search",
      description:
        "Search the public web for current context when repository contents are insufficient.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query." }),
        maxResults: Type.Optional(
          Type.Number({ description: "Maximum number of results." }),
        ),
      }),
    });
  }

  return tools;
}
