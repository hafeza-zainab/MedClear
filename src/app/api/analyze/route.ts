import { NextResponse } from "next/server";
import { analysisSchema } from "@/lib/medical";
import { getChatCompletionsUrl, getLlmConfig, invalidModelJsonMessage, logUpstreamFailure } from "@/lib/llm";
import { getLanguage } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function matchesImageType(type: string, bytes: Buffer) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const { model } = getLlmConfig();

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
    const response = await fetch(getChatCompletionsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              `You read medicine labels and prescriptions and return plain-language information. Never diagnose or replace a doctor. Never invent medicine names, strengths, doses, frequency, timing, or duration that are not clearly visible. If a field is uncertain or unreadable, use an empty string (or 0 for frequency) and describe the uncertain part in unreadable_parts. Keep medicine names in English exactly as printed. Write all explanations in ${languageName}. Explain cautiously and tell the user to confirm all instructions with a doctor or pharmacist. Return only valid JSON matching exactly this shape: {\"medicines\":[{\"name\":string,\"strength\":string,\"purpose\":string,\"how_to_take\":string,\"frequency_per_day\":number,\"timing\":string,\"duration\":string,\"common_side_effects\":string[],\"cautions\":string[]}],\"general_notes\":string[],\"unreadable_parts\":string[]}. Do not infer purpose or side effects from a brand name if uncertain; mark uncertainty instead.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Read the visible medicine information in this image." },
              { type: "image_url", image_url: { url: imageData, detail: "high" } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
      const error = await logUpstreamFailure("analyze", response, apiKey);
      return NextResponse.json(
        { error },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Model response did not contain JSON text");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[MedClear] analyze model returned invalid JSON", { model });
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
    console.error("Analysis route error", error);
    return NextResponse.json(
      { error: "We couldn't analyze that image. Please try again with a clearer photo." },
      { status: 502 },
    );
  }
}
