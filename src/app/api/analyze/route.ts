import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { analysisSchema, type Analysis } from "@/lib/medical";
import { getChatCompletionsUrl, getLlmConfig, invalidModelJsonMessage, logUpstreamFailureDetails } from "@/lib/llm";
import { getLanguage } from "@/lib/languages";

export const runtime = "nodejs";
// Render web services support long-running HTTP responses; the route itself stops
// upstream work at 70 seconds so the app can return its own friendly timeout.
export const maxDuration = 75;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"];
const PER_CALL_TIMEOUT_MS = 40_000;
const TOTAL_SCAN_TIMEOUT_MS = 70_000;
const INITIAL_MAX_TOKENS = 1200;
const RETRY_MAX_TOKENS = 2400;
const FOLLOW_UP_MAX_TOKENS = 1600;
const MAX_UPSTREAM_CALLS = 3;
const ANALYSIS_CACHE_LIMIT = 50;
const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;

const analysisCache = new Map<string, { createdAt: number; value: Analysis }>();
const modelsWithoutReasoningEffort = new Set<string>();

function cleanExpiredCacheEntries(now = Date.now()) {
  for (const [key, entry] of analysisCache) {
    if (now - entry.createdAt >= ANALYSIS_CACHE_TTL_MS) analysisCache.delete(key);
  }
}

function getCachedAnalysis(key: string): Analysis | undefined {
  cleanExpiredCacheEntries();
  const entry = analysisCache.get(key);
  if (!entry) return undefined;
  analysisCache.delete(key);
  analysisCache.set(key, entry);
  return entry.value;
}

function cacheAnalysis(key: string, value: Analysis) {
  cleanExpiredCacheEntries();
  while (analysisCache.size >= ANALYSIS_CACHE_LIMIT) {
    const oldestKey = analysisCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    analysisCache.delete(oldestKey);
  }
  analysisCache.set(key, { createdAt: Date.now(), value });
}

function extractFirstJsonObject(text: string): string | undefined {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = unfenced.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index += 1) {
    const character = unfenced[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return unfenced.slice(start, index + 1);
    }
  }
  return undefined;
}

