import React from "react";
// ============================================================
// EnduroLab — Header Component
// ============================================================

import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="container-narrow flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold text-enduro-700">EnduroLab</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
          <Link href="/" className="hover:text-enduro-600">
            Home
          </Link>
          <Link href="/plan" className="hover:text-enduro-600">
            My Plan
          </Link>
        </nav>
      </div>
    </header>
  );
}
