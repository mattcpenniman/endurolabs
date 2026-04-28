// ============================================================
// EnduroLab — Race Day Plan Generator
// ============================================================
// Generates a mile-by-mile split sheet with target paces,
// nutrition cues, weather adjustments, and pre-race routine.
// ============================================================

import {
  RaceDayPlan,
  RaceSplit,
  NutritionCue,
  WeatherAdjustment,
  PreRaceCue,
} from "./models";

// ─── Split Sheet Generation ────────────────────────────────

function generateSplits(
  goalPace: number,
  pacingStrategy: "even" | "negative" | "positive" | "progressive"
): RaceSplit[] {
  const splits: RaceSplit[] = [];
  let cumulativeTime = 0;

  for (let mile = 1; mile <= 26.2; mile++) {
    let paceDelta = 0;

    switch (pacingStrategy) {
      case "even":
        paceDelta = 0;
        break;
      case "negative":
        // Slow down 1-2 sec/mile each half
        if (mile > 13) {
          paceDelta = (mile - 13) * 1.0;
        }
        break;
      case "positive":
        // Start 1-2 sec/mile faster, then slow
        if (mile <= 13) {
          paceDelta = -(13 - mile) * 0.5;
        } else {
          paceDelta = (mile - 13) * 1.5;
        }
        break;
      case "progressive":
        // Gradually speed up through first half, then hold steady
        if (mile <= 13) {
          paceDelta = -(mile - 1) * 0.5;
        } else {
          // Second half holds at the fastest pace achieved
          paceDelta = -(12 * 0.5);
        }
        break;
    }

    const targetPace = Math.max(goalPace + paceDelta, goalPace - 3);
    cumulativeTime += targetPace;

    let effort = "Easy — stay relaxed";
    let notes = "";

    if (mile <= 3) {
      effort = "Easy — resist the urge to go fast";
      notes = mile === 1 ? "Start slower than goal pace" : "";
    } else if (mile <= 10) {
      effort = "Comfortable — find your rhythm";
    } else if (mile <= 13) {
      effort = "Steady — you're in the groove";
    } else if (mile <= 20) {
      effort = "Hard — focus on form and breathing";
      if (pacingStrategy === "negative" && mile > 13) {
        notes = "This is where the race begins — hold your form";
      }
    } else if (mile <= 23) {
      effort = "Very hard — dig deep, stay positive";
      notes = "Mental toughness zone — break it into 3-mile chunks";
    } else {
      effort = "All out — empty the tank";
      notes = "Final 3 miles — leave it all on the course";
    }

    splits.push({
      mile,
      targetPace: Math.round(targetPace * 100) / 100,
      targetTime: Math.round(cumulativeTime * 100) / 100,
      cumulativeDistance: mile,
      effort,
      notes,
    });
  }

  return splits;
}

// ─── Nutrition Plan ────────────────────────────────────────

function generateNutritionPlan(goalTime: number): NutritionCue[] {
  const cues: NutritionCue[] = [];

  // Pre-rake fueling
  cues.push({
    mile: 0,
    type: "fuel",
    description: "Eat 300-400 kcal carb-rich meal 3-4 hours before start",
  });

  // Race morning
  cues.push({
    mile: 0,
    type: "fuel",
    description: "Light snack 60 min before: banana + toast or energy gel",
  });

  // During race — fuel every 45-60 min (~30-60g carbs/hr)
  const fuelInterval = goalTime <= 240 ? 45 : 60; // faster runners fuel more often
  for (let min = fuelInterval; min <= goalTime; min += fuelInterval) {
    const mile = Math.round((min / goalTime) * 26.2);
    cues.push({
      mile: Math.min(mile, 26),
      type: "fuel",
      description: `Energy gel or chews (~30g carbs)`,
    });
  }

  // Fluids every 2-3 miles
  for (let mile = 2; mile <= 26; mile += 2) {
    cues.push({
      mile,
      type: "fluid",
      description: "4-8 oz water or sports drink at aid station",
    });
  }

  // Electrolytes
  for (let mile = 5; mile <= 26; mile += 5) {
    cues.push({
      mile,
      type: "electrolyte",
      description: "Electrolyte tablet or salt capsule (especially if >75°F)",
    });
  }

  return cues;
}

// ─── Weather Adjustments ──────────────────────────────────

function generateWeatherAdjustments(
  goalPace: number,
  expectedTempF: number
): WeatherAdjustment[] {
  const adjustments: WeatherAdjustment[] = [];

  // Temperature-based adjustments (Daniels' guidelines)
  if (expectedTempF >= 60) {
    const delta = Math.round((expectedTempF - 50) * 0.5); // +0.5s/mi per degree above 50
    adjustments.push({
      condition: "Temperature",
      threshold: 60,
      adjustment: `Add ${delta}s/mile to your goal pace — heat slows you down`,
      paceDelta: delta,
    });
  }

  if (expectedTempF >= 75) {
    adjustments.push({
      condition: "High temperature",
      threshold: 75,
      adjustment: "Consider a more conservative goal — heat stress is significant above 75°F",
      paceDelta: 5,
    });
  }

  if (expectedTempF <= 35) {
    const delta = Math.round((45 - expectedTempF) * 0.3);
    adjustments.push({
      condition: "Cold temperature",
      threshold: 35,
      adjustment: `Add ${delta}s/mile — cold requires extra energy to stay warm`,
      paceDelta: delta,
    });
  }

  if (expectedTempF <= 25) {
    adjustments.push({
      condition: "Extreme cold",
      threshold: 25,
      adjustment: "Race may be unsafe — check with race organizers about cancellation",
      paceDelta: 10,
    });
  }

  // Wind adjustments
  if (expectedTempF > 0) {
    // Placeholder — wind data would come from weather API
    adjustments.push({
      condition: "Headwind >10 mph",
      threshold: 0,
      adjustment: "Add 3-5s/mile for sustained headwind sections",
      paceDelta: 4,
    });
  }

  return adjustments;
}

// ─── Pre-Race Routine ─────────────────────────────────────

function generatePreRaceRoutine(): PreRaceCue[] {
  return [
    { timeBeforeStart: 90, description: "Arrive at race village, find bathroom" },
    { timeBeforeStart: 60, description: "Put on old shoes, lay out gear" },
    { timeBeforeStart: 45, description: "Light snack if needed (banana, toast)" },
    { timeBeforeStart: 30, description: "Apply body glide to chafe points" },
    { timeBeforeStart: 20, description: "Easy jog — 10 min warm-up, 2x 30s strides" },
    { timeBeforeStart: 10, description: "Find start corral, stand still, stay warm" },
    { timeBeforeStart: 5, description: "Mental prep — visualize first 5 miles" },
    { timeBeforeStart: 0, description: "GO! — stick to your pace, not the crowd" },
  ];
}

// ─── Main Generator ───────────────────────────────────────

export function generateRaceDayPlan(
  goalTime: number,
  raceDate: string,
  expectedTempF: number,
  pacingStrategy: "even" | "negative" | "positive" | "progressive" = "even"
): RaceDayPlan {
  const goalPace = goalTime / 26.2;
  const splits = generateSplits(goalPace, pacingStrategy);
  const nutritionPlan = generateNutritionPlan(goalTime);
  const weatherAdjustments = generateWeatherAdjustments(goalPace, expectedTempF);
  const preRaceRoutine = generatePreRaceRoutine();

  return {
    raceDate,
    goalTime,
    goalPace: Math.round(goalPace * 100) / 100,
    splits,
    nutritionPlan,
    weatherAdjustments,
    preRaceRoutine,
    pacingStrategy,
  };
}
