export type HuntExperienceReading = {
  label: string;
  percent: number;
  percentLabel: string;
  totalLabel: string;
};

const EXPERIENCE_READING_PATTERN = /^(.+)\s+\[(\d{1,3}\.\d{3})%\]$/;

export function parseHuntExperienceReading(
  text: string | null,
): HuntExperienceReading | null {
  if (!text) {
    return null;
  }

  const match = EXPERIENCE_READING_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const percent = Number(match[2]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null;
  }

  return {
    label: text,
    percent,
    percentLabel: `${match[2]}%`,
    totalLabel: match[1],
  };
}
