// ============================================================
// EnduroLab - Public Shared Race
// ============================================================

import React from "react";
import { notFound } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import { serializeRunActivity } from "@/lib/activities/serialize";
import { classifyRaceDistance } from "@/lib/activities/race-comparison";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

export default async function SharedRacePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactNode> {
  const { token } = await params;
  const [raceRow] = await db.select().from(runActivities).where(and(
    eq(runActivities.shareToken, token),
    eq(runActivities.eventType, "race"),
    gt(runActivities.sampleCount, 0),
  )).limit(1);
  if (!raceRow) notFound();

  const race = serializeRunActivity(raceRow);
  const category = classifyRaceDistance(race.distanceMiles);
  return (
    <main className="section-padding">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-enduro-700">Shared race · {category.label}</p>
          <h1 className="mt-2 text-3xl font-black text-gray-900">{race.activityName}</h1>
          <p className="mt-2 text-sm text-gray-600">{formatDate(race.localDate)} · {race.distanceMiles.toFixed(2)} recorded miles</p>
        </div>
        <GarminActivityMapCard
          activities={[race]}
          activityId={race.id}
          detailUrlPrefix={`/api/race/${token}/activities`}
          showControls={false}
        />
      </div>
    </main>
  );
}
