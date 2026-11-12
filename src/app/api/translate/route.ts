import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisSchema } from "@/lib/medical";
import { getChatCompletionsUrl, getLlmConfig, invalidModelJsonMessage, logUpstreamFailure } from "@/lib/llm";
import { getLanguage, LANGUAGE_CODES } from "@/lib/languages";

const languageSchema = z.enum(LANGUAGE_CODES);
const requestSchema = analysisSchema.extend({ language: languageSchema });

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const { model } = getLlmConfig();
  if (!apiKey || !model) return NextResponse.json({ error: "The AI service isn't configured." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid translation request." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "The result could not be translated." }, { status: 400 });
  const { language } = parsed.data;
  const languageName = getLanguage(language).promptName;
  const original = { medicines: parsed.data.medicines, general_notes: parsed.data.general_notes, unreadable_parts: parsed.data.unreadable_parts };
  try {
    const response = await fetch(getChatCompletionsUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `Translate all explanatory text to ${languageName}. Keep medicine names and strengths exactly as provided in English. Do not alter medicine names, doses, timing, or facts. Preserve the exact JSON structure and number of items. Never add medical advice or diagnose. Output valid JSON only.` },
          { role: "user", content: JSON.stringify(original) },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) {
      const error = await logUpstreamFailure("translate", response, apiKey);
      return NextResponse.json({ error }, { status: response.status === 429 ? 429 : 502 });
    }
    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No translation result");
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      console.error("[MedClear] translate model returned invalid JSON", { model });
      return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    }
    const validated = analysisSchema.safeParse(json);
    if (!validated.success) {
      console.error("LLM returned invalid translation JSON", validated.error.flatten());
      return NextResponse.json({ error: invalidModelJsonMessage() }, { status: 502 });
    }
    return NextResponse.json(validated.data);
  } catch (error) {
    console.error("Translation route error", error);
    return NextResponse.json({ error: "Translation could not be completed." }, { status: 502 });
  }
}
