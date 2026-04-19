import { logoutCodex } from "../../core/auth/codexAuth.js";
import { createAuthCommand } from "./shared.js";

export const authLogoutCommand = createAuthCommand(logoutCodex);
