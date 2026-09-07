"use client";

// ============================================================
// EnduroLab - Garmin Sync Settings
// ============================================================

import React, { useEffect, useState } from "react";
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
  const [isDetailWorking, setIsDetailWorking] = useState(false);
  const [historySince, setHistorySince] = useState(() => `${new Date().getFullYear() - 2}-01-01`);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [updatingActivityId, setUpdatingActivityId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!connection.connected && connection.username && !username) {
      setUsername(connection.username);
    }
  }, [connection.connected, connection.username, username]);

  const runRequest = async (url: string, init: RequestInit): Promise<void> => {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json()) as {
        error?: string;
        synced?: number;
        matched?: number;
        skippedByTtl?: boolean;
        details?: { imported: number; failed: number };
        mfaRequired?: boolean;
        mfaMethod?: string;
      };
      if (!response.ok) throw new Error(body.error || "Garmin request failed");
      if (body.mfaRequired) {
        setIsMfaRequired(true);
        setMessage(`Enter the verification code Garmin sent by ${body.mfaMethod ?? "email or SMS"}.`);
      } else if (typeof body.synced === "number") {
        const summary = body.skippedByTtl ? "Summaries already current" : `Synced ${body.synced} runs`;
        const detail = body.details
          ? ` ${body.details.imported} detail imports${body.details.failed ? `, ${body.details.failed} failed` : ""}.`
          : "";
        setMessage(`${summary}; ${body.matched ?? 0} matched to this plan.${detail}`);
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

  const startJob = async (url: string, payload: object): Promise<void> => {
    setIsDetailWorking(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) throw new Error(body.error || "Could not start Garmin job");
      setActiveJobId(body.jobId);
      setMessage("Garmin import queued. It will continue on the server if this page closes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Garmin detail sync failed");
      setIsDetailWorking(false);
    }
  };

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/integrations/garmin/jobs/${activeJobId}`);
        const job = (await response.json()) as {
          status?: string;
          total?: number | null;
          processed?: number;
          succeeded?: number;
          empty?: number;
          failed?: number;
          error?: string | null;
        };
        if (!response.ok) throw new Error(job.error || "Could not read Garmin job");
        if (cancelled) return;
        const terminal = ["succeeded", "partial", "failed"].includes(job.status ?? "");
        setMessage(`Garmin import: ${job.processed ?? 0}${job.total === null ? "" : `/${job.total}`} processed, ${job.succeeded ?? 0} imported, ${job.empty ?? 0} empty${job.failed ? `, ${job.failed} failed` : ""}.${job.error ? ` ${job.error}` : ""}`);
        if (terminal) {
          setActiveJobId(null);
          setIsDetailWorking(false);
          await onChanged();
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Garmin job polling failed");
          setIsDetailWorking(false);
        }
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobId, onChanged]);

  const setActivityExcluded = async (activityId: string, excludedFromAnalytics: boolean): Promise<void> => {
    setUpdatingActivityId(activityId);
    setMessage(null);
    try {
      const response = await fetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedFromAnalytics }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to update activity");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update activity");
    } finally {
      setUpdatingActivityId(null);
    }
  };

  const awaitingMfa = connection.mfaRequired || isMfaRequired;
  const reconnectRequired = connection.status === "error";

  return (
    <div id="garmin-detail-sync" className={`scroll-mt-24 rounded-lg border bg-white p-5 md:col-span-2 ${reconnectRequired ? "border-red-300" : "border-gray-200"}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-950 text-xs font-black text-white">G</span>
            <h3 className="text-sm font-semibold text-gray-900">Garmin Connect</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${connection.connected ? "bg-emerald-100 text-emerald-700" : reconnectRequired ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
              {connection.connected ? "Connected" : reconnectRequired ? "Reconnect required" : "Not connected"}
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
              <span className="rounded bg-gray-100 px-2 py-1">
                {connection.activities.filter((activity) => activity.samplesFetchedAt).length} with detail
              </span>
              {connection.lastSyncAt && (
                <span className="rounded bg-gray-100 px-2 py-1">Last sync {new Date(connection.lastSyncAt).toLocaleString()}</span>
              )}
            </div>
          )}
          {reconnectRequired && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Garmin is disconnected</p>
              <p className="mt-1">{connection.lastError || "Your Garmin session is no longer valid. Sign in again to resume run imports."}</p>
            </div>
          )}
          {(message || (!reconnectRequired && connection.lastError)) && (
            <p className={`mt-3 text-xs ${message?.toLowerCase().includes("failed") || connection.lastError ? "text-red-600" : "text-emerald-700"}`}>
              {message || (!reconnectRequired ? connection.lastError : null)}
            </p>
          )}
          {connection.connected && connection.activities.length > 0 && (
            <details className="mt-4 text-xs text-gray-600">
              <summary className="cursor-pointer font-medium text-gray-700">Recent activity quality</summary>
              <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {connection.activities.slice(0, 8).map((activity) => (
                  <div key={activity.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-800">{activity.activityName}</p>
                      <p className="text-gray-400">
                        {activity.localDate} | quality {activity.qualityScore ?? "pending"}/100
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={activity.excludedFromAnalytics ?? false}
                        disabled={updatingActivityId === activity.id}
                        onChange={(event) => setActivityExcluded(activity.id, event.target.checked)}
                      />
                      Exclude
                    </label>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {connection.connected ? (
          <div className="flex max-w-sm shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isWorking || isDetailWorking}
              onClick={() => runRequest("/api/integrations/garmin/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId, limit: 400, force: true }),
              })}
              className="rounded-lg bg-sky-950 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
            >
              {isWorking ? "Refreshing..." : "Refresh Garmin"}
            </button>
            <button
              type="button"
              disabled={isWorking || isDetailWorking}
              onClick={() => startJob("/api/integrations/garmin/samples", { scope: "all", days: 90, planId })}
              className="rounded-lg border border-sky-950 bg-white px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-50 disabled:opacity-50"
            >
              {isDetailWorking ? "Syncing detail..." : "Sync detail"}
            </button>
            <form
              className="flex w-full items-end gap-2 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                startJob("/api/integrations/garmin/history", { since: historySince });
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">Import summaries since</span>
                <input
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={historySince}
                  onChange={(event) => setHistorySince(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={isWorking || isDetailWorking}
                className="rounded-lg border border-sky-950 bg-white px-3 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-50 disabled:opacity-50"
              >
                Import history
              </button>
            </form>
            <button
              type="button"
              disabled={isWorking || isDetailWorking}
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
              {isWorking ? "Connecting..." : reconnectRequired ? "Reconnect Garmin" : "Connect Garmin"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
