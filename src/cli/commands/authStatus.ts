import { getAuthStatus } from "../../core/auth/codexAuth.js";
import { createAuthCommand } from "./shared.js";

export const authStatusCommand = createAuthCommand(getAuthStatus);
