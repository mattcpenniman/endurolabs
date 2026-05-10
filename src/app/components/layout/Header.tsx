// ============================================================
// EnduroLab — Header Component
// ============================================================

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "endurlab-theme";

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

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-sm">
      <div className="container-narrow flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold text-enduro-700">EnduroLab</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
          <Link href="/" className="hover:text-enduro-600">
            Home
          </Link>
          <Link href="/plan?view=current" className="hover:text-enduro-600">
            Current Plan
          </Link>
          <a href="/plan?view=list" className="hover:text-enduro-600">
            My Plans
          </a>
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
