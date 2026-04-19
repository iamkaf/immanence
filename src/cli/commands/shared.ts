import { loadConfig } from "../../core/config.js";
import { stableStringify } from "../../util/json.js";

export function writeJson(
  value: unknown,
  stream: NodeJS.WriteStream = process.stdout,
) {
  stream.write(`${stableStringify(value)}\n`);
}

export function createAuthCommand(
  action: (authFilePath: string) => Promise<unknown>,
) {
  return async function authCommand() {
    writeJson(await action(loadConfig().authFilePath));
  };
}
