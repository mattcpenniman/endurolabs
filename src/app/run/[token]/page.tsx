/** Public single-run card; a token grants access only to this activity. */
import React from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import { serializeRunActivity } from "@/lib/activities/serialize";

export default async function SharedRunPage({
  params,
}: { params: Promise<{ token: string }> }): Promise<React.ReactNode> {
  const { token } = await params;
  const [row] = await db.select().from(runActivities).where(eq(runActivities.shareToken, token)).limit(1);
  if (!row) notFound();
  const activity = serializeRunActivity(row);
  return (
    <main className="section-padding">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-enduro-700">Shared run</p>
          <h1 className="mt-2 text-3xl font-bold">{activity.activityName}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{activity.localDate}</p>
        </div>
        <GarminActivityMapCard activities={[activity]} activityId={activity.id}
          detailUrlPrefix={`/api/run/${token}/activities`} showControls={false} />
      </div>
    </main>
  );
}
