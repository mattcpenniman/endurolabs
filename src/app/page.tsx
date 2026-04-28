// ============================================================
// EnduroLab — Home Page
// ============================================================
// Landing page with hero section, feature highlights, and
// call-to-action to start the onboarding flow.
// ============================================================

import Link from "next/link";

export default function HomePage(): React.ReactNode {
  return (
    <div className="section-padding">
      {/* Hero */}
      <section className="container-narrow py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-enduro-900 sm:text-6xl">
            Your Marathon Plan,<br />
            <span className="text-enduro-500">Science-Backed</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            Generate a personalized, week-by-week marathon training plan based on your fitness level,
            available days, and goal race time. Built around Daniels&apos; Running Formula methodology
            with pace zones, progression curves, and calendar export.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/plan"
              className="rounded-lg bg-enduro-600 px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-enduro-700 focus:outline-none focus:ring-2 focus:ring-enduro-500 focus:ring-offset-2"
            >
              Generate Your Plan
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-8 py-3 text-base font-semibold shadow-sm hover:bg-[var(--color-bg-secondary)] focus:outline-none focus:ring-2 focus:ring-enduro-500 focus:ring-offset-2"
              style={{ color: "var(--color-text)" }}
            >
              How It Works
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="how-it-works" className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-16">
        <div className="container-narrow">
          <h2 className="mb-12 text-center text-3xl font-bold" style={{ color: "var(--color-text)" }}>How It Works</h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-enduro-100 text-2xl">
                📋
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>Tell Us Your Goals</h3>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Enter your target marathon time, race date, current mileage, and available training days.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-enduro-100 text-2xl">
                🧮
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>We Calculate Your Zones</h3>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Using VDOT estimation and Daniels&apos; pace factors, we derive personalized easy, marathon,
                threshold, and VO2 max pace zones.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-enduro-100 text-2xl">
                📅
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>Get Your Plan</h3>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Receive a complete week-by-week plan with daily workouts, mileage trends, and calendar export.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Methodology */}
      <section className="border-t border-[var(--color-border)] py-16">
        <div className="container-narrow">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-6 text-3xl font-bold" style={{ color: "var(--color-text)" }}>Built on Running Science</h2>
            <div className="prose prose-gray">
              <p style={{ color: "var(--color-text-secondary)" }}>
                EnduroLab uses a <strong style={{ color: "var(--color-text)" }}>VDOT approximation</strong> derived from your race times (marathon PR,
                half marathon PR, or goal time), then applies <strong style={{ color: "var(--color-text)" }}>Daniels&apos;-derived pace factors</strong>
                to calculate training zones:
              </p>
              <ul className="mt-4 space-y-2" style={{ color: "var(--color-text-secondary)" }}>
                <li><strong className="text-green-600">Easy</strong> — ~1.55× marathon pace (aerobic base)</li>
                <li><strong className="text-blue-600">Marathon</strong> — goal race pace</li>
                <li><strong className="text-amber-600">Threshold</strong> — ~1.18× marathon pace (lactate threshold)</li>
                <li><strong className="text-red-600">VO2 Max</strong> — ~1.3× marathon pace (speed development)</li>
                <li><strong className="text-green-400">Recovery</strong> — ~1.1× easy pace (active recovery)</li>
              </ul>
              <p style={{ color: "var(--color-text-secondary)" }}>
                Plans follow a three-phase periodization model: <strong style={{ color: "var(--color-text)" }}>base building</strong> (30%),
                <strong style={{ color: "var(--color-text)" }}> marathon-specific work</strong> (50%), and <strong style={{ color: "var(--color-text)" }}>peak &amp; taper</strong> (20%),
                with recovery weeks every third week during the build phase.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
