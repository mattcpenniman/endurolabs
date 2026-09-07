// ============================================================
// EnduroLab — Header Component
// ============================================================

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "endurlab-theme";
const OPEN_CURRENT_PLAN_EVENT = "endurlab-open-current-plan";

interface CurrentUser {
  email: string;
  name: string | null;
}

export default function Header() {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as "light" | "dark" | null;
    if (saved) setTheme(saved);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((data: { user: CurrentUser | null }) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const handleLogout = async (): Promise<void> => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  };

  const handleOpenCurrentPlan = (): void => {
    router.push("/plan?view=current");
    window.dispatchEvent(new CustomEvent(OPEN_CURRENT_PLAN_EVENT));
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-sm">
      <div className="container-narrow flex flex-col gap-2 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold text-enduro-700">EnduroLab</span>
        </Link>
        <nav className="scrollbar-thin flex w-full items-center gap-4 overflow-x-auto pb-1 text-sm font-medium sm:w-auto sm:gap-6 sm:overflow-visible sm:pb-0" style={{ color: "var(--color-text-secondary)" }}>
          <Link href="/" className="hover:text-enduro-600">
            Home
          </Link>
          <button onClick={handleOpenCurrentPlan} className="hover:text-enduro-600">
            Current Plan
          </button>
          <a href="/plan?view=list" className="hover:text-enduro-600">
            My Plans
          </a>
          <a href="/stats" className="hover:text-enduro-600">
            Stats
          </a>
          <Link href="/courses" className="hover:text-enduro-600">
            Courses
          </Link>
          <Link href="/races" className="hover:text-enduro-600">
            Races
          </Link>
          <Link href="/race-predictor" className="hover:text-enduro-600">
            Predictor
          </Link>
          {user && (
            <Link href="/profile" className="hover:text-enduro-600">
              Profile
            </Link>
          )}
          {user ? (
            <button onClick={handleLogout} className="hover:text-enduro-600">
              Sign out
            </button>
          ) : (
            <Link href="/login" className="hover:text-enduro-600">
              Sign in
            </Link>
          )}
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] text-lg transition-colors hover:bg-[var(--color-bg-secondary)]"
            aria-label="Toggle dark mode"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        </nav>
      </div>
    </header>
  );
}
