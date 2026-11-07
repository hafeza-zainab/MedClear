import Link from "next/link";

import DemoStartButton from "@/components/demo-start-button";

export default function Home() {
  return (
    <main className="landing">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="MedClear home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>MedClear</span>
        </Link>
        <span className="header-note">Medicine, made clearer</span>
      </header>

      <section className="hero" aria-labelledby="hero-title" data-tour="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            A little more clarity, every day
          </div>
          <h1 id="hero-title">
            Feel clearer about
            <br className="desktop-break" /> what you&apos;re taking.
          </h1>
          <p className="tagline">
            Simple, thoughtful explanations for the medicines in your care.
          </p>
          <a className="try-button" href="/scan">
            Try it <span aria-hidden="true">→</span>
          </a>
          <DemoStartButton />
          <p className="disclaimer" data-tour="landing-disclaimer">
            MedClear is for information only. Always confirm with your doctor or
            pharmacist.
          </p>
        </div>

        <div className="visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="pill-card">
            <div className="pill-shape">
              <span />
            </div>
            <div className="card-lines">
              <span />
              <span />
              <span />
            </div>
            <div className="card-check">✓</div>
          </div>
          <div className="spark spark-one">✳</div>
          <div className="spark spark-two">✳</div>
          <div className="soft-leaf leaf-one" />
          <div className="soft-leaf leaf-two" />
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <div className="how-heading">
          <div className="eyebrow"><span className="eyebrow-dot" /> A simple place to start</div>
          <h2 id="how-title">How it works</h2>
        </div>
        <div className="how-steps">
          <article><span>01</span><h3>Share a photo</h3><p>Choose a clear picture of a prescription or medicine strip.</p></article>
          <article><span>02</span><h3>Review the details</h3><p>See plain-language notes and anything that needs a closer look.</p></article>
          <article><span>03</span><h3>Plan with confidence</h3><p>Review a daily schedule, then confirm it with your care team.</p></article>
        </div>
      </section>

      <footer className="site-footer">
        <span>MedClear is for information only. Always confirm with your doctor or pharmacist.</span>
        <span className="footer-mark">●</span>
      </footer>
    </main>
  );
}
