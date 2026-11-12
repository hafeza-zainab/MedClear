import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenesPath = path.join(root, "src", "data", "demo-scenes.json");
const manifestPath = path.join(root, "public", "audio", "manifest.json");
const scriptPath = path.join(root, "scripts", "generate_narration.py");
const audioDir = path.join(root, "public", "audio");
const scenes = JSON.parse(readFileSync(scenesPath, "utf8"));
const generator = readFileSync(scriptPath, "utf8");
const narrationSource = (process.env.NARRATION_SOURCE || "external").trim().toLowerCase();

if (narrationSource === "external") {
  console.log("External narration mode; skipping generated audio manifest check.");
  process.exit(0);
}

function pythonConstant(name) {
  const match = generator.match(new RegExp(`^${name}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1] ?? null;
}

function pythonPronunciationMap() {
  const block = generator.match(/^PRONUNCIATIONS\s*=\s*\{([\s\S]*?)^\}/m)?.[1];
  if (!block) return null;
  const entries = [...block.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']*)["']/g)]
    .map((match) => [match[1], match[2]])
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  return Object.fromEntries(entries);
}

const currentVoice = pythonConstant("VOICE");
const currentRate = pythonConstant("RATE");
const silenceFilter = pythonConstant("SILENCE_FILTER");
const currentPronunciations = pythonPronunciationMap();
const issues = [];

if (scenes.length !== 10) issues.push(`expected ten scenes, found ${scenes.length}`);
for (const scene of scenes) {
  if (scene.caption !== scene.speech) issues.push(`${scene.id} caption differs from speech`);
}

if (!existsSync(manifestPath)) {
  issues.push("audio manifest is missing");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!currentPronunciations || !manifest.pronunciation_hash) {
    issues.push("pronunciation hash is missing");
  } else {
    const pronunciationHash = createHash("sha256").update(JSON.stringify(currentPronunciations), "utf8").digest("hex");
    if (manifest.pronunciation_hash !== pronunciationHash) issues.push("speech pronunciation map changed");
  }
  if (!silenceFilter || manifest.silence_filter_hash !== createHash("sha256").update(silenceFilter, "utf8").digest("hex")) {
    issues.push("audio silence-trimming filter changed");
  }
  for (const scene of scenes) {
    const record = manifest.scenes?.[scene.id];
    if (!record) {
      issues.push(`${scene.id} has no manifest entry`);
      continue;
    }
    const expected = createHash("sha256")
      .update(`${scene.speech}\0${record.voice}\0${record.rate}`, "utf8")
      .digest("hex");
    if (record.hash !== expected) issues.push(`${scene.id} speech hash does not match demo-scenes.json`);
    if (record.voice !== currentVoice || record.rate !== currentRate) issues.push(`${scene.id} was generated with a different voice or rate`);
    if (!existsSync(path.join(audioDir, `${scene.id}.mp3`))) issues.push(`${scene.id} MP3 is missing`);
  }
}

if (issues.length) {
  console.warn("\n*** WARNING: MedClear narration audio is stale or incomplete. ***");
  for (const issue of issues) console.warn(`- ${issue}`);
  console.warn("Run `python scripts/generate_narration.py` to refresh the MP3 files and manifest.\n");
} else {
  console.log("Narration manifest is current.");
}
