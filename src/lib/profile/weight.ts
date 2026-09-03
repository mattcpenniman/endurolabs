// ============================================================
// EnduroLab - Body Weight Conversions
// ============================================================

export const KILOGRAMS_PER_POUND = 0.45359237;

export function poundsToKilograms(pounds: number): number {
  return pounds * KILOGRAMS_PER_POUND;
}

export function kilogramsToPounds(kilograms: number): number {
  return kilograms / KILOGRAMS_PER_POUND;
}
