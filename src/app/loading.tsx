// ============================================================
// EnduroLab — Route Transition Fallback
// ============================================================
// Suspense boundary for every nested route. Without it Next.js
// keeps the previous page mounted (and the URL unchanged) until
// the incoming route resolves, so any slow render looks like a
// locked screen. This shell swaps in immediately, stays under
// the persistent Header/Footer, and is replaced by the real page.
// ============================================================

import React from "react";

const BLOCK_CLASS = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]";

export default function RouteLoading(): React.ReactNode {
  return (
    <div className="section-padding" role="status" aria-live="polite">
      <div className="container-narrow animate-pulse space-y-6">
        <div className="space-y-3">
          <div className={`h-9 w-64 ${BLOCK_CLASS}`} />
          <div className={`h-4 w-full max-w-xl ${BLOCK_CLASS}`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={`h-28 ${BLOCK_CLASS}`} />
          ))}
        </div>
        <div className={`h-64 ${BLOCK_CLASS}`} />
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
