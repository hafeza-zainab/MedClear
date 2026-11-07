import { z } from "zod";

export const medicineSchema = z
  .object({
    name: z.string(),
    strength: z.string(),
    purpose: z.string(),
    how_to_take: z.string(),
    frequency_per_day: z.number().int().min(0).max(24),
    timing: z.string(),
    duration: z.string(),
    common_side_effects: z.array(z.string()),
    cautions: z.array(z.string()),
  })
  .strict();

export const analysisSchema = z
  .object({
    medicines: z.array(medicineSchema),
    general_notes: z.array(z.string()),
    unreadable_parts: z.array(z.string()),
  })
  .strict();

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
