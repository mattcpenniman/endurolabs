#!/usr/bin/env node

// Polls the app's protected worker endpoint so persisted Garmin jobs continue
// independently of browser sessions. Intended for a long-running service.

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const appUrl = process.env.WORKER_APP_URL || "http://localhost:3000";
const secret = process.env.GARMIN_WORKER_SECRET;
if (!secret) throw new Error("GARMIN_WORKER_SECRET is required");

let stopping = false;
let lastSchedulerDate = null;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
while (!stopping) {
  const currentDate = new Date().toISOString().slice(0, 10);
  if (lastSchedulerDate !== currentDate) {
    try {
      const schedulerResponse = await fetch(`${appUrl}/api/internal/race-prediction-scheduler`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!schedulerResponse.ok) throw new Error(`Prediction scheduler returned ${schedulerResponse.status}`);
      lastSchedulerDate = currentDate;
    } catch (error) {
      console.error("Prediction scheduler pass failed:", error.message);
    }
  }
  try {
    const response = await fetch(`${appUrl}/api/internal/garmin-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) throw new Error(`Worker endpoint returned ${response.status}`);
    const body = await response.json();
    if (!body.processed) await sleep(5000);
  } catch (error) {
    console.error("Garmin worker pass failed:", error.message);
    await sleep(5000);
  }
}
