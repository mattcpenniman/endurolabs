// ============================================================
// EnduroLab — Landing Page
// ============================================================
// Hero, problem/positioning, methodology pillars, and
// call-to-action to start the onboarding flow.
// ============================================================

import Link from "next/link";

export default function HomePage(): React.ReactNode {
  return (
    <div className="section-padding">

      {/* ── Hero ── */}
      <section className="container-narrow py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-enduro-500">
            EnduroLab
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-enduro-900 sm:text-6xl">
            Your Marathon Plan,<br />
            <span className="text-enduro-500">Science-Backed</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            A performance training engine for serious amateur marathoners.
            Generate a personalized, week-by-week plan built around your fitness,
            your schedule, and your goal race time — with pace zones, progression
            curves, and calendar export.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/plan"
              className="rounded-lg bg-enduro-600 px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-enduro-700 focus:outline-none focus:ring-2 focus:ring-enduro-500 focus:ring-offset-2"
            >
              Generate Your Plan
            </Link>
            <a
              href="#why-it-works"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-8 py-3 text-base font-semibold shadow-sm hover:bg-[var(--color-bg-secondary)] focus:outline-none focus:ring-2 focus:ring-enduro-500 focus:ring-offset-2"
              style={{ color: "var(--color-text)" }}
            >
              Why It Works
            </a>
          </div>
        </div>
      </section>

      {/* ── Problem / Positioning ── */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-16">
        <div className="container-narrow">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-6 text-3xl font-bold" style={{ color: "var(--color-text)" }}>
              Generic Plans Are Too Blunt
            </h2>
            <p className="text-base leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              Most marathon plans treat every runner the same. They hand you a fixed mileage
              table and hope it fits your life, your fitness, and your race goal. The result?
              Either you&apos;re undertrained and flat on race day, or you&apos;re overreaching
              and injured before the peak phase.
            </p>
            <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              <strong style={{ color: "var(--color-text)" }}>EnduroLab is different.</strong>{" "}
              It is a <strong style={{ color: "var(--color-text)" }}>performance training engine</strong>{" "}
              designed for serious amateur marathoners who want more than a PDF calendar.
              We calculate your pace zones from real data, structure every workout around
              proven physiology, and build a progression curve that matches your available
              days and current fitness level.
            </p>
          </div>
        </div>
      </section>

      {/* ── Methodology Pillars ── */}
      <section id="why-it-works" className="border-t border-[var(--color-border)] py-16">
        <div className="container-narrow">
          <h2 className="mb-4 text-center text-3xl font-bold" style={{ color: "var(--color-text)" }}>
            Three Pillars of the Plan
          </h2>
          <p className="mb-12 text-center text-base" style={{ color: "var(--color-text-secondary)" }}>
            Every EnduroLab plan is built around three evidence-based training pillars.
          </p>
          <div className="grid gap-8 sm:grid-cols-3">
            {/* Pillar 1 — Threshold Development */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100 text-2xl">
                🔥
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
                Threshold Development
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Your lactate threshold is the single best predictor of marathon performance.
                EnduroLab schedules threshold intervals and tempo runs at the right intensity
                and frequency to push that ceiling higher — without burning you out.
              </p>
            </div>
            {/* Pillar 2 — Marathon-Specific Durability */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 text-2xl">
                🦵
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
                Marathon-Specific Durability
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Speed means nothing if your body can&apos;t handle 26.2 miles. Long runs and
                progression runs are structured to condition your tendons, muscles, and
                fuel systems for the specific demands of marathon distance.
              </p>
            </div>
            {/* Pillar 3 — High-Mileage Progression */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-enduro-100 text-2xl">
                📈
              </div>
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--color-text)" }}>
                High-Mileage Progression
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Aerobic capacity grows with volume — but only if that volume increases
                intelligently. EnduroLab builds your weekly mileage using a safe progression
                curve with built-in recovery weeks, so you peak at the right time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works (steps) ── */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-16">
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
    </div>
  );
}
