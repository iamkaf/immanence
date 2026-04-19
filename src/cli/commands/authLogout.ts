import { loadConfig } from "../../core/config.js";
import { logoutCodex } from "../../core/auth/codexAuth.js";

export async function authLogoutCommand() {
  const status = await logoutCodex(loadConfig().authFilePath);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}
