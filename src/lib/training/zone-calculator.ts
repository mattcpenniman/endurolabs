// ============================================================
// EnduroLab — Pace & Power Zone Calculator
// ============================================================
// Calculates training pace/power zones from race performances
// using Daniels'-derived formulas, adjusted for Apple Watch
// running power data when available.
// ============================================================

import {
  RunnerProfile,
  PaceZones,
  PowerZones,
} from "./models";

// ─── VDOT Estimation ────────────────────────────────────────
// Approximate VDOT/VO2 max from race time (minutes, miles).
// Uses the Daniels oxygen cost and fractional VO2 max equations.

function estimateVDOTFromTime(distanceMiles: number, timeMinutes: number): number {
  const meters = distanceMiles * 1609.344;
  const velocityMetersPerMinute = meters / timeMinutes;
  const oxygenCost =
    -4.6 +
    0.182258 * velocityMetersPerMinute +
    0.000104 * velocityMetersPerMinute ** 2;
  const fractionalVO2Max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMinutes) +
    0.2989558 * Math.exp(-0.1932605 * timeMinutes);

  const vdot = oxygenCost / fractionalVO2Max;
  return vdot;
}

// ─── Pace Factors ───────────────────────────────────────────
// Multiplier from VDOT to get pace (min/mile) for each zone.
// Derived from Daniels' Running Formula tables.

function getEasyPaceFactor(vdot: number): number {
  // Easy pace is slower than marathon pace, with a slightly wider gap for newer runners.
  return vdot > 55 ? 1.13 : vdot > 45 ? 1.18 : vdot > 35 ? 1.24 : 1.3;
}

function getRecoveryPaceFactor(vdot: number): number {
  // Recovery is slower than easy.
  return getEasyPaceFactor(vdot) + 0.12;
}

function getThresholdPaceFactor(vdot: number): number {
  // Threshold is faster than marathon pace, roughly 1-hour race effort.
  return vdot > 55 ? 0.9 : vdot > 45 ? 0.91 : vdot > 35 ? 0.93 : 0.95;
}

function getVO2PaceFactor(vdot: number): number {
  // VO2 max intervals approximate 3K-5K effort and must be faster than threshold.
  return vdot > 55 ? 0.8 : vdot > 45 ? 0.82 : vdot > 35 ? 0.84 : 0.86;
}

// ─── Core Zone Calculation ──────────────────────────────────

export function calculatePaceZones(profile: RunnerProfile): PaceZones {
  // The displayed marathon pace should match the anticipated race time.
  let marathonPace = profile.goalMarathonTime / 26.2;
  let vdot = estimateVDOTFromTime(26.2, profile.goalMarathonTime);

  // Use recent performances to tune training zones only when supplied.
  if (profile.currentMarathonPR) {
    vdot = estimateVDOTFromTime(26.2, profile.currentMarathonPR);
  } else if (profile.currentHalfMarathonPR) {
    vdot = estimateVDOTFromTime(13.1, profile.currentHalfMarathonPR);
  }

  // Override marathon pace only with an explicit user-provided training anchor.
  if (profile.averageMarathonPace) {
    marathonPace = profile.averageMarathonPace;
    vdot = estimateVDOTFromTime(26.2, marathonPace * 26.2);
  }

  const easyPace = marathonPace * getEasyPaceFactor(vdot);
  const recoveryPace = marathonPace * getRecoveryPaceFactor(vdot);
  const thresholdPace = profile.averageThresholdPace
    ? profile.averageThresholdPace
    : marathonPace * getThresholdPaceFactor(vdot);
  const vo2Pace = marathonPace * getVO2PaceFactor(vdot);

  // Easy pace range (low end for recovery miles, high end for normal easy)
  const easyMin = profile.averageEasyPace
    ? profile.averageEasyPace + 0.25
    : easyPace + 0.25;
  const easyMax = profile.averageEasyPace
    ? profile.averageEasyPace - 0.25
    : easyPace - 0.25;

  return {
    easy: { min: Math.max(easyMin, easyMax), max: Math.min(easyMin, easyMax) },
    marathon: Math.round(marathonPace * 100) / 100,
    threshold: Math.round(thresholdPace * 100) / 100,
    vo2: Math.round(vo2Pace * 100) / 100,
    recovery: Math.round(recoveryPace * 100) / 100,
    vo2MaxEstimate: Math.round(vdot),
    easyEffort: "Conversational — you could speak in full sentences",
    marathonEffort: "Comfortably hard — brief phrases only",
    thresholdEffort: "Sustainable discomfort — a few words at a time",
    vo2Effort: "Hard — one-word answers only",
  };
}

// ─── Power Zone Estimation (Apple Watch) ────────────────────
// Apple Watch running power is internally consistent but not
// directly comparable to Stryd or lab-grade power meters.
// We estimate zones from pace zones using a pace→power curve
// calibrated for typical Apple Watch readings.

export function calculatePowerZones(
  profile: RunnerProfile,
  paceZones: PaceZones
): PowerZones | undefined {
  if (!profile.hasAppleWatchPower) return undefined;

  // If the user has provided actual power data, use it as anchors
  const mpPower = profile.appleWatchPowerData?.marathonPower;
  const thPower = profile.appleWatchPowerData?.thresholdPower;
  const easyPower = profile.appleWatchPowerData?.easyPower;

  if (mpPower) {
    // Derive all zones from marathon power anchor
    const threshold = thPower ?? Math.round(mpPower * 1.12);
    const easy = easyPower ?? Math.round(mpPower * 0.78);
    const vo2 = Math.round(mpPower * 1.22);

    return {
      easy: { min: Math.round(easy * 0.85), max: Math.round(easy * 1.05) },
      marathon: mpPower,
      threshold,
      vo2,
    };
  }

  // Fallback: estimate power from marathon pace using a rough curve
  // Apple Watch power tends to read ~2-3W lower than Stryd at same pace
  const mp = paceZones.marathon;
  const estimatedMPPower = Math.round(2100 / mp); // rough fit from AW data

  return {
    easy: {
      min: Math.round(estimatedMPPower * 0.72),
      max: Math.round(estimatedMPPower * 0.85),
    },
    marathon: estimatedMPPower,
    threshold: Math.round(estimatedMPPower * 1.12),
    vo2: Math.round(estimatedMPPower * 1.22),
  };
}
