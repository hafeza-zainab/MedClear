import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioDir = path.join(root, "public", "audio");
const scenes = JSON.parse(readFileSync(path.join(root, "src", "data", "demo-scenes.json"), "utf8"));
const extensions = ["mp3", "m4a", "wav"];
const rows = [];
const warnings = [];

function findAudio(sceneId) {
  for (const extension of extensions) {
    const file = path.join(audioDir, `${sceneId}.${extension}`);
    if (existsSync(file)) return { file, name: `${sceneId}.${extension}`, extension };
  }
  return null;
}

function wavDuration(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === "fmt " && size >= 16) byteRate = buffer.readUInt32LE(start + 8);
    if (type === "data") dataSize = size;
    if (size < 0 || start + size > buffer.length) break;
    offset = start + size + (size % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
}

function mp3Duration(buffer) {
  let offset = 0;
  if (buffer.toString("ascii", 0, 3) === "ID3" && buffer.length >= 10) {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size + ((buffer[5] & 0x10) ? 10 : 0);
  }
  let samples = 0;
  let frames = 0;
  let firstSampleRate = 0;
  while (offset + 4 <= buffer.length) {
    const header = buffer.readUInt32BE(offset);
    if ((header & 0xffe00000) !== 0xffe00000) { offset += 1; continue; }
    const version = (header >>> 19) & 0x3;
    const layer = (header >>> 17) & 0x3;
    const bitrateIndex = (header >>> 12) & 0xf;
    const sampleIndex = (header >>> 10) & 0x3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) { offset += 1; continue; }
    const versionOne = version === 3;
    const bitrates = versionOne
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRates = [44100, 48000, 32000];
    const sampleRate = sampleRates[sampleIndex] / (versionOne ? 1 : version === 2 ? 2 : 4);
    const padding = (header >>> 9) & 1;
    const frameLength = Math.floor((versionOne ? 144 : 72) * bitrates[bitrateIndex] * 1000 / sampleRate) + padding;
    if (frameLength < 4 || offset + frameLength > buffer.length) break;
    firstSampleRate ||= sampleRate;
    samples += versionOne ? 1152 : 576;
    frames += 1;
    offset += frameLength;
  }
  return frames && firstSampleRate ? samples / firstSampleRate : null;
}

function m4aDuration(buffer) {
  const type = Buffer.from("mvhd");
  const index = buffer.indexOf(type);
  if (index < 4 || index + 24 > buffer.length) return null;
  const version = buffer[index + 4];
  if (version === 1 && index + 32 <= buffer.length) {
    const timescale = buffer.readUInt32BE(index + 24);
    const duration = Number(buffer.readBigUInt64BE(index + 28));
    return timescale > 0 ? duration / timescale : null;
  }
  if (version === 0 && index + 24 <= buffer.length) {
    const timescale = buffer.readUInt32BE(index + 16);
    const duration = buffer.readUInt32BE(index + 20);
    return timescale > 0 ? duration / timescale : null;
  }
  return null;
}

function durationSeconds(file, extension) {
  const buffer = readFileSync(file);
  if (extension === "wav") return wavDuration(buffer);
  if (extension === "mp3") return mp3Duration(buffer);
  if (extension === "m4a") return m4aDuration(buffer);
  return null;
}

for (const scene of scenes) {
  const audio = findAudio(scene.id);
  const wordCount = scene.caption.trim().split(/\s+/).filter(Boolean).length;
  if (!audio) {
    rows.push({ scene: scene.id, file: "MISSING", duration: "—", words: wordCount, status: "WARN" });
    warnings.push(`${scene.id}: no MP3, M4A, or WAV file found.`);
    continue;
  }
  const duration = durationSeconds(audio.file, audio.extension);
  const status = duration === null ? "WARN" : duration < 3 || duration > 25 ? "WARN" : "OK";
  rows.push({ scene: scene.id, file: audio.name, duration: duration === null ? "unknown" : duration.toFixed(2), words: wordCount, status });
  if (duration === null) warnings.push(`${scene.id}: could not read duration from ${audio.name}.`);
  else if (duration < 3 || duration > 25) warnings.push(`${scene.id}: ${duration.toFixed(2)} seconds is outside the 3 to 25 second range.`);
}

console.log("| Scene | File found | Duration (s) | Caption words | Status |");
console.log("| --- | --- | ---: | ---: | --- |");
for (const row of rows) console.log(`| ${row.scene} | ${row.file} | ${row.duration} | ${row.words} | ${row.status} |`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
