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
  HeartRateZone,
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

function oxygenCostForVelocity(velocityMetersPerMinute: number): number {
  return (
    -4.6 +
    0.182258 * velocityMetersPerMinute +
    0.000104 * velocityMetersPerMinute ** 2
  );
}

function paceFromRaceDuration(vdot: number, durationMinutes: number): number {
  let lowVelocity = 80;
  let highVelocity = 420;

  for (let i = 0; i < 40; i++) {
    const velocity = (lowVelocity + highVelocity) / 2;
    const distanceMiles = (velocity * durationMinutes) / 1609.344;
    const estimate = estimateVDOTFromTime(distanceMiles, durationMinutes);

    if (estimate > vdot) {
      highVelocity = velocity;
    } else {
      lowVelocity = velocity;
    }
  }

  const velocity = (lowVelocity + highVelocity) / 2;
  return 1609.344 / velocity;
}

function paceFromVO2Fraction(vdot: number, fraction: number): number {
  const targetOxygenCost = vdot * fraction;
  let lowVelocity = 80;
  let highVelocity = 420;

  for (let i = 0; i < 40; i++) {
    const velocity = (lowVelocity + highVelocity) / 2;

    if (oxygenCostForVelocity(velocity) > targetOxygenCost) {
      highVelocity = velocity;
    } else {
      lowVelocity = velocity;
    }
  }

  const velocity = (lowVelocity + highVelocity) / 2;
  return 1609.344 / velocity;
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
  // Fallback only. Threshold should be closer to current one-hour race effort
  // than to an aggressive goal marathon pace.
  return vdot > 55 ? 0.93 : vdot > 45 ? 0.94 : vdot > 35 ? 0.96 : 0.98;
}

function getVO2PaceFactor(vdot: number): number {
  // Fallback only. VO2 max intervals approximate Daniels I pace.
  return vdot > 55 ? 0.86 : vdot > 45 ? 0.87 : vdot > 35 ? 0.89 : 0.91;
}

function calculateHeartRateZone(
  profile: RunnerProfile,
  hrrPercent: HeartRateZone["hrrPercent"],
  hrMaxPercent: HeartRateZone["hrMaxPercent"],
  note?: string
): HeartRateZone {
  const maxHeartRate = profile.maxHeartRate ?? null;
  const restingHeartRate = profile.restingHeartRate ?? null;
  const canCalculateTarget =
    maxHeartRate !== null &&
    restingHeartRate !== null &&
    maxHeartRate > restingHeartRate;

  const targetBpm = canCalculateTarget
    ? {
        min: Math.round(restingHeartRate + hrrPercent.min * (maxHeartRate - restingHeartRate)),
        max: Math.round(restingHeartRate + hrrPercent.max * (maxHeartRate - restingHeartRate)),
      }
    : null;

  return {
    hrrPercent,
    hrMaxPercent,
    targetBpm,
    note,
  };
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
    : Math.max(
        paceFromRaceDuration(vdot, 60),
        marathonPace * getThresholdPaceFactor(vdot)
      );
  const vo2Pace = Math.max(
    paceFromVO2Fraction(vdot, 0.95),
    marathonPace * getVO2PaceFactor(vdot)
  );

  // Easy pace range (low end for recovery miles, high end for normal easy)
  const easyMin = profile.averageEasyPace
    ? profile.averageEasyPace + 0.25
    : easyPace + 0.25;
  const easyMax = profile.averageEasyPace
    ? profile.averageEasyPace - 0.25
    : easyPace - 0.25;
  const heartRateZones = {
    recovery: calculateHeartRateZone(
      profile,
      { min: 0.6, max: 0.67 },
      { min: 0.65, max: 0.72 },
      "Stay near the low end of easy effort."
    ),
    easy: calculateHeartRateZone(profile, { min: 0.6, max: 0.74 }, { min: 0.65, max: 0.79 }),
    marathon: calculateHeartRateZone(profile, { min: 0.75, max: 0.84 }, { min: 0.8, max: 0.9 }),
    threshold: calculateHeartRateZone(profile, { min: 0.83, max: 0.88 }, { min: 0.88, max: 0.92 }),
    vo2: calculateHeartRateZone(profile, { min: 0.95, max: 1 }, { min: 0.98, max: 1 }),
  };

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
    heartRateZones,
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
