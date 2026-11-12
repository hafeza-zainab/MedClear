import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisSchema, type Analysis } from "@/lib/medical";
import { getChatCompletionsUrl, getLlmConfig, userFacingProviderError } from "@/lib/llm";
import { getLanguage, LANGUAGE_CODES } from "@/lib/languages";

export const runtime = "nodejs";

const PER_CALL_TIMEOUT_MS = 40_000;
const TOTAL_TIMEOUT_MS = 70_000;
const MAX_UPSTREAM_CALLS = 3;
const CACHE_LIMIT = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"];
const modelsWithoutReasoningEffort = new Set<string>();
const translationCache = new Map<string, { createdAt: number; value: Analysis }>();

const nullableText = z.preprocess((value) => typeof value === "string" ? value : "", z.string());
const textList = z.preprocess((value) => Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : "") : [], z.array(z.string()));
const translatedMedicineSchema = z.preprocess((value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}, z.object({
  purpose: nullableText,
  how_to_take: nullableText,
  timing: nullableText,
  common_side_effects: textList,
  cautions: textList,
}));
const translatedContentSchema = z.object({
  medicines: z.preprocess((value) => Array.isArray(value) ? value : [], z.array(translatedMedicineSchema)),
  general_notes: textList,
  unreadable_parts: textList,
});
const requestSchema = z.object({
  analysis: analysisSchema,
  language: z.enum(LANGUAGE_CODES),
});

type TextField = "purpose" | "how_to_take" | "timing";
type ListField = "common_side_effects" | "cautions";

function tokenLetters(index: number) {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

function maskNumbers(text: string) {
  const values: string[] = [];
  const numberPattern = /\d+(?:[.,]\d+)*|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|once|twice)\b/gi;
  const masked = text.replace(numberPattern, (value) => {
    const marker = `VALUETOKEN${tokenLetters(values.length)}END`;
    values.push(value);
    return marker;
  });
  return { masked, values };
}

function restoreNumbers(translated: string, original: string) {
  const { values } = maskNumbers(original);
  if (!values.length) return translated;
  const markers = values.map((_, index) => `VALUETOKEN${tokenLetters(index)}END`);
  if (markers.some((marker) => !translated.includes(marker))) return original;
  let restored = translated;
  markers.forEach((marker, index) => { restored = restored.replaceAll(marker, values[index]); });
  return restored;
}

function maskList(items: string[]) {
  return items.map((text) => maskNumbers(text).masked);
}

function extractFirstJsonObject(text: string) {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = unfenced.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < unfenced.length; index += 1) {
    const character = unfenced[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return unfenced.slice(start, index + 1);
  }
  return undefined;
}

