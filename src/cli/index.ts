#!/usr/bin/env node
import { Command } from "commander";
import { askCommand } from "./commands/ask.js";
import { authLoginCommand } from "./commands/authLogin.js";
import { authLogoutCommand } from "./commands/authLogout.js";
import { authStatusCommand } from "./commands/authStatus.js";
import { modelsCommand } from "./commands/models.js";
import { serveHttpCommand } from "./commands/serveHttp.js";
import { serveMcpCommand } from "./commands/serveMcp.js";

const program = new Command();

program.name("immanence").description("Codebase exploration utility.");

const auth = program
  .command("auth")
  .description("Manage Codex authentication.");
auth.command("login").action(async () => await authLoginCommand());
auth.command("status").action(async () => await authStatusCommand());
auth.command("logout").action(async () => await authLogoutCommand());

program
  .command("models")
  .option("--json", "Emit JSON")
  .action(async (options) => await modelsCommand({ json: !!options.json }));

program
  .command("ask")
  .requiredOption("--question <question>", "Question to answer")
  .option("--repo <repo...>", "Explicit GitHub repos")
  .option("--ref <ref>", "Optional branch, tag, or commit for explicit repos")
  .option("--model <model>", "Model ID")
  .option("--include-web-search", "Enable web search")
  .option("--refresh <mode>", "Refresh mode")
  .option("--max-tool-calls <count>", "Max tool calls", (value) =>
    Number(value),
  )
  .option("--json", "Emit JSON only")
  .action(async (options) => {
    await askCommand({
      question: options.question,
      repos: options.repo,
      ref: options.ref,
      model: options.model,
      includeWebSearch: !!options.includeWebSearch,
      refresh: options.refresh,
      maxToolCalls: options.maxToolCalls,
      json: !!options.json,
    });
  });

const serve = program
  .command("serve")
  .description("Start an interface server.");
serve
  .command("http")
  .option("--port <port>", "Port to listen on", (value) => Number(value), 8787)
  .action(async (options) => await serveHttpCommand(options.port));
serve.command("mcp").action(async () => await serveMcpCommand());

await program.parseAsync(process.argv);
