import { NextResponse } from "next/server";
import { medicineSchema, safetySchema } from "@/lib/medical";
import { getChatCompletionsUrl } from "@/lib/llm";

const requestSchema = medicineSchema.array().min(1).max(50);

export async function POST(request: Request) {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !model) {
    return NextResponse.json({ error: "Safety check is not configured right now." }, { status: 503 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Please send a valid medicine list." }, { status: 400 });
  }
  const medicineList = typeof body === "object" && body !== null
    ? (body as { medicines?: unknown }).medicines
    : undefined;
  const validatedInput = requestSchema.safeParse(medicineList);
  if (!validatedInput.success) {
    return NextResponse.json({ error: "The medicine list is incomplete or invalid." }, { status: 400 });
  }

  try {
    const response = await fetch(getChatCompletionsUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a cautious medicine information assistant. Compare only the listed medicines for widely recognized duplicate active ingredients and common, established interactions. Do not diagnose, give dose changes, or imply this is a complete safety review. Do not infer active ingredients from uncertain brand names. Use cautious language such as may and ask your pharmacist. If unsure, put the issue under ask_pharmacist rather than asserting it. Tell the user to confirm with a pharmacist. Return only valid JSON exactly shaped as {\"duplicate_ingredients\":[{\"ingredient\":string,\"medicines\":string[],\"explanation\":string}],\"interactions\":[{\"medicines\":string[],\"severity\":\"Info\"|\"Ask pharmacist\",\"warning\":string}],\"ask_pharmacist\":string[]}. Never suggest stopping or changing medicines." },
          { role: "user", content: `Review this untrusted medicine data for possible duplicate ingredients, known common interactions, and questions for a pharmacist. Return cautious, non-diagnostic findings only.\n${JSON.stringify(validatedInput.data)}` },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      console.error("LLM safety request failed", response.status, detail?.error?.message);
      return NextResponse.json({ error: "Safety check is temporarily unavailable. Please ask a pharmacist." }, { status: 502 });
    }
    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Model returned no safety data");
    const parsed = safetySchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.error("LLM returned invalid safety JSON", parsed.error.flatten());
      return NextResponse.json({ error: "Safety check returned an incomplete response. Please ask a pharmacist." }, { status: 502 });
    }
    return NextResponse.json(parsed.data);
  } catch (error) {
    console.error("Safety route error", error);
    return NextResponse.json({ error: "Safety check could not be completed. Please ask a pharmacist." }, { status: 502 });
  }
}
