type WeightedScore = {
  score: number;
  weight: number;
};

export function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundScore(value: number): number {
  return Math.round(clamp(value));
}

export function normalizeLinear(value: number, minInput: number, maxInput: number): number {
  if (maxInput <= minInput) {
    throw new Error("normalizeLinear requires maxInput to be greater than minInput");
  }

  return clamp(((value - minInput) / (maxInput - minInput)) * 100);
}

export function normalizeInverseLinear(value: number, minInput: number, maxInput: number): number {
  return 100 - normalizeLinear(value, minInput, maxInput);
}

export function normalizeLogScale(value: number, minInput: number, maxInput: number): number {
  if (minInput < 0 || maxInput <= minInput) {
    throw new Error("normalizeLogScale requires 0 <= minInput < maxInput");
  }

  const safeValue = clamp(value, minInput, maxInput);
  const minLog = Math.log10(minInput + 1);
  const maxLog = Math.log10(maxInput + 1);
  const valueLog = Math.log10(safeValue + 1);

  return normalizeLinear(valueLog, minLog, maxLog);
}

export function normalizeRatio(part: number, total: number): number {
  if (total <= 0) return 0;
  return clamp((part / total) * 100);
}

export function weightedAverage(scores: WeightedScore[]): number {
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;

  const weightedTotal = scores.reduce((sum, item) => sum + clamp(item.score) * item.weight, 0);
  return clamp(weightedTotal / totalWeight);
}
