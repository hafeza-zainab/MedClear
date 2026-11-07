const steps = ["Upload", "Review", "Schedule", "Safety check"] as const;

export default function StepIndicator({ active }: { active: (typeof steps)[number] }) {
  return (
    <nav className="step-indicator" aria-label="MedClear steps">
      {steps.map((step, index) => (
        <div className={`step-item${step === active ? " step-active" : ""}${steps.indexOf(active) > index ? " step-done" : ""}`} key={step} aria-current={step === active ? "step" : undefined}>
          <span className="step-number">{steps.indexOf(active) > index ? "✓" : index + 1}</span>
          <span>{step}</span>
          {index < steps.length - 1 && <span className="step-connector" aria-hidden="true">→</span>}
        </div>
      ))}
    </nav>
  );
}
