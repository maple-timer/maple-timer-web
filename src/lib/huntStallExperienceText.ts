const EXPERIENCE_READING_PATTERN = /^(\d{1,3}(?:,\d{3})+|--) \[(\d{1,2}\.\d{3})%\]$/;
const EXPERIENCE_STABLE_TAIL_DIGITS = 8;
const EXPERIENCE_SAME_PERCENT_MAX_DIGIT_LENGTH_DIFF = 2;
const EXPERIENCE_TOTAL_ESTIMATE_MIN_MILLI = 2_500;
const EXPERIENCE_TOTAL_ESTIMATE_MAX_MILLI = 97_000;

export type ExperienceReadingParts = {
  total: string | null;
  totalDigits: string;
  percent: string;
};

export type ParsedExperienceReading = {
  total: number | null;
  totalDigits: string;
  milliPercent: number;
  text: string;
};

export function parseExperienceReading(text: string): ExperienceReadingParts | null {
  const match = EXPERIENCE_READING_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const total = match[1] === "--" ? null : match[1];
  return {
    total,
    totalDigits: total?.replace(/\D/g, "") ?? "",
    percent: match[2],
  };
}

export function parseExperienceReadingForMath(text: string): ParsedExperienceReading | null {
  const parsed = parseExperienceReading(text);
  if (!parsed) {
    return null;
  }
  const milliPercent = Math.round(Number(parsed.percent) * 1000);
  if (!Number.isFinite(milliPercent) || milliPercent < 0 || milliPercent > 100_000) {
    return null;
  }
  return {
    total: parsed.totalDigits ? Number(parsed.totalDigits) : null,
    totalDigits: parsed.totalDigits,
    milliPercent,
    text,
  };
}

export function hasSameExperienceValue(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }

  const leftValue = parseExperienceReading(left);
  const rightValue = parseExperienceReading(right);
  if (!leftValue || !rightValue) {
    return left === right;
  }

  if (leftValue.total && rightValue.total && leftValue.total === rightValue.total) {
    return true;
  }

  if (leftValue.percent !== rightValue.percent) {
    return false;
  }

  if (!leftValue.total || !rightValue.total) {
    return leftValue.percent === rightValue.percent;
  }

  if (leftValue.totalDigits.length !== rightValue.totalDigits.length) {
    return (
      Math.abs(leftValue.totalDigits.length - rightValue.totalDigits.length) <=
      EXPERIENCE_SAME_PERCENT_MAX_DIGIT_LENGTH_DIFF
    );
  }

  if (leftValue.totalDigits.length <= EXPERIENCE_STABLE_TAIL_DIGITS + 1) {
    return true;
  }

  return hasSharedExperienceTail(leftValue.totalDigits, rightValue.totalDigits);
}

export function canIgnoreLowFingerprintExperienceChange(
  left: string | null,
  right: string | null,
): boolean {
  const leftValue = left ? parseExperienceReading(left) : null;
  const rightValue = right ? parseExperienceReading(right) : null;
  if (!leftValue || !rightValue) {
    return false;
  }

  if (leftValue.total && rightValue.total && leftValue.total === rightValue.total) {
    return true;
  }

  if (leftValue.percent !== rightValue.percent) {
    return false;
  }

  if (!leftValue.total || !rightValue.total) {
    return true;
  }

  return (
    Math.abs(leftValue.totalDigits.length - rightValue.totalDigits.length) <=
    EXPERIENCE_SAME_PERCENT_MAX_DIGIT_LENGTH_DIFF
  );
}

export function estimateExperienceTotalFromText(text: string | null): number | null {
  if (!text) {
    return null;
  }
  const parsed = parseExperienceReadingForMath(text);
  if (
    !parsed?.total ||
    parsed.milliPercent < EXPERIENCE_TOTAL_ESTIMATE_MIN_MILLI ||
    parsed.milliPercent > EXPERIENCE_TOTAL_ESTIMATE_MAX_MILLI
  ) {
    return null;
  }
  return (parsed.total * 100_000) / parsed.milliPercent;
}

export function expectedExperienceMilli(number: number, total: number): number {
  return (number / total) * 100_000;
}

export function experienceNumberCenter(total: number, milliPercent: number): number {
  return (total * milliPercent) / 100_000;
}

export function formatExperienceValue(number: number, milliPercent: number): string {
  return `${addExperienceCommas(String(Math.round(number)))} [${formatExperiencePercent(milliPercent)}%]`;
}

export function addExperienceCommas(rawDigits: string): string {
  const parts: string[] = [];
  let digits = rawDigits;
  while (digits.length > 0) {
    parts.unshift(digits.slice(-3));
    digits = digits.slice(0, -3);
  }
  return parts.join(",");
}

export function formatExperiencePercent(milliPercent: number): string {
  const rounded = Math.max(0, Math.min(100_000, Math.round(milliPercent)));
  return `${Math.floor(rounded / 1000)}.${String(rounded % 1000).padStart(3, "0")}`;
}

export function hasExperiencePercentProgress(base: string | null, next: string | null): boolean {
  if (!base || !next) {
    return false;
  }

  const baseValue = parseExperienceReading(base);
  const nextValue = parseExperienceReading(next);
  if (!baseValue || !nextValue) {
    return false;
  }

  const basePercent = Number(baseValue.percent);
  const nextPercent = Number(nextValue.percent);
  return Number.isFinite(basePercent) && Number.isFinite(nextPercent) && nextPercent > basePercent;
}

