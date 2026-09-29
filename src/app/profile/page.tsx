// ============================================================
// EnduroLab - Profile Page
// ============================================================

"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GarminConnectCard from "@/app/components/profile/GarminConnectCard";
import { useUnits } from "@/app/components/units/UnitsProvider";
import type { GarminConnectionStatus } from "@/lib/activities/models";
import { kilogramsToPounds, poundsToKilograms } from "@/lib/profile/weight";
import type { PowerZoneDefaults } from "@/lib/training/power-anchors";
import type { UnitSystem } from "@/lib/units/format";

const EMPTY_GARMIN_STATUS: GarminConnectionStatus = { connected: false, activities: [] };

interface ProfileResponse {
  profile: {
    email: string;
    name: string | null;
    weightPounds: number | null;
    weightMeasuredAt: string | null;
    unitsSystem: UnitSystem;
    powerZoneDefaults: PowerZoneDefaults | null;
  };
}

function anchorInput(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Unparsable text is passed through so the API rejects it instead of silently clearing it. */
function parseAnchorInput(value: string): number | null | string {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export default function ProfilePage(): React.ReactNode {
  const router = useRouter();
  const { units, setUnits } = useUnits();
  const [profile, setProfile] = useState<ProfileResponse["profile"] | null>(null);
  const [weight, setWeight] = useState("");
  const [pendingUnits, setPendingUnits] = useState<UnitSystem>(units);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [garminConnection, setGarminConnection] = useState<GarminConnectionStatus>(EMPTY_GARMIN_STATUS);
  const [powerEnabled, setPowerEnabled] = useState(false);
  const [easyPower, setEasyPower] = useState("");
  const [marathonPower, setMarathonPower] = useState("");
  const [thresholdPower, setThresholdPower] = useState("");
  const [savingZones, setSavingZones] = useState(false);
  const [zonesMessage, setZonesMessage] = useState<string | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);

  const refreshGarminConnection = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/integrations/garmin");
      if (response.ok) {
        setGarminConnection((await response.json()) as GarminConnectionStatus);
      }
    } catch {
      // Keep the last known connection status; the card surfaces request errors.
    }
  }, []);

  useEffect(() => {
    fetch("/api/profile")
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login?redirect=/profile");
          return null;
        }
        if (!response.ok) throw new Error("Failed to load profile");
        return response.json() as Promise<ProfileResponse>;
      })
      .then((body) => {
        if (!body) return;
        setProfile(body.profile);
        setPendingUnits(body.profile.unitsSystem);
        setWeight(weightInput(body.profile.weightPounds, body.profile.unitsSystem));
        const defaults = body.profile.powerZoneDefaults;
        setPowerEnabled(defaults?.hasPower ?? false);
        setEasyPower(anchorInput(defaults?.easyPower));
        setMarathonPower(anchorInput(defaults?.marathonPower));
        setThresholdPower(anchorInput(defaults?.thresholdPower));
        return refreshGarminConnection();
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [router, refreshGarminConnection]);

  useEffect(() => {
    if (profile && units !== pendingUnits) {
      setPendingUnits(units);
      setWeight(weightInput(profile.weightPounds, units));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  const weightLabel = pendingUnits === "metric" ? "kg" : "lb";
  const weightMin = pendingUnits === "metric" ? 23 : 50;
  const weightMax = pendingUnits === "metric" ? 318 : 700;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      if (weight.trim() !== "") {
        const inputWeight = Number(weight);
        const weightPounds = pendingUnits === "metric"
          ? kilogramsToPounds(inputWeight)
          : inputWeight;
        const response = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weightPounds }),
        });
        const body = (await response.json()) as { error?: string; weightMeasuredAt?: string };
        if (!response.ok) throw new Error(body.error ?? "Failed to save profile");
        setProfile((current) => current ? { ...current, weightPounds, weightMeasuredAt: body.weightMeasuredAt ?? null } : current);
      }
      if (pendingUnits !== units) {
        await setUnits(pendingUnits);
      }
      setMessage("Profile saved. Elevation and pace now render in your chosen units across EnduroLab.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleZonesSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSavingZones(true);
    setZonesMessage(null);
    setZonesError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          powerZoneDefaults: {
            hasPower: powerEnabled,
            easyPower: parseAnchorInput(easyPower),
            marathonPower: parseAnchorInput(marathonPower),
            thresholdPower: parseAnchorInput(thresholdPower),
          },
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        powerZoneDefaults?: PowerZoneDefaults;
        planUpdated?: boolean;
      };
      if (!response.ok) throw new Error(body.error ?? "Failed to save power zones");
      if (body.powerZoneDefaults) {
        const saved = body.powerZoneDefaults;
        setProfile((current) => current ? { ...current, powerZoneDefaults: saved } : current);
      }
      setZonesMessage(
        body.planUpdated
          ? "Power zones saved and applied to your current plan."
          : "Power zones saved. They will apply to your next generated plan.",
      );
    } catch (saveError) {
      setZonesError(saveError instanceof Error ? saveError.message : "Failed to save power zones");
    } finally {
      setSavingZones(false);
    }
  };

  return (
    <div className="section-padding">
      <div className="container-narrow max-w-3xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-enduro-700">Account</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Profile</h1>
          <p className="mt-2 text-sm text-gray-600">Keep your body weight current for accurate power-to-weight stats, choose the units EnduroLab uses for elevation and pace, and connect your Garmin Connect account.</p>
        </header>

        {loading ? (
          <p className="mt-8 text-sm text-gray-500">Loading profile...</p>
        ) : profile ? (
          <>
          <form onSubmit={handleSubmit} className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="border-b border-gray-100 pb-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Signed in as</p>
              <p className="mt-1 font-medium text-gray-900">{profile.name ?? profile.email}</p>
              {profile.name && <p className="text-sm text-gray-500">{profile.email}</p>}
            </div>
            <label className="mt-5 block max-w-xs text-sm font-medium text-gray-800">
              Body weight
              <div className="mt-2 flex rounded-lg border border-gray-300 bg-white focus-within:border-enduro-500 focus-within:ring-2 focus-within:ring-enduro-100">
                <input
                  type="number"
                  min={weightMin}
                  max={weightMax}
                  step="0.1"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-gray-900 outline-none"
                />
                <span className="flex items-center border-l border-gray-200 px-3 text-sm text-gray-500">{weightLabel}</span>
              </div>
            </label>
            <p className="mt-2 text-xs text-gray-500">
              {profile.weightMeasuredAt
                ? `Last updated ${new Date(profile.weightMeasuredAt).toLocaleDateString()}.`
                : "No body weight is on file."}
            </p>

            <div className="mt-6 max-w-xs">
              <p className="text-sm font-medium text-gray-800">
                <label htmlFor="units-system">Elevation &amp; pace units</label>
              </p>
              <select
                id="units-system"
                value={pendingUnits}
                onChange={(event) => {
                  const next = event.target.value as UnitSystem;
                  setPendingUnits(next);
                  setWeight((current) => {
                    if (current.trim() === "") return current;
                    const parsed = Number(current);
                    if (!Number.isFinite(parsed)) return current;
                    return (next === "metric" ? poundsToKilograms(parsed) : kilogramsToPounds(parsed)).toFixed(1);
                  });
                }}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-100"
              >
                <option value="imperial">Imperial — feet, min/mile</option>
                <option value="metric">Metric — meters, min/km</option>
              </select>
              <p className="mt-2 text-xs text-gray-500">
                Applies to elevation gain, altitude, climbing grade, and pace throughout EnduroLab.
                Plan mileage stays in miles.
              </p>
            </div>
            {message && <p className="mt-4 text-sm text-enduro-700">{message}</p>}
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="mt-5 rounded-lg bg-enduro-700 px-4 py-2 text-sm font-semibold text-white hover:bg-enduro-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </form>

          <form onSubmit={handleZonesSubmit} className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Power zones</h2>
            <p className="mt-1 text-sm text-gray-600">
              Plans recommend power targets from your logged runs automatically. Set explicit
              anchors here to override that. Saving applies them to your current plan and to
              plans you generate later.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <input
                type="checkbox"
                id="power-zones-enabled"
                checked={powerEnabled}
                onChange={(event) => setPowerEnabled(event.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-enduro-500 focus:ring-enduro-500"
              />
              <label htmlFor="power-zones-enabled" className="text-sm text-gray-700">
                Use these power anchors
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Marathon power</span>
                <input
                  type="number"
                  min={50}
                  max={700}
                  step={1}
                  value={marathonPower}
                  onChange={(event) => setMarathonPower(event.target.value)}
                  disabled={!powerEnabled}
                  placeholder="e.g. 300"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-100 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Threshold power</span>
                <input
                  type="number"
                  min={50}
                  max={700}
                  step={1}
                  value={thresholdPower}
                  onChange={(event) => setThresholdPower(event.target.value)}
                  disabled={!powerEnabled}
                  placeholder="e.g. 336"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-100 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Easy power</span>
                <input
                  type="number"
                  min={50}
                  max={700}
                  step={1}
                  value={easyPower}
                  onChange={(event) => setEasyPower(event.target.value)}
                  disabled={!powerEnabled}
                  placeholder="e.g. 240"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-100 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Marathon power is required when enabled. Threshold and easy are optional; when
              blank EnduroLab derives threshold as 112% and easy as 78% of marathon power.
            </p>
            {zonesMessage && <p className="mt-4 text-sm text-enduro-700">{zonesMessage}</p>}
            {zonesError && <p className="mt-4 text-sm text-red-600">{zonesError}</p>}
            <button
              type="submit"
              disabled={savingZones}
              className="mt-5 rounded-lg bg-enduro-700 px-4 py-2 text-sm font-semibold text-white hover:bg-enduro-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingZones ? "Saving..." : "Save power zones"}
            </button>
          </form>
          <div className="mt-6">
            <GarminConnectCard
              connection={garminConnection}
              onChanged={refreshGarminConnection}
            />
          </div>
          </>
        ) : null}
        {!loading && !profile && error && <p className="mt-8 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function weightInput(weightPounds: number | null, system: UnitSystem): string {
  if (weightPounds === null) return "";
  return (system === "metric" ? poundsToKilograms(weightPounds) : weightPounds).toFixed(1);
}
