"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import sampleData from "@/data/sample-analysis.json";
import { useRouter } from "next/navigation";
import { getLanguage, LANGUAGES } from "@/lib/languages";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 1600;

async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser couldn't prepare the image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Couldn't prepare the image. Please try another photo."));
      if (blob.type !== "image/jpeg") return reject(new Error("This browser couldn't convert the photo to JPEG. Try another image."));
      resolve(blob);
    }, "image/jpeg", 0.88);
  });
}

export default function ScanForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    const savedLanguage = getLanguage(localStorage.getItem("medclear-language")).code;
    setLanguage(savedLanguage);
    localStorage.setItem("medclear-language", savedLanguage);
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setError("");
    if (!next) return setFile(null);
    if (!ACCEPTED.includes(next.type)) {
      setFile(null);
      setError("Please choose a JPG, PNG, or WebP photo.");
    } else if (next.size > MAX_FILE_BYTES) {
      setFile(null);
      setError("That photo is over 20 MB. Choose a smaller image.");
    } else {
      setFile(next);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const resized = await resizeImage(file);
      const form = new FormData();
      form.append("image", resized, "medicine-photo.jpg");
      form.append("language", language);
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
      sessionStorage.setItem("medclear-analysis", JSON.stringify(payload));
      sessionStorage.removeItem("medclear-demo");
      router.push("/results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setCooldownSeconds(15);
    } finally {
      setBusy(false);
    }
  }

  function trySample() {
    const selectedSample = language === "en" ? sampleData.analysis : sampleData.translations[language as "es" | "fr"].analysis;
    sessionStorage.setItem("medclear-analysis", JSON.stringify(selectedSample));
    sessionStorage.setItem("medclear-demo", "true");
    router.push("/results");
  }

  return (
    <form className="upload-form" onSubmit={onSubmit}>
      <label className="language-field" htmlFor="scan-language">Explanation language
        <select id="scan-language" value={language} onChange={(event) => { setLanguage(event.target.value); localStorage.setItem("medclear-language", event.target.value); }}>
          {LANGUAGES.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        </select>
      </label>
      <label className={`upload-box${preview ? " has-preview" : ""}`} htmlFor="medicine-image" data-tour="scan-preview">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="image-preview" src={preview} alt="Preview of the selected medicine photo" />
        ) : (
          <span className="upload-placeholder">
            <span className="upload-icon" aria-hidden="true">↑</span>
            <strong>Choose a photo</strong>
            <span>or take one with your camera</span>
            <small>JPG, PNG, or WebP · up to 20 MB</small>
          </span>
        )}
        <input
          id="medicine-image"
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={onFileChange}
          aria-label="Choose or take a photo of a prescription or medicine strip"
        />
      </label>
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button className="sample-button error-sample-button" type="button" onClick={trySample}>
            Open sample results (no AI call)
          </button>
        </div>
      )}
      <button className="try-button upload-submit" type="submit" disabled={!file || busy || cooldownSeconds > 0}>
        {busy ? <><span className="spinner" aria-hidden="true" /> Reading your photo…</> : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : <>Explain this photo <span aria-hidden="true">→</span></>}
      </button>
      <div className="sample-divider"><span>or</span></div>
      <button className="sample-button" type="button" data-tour="sample-button" onClick={trySample}>Try a sample prescription</button>
      {busy && <p className="loading-note" role="status">This can take a few moments. Please keep this page open.</p>}
      {!busy && cooldownSeconds > 0 && <p className="loading-note" role="status">Please wait {cooldownSeconds} seconds before trying again.</p>}
    </form>
  );
}
