import { createRoot } from "react-dom/client";
import "./aboutLanding.css";

const contactEmail = import.meta.env.VITE_TRENDIQ_CONTACT_EMAIL || "contact@example.com";

const signals = [
  "Search momentum",
  "Social discussion trends",
  "Consumer sentiment",
  "Purchase intent",
  "Review quality",
  "Growth velocity",
  "Trend sustainability",
];

const categories = [
  "technology",
  "wearables",
  "software/apps",
  "fitness",
  "home products",
  "consumer gadgets",
  "emerging consumer trends",
];

function AboutLanding() {
  return (
    <main className="landing-shell">
      <section className="hero-section">
        <nav className="topbar" aria-label="TrendIQ public navigation">
          <a className="brand-mark" href="/about.html" aria-label="TrendIQ home">
            <span className="brand-dot" />
            TrendIQ
          </a>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Consumer product intelligence</p>
            <h1>TrendIQ</h1>
            <p className="hero-line">Find what&apos;s worth the hype.</p>
            <p className="hero-description">
              TrendIQ helps consumers understand which products, apps, and emerging trends are gaining momentum by
              combining signals from multiple independent data sources into an easy-to-understand TrendIQ Score.
            </p>
            <div className="hero-ctas" aria-label="TrendIQ status">
              <span className="primary-pill">Coming Soon</span>
              <span className="secondary-pill">Private Beta</span>
            </div>
          </div>

          <div className="signal-panel" aria-label="TrendIQ signal preview">
            <div className="panel-header">
              <span>TrendIQ Score</span>
              <strong>Early MVP</strong>
            </div>
            <div className="score-orbit">
              <span>IQ</span>
              <strong>78</strong>
            </div>
            <div className="signal-bars" aria-hidden="true">
              <span style={{ width: "92%" }} />
              <span style={{ width: "74%" }} />
              <span style={{ width: "66%" }} />
              <span style={{ width: "82%" }} />
            </div>
          </div>
        </div>
      </section>

      <section className="content-band">
        <div className="section-copy">
          <p className="section-kicker">What is TrendIQ?</p>
          <h2>Product research, compressed into a clearer signal.</h2>
          <p>
            TrendIQ is a consumer product intelligence platform designed to make product research faster and easier.
            Instead of requiring users to manually search across multiple platforms, TrendIQ combines product-level
            signals into a single score with clear explanations of why a trend is rising, stable, cooling, or
            accelerating.
          </p>
        </div>
      </section>

      <section className="content-band split-band">
        <div className="section-copy">
          <p className="section-kicker">How TrendIQ Works</p>
          <h2>Multiple signals, one readable score.</h2>
          <p>
            These signals are combined into the TrendIQ Score and supporting insights. TrendIQ is designed to inform
            users, not make purchasing decisions for them.
          </p>
        </div>
        <ul className="signal-list" aria-label="Signals TrendIQ analyzes">
          {signals.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      </section>

      <section className="content-band">
        <div className="section-copy wide">
          <p className="section-kicker">Data & Privacy</p>
          <h2>Aggregated product intelligence with clear boundaries.</h2>
          <p>
            TrendIQ uses data from multiple independent sources to generate aggregated product-level intelligence.
          </p>
          <p>
            TrendIQ does not sell or redistribute raw third-party datasets as a standalone product.
          </p>
          <p>
            TrendIQ does not use third-party platform data to identify individual users, build personal profiles, or
            infer sensitive personal characteristics.
          </p>
          <p>
            Third-party data is used only in accordance with applicable provider terms, permissions, retention
            requirements, and access agreements.
          </p>
        </div>
      </section>

      <section className="content-band split-band">
        <div className="section-copy">
          <p className="section-kicker">Status</p>
          <h2>MVP development and private testing.</h2>
          <p>TrendIQ is currently in MVP development and private testing.</p>
          <p>Initial launch focus: United States.</p>
        </div>
        <div className="category-wrap" aria-label="Possible product categories">
          {categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
      </section>

      <section className="contact-band">
        <p className="section-kicker">Contact</p>
        <h2>Partnerships, data-provider inquiries, or beta access</h2>
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </section>
    </main>
  );
}

createRoot(document.getElementById("about-root")!).render(<AboutLanding />);
