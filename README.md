# Immanence

Local codebase Q&A for public GitHub repositories.

Immanence resolves a repo, pins a commit, downloads a cached source snapshot, lets a Codex-backed agent inspect the code, and returns an answer with citations.

The name means something being present within rather than outside. Here, the answers come from the codebase itself.

## User Guide

### Requirements

- Node.js 20+
- `git`

Optional:

- `BRAVE_SEARCH_API_KEY` for `--include-web-search`

### Install

```bash
npm install
npm run build
```

### Windows

Native Windows is supported.

- external dependency: `git`
- default data dir: `%LOCALAPPDATA%\\immanence\\data`
- default cache dir: `%LOCALAPPDATA%\\immanence\\cache`
- `IMMANENCE_DATA_DIR` and `IMMANENCE_CACHE_DIR` override the defaults

### Sign in

```bash
npx immanence auth login
npx immanence auth status
```

### Ask a question

Explicit repo:

```bash
npx immanence ask \
  --repo honojs/hono \
  --question "How does the router match params and wildcards?"
```

Repo inference:

```bash
npx immanence ask \
  --question "Where does Next take its list of Google fonts from?"
```

JSON output:

```bash
npx immanence ask \
  --question "Where does Next take its list of Google fonts from?" \
  --json
```

### CLI

Commands:

- `auth login`
- `auth status`
- `auth logout`
- `models`
- `ask`
- `serve http`
- `serve mcp`

`ask` options:

- `--repo <repo...>` explicit GitHub repos
- `--ref <ref>` branch, tag, or commit for explicit repos
- `--model <model>` model override
- `--include-web-search` enable Brave-backed web search
- `--refresh <mode>` `never`, `if-stale`, or `always`
- `--max-tool-calls <count>` tool-call cap
- `--json` emit the full response envelope

### HTTP

Start:

```bash
npm run serve:http
```

Default address: `127.0.0.1:8787`

Endpoints:

- `GET /healthz`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/questions`

Example:

```bash
curl -X POST http://127.0.0.1:8787/v1/questions \
  -H 'content-type: application/json' \
  -d '{
    "question": "How does the router match params and wildcards?",
    "repos": [{ "repo": "honojs/hono" }]
  }'
```

### MCP

Start:

```bash
npm run serve:mcp
```

Tool:

- `ask_codebase_question`

### Limits

- Public GitHub repos only
- Read-only inspection
- No chat memory

### Storage

Defaults:

- data:
  - Linux/macOS: `~/.local/share/immanence`
  - Windows: `%LOCALAPPDATA%\\immanence\\data`
- cache:
  - Linux/macOS: `~/.cache/immanence`
  - Windows: `%LOCALAPPDATA%\\immanence\\cache`
- auth:
  - Linux/macOS: `~/.local/share/immanence/auth.json`
  - Windows: `%LOCALAPPDATA%\\immanence\\data\\auth.json`
- repo snapshots:
  - Linux/macOS: `~/.local/share/immanence/repos/github.com/...`
  - Windows: `%LOCALAPPDATA%\\immanence\\data\\repos\\github.com\\...`

Environment:

- `IMMANENCE_DATA_DIR`
- `IMMANENCE_CACHE_DIR`
- `IMMANENCE_DEFAULT_MODEL`
- `BRAVE_SEARCH_API_KEY`

## Developer Guide

### Local Development

```bash
npm run dev -- --help
```

### Main Commands

```bash
npm test
npm run build
npm run serve:http
npm run serve:mcp
```

### Notes

- Repo caching is snapshot-based, keyed by commit SHA.
- Refs are refreshed according to `--refresh`.
- Final answers include commit SHAs so citations stay stable.
