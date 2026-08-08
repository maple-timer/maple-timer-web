export type ExperienceOcrV2Reading = {
  numberDigits: string;
  percentDigits: string;
};

export type ExperienceOcrV2Candidate = {
  reading: ExperienceOcrV2Reading;
  sequence: string;
  score: number;
  weight: number;
  source: string;
  mask: Uint8Array;
  width: number;
  height: number;
};

export function formatExperienceOcrV2Reading(reading: ExperienceOcrV2Reading): string {
  return `${addCommas(reading.numberDigits)} [${formatPercent(reading.percentDigits)}%]`;
}

export function isValidExperienceOcrV2Reading(reading: ExperienceOcrV2Reading): boolean {
  return (
    reading.numberDigits.length > 0 &&
    reading.percentDigits.length >= 4 &&
    reading.percentDigits.length <= 6 &&
    Number(reading.percentDigits) <= 100000
  );
}

export function scoreToExperienceOcrV2Confidence(score: number): number {
  return Math.max(0, Math.min(1, 1 - (score + 0.08) / 0.5));
}

export function isExperienceOcrV2BoundarySkipSource(source: string): boolean {
  return source.startsWith("font_boundary_skip:");
}

export function isExperienceOcrV2ParserBoundaryAlternative(
  bestNormal: ExperienceOcrV2Candidate,
  candidate: ExperienceOcrV2Candidate,
): boolean {
  if (!isExperienceOcrV2BoundarySkipSource(candidate.source)) {
    return false;
  }
  const bestPercentLength = bestNormal.reading.percentDigits.length;
  const candidatePercentLength = candidate.reading.percentDigits.length;
  const trimmedNumberDigits = bestNormal.reading.numberDigits.length - candidate.reading.numberDigits.length;
  return (
    bestPercentLength <= 4 &&
    candidatePercentLength >= 5 &&
    candidatePercentLength <= 6 &&
    trimmedNumberDigits >= 1 &&
    trimmedNumberDigits <= 4 &&
    candidate.reading.numberDigits.length >= 8 &&
    candidate.score <= bestNormal.score + 0.08
  );
}

export function dedupeExperienceOcrV2Candidates(
  candidates: ExperienceOcrV2Candidate[],
): ExperienceOcrV2Candidate[] {
  const output: ExperienceOcrV2Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.sort((left, right) => left.score - right.score || right.weight - left.weight)) {
    const key = `${candidate.reading.numberDigits}|${candidate.reading.percentDigits}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

export function rankExperienceOcrV2Candidates(
  candidates: ExperienceOcrV2Candidate[],
  limit: number,
): ExperienceOcrV2Candidate[] {
  const valid = candidates.filter(
    (candidate) => isValidExperienceOcrV2Reading(candidate.reading) && !isRepetitive(candidate.reading.numberDigits),
  );
  valid.push(...consensusCandidates(valid));

  for (const candidate of valid) {
    let support = 0;
    for (const other of valid) {
      if (
        other === candidate ||
        other.reading.numberDigits.length !== candidate.reading.numberDigits.length ||
        other.reading.percentDigits.length !== candidate.reading.percentDigits.length
      ) {
        continue;
      }
      const distance =
        hammingDistance(other.reading.numberDigits, candidate.reading.numberDigits) +
        hammingDistance(other.reading.percentDigits, candidate.reading.percentDigits);
      support += other.weight * Math.max(0, 1 - distance / 4);
    }
    candidate.score -= Math.min(0.18, support * 0.025);
  }

  const bestNonRepaintByNumber = new Map<string, ExperienceOcrV2Candidate>();
  for (const candidate of valid) {
    if (candidate.source.includes("repaint:") || candidate.source.startsWith("consensus:")) {
      continue;
    }
    const current = bestNonRepaintByNumber.get(candidate.reading.numberDigits);
    if (!current || candidate.score < current.score) {
      bestNonRepaintByNumber.set(candidate.reading.numberDigits, candidate);
    }
  }

  for (const candidate of valid) {
    if (!candidate.source.includes("repaint:")) {
      continue;
    }
    const original = bestNonRepaintByNumber.get(candidate.reading.numberDigits);
    if (original && original.reading.percentDigits !== candidate.reading.percentDigits) {
      candidate.score += 0.18;
    }
  }

  return valid.sort((left, right) => left.score - right.score || right.weight - left.weight).slice(0, limit);
}

function addCommas(rawDigits: string): string {
  const parts: string[] = [];
  let digits = rawDigits;
  while (digits.length > 0) {
    parts.unshift(digits.slice(-3));
    digits = digits.slice(0, -3);
  }
  return parts.join(",");
}

function formatPercent(rawDigits: string): string {
  const digits = rawDigits.padStart(4, "0");
  return `${digits.slice(0, -3) || "0"}.${digits.slice(-3)}`;
}

function consensusCandidates(candidates: ExperienceOcrV2Candidate[]): ExperienceOcrV2Candidate[] {
  const grouped = new Map<string, ExperienceOcrV2Candidate[]>();
  for (const candidate of candidates) {
    if (!isValidExperienceOcrV2Reading(candidate.reading) || isRepetitive(candidate.reading.numberDigits)) {
      continue;
    }
    const key = `${candidate.reading.numberDigits.length}:${candidate.reading.percentDigits.length}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  const output: ExperienceOcrV2Candidate[] = [];
  for (const group of grouped.values()) {
    if (group.some((candidate) => candidate.source.includes("repaint:"))) {
      continue;
    }
    const support = group.reduce((total, candidate) => total + candidate.weight, 0);
    if (support < 1.6) {
      continue;
    }
    const numberLength = group[0].reading.numberDigits.length;
    const percentLength = group[0].reading.percentDigits.length;
    let entropy = 0;
    let numberDigits = "";
    let percentDigits = "";
    for (let index = 0; index < numberLength; index += 1) {
      const vote = weightedVote(group, (candidate) => candidate.reading.numberDigits[index]);
      numberDigits += vote.value;
      entropy += Math.max(0, support - vote.weight) / support;
    }
    for (let index = 0; index < percentLength; index += 1) {
      const vote = weightedVote(group, (candidate) => candidate.reading.percentDigits[index]);
      percentDigits += vote.value;
      entropy += Math.max(0, support - vote.weight) / support;
    }
    const reading = { numberDigits, percentDigits };
    if (!isValidExperienceOcrV2Reading(reading)) {
      continue;
    }
    output.push({
      reading,
      sequence: "consensus",
      score: 0.04 + entropy / Math.max(1, numberLength + percentLength) - Math.min(0.08, support * 0.01),
      weight: support + 0.5,
      source: `consensus:${group.length}`,
      mask: group[0].mask,
      width: group[0].width,
      height: group[0].height,
    });
  }
  return output;
}

function isRepetitive(digits: string): boolean {
  if (digits.length <= 6) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const char of digits) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / digits.length > 0.72;
}

function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) {
    return Math.max(left.length, right.length);
  }
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }
  return distance;
}

function weightedVote<T>(
  items: ExperienceOcrV2Candidate[],
  select: (item: ExperienceOcrV2Candidate) => T,
): { value: T; weight: number } {
  const votes = new Map<T, number>();
  for (const item of items) {
    const value = select(item);
    votes.set(value, (votes.get(value) ?? 0) + item.weight);
  }
  let best = Array.from(votes)[0];
  for (const entry of votes) {
    if (entry[1] > best[1]) {
      best = entry;
    }
  }
  return { value: best[0], weight: best[1] };
}
