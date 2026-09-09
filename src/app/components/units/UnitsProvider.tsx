// ============================================================
// EnduroLab — Display Units Context
// ============================================================
// Loads the signed-in user's profile unit preference once per
// app load and exposes it to every client surface so elevation
// and pace render in the same system everywhere. Anonymous
// visitors and share pages keep the imperial default.
// ============================================================

"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_UNIT_SYSTEM,
  parseUnitSystem,
  type UnitSystem,
} from "@/lib/units/format";

interface UnitsContextValue {
  units: UnitSystem;
  loading: boolean;
  /** Persists via PUT /api/profile and updates consumers. Throws on failure. */
  setUnits: (next: UnitSystem) => Promise<void>;
}

const UnitsContext = createContext<UnitsContextValue>({
  units: DEFAULT_UNIT_SYSTEM,
  loading: false,
  setUnits: async () => {},
});

export function useUnits(): UnitsContextValue {
  return useContext(UnitsContext);
}

export function UnitsProvider({
  children,
  initialUnits = DEFAULT_UNIT_SYSTEM,
}: {
  children: React.ReactNode;
  initialUnits?: UnitSystem;
}): React.ReactNode {
  const [units, setUnitsState] = useState<UnitSystem>(initialUnits);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return;
        const stored = (body as { profile?: { unitsSystem?: unknown } } | null)?.profile?.unitsSystem;
        const parsed = parseUnitSystem(stored);
        if (parsed) setUnitsState(parsed);
      })
      .catch(() => { /* visitors without a session keep the provided/initial default */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setUnits = useCallback(async (next: UnitSystem): Promise<void> => {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitsSystem: next }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to save unit preference");
    }
    setUnitsState(next);
  }, []);

  return (
    <UnitsContext.Provider value={{ units, loading, setUnits }}>
      {children}
    </UnitsContext.Provider>
  );
}
