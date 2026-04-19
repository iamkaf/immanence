import { loadConfig } from "../../core/config.js";
import { getAuthStatus } from "../../core/auth/codexAuth.js";

export async function authStatusCommand() {
  const status = await getAuthStatus(loadConfig().authFilePath);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}
