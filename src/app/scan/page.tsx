import ScanForm from "@/components/scan-form";
import StepIndicator from "@/components/step-indicator";
import Link from "next/link";

export default function ScanPage() {
  return (
    <main className="scan-page">
      <header className="site-header scan-header">
        <Link className="brand" href="/" aria-label="MedClear home">
          <span className="brand-mark" aria-hidden="true"><span /><span /></span>
          <span>MedClear</span>
        </Link>
        <span className="header-note">Medicine, made clearer</span>
      </header>
      <section className="scan-content" aria-labelledby="scan-title" data-tour="scan-section">
        <StepIndicator hasResult={false} />
        <Link className="back-link" href="/">← Home</Link>
        <div className="eyebrow"><span className="eyebrow-dot" /> Start with a photo</div>
        <h1 id="scan-title" className="scan-title">Let&apos;s make sense of it.</h1>
        <p className="scan-intro">Choose a clear photo of a prescription or medicine strip. We&apos;ll help explain what can be read.</p>
        <ScanForm />
        <p className="disclaimer scan-disclaimer">MedClear is for information only. Always confirm with your doctor or pharmacist.</p>
      </section>
    </main>
  );
}
