#!/usr/bin/env node
/** Bounded daily-step history import; preview by default, reuses the app's fenced ingestion. */
export {};
try { process.loadEnvFile(".env"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run steps:backfill -- --email EMAIL --since YYYY-MM-DD --through YYYY-MM-DD [--apply]\nPreview by default. Apply fetches 28-day chunks, checkpoints each date, and resumes safely on rerun. Maximum 10 years per invocation.");
  process.exit(0);
}
function option(name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
const email = option("--email");
const { chunkStepsRange, validateStepsRange } = await import("../src/lib/garmin/daily-steps");
const range = validateStepsRange(option("--since"), option("--through"), 3660);
if (range.endDate > new Date().toISOString().slice(0, 10)) throw new Error("--through must not be in the future");
const chunks = chunkStepsRange(range);
console.log(`${args.includes("--apply") ? "Import" : "Preview"}: ${range.startDate} through ${range.endDate}; ${chunks.length} sequential chunks.`);
if (!args.includes("--apply")) {
  console.log("No database or Garmin access. Use --apply after the migration and operational authorization.");
} else {
  const { db, endDb } = await import("../src/lib/db/client");
  const { users } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { syncDailySteps } = await import("../src/lib/garmin/daily-steps-sync");
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new Error("User not found");
    for (const chunk of chunks) {
      const result = await syncDailySteps(user.id, chunk);
      console.log(`${chunk.startDate} through ${chunk.endDate}: ${result.days.length} totals${result.skippedByTtl ? " (cached)" : ""}`);
    }
  } catch {
    console.error("Steps import stopped. Check the database migration, Garmin connection, and competing sync jobs; rerun the same range to resume. No credentials or raw provider errors are logged.");
    process.exitCode = 1;
  } finally { await endDb(); }
}
