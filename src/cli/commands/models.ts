import { listCodexModels } from "../../core/auth/codexAuth.js";

export async function modelsCommand() {
  const models = await listCodexModels();
  process.stdout.write(`${JSON.stringify(models, null, 2)}\n`);
}