export function isLikelyHuntProgressWithLag(base: string | null, next: string | null): boolean {
  if (!base || !next) {
    return false;
  }

  if (isPlausibleExperienceProgress(base, next)) {
    return true;
  }

  const baseValue = parseExperienceReading(base);
  const nextValue = parseExperienceReading(next);
  if (!baseValue?.total || !nextValue?.total) {
    return false;
  }

  if (compareExperienceTotals(base, next) !== -1) {
    return false;
  }

  const basePercent = Number(baseValue.percent);
  const nextPercent = Number(nextValue.percent);
  if (!Number.isFinite(basePercent) || !Number.isFinite(nextPercent)) {
    return false;
  }

  if (basePercent - nextPercent > 2) {
    return false;
  }

  const baseTotal = BigInt(baseValue.totalDigits);
  const nextTotal = BigInt(nextValue.totalDigits);
  const delta = nextTotal - baseTotal;
  const minimumDelta = Math.max(800_000, Number(baseTotal) * 0.000001);
  return Number(delta) >= minimumDelta;
}

export function isLikelyExperienceBaselineReplacement(
  base: string | null,
  next: string | null,
): boolean {
  if (!base || !next || hasSameExperienceValue(base, next)) {
    return false;
  }

  const baseValue = parseExperienceReading(base);
  const nextValue = parseExperienceReading(next);
  if (!baseValue?.total || !nextValue?.total) {
    return false;
  }

  const totalLengthDifference = Math.abs(
    nextValue.totalDigits.length - baseValue.totalDigits.length,
  );
  if (totalLengthDifference >= 3) {
    return true;
  }

  const basePercent = Number(baseValue.percent);
  const nextPercent = Number(nextValue.percent);
  if (!Number.isFinite(basePercent) || !Number.isFinite(nextPercent)) {
    return false;
  }

  return totalLengthDifference >= 2 && Math.abs(nextPercent - basePercent) >= 1;
}

export function isLikelyExperienceLevelReset(base: string | null, next: string | null): boolean {
  if (!base || !next || hasSameExperienceValue(base, next)) {
    return false;
  }

  const baseValue = parseExperienceReading(base);
  const nextValue = parseExperienceReading(next);
  if (!baseValue?.total || !nextValue?.total) {
    return false;
  }

  const basePercent = Number(baseValue.percent);
  const nextPercent = Number(nextValue.percent);
  if (!Number.isFinite(basePercent) || !Number.isFinite(nextPercent)) {
    return false;
  }

  const percentDrop = basePercent - nextPercent;
  if (basePercent >= 80 && nextPercent <= 25 && percentDrop >= 50) {
    return true;
  }

  const baseTotal = BigInt(baseValue.totalDigits);
  const nextTotal = BigInt(nextValue.totalDigits);
  return basePercent >= 60 && nextPercent <= 10 && percentDrop >= 35 && nextTotal < baseTotal;
}

export function compareExperienceTotals(left: string | null, right: string | null): -1 | 0 | 1 | null {
  if (!left || !right) {
    return null;
  }

  const leftValue = parseExperienceReading(left);
  const rightValue = parseExperienceReading(right);
  if (!leftValue?.total || !rightValue?.total) {
    return null;
  }

  if (!hasComparableExperienceTotalLength(leftValue.totalDigits, rightValue.totalDigits)) {
    return null;
  }

  const leftTotal = BigInt(leftValue.totalDigits);
  const rightTotal = BigInt(rightValue.totalDigits);
  if (leftTotal === rightTotal) {
    return 0;
  }

  return leftTotal < rightTotal ? -1 : 1;
}

export function hasComparableExperienceTotalLength(leftDigits: string, rightDigits: string): boolean {
  const lengthDifference = rightDigits.length - leftDigits.length;
  return lengthDifference >= 0 && lengthDifference <= 1;
}

export function isPlausibleExperienceProgress(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }

  const leftValue = parseExperienceReading(left);
  const rightValue = parseExperienceReading(right);
  if (!leftValue?.total || !rightValue?.total) {
    return false;
  }

  if (leftValue.totalDigits.length !== rightValue.totalDigits.length) {
    return false;
  }

  const leftTotal = BigInt(leftValue.totalDigits);
  const rightTotal = BigInt(rightValue.totalDigits);
  if (rightTotal <= leftTotal) {
    return false;
  }

  const leftPercent = Number(leftValue.percent);
  const rightPercent = Number(rightValue.percent);
  if (!Number.isFinite(leftPercent) || !Number.isFinite(rightPercent)) {
    return false;
  }

  if (rightPercent > leftPercent) {
    return true;
  }

  if (rightPercent < leftPercent) {
    return false;
  }

  if (leftValue.totalDigits.length < 11) {
    return false;
  }

  const delta = rightTotal - leftTotal;
  return delta * 1000n <= leftTotal;
}

export function chooseMoreCompleteExperienceText(current: string, next: string): string {
  const currentValue = parseExperienceReading(current);
  const nextValue = parseExperienceReading(next);
  if (!currentValue || !nextValue) {
    return current;
  }

  if (currentValue.total && !nextValue.total) {
    return current;
  }
  if (!currentValue.total && nextValue.total) {
    return next;
  }

  return nextValue.totalDigits.length > currentValue.totalDigits.length ? next : current;
}

function hasSharedExperienceTail(leftDigits: string, rightDigits: string): boolean {
  const tailLength = Math.min(
    EXPERIENCE_STABLE_TAIL_DIGITS,
    leftDigits.length,
    rightDigits.length,
  );
  if (tailLength < 6) {
    return false;
  }

  return leftDigits.slice(-tailLength) === rightDigits.slice(-tailLength);
}
