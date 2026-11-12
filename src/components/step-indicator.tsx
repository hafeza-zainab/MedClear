"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const steps = [
  { id: "upload", label: "Upload", href: "/scan" },
  { id: "review", label: "Review", section: "step-review" },
  { id: "schedule", label: "Schedule", section: "step-schedule" },
  { id: "safety", label: "Safety check", section: "step-safety" },
] as const;
type StepId = (typeof steps)[number]["id"];
type SectionStep = Extract<(typeof steps)[number], { section: string }>;
type SectionStepId = SectionStep["id"];

export default function StepIndicator({ hasResult }: { hasResult: boolean }) {
  const [active, setActive] = useState<StepId>(hasResult ? "review" : "upload");
  const [viewed, setViewed] = useState<Set<StepId>>(() => new Set(hasResult ? ["upload"] : []));

  useEffect(() => {
    if (!hasResult) {
      setActive("upload");
      setViewed(new Set());
      return;
    }

    const targets = steps.filter((step): step is SectionStep => "section" in step)
      .map((step) => ({ id: step.id, element: document.getElementById(step.section) }))
      .filter((entry): entry is { id: SectionStepId; element: HTMLElement } => entry.element instanceof HTMLElement);
    const seen = new Set<StepId>(["upload"]);
    setViewed(new Set(seen));

    const updateActive = () => {
      const targetY = window.innerHeight * 0.28;
      let best: { id: StepId; distance: number } | undefined;
      for (const { id, element } of targets) {
        const rect = element.getBoundingClientRect();
        const distance = targetY < rect.top ? rect.top - targetY : targetY > rect.bottom ? targetY - rect.bottom : 0;
        if (!best || distance < best.distance) best = { id, distance };
      }
      if (best) setActive(best.id);
    };
    const observer = new IntersectionObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = targets.find(({ element }) => element === entry.target);
        if (target && !seen.has(target.id)) {
          seen.add(target.id);
          changed = true;
        }
      }
      if (changed) setViewed(new Set(seen));
      updateActive();
    }, { threshold: 0.01 });
    targets.forEach(({ element }) => observer.observe(element));
    updateActive();
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [hasResult]);

  function scrollToSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  return (
    <nav className="step-indicator" aria-label="MedClear steps">
      {steps.map((step, index) => {
        const isActive = active === step.id;
        const isViewed = viewed.has(step.id) || index < steps.findIndex((item) => item.id === active);
        const className = `step-item${isActive ? " step-active" : ""}${isViewed ? " step-done" : ""}`;
        const ariaLabel = `${step.label}${isViewed ? ", viewed" : ""}${isActive ? ", current step" : ""}`;
        return (
          <span className={className} key={step.id}>
            {"section" in step ? (
              <button className="step-link" type="button" aria-label={`Go to ${ariaLabel}`} aria-current={isActive ? "step" : undefined} onClick={() => scrollToSection(step.section)}>
                <span className="step-number" aria-hidden="true">{isViewed ? "✓" : index + 1}</span><span>{step.label}</span>
              </button>
            ) : (
              <Link className="step-link" href={step.href} aria-label={`Go to ${ariaLabel}`} aria-current={isActive ? "step" : undefined}>
                <span className="step-number" aria-hidden="true">{isViewed ? "✓" : index + 1}</span><span>{step.label}</span>
              </Link>
            )}
            {index < steps.length - 1 && <span className="step-connector" aria-hidden="true">→</span>}
          </span>
        );
      })}
    </nav>
  );
}
