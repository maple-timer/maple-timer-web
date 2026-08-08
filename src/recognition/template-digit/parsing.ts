export function parseCooldownDigits(digitText: string): number {
  if (digitText.length >= 3 && digitText.length <= 4) {
    const minutes = Number(digitText.slice(0, -2));
    const seconds = Number(digitText.slice(-2));
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
      return minutes * 60 + seconds;
    }
  }

  return Number(digitText);
}

export function capAmbiguousSingleDigitConfidence(
  value: number,
  digitCount: number,
  confidence: number,
): number {
  if (digitCount !== 1 || value < 4 || value > 9) {
    return confidence;
  }

  return Math.min(confidence, 0.53);
}
