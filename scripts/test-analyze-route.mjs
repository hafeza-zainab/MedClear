// Start `npm run dev`, then run `node scripts/test-analyze-route.mjs`.
// This submits a fictional test prescription stored in scripts/fixtures.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const model = process.env.LLM_MODEL?.trim();
const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
const missing = [!baseUrl && "LLM_BASE_URL", !model && "LLM_MODEL"].filter(Boolean);
if (missing.length) {
  console.error(`Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Check .env.local and restart the development server.`);
  process.exit(1);
}
console.log(`Effective model: ${model}`);
console.log(`Effective base URL: ${baseUrl}`);

const endpoint = process.env.MEDCLEAR_TEST_URL ?? "http://127.0.0.1:3000/api/analyze";

try {
  const jpeg = await readFile(resolve(scriptDirectory, "fixtures", "test-prescription.jpg"));
  const form = new FormData();
  form.set("image", new Blob([jpeg], { type: "image/jpeg" }), "test-prescription.jpg");
  form.set("language", "en");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "x-medclear-test-diagnostics": "true" },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));

  if (payload.diagnostics) {
    console.log(`Sanitized upstream status: HTTP ${payload.diagnostics.upstreamStatus}`);
    console.log(`Sanitized upstream body: ${payload.diagnostics.upstreamBody}`);
  } else if (response.ok) {
    const medicineCount = Array.isArray(payload.medicines) ? payload.medicines.length : 0;
    console.log(`Analyze route succeeded: HTTP ${response.status}; parsed medicine count: ${medicineCount}.`);
  } else {
    console.log(`Analyze route response: HTTP ${response.status}`);
    console.log(`Route message: ${payload.error ?? "No response message."}`);
    console.log("No upstream diagnostic was returned. Use a development server and check its sanitized MedClear server log.");
  }
} catch (error) {
  console.error(`Could not reach the analyze route at ${endpoint}: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
