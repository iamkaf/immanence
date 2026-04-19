import { listCodexModels } from "../../core/auth/codexAuth.js";

export async function modelsCommand(options: { json?: boolean } = {}) {
  const models = await listCodexModels();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(models, null, 2)}\n`);
    return;
  }

  for (const model of models) {
    const context = model.contextLength ? `${model.contextLength.toLocaleString()} ctx` : "unknown ctx";
    const reasoning = model.reasoning ? "reasoning" : "fast";
    const modalities = model.inputModalities.join(", ");
    process.stdout.write(`${model.id}\n`);
    process.stdout.write(`  ${model.name}\n`);
    process.stdout.write(`  ${reasoning} | ${context} | input: ${modalities}\n`);
  }
}
