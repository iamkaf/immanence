# Immanence

Immanence is a local AI-powered codebase exploration utility. It answers questions about public GitHub repositories by:

1. Resolving or accepting repository targets
2. Resolving the target commit SHA
3. Downloading or reusing cached source snapshots
4. Letting a Codex-backed agent inspect the code with bespoke tools
5. Returning an answer with citations and a tool trace

It exposes three interfaces over the same core engine:

- CLI
- HTTP API
- MCP server

## Status

This is an MVP. The current implementation supports:

- Public GitHub repositories only
- OpenAI Codex auth via `@mariozechner/pi-ai`
- Hybrid repo selection:
  - explicit repos
  - best-effort inference from question text
- Read-only agent tools:
  - `clone`
  - `list`
  - `read`
  - `search`
  - `web_search`
- CLI, HTTP, and stdio MCP entrypoints

Out of scope in the current build:

- Private GitHub repos
- Chat/session memory
- Repo mutation or patching
- Browser UI
- Multi-user deployment

## Requirements

- Node.js 20+
- `git`
- `tar`
- `rg` (`ripgrep`) on `PATH`

Optional:

- `BRAVE_SEARCH_API_KEY` to enable `web_search`

## Install

```bash
npm install
npm run build
```

For local development:

```bash
npm run dev -- --help
```

## Quickstart

### 1. Sign in to Codex

```bash
node dist/cli/index.js auth login
```

Check auth status:

```bash
node dist/cli/index.js auth status
```

### 2. Ask a question

With explicit repos:

```bash
node dist/cli/index.js ask \
  --repo openclaw/openclaw \
  --question "How is OpenClaw able to sync Codex credentials?"
```

With repo inference:

```bash
node dist/cli/index.js ask \
  --question "How do I get started with json-render?"
```

Structured JSON output:

```bash
node dist/cli/index.js ask \
  --question "Where does Next take its list of Google fonts from?" \
  --json
```

Enable web search when needed:

```bash
BRAVE_SEARCH_API_KEY=... \
node dist/cli/index.js ask \
  --question "What changed recently in this project?" \
  --repo owner/repo \
  --include-web-search
```

## CLI

Top-level commands:

- `auth login`
- `auth status`
- `auth logout`
- `models`
- `ask`
- `serve http`
- `serve mcp`

### `ask`

```text
immanence ask --question <question> [options]
```

Options:

- `--repo <repo...>`: explicit GitHub repos
- `--ref <ref>`: optional branch, tag, or commit
- `--model <model>`: override the default model
- `--include-web-search`: enable Brave-backed web search
- `--refresh <mode>`: `never`, `if-stale`, or `always`
- `--max-tool-calls <count>`: cap the tool loop
- `--json`: emit the full response envelope instead of plain answer text

## HTTP API

Start the server:

```bash
npm run serve:http
```

Default bind:

- `127.0.0.1:8787`

Endpoints:

- `GET /healthz`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/questions`

Example request:

```bash
curl -X POST http://127.0.0.1:8787/v1/questions \
  -H 'content-type: application/json' \
  -d '{
    "question": "How is OpenClaw able to sync Codex credentials?",
    "repos": [{ "repo": "openclaw/openclaw" }]
  }'
```

Example inferred-repo request:

```bash
curl -X POST http://127.0.0.1:8787/v1/questions \
  -H 'content-type: application/json' \
  -d '{
    "question": "How do I get started with json-render?"
  }'
```

Successful responses include:

- `answer`
- `model`
- resolved `repos`
- `citations`
- `trace`
- optional `usage`
- `warnings`

If repo inference is ambiguous, the server returns a structured `REPO_INFERENCE_AMBIGUOUS` error with ranked candidates and a suggested retry payload.

## MCP

Start the MCP server over stdio:

```bash
npm run serve:mcp
```

The server exposes one high-level tool:

- `ask_codebase_question`

Its input mirrors the HTTP `POST /v1/questions` request body.

Its output is either:

- the full question response envelope
- or a structured error payload, including repo inference ambiguity details when applicable

## Configuration

Environment variables:

- `IMMANENCE_DATA_DIR`: override the persistent data directory
- `IMMANENCE_CACHE_DIR`: override the cache directory
- `IMMANENCE_DEFAULT_MODEL`: override the default model
- `BRAVE_SEARCH_API_KEY`: enable Brave-backed `web_search`

Defaults:

- data dir: `~/.local/share/immanence`
- cache dir: `~/.cache/immanence`
- auth file: `~/.local/share/immanence/auth.json`
- repo snapshot cache: `~/.local/share/immanence/repos/github.com/...`

## How It Works

### Repo handling

- Repos are cached as extracted source snapshots keyed by commit SHA
- Refs are refreshed according to `refresh`
- Snapshots are downloaded from GitHub tarballs and reused across requests
- Final responses include commit SHAs so citations are stable

### Agent tools

The Codex-backed agent uses bespoke internal tools:

- `clone`: add a new public GitHub repo to the request context
- `list`: inspect directory structure
- `read`: read bounded file slices
- `search`: run `rg` in a repo
- `web_search`: search the web through Brave when enabled

### Repo inference

If `repos` are omitted, Immanence tries to infer likely repos from question text using:

- direct `owner/name` mentions
- model-planned repository guesses

If the result is not confident enough, it fails instead of guessing silently.

## Example Smoke Prompts

These are good manual checks for the current MVP:

- `How is OpenClaw able to sync Codex credentials?`
- `How do I get started with json-render?`
- `Where does Next take its list of Google fonts from?`

## Development

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

Current automated coverage is focused on:

- request validation
- repo inference behavior
- fixture prompt resolution

## Limitations

- The agent currently relies on live network access for GitHub cloning, GitHub repo search, and Codex requests.
- Web search is disabled unless `BRAVE_SEARCH_API_KEY` is set.
- The MCP server currently uses stdio only.
- There is no persisted conversation/session model yet.
