"use client";

// ============================================================
// EnduroLab — Login Page
// ============================================================
// Session login form for accessing saved training plans.
// ============================================================

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { isSafeInternalRedirect } from "@/lib/plan-url";

export default function LoginPage(): React.ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Unable to sign in");
      }

      const redirectTo = new URLSearchParams(window.location.search).get("redirect") ?? "/plan";
      router.push(isSafeInternalRedirect(redirectTo) ? redirectTo : "/plan");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="section-padding">
      <section className="container-narrow flex justify-center py-12 sm:py-20">
        <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-8 shadow-sm">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-enduro-500">
              EnduroLab
            </p>
            <h1 className="mt-2 text-3xl font-bold" style={{ color: "var(--color-text)" }}>
              Sign in
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Access your saved training plans and create new ones.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium" style={{ color: "var(--color-text)" }}>
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm outline-none focus:border-enduro-500 focus:ring-2 focus:ring-enduro-100"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium" style={{ color: "var(--color-text)" }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm outline-none focus:border-enduro-500 focus:ring-2 focus:ring-enduro-100"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-enduro-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-enduro-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
