/** Private certificates, photos, and online results for a selected race. */
"use client";

import React, { useEffect, useState } from "react";
import { MAX_RACE_ATTACHMENT_BYTES, MAX_RACE_ATTACHMENTS, RACE_ATTACHMENT_ACCEPT, type RaceAttachmentRecord, type RaceResourcesResponse } from "@/lib/races/resources";

export default function RaceResourcesCard({ activityId }: { activityId: string }): React.ReactNode {
  const [resources, setResources] = useState<RaceResourcesResponse | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const endpoint = `/api/races/${activityId}/resources`;

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load race resources");
        setResources(body);
        setUrl(body.resultsUrl ?? "");
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load race resources");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint]);

  async function mutate(action: () => Promise<void>, success: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage("");
    try { await action(); setMessage(success); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save race resources"); }
    finally { setBusy(false); }
  }

  async function request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(path, init);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to save race resources");
    return body;
  }

  return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-xl font-black text-gray-900">Results &amp; keepsakes</h2>
    <p className="mt-1 text-sm text-gray-500">Save certificates and race photos. Attachments are private to your account.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-enduro-700">{message}</p>}
    {!resources ? <p className="mt-4 text-sm text-gray-500">{error ? "Reload the page to try again." : "Loading race resources..."}</p> : <>
      <form className="mt-5 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void mutate(async () => {
          const body = await request(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultsUrl: url }) });
          const resultsUrl = body.resultsUrl as string | null;
          setResources((current) => current && { ...current, resultsUrl });
          setUrl(resultsUrl ?? "");
        }, "Results link saved");
      }}>
        <label className="block text-sm font-bold text-gray-700">Online results URL
          <input type="url" maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://results.example.com/race" className="form-input mt-2" disabled={busy} />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} className="rounded-lg bg-enduro-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save link</button>
          {resources.resultsUrl && <a href={resources.resultsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-enduro-700 underline">Open online results ↗</a>}
          <span className="text-xs text-gray-500">Clear the field and save to remove the link.</span>
        </div>
      </form>
      <div className="mt-6 border-t border-gray-100 pt-5">
        <h3 className="text-sm font-bold text-gray-800">Attachments ({resources.attachments.length}/{MAX_RACE_ATTACHMENTS})</h3>
        {resources.attachments.length === 0 && <p className="mt-2 text-sm text-gray-500">No attachments yet.</p>}
        <ul className="mt-3 space-y-3">{resources.attachments.map((attachment) => <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
          <a className="min-w-0 break-words text-sm font-bold text-enduro-700 underline" href={`/api/races/${activityId}/attachments/${attachment.id}`}>{attachment.filename} <span className="font-normal text-gray-500">({Math.ceil(attachment.sizeBytes / 1024)} KB)</span></a>
          <button type="button" disabled={busy} className="text-xs font-bold text-red-700 disabled:opacity-50" aria-label={`Remove ${attachment.filename}`} onClick={() => {
            if (!window.confirm(`Remove ${attachment.filename}?`)) return;
            void mutate(async () => {
              await request(`/api/races/${activityId}/attachments/${attachment.id}`, { method: "DELETE" });
              setResources((current) => current && { ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) });
            }, "Attachment removed");
          }}>Remove</button>
        </li>)}</ul>
        <label className="mt-4 block text-sm font-bold text-gray-700">Add certificate or photo
          <input type="file" accept={RACE_ATTACHMENT_ACCEPT} disabled={busy || resources.attachments.length >= MAX_RACE_ATTACHMENTS} className="mt-2 block w-full text-sm font-normal" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void mutate(async () => {
              if (!file.size || file.size > MAX_RACE_ATTACHMENT_BYTES) throw new Error("Choose a non-empty file up to 5 MB");
              const form = new FormData();
              form.set("file", file);
              const body = await request(endpoint, { method: "POST", body: form });
              const attachment = body.attachment as RaceAttachmentRecord;
              setResources((current) => current && { ...current, attachments: [...current.attachments, attachment] });
            }, "Attachment uploaded");
          }} />
        </label>
        <p className="mt-2 text-xs text-gray-500">PDF, JPEG, or PNG · Up to 5 MB each · Up to 10 per race</p>
        {busy && <p role="status" className="mt-2 text-sm text-gray-500">Saving...</p>}
      </div>
    </>}
  </section>;
}
