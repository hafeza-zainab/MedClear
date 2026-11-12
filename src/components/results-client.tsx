"use client";

import { useEffect, useState } from "react";
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
  const [language, setLanguage] = useState("en");
  const [translating, setTranslating] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [demoSafety, setDemoSafety] = useState<SafetyResult | undefined>();

  useEffect(() => {
    const savedLanguage = getLanguage(localStorage.getItem("medclear-language")).code;
    setLanguage(savedLanguage);
    localStorage.setItem("medclear-language", savedLanguage);
    const isDemo = sessionStorage.getItem("medclear-demo") === "true";
    setDemoMode(isDemo);
    if (isDemo) {
      const localized = getSampleTranslation(savedLanguage);
      const demoAnalysis = localized?.analysis ?? sampleData.analysis;
      setAnalysis(demoAnalysis as Analysis);
      setDemoSafety((localized?.safety ?? sampleData.safety) as SafetyResult);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(demoAnalysis));
      return;
    }
    const stored = sessionStorage.getItem("medclear-analysis");
    if (!stored) return;
    try {
      setAnalysis(JSON.parse(stored) as Analysis);
    } catch {
      sessionStorage.removeItem("medclear-analysis");
    }
  }, []);

  async function changeLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    localStorage.setItem("medclear-language", nextLanguage);
    setLanguageError("");
    if (!analysis || nextLanguage === language) return;
    if (demoMode) {
      const localized = getSampleTranslation(nextLanguage);
      const demoAnalysis = localized?.analysis ?? sampleData.analysis;
      setAnalysis(demoAnalysis as Analysis);
      setDemoSafety((localized?.safety ?? sampleData.safety) as SafetyResult);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(demoAnalysis));
      return;
    }
    setTranslating(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...analysis, language: nextLanguage }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not change language.");
      setAnalysis(payload as Analysis);
      sessionStorage.setItem("medclear-analysis", JSON.stringify(payload));
    } catch (caught) {
      setLanguageError(caught instanceof Error ? caught.message : "Could not change language. Your result is unchanged.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <main className="results-page">
      <header className="site-header scan-header">
        <Link className="brand" href="/" aria-label="MedClear home"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>MedClear</span></Link>
        <span className="header-note">Medicine, made clearer</span>
      </header>
      <section className="results-content">
        <StepIndicator active="Review" />
        <a className="back-link" href="/scan">← Scan another photo</a>
        <div className="results-toolbar"><div className="eyebrow"><span className="eyebrow-dot" /> Your medicine notes</div><label className="language-field" htmlFor="results-language">Language<select id="results-language" data-tour="language-switcher" value={language} disabled={translating} onChange={(event) => void changeLanguage(event.target.value)}>{LANGUAGES.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label></div>
        {language !== "en" && <p className="translation-disclaimer">AI-generated translation, please confirm with a pharmacist.</p>}
        {translating && <p className="loading-note" role="status">Changing language…</p>}
        {languageError && <p className="form-error" role="alert">{languageError}</p>}
        {demoMode && <p className="demo-notice">Sample demonstration result · no prescription was analyzed.</p>}
        <h1 className="results-title">Here&apos;s what we could read.</h1>
        {!analysis ? (
          <div className="empty-state"><p>No result is saved in this browser yet.</p><a className="try-button" href="/scan">Upload a photo <span aria-hidden="true">→</span></a></div>
        ) : (
          <>
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
            {analysis.medicines.length > 0 && <Schedule analysis={analysis} />}
            {analysis.medicines.length > 0 && <SafetyCheck medicines={analysis.medicines} demoResult={demoMode ? demoSafety : undefined} />}
          </>
        )}
        <p className="persistent-disclaimer" data-tour="closing-disclaimer">MedClear is for information only. Always confirm with your doctor or pharmacist.</p>
      </section>
    </main>
  );
}
