const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export function getChatCompletionsUrl() {
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, "");
  return `${baseUrl}/chat/completions`;
}
