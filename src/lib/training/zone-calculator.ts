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
// Approximate VDOT from race time (minutes, miles).
// Uses a simplified Riegel/VDOT hybrid — accurate enough for
// training-zone purposes without a 500-row lookup table.

function estimateVDOTFromTime(distanceMiles: number, timeMinutes: number): number {
  const pace = timeMinutes / distanceMiles;

  // VDOT approximation (inverse of pace, scaled)
  // Ranges: elite ~100+, sub-3 marathoner ~45-50, 4:00 ~30
  const vdot = Math.max(20, Math.min(100, (250 / pace) - 10));
  return vdot;
}

// ─── Pace Factors ───────────────────────────────────────────
// Multiplier from VDOT to get pace (min/mile) for each zone.
// Derived from Daniels' Running Formula tables.

function getEasyPaceFactor(vdot: number): number {
  // Easy pace is ~70-80% of max HR, roughly 1.45-1.65x marathon pace
  return vdot > 50 ? 1.55 : vdot > 35 ? 1.6 : 1.65;
}

function getRecoveryPaceFactor(vdot: number): number {
  // Recovery is even slower than easy — ~85-95% of easy pace
  return getEasyPaceFactor(vdot) * 1.1;
}

function getThresholdPaceFactor(vdot: number): number {
  // Threshold is ~1.15-1.25x marathon pace
  return vdot > 50 ? 1.18 : vdot > 35 ? 1.2 : 1.22;
}

function getVO2PaceFactor(vdot: number): number {
  // VO2 is ~1.3-1.4x marathon pace
  return vdot > 50 ? 1.3 : vdot > 35 ? 1.33 : 1.36;
}

// ─── Core Zone Calculation ──────────────────────────────────

export function calculatePaceZones(profile: RunnerProfile): PaceZones {
  // Determine best available VDOT source
  let vdot: number;
  let marathonPace: number;

  if (profile.currentMarathonPR) {
    vdot = estimateVDOTFromTime(26.2, profile.currentMarathonPR);
    marathonPace = profile.currentMarathonPR / 26.2;
  } else if (profile.currentHalfMarathonPR) {
    vdot = estimateVDOTFromTime(13.1, profile.currentHalfMarathonPR);
    // Convert half pace to estimated marathon pace
    const halfPace = profile.currentHalfMarathonPR / 13.1;
    marathonPace = halfPace * 1.12; // ~7% slowdown from half to full
  } else {
    // Fallback: use goal marathon time to back-calculate
    vdot = estimateVDOTFromTime(26.2, profile.goalMarathonTime);
    marathonPace = profile.goalMarathonTime / 26.2;
  }

  // Override with user-provided paces if available
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
  const estimatedMPPower = Math.round(5.2 * mp - 18); // rough fit from AW data

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
