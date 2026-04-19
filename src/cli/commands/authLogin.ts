import { loadConfig } from "../../core/config.js";
import { loginCodex } from "../../core/auth/codexAuth.js";

export async function authLoginCommand() {
  const status = await loginCodex(loadConfig().authFilePath);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}
