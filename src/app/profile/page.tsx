// ============================================================
// EnduroLab - Profile Page
// ============================================================

"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileResponse {
  profile: {
    email: string;
    name: string | null;
    weightPounds: number | null;
    weightMeasuredAt: string | null;
  };
}

export default function ProfilePage(): React.ReactNode {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResponse["profile"] | null>(null);
  const [weight, setWeight] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setWeight(body.profile.weightPounds === null ? "" : body.profile.weightPounds.toFixed(1));
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightPounds: Number(weight) }),
      });
      const body = (await response.json()) as { error?: string; weightMeasuredAt?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to save profile");
      setProfile((current) => current ? { ...current, weightPounds: Number(weight), weightMeasuredAt: body.weightMeasuredAt ?? null } : current);
      setMessage("Weight saved. Stats will use it for W/kg calculations.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section-padding">
      <div className="container-narrow max-w-3xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-enduro-700">Account</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Profile</h1>
          <p className="mt-2 text-sm text-gray-600">Keep your body weight current for accurate power-to-weight stats.</p>
        </header>

        {loading ? (
          <p className="mt-8 text-sm text-gray-500">Loading profile...</p>
        ) : profile ? (
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
                  min="50"
                  max="700"
                  step="0.1"
                  required
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-gray-900 outline-none"
                />
                <span className="flex items-center border-l border-gray-200 px-3 text-sm text-gray-500">lb</span>
              </div>
            </label>
            <p className="mt-2 text-xs text-gray-500">
              {profile.weightMeasuredAt
                ? `Last updated ${new Date(profile.weightMeasuredAt).toLocaleDateString()}.`
                : "No body weight is on file."}
            </p>
            {message && <p className="mt-4 text-sm text-enduro-700">{message}</p>}
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="mt-5 rounded-lg bg-enduro-700 px-4 py-2 text-sm font-semibold text-white hover:bg-enduro-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save weight"}
            </button>
          </form>
        ) : null}
        {!loading && !profile && error && <p className="mt-8 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
