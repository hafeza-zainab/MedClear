export async function register() {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getLlmConfig } = await import("./lib/llm");
  const { model, baseUrl } = getLlmConfig();
  console.info(`[MedClear] LLM configuration: model=${model || "<missing>"}, baseUrl=${baseUrl}`);
}
