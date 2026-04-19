import { loginCodex } from "../../core/auth/codexAuth.js";
import { createAuthCommand } from "./shared.js";

export const authLoginCommand = createAuthCommand(loginCodex);