function getFinishReason(text: string): string | null {
  try {
    const body = JSON.parse(text) as { choices?: Array<{ finish_reason?: unknown }> };
    const reason = body.choices?.[0]?.finish_reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

function getRetryAfterMs(response: Response) {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function logCall(model: string, elapsedMs: number, status: number | null, finishReason: string | null) {
  console.info("[MedClear] translate upstream call", {
    model,
    elapsed_ms: elapsedMs,
    status,
    finish_reason: finishReason,
  });
}

function logValidationFailure(model: string, elapsedMs: number, status: number, finishReason: string | null, issues: Array<{ path: PropertyKey[]; message: string }>) {
  console.warn("[MedClear] translate validation failed", {
    model,
    elapsed_ms: elapsedMs,
    status,
    finish_reason: finishReason,
    zod_issues: issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
}

function cleanCache(now = Date.now()) {
  for (const [key, entry] of translationCache) {
    if (now - entry.createdAt >= CACHE_TTL_MS) translationCache.delete(key);
  }
}

function getCached(key: string) {
  cleanCache();
  const entry = translationCache.get(key);
  if (!entry) return undefined;
  translationCache.delete(key);
  translationCache.set(key, entry);
  return entry.value;
}

function saveCached(key: string, value: Analysis) {
  cleanCache();
  while (translationCache.size >= CACHE_LIMIT) {
    const oldest = translationCache.keys().next().value as string | undefined;
    if (!oldest) break;
    translationCache.delete(oldest);
  }
  translationCache.set(key, { createdAt: Date.now(), value });
}

function mergeTranslation(original: Analysis, translated: z.infer<typeof translatedContentSchema>): Analysis {
  const medicines = original.medicines.map((medicine, index) => {
    const item = translated.medicines[index];
    if (!item) return medicine;
    const nextMedicine = { ...medicine };
    for (const field of ["purpose", "how_to_take", "timing"] as const satisfies TextField[]) {
      const translatedText = item[field].trim();
      if (translatedText) nextMedicine[field] = restoreNumbers(translatedText, medicine[field]);
    }
    for (const field of ["common_side_effects", "cautions"] as const satisfies ListField[]) {
      if (item[field].length) {
        nextMedicine[field] = medicine[field].map((originalText, itemIndex) => {
          const localizedText = item[field][itemIndex];
          return localizedText ? restoreNumbers(localizedText, originalText) : originalText;
        });
      }
    }
    return nextMedicine;
  });
  const mergeList = (localized: string[], source: string[]) => source.map((value, index) => {
    const translatedText = localized[index]?.trim();
    return translatedText ? restoreNumbers(translatedText, value) : value;
  });
  return {
    medicines,
    general_notes: mergeList(translated.general_notes, original.general_notes),
    unreadable_parts: mergeList(translated.unreadable_parts, original.unreadable_parts),
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const { model } = getLlmConfig();
  if (!apiKey) return NextResponse.json({ error: "The AI service isn't configured." }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid translation request." }, { status: 400 }); }
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "The result could not be translated." }, { status: 400 });
  }

  const { analysis, language } = parsedRequest.data;
  const cacheKey = createHash("sha256").update(JSON.stringify(analysis)).update("\0").update(language).digest("hex");
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const languageName = getLanguage(language).promptName;
  const translationInput = {
    medicines: analysis.medicines.map((medicine) => ({
      purpose: maskNumbers(medicine.purpose).masked,
      how_to_take: maskNumbers(medicine.how_to_take).masked,
      timing: maskNumbers(medicine.timing).masked,
      common_side_effects: maskList(medicine.common_side_effects),
      cautions: maskList(medicine.cautions),
    })),
    general_notes: maskList(analysis.general_notes),
    unreadable_parts: maskList(analysis.unreadable_parts),
  };
  const messages = [
    {
      role: "system",
      content: `Translate only the provided explanatory text to ${languageName}. Return one JSON object only with the same arrays and indexes: {"medicines":[{"purpose":"","how_to_take":"","timing":"","common_side_effects":[],"cautions":[]}],"general_notes":[],"unreadable_parts":[]}. Preserve every VALUETOKEN...END marker exactly; these protect numbers and dose values. Do not add facts or text.`,
    },
    { role: "user", content: JSON.stringify(translationInput) },
  ];
  const fallbackModels = (process.env.LLM_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS.join(","))
    .split(",").map((candidate) => candidate.trim()).filter(Boolean);
  const models = [model, ...fallbackModels].filter((candidate, index, all) => all.indexOf(candidate) === index);
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let callCount = 0;
  let lastResponse: Response | undefined;
  let lastModel = model;
  let lastElapsedMs = 0;
  let lastFinishReason: string | null = null;
  let lastTimeout: unknown;

  async function requestModel(requestedModel: string, includeReasoning: boolean) {
    if (callCount >= MAX_UPSTREAM_CALLS) throw new Error("Translation call limit reached");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DOMException("Translation time budget exhausted", "TimeoutError");
    callCount += 1;
    const started = Date.now();
    let responseStatus: number | null = null;
    let finishReason: string | null = null;
    try {
      const response = await fetch(getChatCompletionsUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: requestedModel,
          ...(includeReasoning && !modelsWithoutReasoningEffort.has(requestedModel)
            ? { reasoning_effort: requestedModel.includes("flash-lite") ? "minimal" : "low" }
            : {}),
          max_tokens: 1800,
          messages,
        }),
        signal: AbortSignal.timeout(Math.min(PER_CALL_TIMEOUT_MS, remaining)),
      });
      responseStatus = response.status;
      const rawBody = await response.clone().text().catch(() => "");
      finishReason = getFinishReason(rawBody);
      lastElapsedMs = Date.now() - started;
      lastFinishReason = finishReason;
      logCall(requestedModel, lastElapsedMs, responseStatus, finishReason);
      return { response, rawBody, elapsedMs: lastElapsedMs, finishReason };
    } catch (error) {
      lastElapsedMs = Date.now() - started;
      lastFinishReason = finishReason;
      logCall(requestedModel, lastElapsedMs, responseStatus, finishReason);
      throw error;
    }
  }

  for (let index = 0; index < models.length && callCount < MAX_UPSTREAM_CALLS; index += 1) {
    const requestedModel = models[index];
    lastModel = requestedModel;
    let result: Awaited<ReturnType<typeof requestModel>>;
    try {
      result = await requestModel(requestedModel, true);
    } catch (error) {
      if (!(error instanceof Error) || (error.name !== "TimeoutError" && error.name !== "AbortError")) {
        return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 502 });
      }
      lastTimeout = error;
      if (index + 1 < models.length && callCount < MAX_UPSTREAM_CALLS && Date.now() < deadline) continue;
      break;
    }

    if (result.response.status === 400 && !modelsWithoutReasoningEffort.has(requestedModel) && callCount < MAX_UPSTREAM_CALLS
      && /reasoning_effort|thinking_level|thinking budget/i.test(result.rawBody)) {
      modelsWithoutReasoningEffort.add(requestedModel);
      try {
        result = await requestModel(requestedModel, false);
      } catch (error) {
        if (!(error instanceof Error) || (error.name !== "TimeoutError" && error.name !== "AbortError")) {
          return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 502 });
        }
        lastTimeout = error;
        if (index + 1 < models.length && callCount < MAX_UPSTREAM_CALLS && Date.now() < deadline) continue;
        break;
      }
    }

    lastResponse = result.response;
    lastModel = requestedModel;
    lastElapsedMs = result.elapsedMs;
    lastFinishReason = result.finishReason;
    if (result.response.status === 429 && index + 1 < models.length && callCount < MAX_UPSTREAM_CALLS) {
      const waitMs = getRetryAfterMs(result.response);
      if (waitMs !== undefined) {
        const remaining = deadline - Date.now();
        if (waitMs >= remaining) break;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    if ((result.response.status === 429 || result.response.status >= 500)
      && index + 1 < models.length && callCount < MAX_UPSTREAM_CALLS) continue;
    if (!result.response.ok) {
      return NextResponse.json({ error: userFacingProviderError(result.response.status) }, {
        status: result.response.status === 429 ? 429 : 502,
        headers: result.response.status === 429 && result.response.headers.has("retry-after")
          ? { "Retry-After": result.response.headers.get("retry-after")! }
          : undefined,
      });
    }

    let completion: unknown;
    try { completion = JSON.parse(result.rawBody); } catch { completion = undefined; }
    const rawContent = (completion as { choices?: Array<{ message?: { content?: unknown } }> } | undefined)?.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "").join("\n")
        : "";
    const objectText = extractFirstJsonObject(content);
    let output: unknown;
    try { output = objectText ? JSON.parse(objectText) : undefined; } catch { output = undefined; }
    const outputRecord = typeof output === "object" && output !== null && !Array.isArray(output)
      ? output as Record<string, unknown>
      : undefined;
    const hasUsableFields = Boolean(outputRecord
      && ["medicines", "general_notes", "unreadable_parts"].some((field) => Array.isArray(outputRecord[field])));
    const validated = hasUsableFields ? translatedContentSchema.safeParse(output) : undefined;
    if (!validated?.success) {
      const issues = validated && !validated.success
        ? validated.error.issues
        : [{ path: [], message: "No usable translated text was returned." }];
      logValidationFailure(requestedModel, result.elapsedMs, result.response.status, result.finishReason, issues);
      return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 502 });
    }

    const hasTranslatedText = validated.data.medicines.some((medicine) =>
      [medicine.purpose, medicine.how_to_take, medicine.timing].some((text) => text.trim())
      || medicine.common_side_effects.some((text) => text.trim())
      || medicine.cautions.some((text) => text.trim()))
      || validated.data.general_notes.some((text) => text.trim())
      || validated.data.unreadable_parts.some((text) => text.trim());
    if (!hasTranslatedText) {
      logValidationFailure(requestedModel, result.elapsedMs, result.response.status, result.finishReason, [{ path: [], message: "No usable translated text was returned." }]);
      return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 502 });
    }

    const translated = mergeTranslation(analysis, validated.data);
    saveCached(cacheKey, translated);
    return NextResponse.json(translated);
  }

  if (lastTimeout) {
    return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 504 });
  }
  if (lastResponse && !lastResponse.ok) {
    return NextResponse.json({ error: userFacingProviderError(lastResponse.status) }, {
      status: lastResponse.status === 429 ? 429 : 502,
      headers: lastResponse.status === 429 && lastResponse.headers.has("retry-after")
        ? { "Retry-After": lastResponse.headers.get("retry-after")! }
        : undefined,
    });
  }
  logValidationFailure(lastModel, lastElapsedMs, lastResponse?.status ?? 502, lastFinishReason, []);
  return NextResponse.json({ error: "Translation is busy right now, please try again in a moment" }, { status: 502 });
}
