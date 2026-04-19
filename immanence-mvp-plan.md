# Immanence MVP Plan

## Summary
Build `immanence` as a local, single-user TypeScript/Node utility that answers questions about one or more public GitHub repositories. The app will expose three entrypoints over one shared core engine:

- HTTP API for programmatic callers
- CLI for direct developer use and auth management
- MCP server for agent clients

The request model for v1 is one-shot Q&A, not chat. A request may include explicit repos, or omit them and rely on best-effort repo inference. The engine resolves candidate repos, clones or refreshes cached repos, runs a Codex-backed agent with bespoke read-only tools, and returns a grounded answer with file/web citations and an execution trace.

Core AI and auth will use `@mariozechner/pi-ai`, reusing the same OpenAI Codex OAuth pattern already present in `~/code/apps/spriteform2`. MCP will use the official TypeScript SDK (`@modelcontextprotocol/sdk`). For this MVP, use `stdio` transport because the target deployment is a local utility. Sources: [MCP SDK docs](https://modelcontextprotocol.io/docs/sdk), [TS SDK](https://ts.sdk.modelcontextprotocol.io/). For web search, define a provider abstraction and ship a Brave-backed implementation first; use Brave’s standard web search API for `web_search`, not the deprecated Summarizer flow. Sources: [Brave Search API](https://brave.com/search/api/), [deprecated Summarizer docs](https://api-dashboard.search.brave.com/app/documentation/summarizer-search/get-started).

## Product Shape
### In scope
- Public GitHub repos only
- Multiple repos per request
- Read-only agent behavior
- Repo inference when repos are omitted
- Repo tools: `clone`, `list`, `read`, `search`, `web_search`
- Final answer with citations and tool trace
- Shared local clone cache
- Codex OAuth login via CLI

### Out of scope for v1
- Private GitHub auth/cloning
- Session-based chat
- Repo mutation, patching, PR creation, shell execution inside cloned repos
- Web UI
- Remote multi-user deployment
- MCP raw low-level repo tools as public contract

## Implementation Approach
### Runtime and packaging
- Use Node 20+ and TypeScript.
- Use `npm`.
- Keep the repo as a single package for MVP to reduce bootstrapping overhead.
- Use `tsx` for local dev and `tsc` or `tsup` for build output.
- Use `zod` for public interface validation.
- Use the MCP official TypeScript SDK for the MCP surface.
- Use `@mariozechner/pi-ai` and `@mariozechner/pi-ai/oauth` for model access and Codex login.

### Project structure
```text
src/
  cli/
    index.ts
    commands/
      ask.ts
      authLogin.ts
      authStatus.ts
      authLogout.ts
      models.ts
      serveHttp.ts
      serveMcp.ts
  http/
    server.ts
    routes/
      health.ts
      auth.ts
      models.ts
      questions.ts
  mcp/
    server.ts
    tools/
      askCodebaseQuestion.ts
  core/
    config.ts
    types.ts
    errors.ts
    auth/
      authStore.ts
      codexAuth.ts
    repos/
      github.ts
      repoCache.ts
      repoResolver.ts
      worktree.ts
      fileReaders.ts
    search/
      repoSearch.ts
      webSearch.ts
      braveProvider.ts
    agent/
      prompts.ts
      toolSpecs.ts
      toolExecutor.ts
      runner.ts
      citations.ts
      transcript.ts
  util/
    fs.ts
    process.ts
    json.ts
```

## Core Engine
### Main workflow
1. Validate request payload.
2. If `repos` is provided, normalize repo inputs into canonical GitHub coordinates.
3. If `repos` is omitted or empty, run repo inference and either:
   - accept a high-confidence repo set,
   - accept a small high-confidence multi-repo set,
   - or fail with structured ambiguity details and ranked candidates.
4. For each selected repo, ensure a cached mirror exists and is up to date enough for the request.
5. Create per-request detached worktrees pinned to the selected commit SHA.
6. Build an agent context containing:
   - system prompt
   - user question
   - resolved repo descriptors
   - bespoke tool definitions
7. Run a manual `pi-ai` tool loop until:
   - the assistant returns a final answer with no tool calls,
   - max tool-call count is reached,
   - max step count is reached,
   - or the request times out.
8. Post-process the answer into structured citations and a stable response envelope.
9. Clean up request worktrees unless debug retention is enabled.

### AI loop details
- Default model: `gpt-5.4`
- Model provider: `openai-codex`
- Use `streamSimple()` for the main runner so CLI can stream text incrementally; HTTP and MCP buffer to a final structured response in v1.
- Tool execution is sequential in v1.
- Tool arguments are defined with `Type.Object(...)` from `pi-ai`.
- Each tool result is appended as a `toolResult` message and the loop continues.
- Stop conditions:
  - `maxAgentTurns = 12`
  - `maxToolCalls = 40`
  - `requestTimeoutMs = 300000`
- System prompt requirements:
  - Prefer repo-grounded answers over speculation
  - Cite files with repo, commit, path, and line numbers
  - Use `web_search` only when repo contents are insufficient or the question explicitly needs external/current context
  - Do not claim to have run code unless a future tool exists to do so
  - Do not answer without inspecting the relevant files when the question is code-specific

## Repo Resolution
### Request behavior
The public contract is hybrid:
- clients may pass explicit repos for deterministic behavior
- clients may omit repos and rely on best-effort inference

### Resolver inputs
- raw question text
- optional explicit repos
- optional hint fields added below in the request schema

### Resolver algorithm
1. If explicit repos are present, skip inference.
2. Extract likely repo/entity tokens from the question:
   - slash-form repos like `owner/name`
   - capitalized or kebab-case project names
   - ecosystem markers like `Next`, `Vercel`, `OpenClaw`
3. Query GitHub repository search for top candidates.
4. Score candidates using:
   - exact name match
   - owner/name mention match
   - owner relevance from text
   - popularity/stability tie-break only after lexical match
   - organization-specific heuristics for well-known products
5. Outcome:
   - single repo if confidence >= `0.9`
   - multi-repo set if top candidates are intentionally complementary and confidence >= `0.85`
   - ambiguity response otherwise

### Multi-repo inference rule
The resolver may auto-select multiple repos only when the question naturally spans them, for example:
- primary implementation repo plus upstream metadata repo
- framework repo plus asset/catalog repo

This is allowed only when:
- the primary repo is clear
- the secondary repo is highly likely to be relevant
- total inferred repos <= `2`

### Ambiguity contract
If inference is not confident enough, return a structured `REPO_INFERENCE_AMBIGUOUS` error with:
- top candidate repos
- confidence scores
- short reasons
- suggested retry payload using explicit repos

### Known acceptance fixtures
These are explicitly encoded as resolver expectations in tests:
- `How is OpenClaw able to sync Codex credentials?`
  - infer `openclaw/openclaw`
- `How do I get started with json-render?`
  - infer `vercel-labs/json-render`
- `Where does Next take its list of Google fonts from?`
  - infer `vercel/next.js` as primary
  - allow `google/fonts` as secondary only if the resolver’s multi-repo rule is satisfied

## Repo Cache Design
### Cache layout
- Root data dir default: `~/.local/share/immanence`
- Auth file: `~/.local/share/immanence/auth.json`
- Mirror cache: `~/.local/share/immanence/repos/github.com/<owner>/<repo>.git`
- Request worktrees: `~/.cache/immanence/runs/<requestId>/<alias>/`

### Clone/fetch strategy
- Cache repositories as bare mirrors.
- On first access: `git clone --mirror`.
- On refresh: `git remote update --prune`.
- Resolve requested ref in this order:
  - explicit commit SHA
  - explicit branch/tag
  - default branch
- Create a detached read-only worktree for the exact commit analyzed.
- Return commit SHA in every tool result and final answer so citations are stable.

### Defaults and limits
- Max repos per request: `5`
- Max inferred repos when `repos` omitted: `2`
- Refresh policy:
  - default `refresh = "if-stale"`
  - stale threshold `10 minutes`
  - request may override with `never` or `always`

## Bespoke Internal Tools
These are internal agent tools, not all public interfaces.

### `clone`
Purpose: ensure repo is available locally and return a stable repo handle.

Input:
- `repo`: GitHub URL or `owner/name`
- `ref?`: branch, tag, or commit
- `refresh?`: `"never" | "if-stale" | "always"`

Output:
- `repoId`
- `repo`
- `refRequested`
- `commitSha`
- `defaultBranch`
- `workspacePath`
- `status`: `"cloned" | "reused" | "refreshed"`

### `list`
Purpose: enumerate files/directories.

Input:
- `repoId`
- `path?`
- `depth?` default `2`
- `includeHidden?` default `false`

Output:
- normalized path
- entries with `name`, `path`, `kind`, `size?`

Rules:
- Skip `.git`
- Truncate to `maxEntries = 200`

### `read`
Purpose: return file content or slices.

Input:
- `repoId`
- `path`
- `startLine?`
- `endLine?`

Output:
- `path`
- `language?`
- `startLine`
- `endLine`
- `content`
- `truncated`
- `commitSha`

Rules:
- Text files only
- Max line window per call: `400`
- Max bytes returned: `64 KB`
- Binary files return metadata-only error result

### `search`
Purpose: repo text search using ripgrep.

Input:
- `repoId`
- `query`
- `pathGlob?`
- `regex?` default `false`
- `caseSensitive?` default `false`
- `maxResults?` default `20`

Output:
- match list with `path`, `line`, `column`, `preview`
- `truncated`
- `commitSha`

Rules:
- Use `rg`
- Default literal search
- Max results hard cap `100`

### `web_search`
Purpose: external grounding when repo contents are insufficient.

Input:
- `query`
- `maxResults?` default `5`

Output:
- results with `title`, `url`, `snippet`, `source = "brave"`

Rules:
- Provider interface from day one
- Brave implementation first
- Tool returns a structured disabled/error result if no API key is configured
- v1 uses Brave web search results only, not Brave summarizer/answers generation

## Public Interfaces
### CLI
Commands:
- `immanence auth login`
- `immanence auth status`
- `immanence auth logout`
- `immanence models`
- `immanence ask --question "..." [--repo owner/name]... [--ref ...] [--json]`
- `immanence serve http`
- `immanence serve mcp`

Behavior:
- `auth login` opens the Codex browser flow via `loginOpenAICodex()`
- credentials are stored locally in `auth.json`
- `ask` streams progress to stderr and prints the final answer to stdout
- `--json` prints the full structured response
- if no `--repo` is given, the command may infer repos or fail with ambiguity details

### HTTP
Use Fastify for the HTTP server.

Endpoints:
- `GET /healthz`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/questions`

`POST /v1/questions` request:
```ts
type QuestionRequest = {
  question: string;
  repos?: Array<{
    repo: string;
    ref?: string;
    alias?: string;
  }>;
  repoHints?: {
    owner?: string;
    repo?: string;
  };
  model?: string;
  includeWebSearch?: boolean;
  refresh?: "never" | "if-stale" | "always";
  maxToolCalls?: number;
};
```

`POST /v1/questions` success response:
```ts
type QuestionResponse = {
  answer: string;
  model: string;
  repos: Array<{
    repo: string;
    alias: string;
    refRequested?: string;
    commitSha: string;
    defaultBranch?: string;
    inferred: boolean;
  }>;
  citations: Array<
    | { kind: "file"; repo: string; commitSha: string; path: string; startLine: number; endLine: number }
    | { kind: "web"; url: string; title: string }
  >;
  trace: Array<{
    tool: "clone" | "list" | "read" | "search" | "web_search";
    summary: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  warnings: string[];
};
```

`POST /v1/questions` ambiguity response:
```ts
type RepoInferenceAmbiguousError = {
  error: {
    code: "REPO_INFERENCE_AMBIGUOUS";
    message: string;
    candidates: Array<{
      repo: string;
      confidence: number;
      reason: string;
    }>;
    suggestedRequest: {
      question: string;
      repos: Array<{ repo: string }>;
    };
  };
};
```

HTTP defaults:
- synchronous JSON response only in v1
- no auth-login initiation over HTTP; callers must run CLI login locally first

### MCP
Expose one high-level tool only:

- `ask_codebase_question`

Input schema mirrors `QuestionRequest`.
Output schema mirrors `QuestionResponse` or the structured ambiguity error.

Transport:
- `stdio` in v1
- keep the MCP server implementation isolated so Streamable HTTP can be added later without reworking the core engine

## Auth Design
### Provider
- OpenAI Codex via `loginOpenAICodex()` and `getOAuthApiKey()`

### Storage
- JSON file store, not OS keychain, for MVP simplicity
- file permissions `0600`
- schema:
```ts
type AuthStore = {
  providers: {
    "openai-codex"?: OAuthCredentials;
  };
};
```

### UX
- `immanence auth login` performs the login flow and saves credentials
- all other interfaces fail fast with a clear “not logged in” error and instructions to run the CLI login command
- `GET /v1/auth/status` and `immanence auth status` expose signed-in state and expiry

## Important Public Types and Contracts
These are the v1 contracts the implementation should treat as stable:

- `QuestionRequest`
- `QuestionResponse`
- `RepoInferenceAmbiguousError`
- `Citation`
- `AuthStatus`
- MCP tool name: `ask_codebase_question`
- Internal tool names:
  - `clone`
  - `list`
  - `read`
  - `search`
  - `web_search`

## Error Handling
Normalize errors into stable categories:

- `AUTH_REQUIRED`
- `INVALID_REQUEST`
- `REPO_NOT_FOUND`
- `REF_NOT_FOUND`
- `CLONE_FAILED`
- `REPO_INFERENCE_AMBIGUOUS`
- `SEARCH_UNAVAILABLE`
- `FILE_NOT_TEXT`
- `PATH_NOT_FOUND`
- `TOOL_LIMIT_EXCEEDED`
- `AGENT_TIMEOUT`
- `MODEL_ERROR`

Rules:
- tool errors are returned to the model as structured tool results when recoverable
- interface errors return HTTP status codes or CLI/MCP structured failures
- final response may include warnings when the answer is partial

## Testing and Acceptance Criteria
### Unit tests
- GitHub repo input normalization
- repo inference scoring and tie-breaking
- ambiguity threshold behavior
- acceptance fixture inference for:
  - `OpenClaw`
  - `json-render`
  - `Next` plus optional `google/fonts`
- auth store load/save/update
- clone cache staleness logic
- commit/ref resolution
- `list` truncation and hidden-file behavior
- `read` line slicing and text/binary detection
- `search` literal vs regex handling
- Brave result normalization and disabled-provider behavior
- citation extraction and deduplication
- agent loop stop conditions

### Integration tests
- analyze a small public GitHub repo and answer a known question
- analyze multiple repos in one request
- reuse cached mirror on second request
- refresh stale mirror when requested
- infer a repo successfully from question-only input
- return ambiguity error for question-only input with low-confidence matches
- return structured error for nonexistent repo
- return structured error for bad ref
- return structured error for missing auth
- HTTP `POST /v1/questions` happy path
- CLI `ask --json` happy path
- MCP `ask_codebase_question` happy path

### Acceptance prompt fixtures
Automate these as end-to-end fixtures with expected repo resolution and citation requirements:

1. `How is OpenClaw able to sync Codex credentials?`
- expected resolved repo: `openclaw/openclaw`
- expected answer property: explains credential sync/login path with file citations

2. `How do I get started with json-render?`
- expected resolved repo: `vercel-labs/json-render`
- expected answer property: setup/getting-started guidance grounded in repo docs/code

3. `Where does Next take its list of Google fonts from?`
- expected resolved repo: `vercel/next.js`
- allowed secondary repo: `google/fonts`
- expected answer property: explains source of truth for the font list with file citations from `next.js`, optionally augmented by `google/fonts` if actually used

### Networked smoke tests
Run only when env is configured:
- Codex login already completed locally
- `BRAVE_SEARCH_API_KEY` present if web search is enabled

Smoke scenarios:
- repo-only question answered with file citations
- question-only input resolves repo and answers correctly
- ambiguous question returns ranked candidate repos
- question requiring external current context triggers `web_search`
- answer contains no uncited file claims

## Defaults and Assumptions
- Use TypeScript, Node, and `npm`.
- Use Fastify for HTTP.
- Use `stdio` for MCP in v1.
- Use one-shot analysis only; session chat is explicitly deferred to v2.
- Use public GitHub only in v1.
- Use a shared mirror cache plus per-request detached worktrees.
- Use Brave as the first `web_search` provider, behind a provider interface.
- Use Codex OAuth once per machine via CLI; HTTP/MCP do not initiate login in v1.
- Keep the system read-only: no write/edit/shell tools.
- Keep the public MCP surface high-level in v1.
- Use hybrid repo selection:
  - explicit repos remain the preferred deterministic mode
  - inference is a convenience layer with a structured ambiguity path

## v2 Hooks To Preserve Now
Do not implement these in v1, but structure code so they can be added without breaking contracts:
- session/chat memory over existing repo workspaces
- private GitHub support
- remote multi-user deployment
- MCP Streamable HTTP transport
- richer trace streaming
- optional low-level repo tools as MCP tools
