import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisSchema } from "@/lib/medical";
import { getChatCompletionsUrl } from "@/lib/llm";

const languageSchema = z.enum(["en", "hi", "mr"]);
const requestSchema = analysisSchema.extend({ language: languageSchema });

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !model) return NextResponse.json({ error: "Translation is not configured." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid translation request." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "The result could not be translated." }, { status: 400 });
  const { language } = parsed.data;
  const languageName = language === "hi" ? "Hindi" : language === "mr" ? "Marathi" : "English";
  const original = { medicines: parsed.data.medicines, general_notes: parsed.data.general_notes, unreadable_parts: parsed.data.unreadable_parts };
  try {
    const response = await fetch(getChatCompletionsUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Translate all explanatory text to ${languageName}. Keep medicine names and strengths exactly as provided in English. Do not alter medicine names, doses, timing, or facts. Preserve the exact JSON structure and number of items. Never add medical advice or diagnose. Output valid JSON only.` },
          { role: "user", content: JSON.stringify(original) },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) return NextResponse.json({ error: "Translation is temporarily unavailable." }, { status: 502 });
    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No translation result");
    const validated = analysisSchema.safeParse(JSON.parse(content));
    if (!validated.success) return NextResponse.json({ error: "Translation returned an incomplete result." }, { status: 502 });
    return NextResponse.json(validated.data);
  } catch (error) {
    console.error("Translation route error", error);
    return NextResponse.json({ error: "Translation could not be completed." }, { status: 502 });
  }
}