function logAnalysisOutputProblem(
  model: string,
  finishReason: string | null,
  content: string,
  issues: Array<{ path: PropertyKey[]; message: string }> = [],
  responseLength = content.length,
) {
  console.error("[MedClear] analyze output parse/validation failed", {
    model,
    finish_reason: finishReason,
    response_length: responseLength,
    wrapped_in_code_fences: /^\s*```/.test(content) && /```\s*$/.test(content),
    zod_issues: issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function matchesImageType(type: string, bytes: Buffer) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const { model } = getLlmConfig();
  const fallbackModels = (process.env.LLM_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS.join(","))
    .split(",").map((candidate) => candidate.trim()).filter(Boolean);

  if (!apiKey || !model) {
    return NextResponse.json(
      { error: "The AI service isn't configured. Please try the sample." },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Please upload a valid image." }, { status: 400 });
  }

  const image = formData.get("image");
  const language = formData.get("language");
  const languageSetting = getLanguage(language);
  const languageName = languageSetting.promptName;
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Choose a prescription or medicine photo first." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(image.type) || image.size === 0 || image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Use a non-empty JPG, PNG, or WebP image under 12 MB." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  if (!matchesImageType(image.type, bytes)) {
    return NextResponse.json({ error: "This file doesn't look like a supported image. Choose a clear JPG, PNG, or WebP photo." }, { status: 400 });
  }
  const cacheKey = createHash("sha256")
    .update(bytes)
    .update("\0")
    .update(languageSetting.code)
    .digest("hex");
  const cached = getCachedAnalysis(cacheKey);
  if (cached) return NextResponse.json(cached);

  const imageData = `data:${image.type};base64,${bytes.toString("base64")}`;

  try {
    const systemPrompt = `Extract only clearly visible medicine facts. Never diagnose, prescribe, infer, or invent names or instructions. Keep medicine names in English; write explanations in ${languageName}. Use concise phrases: purpose at most 15 words, how_to_take at most 20 words, up to 3 side effects and 3 cautions, each at most 10 words. Use empty strings, 0, and empty arrays for missing details; record unclear text in unreadable_parts. Tell the user to confirm with a doctor or pharmacist. Return only this JSON, no prose or markdown: {"medicines":[{"name":"","strength":"","purpose":"","how_to_take":"","frequency_per_day":0,"timing":"","duration":"","common_side_effects":[],"cautions":[]}],"general_notes":[],"unreadable_parts":[]}.`;
    const initialMessages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Read the visible medicine information in this image." },
          { type: "image_url", image_url: { url: imageData } },
        ],
      },
    ];

    const modelAttempts = [model, ...fallbackModels]
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
    const requestDeadline = Date.now() + TOTAL_SCAN_TIMEOUT_MS;
    let upstreamCalls = 0;

    async function requestModel(requestedModel: string, messages: unknown[], maxTokens: number, useReasoningEffort: boolean) {
      if (upstreamCalls >= MAX_UPSTREAM_CALLS) throw new Error("Analyze upstream call limit reached");
      const remainingMs = requestDeadline - Date.now();
      if (remainingMs <= 0) throw new DOMException("Analyze request time budget exhausted", "TimeoutError");
      upstreamCalls += 1;
      const startedAt = Date.now();
      let finishReason: string | null = null;
      try {
        const response = await fetch(getChatCompletionsUrl(), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: requestedModel,
            ...(useReasoningEffort && !modelsWithoutReasoningEffort.has(requestedModel)
              ? { reasoning_effort: requestedModel.includes("flash-lite") ? "minimal" : "low" }
              : {}),
            max_tokens: maxTokens,
            messages,
          }),
          signal: AbortSignal.timeout(Math.min(PER_CALL_TIMEOUT_MS, remainingMs)),
        });
        try {
          const body = await response.clone().json() as { choices?: Array<{ finish_reason?: unknown }> };
          finishReason = typeof body.choices?.[0]?.finish_reason === "string" ? body.choices[0].finish_reason : null;
        } catch { /* Keep timing logs useful even when the upstream body is malformed. */ }
        console.info("[MedClear] analyze upstream call", {
          model: requestedModel,
          image_bytes: bytes.length,
          elapsed_ms: Date.now() - startedAt,
          finish_reason: finishReason,
          timed_out: false,
        });
        return response;
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        console.info("[MedClear] analyze upstream call", {
          model: requestedModel,
          image_bytes: bytes.length,
          elapsed_ms: Date.now() - startedAt,
          finish_reason: finishReason,
          timed_out: timedOut,
        });
        throw error;
      }
    }

    async function requestWithFallback(messages: unknown[], maxTokens: number, startIndex = 0) {
      let last: { response: Response; model: string; modelIndex: number } | undefined;
      let lastTimeout: unknown;
      for (let index = startIndex; index < modelAttempts.length && upstreamCalls < MAX_UPSTREAM_CALLS; index += 1) {
        const requestedModel = modelAttempts[index];
        let response: Response;
        try {
          response = await requestModel(requestedModel, messages, maxTokens, true);
        } catch (error) {
          if (!(error instanceof Error) || (error.name !== "TimeoutError" && error.name !== "AbortError")) throw error;
          lastTimeout = error;
          if (index + 1 < modelAttempts.length && upstreamCalls < MAX_UPSTREAM_CALLS && Date.now() < requestDeadline) {
            console.warn(`[MedClear] analyze model ${requestedModel} timed out; immediately trying ${modelAttempts[index + 1]}`);
            continue;
          }
          throw error;
        }
        if (response.status === 400 && !modelsWithoutReasoningEffort.has(requestedModel) && upstreamCalls < MAX_UPSTREAM_CALLS) {
          const body = await response.clone().text().catch(() => "");
          if (/reasoning_effort|thinking_level|thinking budget/i.test(body)) {
            modelsWithoutReasoningEffort.add(requestedModel);
            console.warn(`[MedClear] analyze model ${requestedModel} rejected reasoning_effort; retrying once without it`);
            try {
              response = await requestModel(requestedModel, messages, maxTokens, false);
            } catch (error) {
              if (!(error instanceof Error) || (error.name !== "TimeoutError" && error.name !== "AbortError")) throw error;
              lastTimeout = error;
              if (index + 1 < modelAttempts.length && upstreamCalls < MAX_UPSTREAM_CALLS && Date.now() < requestDeadline) {
                console.warn(`[MedClear] analyze model ${requestedModel} timed out without reasoning_effort; immediately trying ${modelAttempts[index + 1]}`);
                continue;
              }
              throw error;
            }
          }
        }
        last = { response, model: requestedModel, modelIndex: index };
        const canFallback = (response.status === 429 || response.status >= 500)
          && index < modelAttempts.length - 1
          && upstreamCalls < MAX_UPSTREAM_CALLS;
        if (!canFallback) return last;

        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response);
          if (retryAfterMs !== undefined) {
            const remainingMs = requestDeadline - Date.now();
            if (retryAfterMs >= remainingMs) return last;
            await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          }
        }
        console.warn(`[MedClear] analyze model ${requestedModel} returned HTTP ${response.status}; trying ${modelAttempts[index + 1]}`);
      }
      if (!last) {
        if (lastTimeout) throw lastTimeout;
        throw new Error("Analyze upstream call limit reached");
      }
      return last;
    }

    async function readModelOutput(response: Response) {
      const bodyText = await response.text();
      let completion: unknown;
      try {
        completion = JSON.parse(bodyText);
      } catch {
        return { content: "", finishReason: null as string | null, responseLength: bodyText.length };
      }
      const choice = (completion as {
        choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
      })?.choices?.[0];
      const rawContent = choice?.message?.content;
      const content = typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "").join("\n")
          : "";
      return {
        content,
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
        responseLength: content.length || bodyText.length,
      };
    }

    function parseAnalysis(content: string, usedModel: string, finishReason: string | null, responseLength: number) {
      const jsonObject = extractFirstJsonObject(content);
      if (!jsonObject) {
        logAnalysisOutputProblem(usedModel, finishReason, content, [], responseLength);
        return undefined;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonObject);
      } catch {
        logAnalysisOutputProblem(usedModel, finishReason, content, [], responseLength);
        return undefined;
      }
      const validated = analysisSchema.safeParse(parsed);
      if (!validated.success) {
        logAnalysisOutputProblem(usedModel, finishReason, content, validated.error.issues, responseLength);
        return undefined;
      }
      return validated.data;
    }

    async function providerFailure(result: { response: Response; model: string }) {
      const failure = await logUpstreamFailureDetails(`analyze model=${result.model}`, result.response, apiKey!);
      const headers = result.response.status === 429 && result.response.headers.has("retry-after")
        ? { "Retry-After": result.response.headers.get("retry-after")! }
        : undefined;
      return NextResponse.json({ error: failure.message }, {
        status: result.response.status === 429 ? 429 : 502,
        headers,
      });
    }

    let result = await requestWithFallback(initialMessages, INITIAL_MAX_TOKENS);
    if (!result.response.ok) return providerFailure(result);
    let output = await readModelOutput(result.response);
    let wasTruncated = /length|max_tokens/i.test(output.finishReason ?? "");

    if (wasTruncated && upstreamCalls < MAX_UPSTREAM_CALLS) {
      result = await requestWithFallback(initialMessages, RETRY_MAX_TOKENS, result.modelIndex);
      if (!result.response.ok) return providerFailure(result);
      output = await readModelOutput(result.response);
      wasTruncated = /length|max_tokens/i.test(output.finishReason ?? "");
    }

    let analysis = parseAnalysis(output.content, result.model, output.finishReason, output.responseLength);
    if (!analysis && upstreamCalls < MAX_UPSTREAM_CALLS) {
      const repairSystem = `Return only one concise JSON object with no prose or markdown. Preserve visible facts only; never invent. Keep medicine names in English, write explanations in ${languageName}. purpose max 15 words, how_to_take max 20 words, up to 3 side effects and cautions, each max 10 words. Put unclear details in unreadable_parts. Shape: {"medicines":[{"name":"","strength":"","purpose":"","how_to_take":"","frequency_per_day":0,"timing":"","duration":"","common_side_effects":[],"cautions":[]}],"general_notes":[],"unreadable_parts":[]}.`;
      const repairMessages = output.content
        ? [
          { role: "system", content: repairSystem },
          { role: "user", content: `Convert this previous answer to the required JSON shape without adding facts:\n${output.content}` },
        ]
        : [
          { role: "system", content: repairSystem },
          initialMessages[1],
        ];
      result = await requestWithFallback(repairMessages, FOLLOW_UP_MAX_TOKENS, result.modelIndex);
      if (!result.response.ok) return providerFailure(result);
      output = await readModelOutput(result.response);
      analysis = parseAnalysis(output.content, result.model, output.finishReason, output.responseLength);
    }

    if (!analysis) return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    if (wasTruncated) {
      analysis.unreadable_parts.push("The AI response may have been cut short. Please confirm all details with your doctor or pharmacist.");
    }
    cacheAnalysis(cacheKey, analysis);
    return NextResponse.json(analysis);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Unknown request failure";
    const safeErrorMessage = errorMessage
      .replaceAll(apiKey, "[REDACTED API KEY]")
      .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[REDACTED IMAGE DATA]")
      .slice(0, 500);
    console.error("[MedClear] analyze request exception", { name: errorName, message: safeErrorMessage });
    const timedOut = errorName === "TimeoutError" || errorName === "AbortError";
    return NextResponse.json(
      { error: timedOut
        ? "The AI service took too long to read this photo. Please try again shortly or use the sample."
        : "We couldn't complete the AI request. Please try again or use the sample." },
      { status: timedOut ? 504 : 502 },
    );
  }
}
