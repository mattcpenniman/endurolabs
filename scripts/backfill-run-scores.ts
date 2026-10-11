#!/usr/bin/env node
/** DB-only run-score backfill. Preview by default; --apply persists for all users. */
export {};
try { process.loadEnvFile(".env"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run scores:backfill -- [--email runner@example.com] [--apply] [--json]\nDefault: preview all stored runs. DB only; no Garmin requests.");
  process.exit(0);
}
const emailIndex = args.indexOf("--email");
const email = args.find((arg) => arg.startsWith("--email="))?.slice(8) ?? (emailIndex >= 0 ? args[emailIndex + 1] : undefined);
if (emailIndex >= 0 && (!email || email.startsWith("--"))) throw new Error("--email requires an address");
const { db, endDb } = await import("../src/lib/db/client");
const { runActivities, users } = await import("../src/lib/db/schema");
const { eq, asc } = await import("drizzle-orm");
const { loadRunScores } = await import("../src/lib/analytics/run-score-persistence");
try {
  const user = email ? (await db.select().from(users).where(eq(users.email, email)).limit(1))[0] : null;
  if (email && !user) throw new Error(`No user found for ${email}`);
  const rows = await db.select().from(runActivities).where(user ? eq(runActivities.userId, user.id) : undefined).orderBy(asc(runActivities.localDate));
  const report = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const scores = await loadRunScores(batch, { force: true, dryRun: !args.includes("--apply") });
    for (const row of batch) report.push({ date: row.localDate, run: row.activityName, id: row.id,
      score: scores.get(row.id)?.score ?? null, partial: scores.get(row.id)?.partial ?? true });
  }
  if (args.includes("--json")) console.log(JSON.stringify({ apply: args.includes("--apply"), runs: report }, null, 2));
  else {
    console.table(report);
    console.log(`${report.length} runs; ${report.filter((row) => row.score !== null).length} scored. ${args.includes("--apply") ? "Persisted." : "Preview only; use --apply to persist."}`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { await endDb(); }
