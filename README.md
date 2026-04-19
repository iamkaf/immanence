<p align="center">
  <img src="assets/banner.png" alt="Immanence — answers that live inside the code" width="720" />
</p>

<h1 align="center">Immanence</h1>

<p align="center">
  <strong>Ask any public GitHub codebase a question. Get an answer with citations.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#cli-reference">CLI</a> ·
  <a href="#http-api">HTTP API</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

Immanence resolves a repo, pins a commit, downloads a cached source snapshot, and lets an AI agent inspect the code to answer your question — complete with file-level citations tied to a specific commit so they never go stale.

> **im·ma·nence** */ˈimənəns/*
> The quality of being contained within; inherent. Here, the answers come from the codebase itself — not from approximations or training data.

## How It Works

```
 You ask a question
       ↓
 Repo is resolved (or inferred from the question)
       ↓
 HEAD is pinned to a specific commit SHA
       ↓
 Source snapshot is downloaded & cached locally
       ↓
 An AI agent inspects the code with tool calls
       ↓
 You get an answer with file + line citations
```

Three interfaces, same engine:

| Interface | Use case |
|-----------|----------|
| **CLI** | One-off questions from your terminal |
| **HTTP** | Integrate into scripts, bots, dashboards |
| **MCP** | Plug into any MCP-compatible AI assistant |

## Quick Start

### Requirements

- Node.js 20+
- `git` on your PATH

### Install & Build

```bash
npm install
npm run build
```

### Authenticate

```bash
npx immanence auth login
npx immanence auth status   # verify
```

### Ask Something

```bash
# Specify a repo explicitly
npx immanence ask \
  --repo honojs/hono \
  --question "How does the router match params and wildcards?"

# Let Immanence figure out which repo you mean
npx immanence ask \
  --question "Where does Next.js get its list of Google fonts?"

# Machine-readable output
npx immanence ask \
  --question "Where does Next.js get its list of Google fonts?" \
  --json
```

## CLI Reference

### Commands

| Command | Description |
|---------|-------------|
| `auth login` | Authenticate with GitHub |
| `auth status` | Check authentication state |
| `auth logout` | Clear stored credentials |
| `models` | List available models |
| `ask` | Ask a question about a codebase |
| `serve http` | Start the HTTP server |
| `serve mcp` | Start the MCP server |

### `ask` Options

| Flag | Description |
|------|-------------|
| `--repo <repo...>` | One or more GitHub repos (`owner/name`) |
| `--ref <ref>` | Branch, tag, or commit SHA |
| `--model <model>` | Override the default model |
| `--include-web-search` | Augment with Brave web search |
| `--refresh <mode>` | `never` · `if-stale` · `always` |
| `--max-tool-calls <n>` | Cap the number of tool calls |
| `--json` | Emit the full response envelope as JSON |

## HTTP API

```bash
npm run serve:http   # default: 127.0.0.1:8787
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/healthz` | Health check |
| `GET` | `/v1/auth/status` | Auth state |
| `GET` | `/v1/models` | Available models |
| `POST` | `/v1/questions` | Ask a question |

**Example request:**

```bash
curl -s -X POST http://127.0.0.1:8787/v1/questions \
  -H 'content-type: application/json' \
  -d '{
    "question": "How does the router match params and wildcards?",
    "repos": [{ "repo": "honojs/hono" }]
  }' | jq .
```

## MCP Server

```bash
npm run serve:mcp
```

Exposes a single tool — `ask_codebase_question` — that any MCP-compatible client can call.

## Platform Notes

### Windows

Natively supported. Requires `git` on PATH.

| Path | Default |
|------|---------|
| Data | `%LOCALAPPDATA%\immanence\data` |
| Cache | `%LOCALAPPDATA%\immanence\cache` |

### Storage & Environment

| Variable | Purpose | Default (Linux/macOS) |
|----------|---------|-----------------------|
| `IMMANENCE_DATA_DIR` | Persistent data | `~/.local/share/immanence` |
| `IMMANENCE_CACHE_DIR` | Cached snapshots | `~/.cache/immanence` |
| `IMMANENCE_DEFAULT_MODEL` | Default model | *(built-in)* |
| `BRAVE_SEARCH_API_KEY` | Web search augmentation | *(disabled)* |

Repo snapshots live under `$IMMANENCE_DATA_DIR/repos/github.com/…` and are keyed by commit SHA.

## Limits

- Public GitHub repos only.
- Read-only inspection — Immanence never modifies code.
- No chat memory between questions.

## Contributing

```bash
npm run dev -- --help   # run from source
npm test                # run the test suite
npm run build           # production build
```

Snapshots are cached by commit SHA. Refs are refreshed according to `--refresh`. Final answers always include the pinned SHA so citations stay stable over time.

## License

[MIT](LICENSE) © Kaf
