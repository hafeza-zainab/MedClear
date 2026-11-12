import { NextResponse } from "next/server";
import { analysisSchema } from "@/lib/medical";
import { getChatCompletionsUrl, getLlmConfig, invalidModelJsonMessage, logUpstreamFailureDetails } from "@/lib/llm";
import { getLanguage } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 85;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_FALLBACK_MODEL = "gemini-3.7-flash";
const DEFAULT_EMERGENCY_MODEL = "gemini-3.5-flash-lite";

function matchesImageType(type: string, bytes: Buffer) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const { model } = getLlmConfig();
  const fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  const emergencyModel = process.env.LLM_EMERGENCY_MODEL?.trim() || DEFAULT_EMERGENCY_MODEL;

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
  const languageName = getLanguage(language).promptName;
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
  const imageData = `data:${image.type};base64,${bytes.toString("base64")}`;

  try {
    const messages = [
          {
            role: "system",
            content:
              `You read medicine labels and prescriptions and return plain-language information. Never diagnose or replace a doctor. Never invent medicine names, strengths, doses, frequency, timing, or duration that are not clearly visible. If a field is uncertain or unreadable, use an empty string (or 0 for frequency) and describe the uncertain part in unreadable_parts. Keep medicine names in English exactly as printed. Write all explanations in ${languageName}. Explain cautiously and tell the user to confirm all instructions with a doctor or pharmacist. Return only valid JSON matching exactly this shape: {\"medicines\":[{\"name\":string,\"strength\":string,\"purpose\":string,\"how_to_take\":string,\"frequency_per_day\":number,\"timing\":string,\"duration\":string,\"common_side_effects\":string[],\"cautions\":string[]}],\"general_notes\":string[],\"unreadable_parts\":string[]}. Do not infer purpose or side effects from a brand name if uncertain; mark uncertainty instead.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Read the visible medicine information in this image." },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ];

    function requestModel(requestedModel: string, timeoutMs: number) {
      const isFlashLite = requestedModel.includes("flash-lite");
      return fetch(getChatCompletionsUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: requestedModel,
          ...(!isFlashLite ? { reasoning_effort: "low" } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    // Try increasingly fast vision models when Gemini reports overload or a timeout.
    const modelAttempts = [
      { name: model, timeoutMs: 20_000 },
      { name: fallbackModel, timeoutMs: 35_000 },
      { name: emergencyModel, timeoutMs: 25_000 },
    ].filter((candidate, index, all) => all.findIndex((item) => item.name === candidate.name) === index);
    let responseModel = modelAttempts[0].name;
    let response: Response | undefined;
    for (let index = 0; index < modelAttempts.length; index += 1) {
      const candidate = modelAttempts[index];
      responseModel = candidate.name;
      try {
        response = await requestModel(candidate.name, candidate.timeoutMs);
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        if (!timedOut || index === modelAttempts.length - 1) throw error;
        console.warn(`[MedClear] analyze model ${candidate.name} timed out; trying ${modelAttempts[index + 1].name}`);
        continue;
      }

      if (response.status < 500 || index === modelAttempts.length - 1) break;
      const nextModel = modelAttempts[index + 1].name;
      console.warn(`[MedClear] analyze model ${candidate.name} returned HTTP ${response.status}; trying ${nextModel}`);
      await response.arrayBuffer();
    }

    if (!response) throw new Error("No model response was received");
    if (!response.ok) {
      const failure = await logUpstreamFailureDetails(`analyze model=${responseModel}`, response, apiKey);
      const diagnostics = process.env.NODE_ENV === "development"
        && request.headers.get("x-medclear-test-diagnostics") === "true"
        ? { upstreamStatus: failure.status, upstreamBody: failure.body }
        : undefined;
      return NextResponse.json(
        { error: failure.message, ...(diagnostics ? { diagnostics } : {}) },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    let completion: unknown;
    try {
      completion = await response.json();
    } catch {
      console.error("[MedClear] analyze provider returned a non-JSON response", { model: responseModel });
      return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    }
    const content = (completion as {
      choices?: Array<{ message?: { content?: unknown } }>;
    })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("[MedClear] analyze provider response had no text content", { model: responseModel });
      return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[MedClear] analyze model returned invalid JSON", { model: responseModel });
      return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    }
    const validated = analysisSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("LLM returned invalid analysis JSON", validated.error.flatten());
      return NextResponse.json(
        { error: invalidModelJsonMessage() },
        { status: 502 },
      );
    }

    return NextResponse.json(validated.data);
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
