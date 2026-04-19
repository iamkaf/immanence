import { spawn } from "node:child_process";

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const commandAvailabilityCache = new Map<string, Promise<boolean>>();

export async function execCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
  } = {},
): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? -1,
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

export async function execCommandOrThrow(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    errorPrefix?: string;
  } = {},
) {
  const result = await execCommand(command, args, options);
  if (result.exitCode === 0) return result;
  const prefix = options.errorPrefix ?? `${command} ${args.join(" ")}`;
  throw new Error(
    `${prefix} failed with exit code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
  );
}

export async function hasCommand(
  command: string,
  probeArgs: string[] = ["--version"],
) {
  const cacheKey = `${command}\0${probeArgs.join("\0")}`;
  const cached = commandAvailabilityCache.get(cacheKey);
  if (cached) return await cached;

  const pending = new Promise<boolean>((resolve) => {
    const child = spawn(command, probeArgs, {
      stdio: "ignore",
    });

    let settled = false;

    child.on("error", () => {
      settled = true;
      resolve(false);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      resolve(true);
    });
  });

  commandAvailabilityCache.set(cacheKey, pending);
  return await pending;
}
