"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Analysis, Medicine } from "@/lib/medical";
import type { SafetyResult } from "@/lib/medical";
import sampleData from "@/data/sample-analysis.json";
import Schedule from "@/components/schedule";
import SafetyCheck from "@/components/safety-check";
import StepIndicator from "@/components/step-indicator";
import { getLanguage, LANGUAGES } from "@/lib/languages";

function getSampleTranslation(code: string) {
  if (code === "en") return undefined;
  return sampleData.translations[code as keyof typeof sampleData.translations];
}

function TimingIcon({ timing }: { timing: string }) {
  const value = timing.toLowerCase();
  const slots = [
    { match: /morning|breakfast/, icon: "☀", label: "Morning" },
    { match: /afternoon|lunch/, icon: "◷", label: "Afternoon" },
    { match: /evening|dinner/, icon: "◒", label: "Evening" },
    { match: /night|bedtime/, icon: "☾", label: "Night" },
  ];
  const matched = slots.filter((slot) => slot.match.test(value));
  const food = /before food|before meals|empty stomach/.test(value)
    ? "Before food"
    : /after food|after meals|with food/.test(value)
      ? "After food"
      : "";
  return (
    <div className="timing-chips" aria-label={`Timing: ${timing || "not specified"}`}>
      {matched.length ? matched.map((slot) => (
        <span className="timing-chip" key={slot.label}><span aria-hidden="true">{slot.icon}</span>{slot.label}</span>
      )) : <span className="timing-chip timing-chip-neutral">◷ Timing not specified</span>}
      {food && <span className="timing-chip timing-chip-food"><span aria-hidden="true">🍽</span>{food}</span>}
      {timing && matched.length === 0 && <span className="timing-extra">{timing}</span>}
    </div>
  );
}

