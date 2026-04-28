// ============================================================
// EnduroLab — Calendar Export
// ============================================================
// Exports training plans as .ics calendar files for import
// into Google Calendar, Apple Calendar, Outlook, etc.
// ============================================================

import { createEvent } from "ics";
import { MarathonPlan, Workout, DailyPlan } from "./models";

// ─── Workout Title Formatting ───────────────────────────────

function formatWorkoutTitle(workout: Workout): string {
  const prefix = getWorkoutEmoji(workout.type);
  return `${prefix} ${workout.title}`;
}

function getWorkoutEmoji(type: string): string {
  switch (type) {
    case "easy": return "🏃";
    case "recovery": return "🚶";
    case "threshold": return "🔥";
    case "marathon_pace": return "🎯";
    case "vo2": return "⚡";
    case "long": return "🦵";
    case "progression": return "📈";
    case "strength": return "💪";
    case "rest": return "😴";
    default: return "🏃";
  }
}

// ─── Description Builder ────────────────────────────────────

function buildEventDescription(workout: Workout, day: DailyPlan): string {
  const lines: string[] = [];

  lines.push(workout.description);
  lines.push("");

  // Segments
  if (workout.segments.length > 0) {
    lines.push("Workout structure:");
    workout.segments.forEach((seg, i) => {
      const repInfo = seg.repetitions ? `${seg.repetitions}× ` : "";
      const distInfo = seg.distance ? `${seg.distance} mi` : "";
      const durInfo = seg.duration ? `${seg.duration} min` : "";
      const paceInfo = seg.pace ? ` @ ${seg.pace.toFixed(1)} min/mi` : "";
      const powerInfo = seg.power ? ` (~${seg.power} W)` : "";
      const restInfo = seg.restBetween ? ` (${seg.restBetween}s rest)` : "";

      lines.push(`  ${i + 1}. ${repInfo}${seg.description}${distInfo}${durInfo}${paceInfo}${powerInfo}${restInfo}`);
    });
  }

  // Summary
  lines.push("");
  lines.push(`Total distance: ${workout.totalDistance} mi`);
  lines.push(`Estimated duration: ${Math.floor(workout.estimatedDuration / 60)}h ${workout.estimatedDuration % 60}min`);
  lines.push(`Intensity: ${workout.intensityCategory}`);

  // Day of week
  lines.push(`\nDay: ${day.dayOfWeek}`);

  return lines.join("\n");
}

// ─── Rest Day Event ─────────────────────────────────────────

function buildRestDayDescription(day: DailyPlan): string {
  return `Rest day — recover and prepare for upcoming workouts.\n\nDay: ${day.dayOfWeek}\nFocus on sleep, nutrition, and light stretching.`;
}

// ─── ICS Generation ─────────────────────────────────────────

export function generateICS(plan: MarathonPlan): string {
  const events: Parameters<typeof createEvent>[0][] = [];

  plan.weeks.forEach((week) => {
    week.days.forEach((day) => {
      if (day.isRestDay || !day.workout) {
        // Rest day
        events.push({
          start: [
            new Date(day.date).getUTCFullYear(),
            new Date(day.date).getUTCMonth() + 1,
            new Date(day.date).getUTCDate(),
          ] as [number, number, number],
          title: `😴 Rest Day — Week ${week.weekNumber}`,
          description: buildRestDayDescription(day),
          duration: { hours: 0, minutes: 1 },
          uid: `endurlab-rest-${day.date}-${plan.id}`,
        });
      } else {
        // Workout day
        const startDate = new Date(day.date);
        events.push({
          start: [
            startDate.getUTCFullYear(),
            startDate.getUTCMonth() + 1,
            startDate.getUTCDate(),
          ] as [number, number, number],
          title: `${formatWorkoutTitle(day.workout)} — Week ${week.weekNumber}`,
          description: buildEventDescription(day.workout, day),
          duration: {
            hours: Math.floor(day.workout.estimatedDuration / 60),
            minutes: day.workout.estimatedDuration % 60,
          },
          uid: `endurlab-${day.workout.id}-${plan.id}`,
        });
      }
    });
  });

  // Build ICS string
  let icsContent = "BEGIN:VCALENDAR\r\n";
  icsContent += "VERSION:2.0\r\n";
  icsContent += "PRODID:-//EnduroLab//Marathon Training Plan//EN\r\n";
  icsContent += `CALSCALE:GREGORIAN\r\n`;
  icsContent += `METHOD:PUBLISH\r\n`;

  events.forEach((evt) => {
    const result = createEvent(evt);
    if (result.error) {
      console.error("ICS event error:", result.error);
      return;
    }
    if (result.value) {
      icsContent += result.value + "\r\n";
    }
  });

  icsContent += "END:VCALENDAR\r\n";

  return icsContent;
}

// ─── Download Helper (browser) ──────────────────────────────

export function downloadICS(plan: MarathonPlan): void {
  const content = generateICS(plan);
  const blob = new Blob([content], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `endurlab-marathon-plan-${plan.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
