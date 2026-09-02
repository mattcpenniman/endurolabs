"use client";

// ============================================================
// EnduroLab - Garmin Sync Settings
// ============================================================

import React, { useState } from "react";
import { GarminConnectionStatus } from "@/lib/activities/models";

interface GarminSyncCardProps {
  planId: string;
  connection: GarminConnectionStatus;
  onChanged: () => Promise<void>;
}

export default function GarminSyncCard({ planId, connection, onChanged }: GarminSyncCardProps): React.ReactNode {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaRequired, setIsMfaRequired] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runRequest = async (url: string, init: RequestInit): Promise<void> => {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json()) as {
        error?: string;
        synced?: number;
        matched?: number;
        mfaRequired?: boolean;
        mfaMethod?: string;
      };
      if (!response.ok) throw new Error(body.error || "Garmin request failed");
      if (body.mfaRequired) {
        setIsMfaRequired(true);
        setMessage(`Enter the verification code Garmin sent by ${body.mfaMethod ?? "email or SMS"}.`);
      } else if (typeof body.synced === "number") {
        setMessage(`Synced ${body.synced} runs; ${body.matched ?? 0} matched to this plan.`);
      } else {
        setMessage("Garmin connection updated.");
        setIsMfaRequired(false);
        setMfaCode("");
      }
      setPassword("");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Garmin request failed");
    } finally {
      setIsWorking(false);
    }
  };

  const awaitingMfa = connection.mfaRequired || isMfaRequired;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 md:col-span-2">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-950 text-xs font-black text-white">G</span>
            <h3 className="text-sm font-semibold text-gray-900">Garmin Connect</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${connection.connected ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
              {connection.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Import recent runs, match them to scheduled workouts by local date and distance, and chart mileage, pace, and heart-rate trends.
          </p>
          <p className="mt-2 text-xs text-gray-400">
            This uses Garmin Connect&apos;s unofficial API. Your password is used only for sign-in; encrypted OAuth tokens are stored afterward.
          </p>
          {connection.connected && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded bg-gray-100 px-2 py-1">{connection.displayName || connection.username}</span>
              <span className="rounded bg-gray-100 px-2 py-1">{connection.activities.length} runs stored</span>
              {connection.lastSyncAt && (
                <span className="rounded bg-gray-100 px-2 py-1">Last sync {new Date(connection.lastSyncAt).toLocaleString()}</span>
              )}
            </div>
          )}
          {(message || connection.lastError) && (
            <p className={`mt-3 text-xs ${message?.toLowerCase().includes("failed") || connection.lastError ? "text-red-600" : "text-emerald-700"}`}>
              {message || connection.lastError}
            </p>
          )}
        </div>

        {connection.connected ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={isWorking}
              onClick={() => runRequest("/api/integrations/garmin/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId, limit: 400 }),
              })}
              className="rounded-lg bg-sky-950 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
            >
              {isWorking ? "Syncing..." : "Sync recent runs"}
            </button>
            <button
              type="button"
              disabled={isWorking}
              onClick={() => runRequest("/api/integrations/garmin", { method: "DELETE" })}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : awaitingMfa ? (
          <form
            className="w-full lg:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              runRequest("/api/integrations/garmin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mfaCode }),
              });
            }}
          >
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Garmin verification code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value.replace(/\s/g, ""))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm tracking-widest focus:border-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-900/10"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={isWorking}
                className="rounded-lg bg-sky-950 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
              >
                {isWorking ? "Verifying..." : "Verify and connect"}
              </button>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => runRequest("/api/integrations/garmin", { method: "DELETE" }).then(() => setIsMfaRequired(false))}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Start over
              </button>
            </div>
          </form>
        ) : (
          <form
            className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-xl"
            onSubmit={(event) => {
              event.preventDefault();
              runRequest("/api/integrations/garmin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
              });
            }}
          >
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Garmin email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-900/10"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-900/10"
              />
            </label>
            <button
              type="submit"
              disabled={isWorking}
              className="rounded-lg bg-sky-950 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50 sm:col-span-2"
            >
              {isWorking ? "Connecting..." : "Connect Garmin"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
