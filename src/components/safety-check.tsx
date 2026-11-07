"use client";

import { useEffect, useState } from "react";
import type { Medicine, SafetyResult } from "@/lib/medical";

export default function SafetyCheck({ medicines, demoResult }: { medicines: Medicine[]; demoResult?: SafetyResult }) {
  const [result, setResult] = useState<SafetyResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (demoResult) {
      setResult(demoResult);
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    async function run() {
      try {
        const response = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ medicines }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Safety check is unavailable.");
        if (active) setResult(payload as SafetyResult);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Safety check is unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    return () => { active = false; };
  }, [medicines, demoResult]);

  return (
    <section className="safety-section" aria-labelledby="safety-title" data-tour="safety-section">
      <div className="eyebrow"><span className="eyebrow-dot" /> Review with care</div>
      <h2 id="safety-title">Safety check</h2>
      {loading ? <p className="safety-state" role="status">Checking for common concerns…</p> : error ? (
        <p className="safety-error" role="alert">{error} This check is not a complete review; confirm your medicines with your pharmacist.</p>
      ) : result ? (
        <>
          {!result.duplicate_ingredients.length && !result.interactions.length && !result.ask_pharmacist.length && <p className="safety-state">No common concerns were identified from the readable medicine names. This is not a complete safety review.</p>}
          {result.duplicate_ingredients.map((item, index) => <article className="safety-item safety-pharmacist" data-tour={index === 0 ? "safety-duplicate" : undefined} key={`duplicate-${index}`}><span className="severity-badge">Ask pharmacist</span><h3>Possible duplicate: {item.ingredient}</h3><p>{item.explanation}</p><small>{item.medicines.join(" · ")}</small></article>)}
          {result.interactions.map((item, index) => <article className={`safety-item${item.severity === "Ask pharmacist" ? " safety-pharmacist" : ""}`} data-tour={index === 0 ? "safety-interaction" : undefined} key={`interaction-${index}`}><span className={`severity-badge${item.severity === "Info" ? " severity-info" : ""}`}>{item.severity}</span><h3>Possible interaction</h3><p>{item.warning}</p><small>{item.medicines.join(" · ")}</small></article>)}
          {result.ask_pharmacist.length > 0 && <article className="safety-item safety-info"><h3>Questions to ask your pharmacist</h3><ul>{result.ask_pharmacist.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}</ul></article>}
        </>
      ) : null}
      <p className="safety-disclaimer">This automated check may miss important information. Ask your doctor or pharmacist to review the full list.</p>
    </section>
  );
}
