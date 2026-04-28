// ============================================================
// EnduroLab — Header Component
// ============================================================

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

const STORAGE_KEY = "endurlab-theme";

export default function Header() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as "light" | "dark" | null;
    if (saved) setTheme(saved);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
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
          <Link href="/plan" className="hover:text-enduro-600">
            My Plan
          </Link>
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