function MedicineCard({ medicine, index }: { medicine: Medicine; index: number }) {
  return (
    <article className="medicine-card" data-tour={index === 0 ? "medicine-card-0" : undefined}>
      <div className="medicine-card-heading">
        <span className="medicine-number">{index + 1}</span>
        <div>
          <h2>{medicine.name || "Medicine name unclear"}</h2>
          {medicine.strength && <p className="medicine-strength">{medicine.strength}</p>}
        </div>
      </div>
      <div className="medicine-details">
        {medicine.purpose && <section><h3>What it&apos;s for</h3><p>{medicine.purpose}</p></section>}
        {(medicine.how_to_take || medicine.frequency_per_day > 0 || medicine.timing || medicine.duration) && (
          <section>
            <h3>How to take</h3>
            {medicine.how_to_take && <p>{medicine.how_to_take}</p>}
            {medicine.frequency_per_day > 0 && <p>{medicine.frequency_per_day} time{medicine.frequency_per_day === 1 ? "" : "s"} per day</p>}
            <TimingIcon timing={medicine.timing} />
            {medicine.duration && <p className="detail-muted">Duration: {medicine.duration}</p>}
          </section>
        )}
        {medicine.common_side_effects.length > 0 && (
          <section><h3>Common side effects</h3><ul>{medicine.common_side_effects.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul></section>
        )}
        {medicine.cautions.length > 0 && (
          <section className="caution-box"><h3>Things to be careful about</h3><ul>{medicine.cautions.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul></section>
        )}
      </div>
    </article>
  );
}

export default function ResultsClient() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [baseAnalysis, setBaseAnalysis] = useState<Analysis | null>(null);
  const [baseLanguage, setBaseLanguage] = useState("en");
  const [translationCache, setTranslationCache] = useState<Record<string, Analysis>>({});
  const [language, setLanguage] = useState("en");
  const [translating, setTranslating] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [retryLanguage, setRetryLanguage] = useState<string | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [translationSucceeded, setTranslationSucceeded] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoSafety, setDemoSafety] = useState<SafetyResult | undefined>();

  useEffect(() => {
    const savedLanguage = getLanguage(localStorage.getItem("medclear-language")).code;
    const isDemo = sessionStorage.getItem("medclear-demo") === "true";
    setDemoMode(isDemo);
    if (isDemo) {
      const localized = getSampleTranslation(savedLanguage);
      const demoAnalysis = localized?.analysis ?? sampleData.analysis;
      setAnalysis(demoAnalysis as Analysis);
      setBaseAnalysis(sampleData.analysis as Analysis);
      setBaseLanguage("en");
      setTranslationCache({ en: sampleData.analysis as Analysis, ...(savedLanguage !== "en" ? { [savedLanguage]: demoAnalysis as Analysis } : {}) });
      setLanguage(savedLanguage);
      setTranslationSucceeded(savedLanguage !== "en");
      localStorage.setItem("medclear-language", savedLanguage);
      setDemoSafety((localized?.safety ?? sampleData.safety) as SafetyResult);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(demoAnalysis));
      return;
    }
    const stored = sessionStorage.getItem("medclear-analysis");
    if (!stored) {
      setLanguage("en");
      setBaseLanguage("en");
      localStorage.setItem("medclear-language", "en");
      return;
    }
    try {
      const initialAnalysis = JSON.parse(stored) as Analysis;
      const source = JSON.stringify(initialAnalysis);
      let originalAnalysis = initialAnalysis;
      let originalLanguage = "en";
      let displayLanguage = "en";
      let cachedEntries: Record<string, Analysis> = { en: initialAnalysis };
      try {
        const savedCache = JSON.parse(sessionStorage.getItem("medclear-translation-cache") || "null") as { source?: string; sourceAnalysis?: Analysis; sourceLanguage?: string; entries?: Record<string, Analysis> } | null;
        if (savedCache?.entries && savedCache.sourceAnalysis && savedCache.source) {
          cachedEntries = savedCache.entries;
          originalAnalysis = savedCache.sourceAnalysis;
          originalLanguage = savedCache.sourceLanguage ?? "en";
          if (savedCache.source === source) displayLanguage = originalLanguage;
          else if (JSON.stringify(savedCache.entries[savedLanguage]) === source) displayLanguage = savedLanguage;
        }
      } catch { /* Ignore unusable session translation cache. */ }
      setAnalysis(initialAnalysis);
      setBaseAnalysis(originalAnalysis);
      setBaseLanguage(originalLanguage);
      setTranslationCache(cachedEntries);
      setLanguage(displayLanguage);
      setTranslationSucceeded(displayLanguage !== originalLanguage);
      if (displayLanguage !== savedLanguage) setPendingLanguage(savedLanguage);
      else localStorage.setItem("medclear-language", displayLanguage);
    } catch {
      sessionStorage.removeItem("medclear-analysis");
      setLanguage("en");
      setBaseLanguage("en");
    }
  }, []);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  const changeLanguage = useCallback(async (nextLanguage: string, sourceOverride?: Analysis) => {
    setLanguageError("");
    setRetryLanguage(null);
    if ((!analysis && !sourceOverride) || (nextLanguage === language && !sourceOverride)) return;
    if (demoMode) {
      const localized = getSampleTranslation(nextLanguage);
      const demoAnalysis = localized?.analysis ?? sampleData.analysis;
      setAnalysis(demoAnalysis as Analysis);
      setLanguage(nextLanguage);
      setTranslationSucceeded(nextLanguage !== "en");
      localStorage.setItem("medclear-language", nextLanguage);
      setTranslationCache((current) => ({ ...current, [nextLanguage]: demoAnalysis as Analysis }));
      setDemoSafety((localized?.safety ?? sampleData.safety) as SafetyResult);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(demoAnalysis));
      return;
    }
    const source = sourceOverride ?? baseAnalysis ?? analysis;
    if (!source) return;
    const cached = translationCache[nextLanguage];
    if (cached) {
      setAnalysis(cached);
      setLanguage(nextLanguage);
      setTranslationSucceeded(nextLanguage !== baseLanguage);
      localStorage.setItem("medclear-language", nextLanguage);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(cached));
      return;
    }
    if (retrySeconds > 0) return;
    setTranslating(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: source, language: nextLanguage }),
      });
      if (!response.ok) throw new Error("translation-failed");
      const payload = await response.json() as Analysis;
      setAnalysis(payload);
      setLanguage(nextLanguage);
      setTranslationSucceeded(true);
      localStorage.setItem("medclear-language", nextLanguage);
      const nextCache = { ...translationCache, [nextLanguage]: payload };
      setTranslationCache(nextCache);
      sessionStorage.setItem("medclear-translation-cache", JSON.stringify({ source: JSON.stringify(source), sourceAnalysis: source, sourceLanguage: baseLanguage, entries: nextCache }));
      sessionStorage.setItem("medclear-analysis", JSON.stringify(payload));
    } catch {
      setAnalysis(source);
      setLanguage(baseLanguage);
      setTranslationSucceeded(false);
      localStorage.setItem("medclear-language", baseLanguage);
      setLanguageError("Translation is busy right now, please try again in a moment");
      setRetryLanguage(nextLanguage);
      setRetrySeconds(15);
    } finally {
      setTranslating(false);
    }
  }, [analysis, baseAnalysis, baseLanguage, demoMode, language, retrySeconds, translationCache]);

  useEffect(() => {
    if (!pendingLanguage || !baseAnalysis) return;
    const target = pendingLanguage;
    setPendingLanguage(null);
    void changeLanguage(target, baseAnalysis);
  }, [baseAnalysis, changeLanguage, pendingLanguage]);

  return (
    <main className="results-page">
      <header className="site-header scan-header">
        <Link className="brand" href="/" aria-label="MedClear home"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>MedClear</span></Link>
        <span className="header-note">Medicine, made clearer</span>
      </header>
      <section className="results-content">
        <StepIndicator hasResult={!!analysis} />
        <a className="back-link" href="/scan">← Scan another photo</a>
        <div className="results-toolbar"><div className="eyebrow"><span className="eyebrow-dot" /> Your medicine notes</div><label className="language-field" htmlFor="results-language">Language<select id="results-language" data-tour="language-switcher" value={language} disabled={translating} onChange={(event) => void changeLanguage(event.target.value)}>{LANGUAGES.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label></div>
        {language !== baseLanguage && translationSucceeded && <p className="translation-disclaimer">AI-generated translation, please confirm with a pharmacist.</p>}
        {translating && <p className="loading-note" role="status">Changing language…</p>}
        {languageError && <div className="form-error" role="alert"><p>{languageError}</p><button className="sample-button" type="button" onClick={() => retryLanguage && void changeLanguage(retryLanguage)} disabled={translating || retrySeconds > 0}>{retrySeconds > 0 ? `Retry in ${retrySeconds}s` : "Retry translation"}</button></div>}
        {demoMode && <p className="demo-notice">Sample demonstration result · no prescription was analyzed.</p>}
        <h1 className="results-title">Here&apos;s what we could read.</h1>
        {!analysis ? (
          <div className="empty-state"><p>No result is saved in this browser yet.</p><a className="try-button" href="/scan">Upload a photo <span aria-hidden="true">→</span></a></div>
        ) : (
          <>
            <section id="step-review" data-tour="review-section" aria-label="Review medicine information">
              {analysis.unreadable_parts.length > 0 && (
                <section className="unreadable-box" aria-labelledby="unreadable-title" data-tour="unreadable-section">
                  <h2 id="unreadable-title"><span aria-hidden="true">ⓘ</span> Could not read clearly</h2>
                  <p>Please check these details on the original packaging or with a pharmacist:</p>
                  <ul>{analysis.unreadable_parts.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
                </section>
              )}
              {analysis.medicines.length > 0 ? (
                <div className="medicine-list">{analysis.medicines.map((medicine, index) => <MedicineCard key={`${medicine.name}-${index}`} medicine={medicine} index={index} />)}</div>
              ) : (
                <div className="empty-state"><h2>No medicine details were clear enough to summarize.</h2><p>Try a sharper photo in good light, or ask your pharmacist to review the label.</p></div>
              )}
              {analysis.general_notes.length > 0 && <section className="general-notes"><h2>Helpful notes</h2><ul>{analysis.general_notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul></section>}
            </section>
            {analysis.medicines.length > 0 && <Schedule analysis={analysis} />}
            {analysis.medicines.length > 0 && <SafetyCheck medicines={analysis.medicines} demoResult={demoMode ? demoSafety : undefined} />}
          </>
        )}
        <p className="persistent-disclaimer" data-tour="closing-disclaimer">MedClear is for information only. Always confirm with your doctor or pharmacist.</p>
      </section>
    </main>
  );
}
