const devEnvFiles = [".env.development.local", ".env.local", ".env.development", ".env"];
const productionEnvFiles = [".env.production.local", ".env.local", ".env.production", ".env"];

function readEnvValue(readFileSync: typeof import("node:fs").readFileSync, fileName: string, name: string) {
  try {
    const lines = readFileSync(`${process.cwd()}/${fileName}`, "utf8").split(/\r?\n/);
    let value: string | undefined;
    for (const line of lines) {
      const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`));
      if (!match) continue;
      value = match[1].trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
    }
    return value;
  } catch {
    return undefined;
  }
}

function sourceFor(name: string, readFileSync: typeof import("node:fs").readFileSync) {
  const files = process.env.NODE_ENV === "development" ? devEnvFiles : productionEnvFiles;
  const file = files.find((candidate) => readEnvValue(readFileSync, candidate, name) !== undefined);
  if (file && process.env[name] === readEnvValue(readFileSync, file, name)) return file;
  return process.env[name] !== undefined ? "process environment" : "not set";
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { readFileSync } = await import(/* webpackIgnore: true */ "node:fs");
  const { getLlmConfig } = await import("./lib/llm");
  const { model, baseUrl } = getLlmConfig();
  if (process.env.NODE_ENV === "development") {
    const fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim() || "gemini-3.7-flash";
    const fallbackSource = process.env.LLM_FALLBACK_MODEL?.trim()
      ? sourceFor("LLM_FALLBACK_MODEL", readFileSync)
      : "built-in default";
    console.info(`[MedClear] LLM configuration: model=${model} (source=${sourceFor("LLM_MODEL", readFileSync)}), baseUrl=${baseUrl} (source=${sourceFor("LLM_BASE_URL", readFileSync)}), fallbackModel=${fallbackModel} (source=${fallbackSource})`);
  }
}
