const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export function getLlmConfig() {
  return {
    model: process.env.LLM_MODEL?.trim() || "",
    baseUrl: (process.env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, ""),
  };
}

export function getChatCompletionsUrl() {
  return `${getLlmConfig().baseUrl}/chat/completions`;
}

export async function logUpstreamFailure(route: string, response: Response, apiKey: string) {
  const rawBody = await response.text().catch(() => "<response body unavailable>");
  const safeBody = rawBody
    .replaceAll(apiKey, "[REDACTED API KEY]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[REDACTED IMAGE DATA]")
    .slice(0, 3000);
  console.error(`[MedClear] ${route} upstream failure: HTTP ${response.status}; response body: ${safeBody}`);
  return userFacingProviderError(response.status);
}

export function userFacingProviderError(status: number) {
  if (status === 401 || status === 403) return "The AI service isn't configured. Please try the sample or contact the app owner.";
  if (status === 429) return "Too many requests. Please wait a minute and try again, or use the sample.";
  if (status === 400 || status === 404) return "The AI request was rejected. Check the model and provider settings, then try the sample.";
  return "The AI service couldn't complete this request. Please try again or use the sample.";
}

export function invalidModelJsonMessage() {
  return "The AI service returned an unreadable result. Please try a clearer photo or use the sample.";
}
