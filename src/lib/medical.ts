import { z } from "zod";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function coerceFrequency(value: unknown): number {
  const candidate = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(candidate) && candidate >= 0 && candidate <= 24 ? candidate : 0;
}

function limitWords(value: string, maximum: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maximum ? words.slice(0, maximum).join(" ") : value;
}

const stringSchema = z.preprocess(coerceString, z.string());
const purposeSchema = z.preprocess(coerceString, z.string()).transform((value) => limitWords(value, 15));
const howToTakeSchema = z.preprocess(coerceString, z.string()).transform((value) => limitWords(value, 20));
const stringArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  return value.map(coerceString).filter(Boolean);
}, z.array(z.string()).default([]));
const conciseListSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  return value.map(coerceString).filter(Boolean).slice(0, 3);
}, z.array(z.string().transform((value) => limitWords(value, 10))).default([]));
const frequencySchema = z.preprocess(coerceFrequency, z.number().int().min(0).max(24));

export const medicineSchema = z.preprocess((value) => {
  const medicine = isRecord(value) ? value : {};
  return {
    ...medicine,
    name: medicine.name,
    strength: medicine.strength,
    purpose: medicine.purpose,
    how_to_take: medicine.how_to_take,
    frequency_per_day: medicine.frequency_per_day,
    timing: medicine.timing,
    duration: medicine.duration,
    common_side_effects: medicine.common_side_effects,
    cautions: medicine.cautions,
  };
}, z.object({
  name: stringSchema,
  strength: stringSchema,
  purpose: purposeSchema,
  how_to_take: howToTakeSchema,
  frequency_per_day: frequencySchema,
  timing: stringSchema,
  duration: stringSchema,
  common_side_effects: conciseListSchema,
  cautions: conciseListSchema,
}));

function normalizeAnalysis(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.medicines)) return value;

  const incompleteMedicines = value.medicines.some((item) => {
    if (!isRecord(item)) return true;
    const requiredText = ["name", "strength", "purpose", "how_to_take", "timing", "duration"];
    return requiredText.some((field) => !coerceString(item[field]).trim())
      || coerceFrequency(item.frequency_per_day) === 0
      || !Array.isArray(item.common_side_effects)
      || !Array.isArray(item.cautions);
  });
  const unreadableParts = Array.isArray(value.unreadable_parts)
    ? value.unreadable_parts.map(coerceString).filter(Boolean)
    : [];

  return {
    ...value,
    general_notes: value.general_notes,
    unreadable_parts: incompleteMedicines
      ? [...unreadableParts, "Some medicine details were missing or unclear in the AI response. Please confirm them with your doctor or pharmacist."]
      : unreadableParts,
  };
}

export const analysisObjectSchema = z.object({
  medicines: z.array(medicineSchema),
  general_notes: stringArraySchema,
  unreadable_parts: stringArraySchema,
});

export const analysisSchema = z.preprocess(normalizeAnalysis, analysisObjectSchema);

export const safetySchema = z.object({
  duplicate_ingredients: z.array(z.object({
    ingredient: z.string(),
    medicines: z.array(z.string()),
    explanation: z.string(),
  }).strict()),
  interactions: z.array(z.object({
    medicines: z.array(z.string()),
    severity: z.enum(["Info", "Ask pharmacist"]),
    warning: z.string(),
  }).strict()),
  ask_pharmacist: z.array(z.string()),
}).strict();

export type Medicine = z.infer<typeof medicineSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type SafetyResult = z.infer<typeof safetySchema>;
