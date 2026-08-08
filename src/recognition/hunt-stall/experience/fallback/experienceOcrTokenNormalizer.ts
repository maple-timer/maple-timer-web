export type ExperienceToken = {
  text: string;
  confidence: number;
  x: number;
  width: number;
};

const MIN_COMPACT_PERCENT_DIGIT_CONFIDENCE = 0.68;
const COMPACT_PERCENT_DIGIT_TAIL_PENALTY = 0.34;
const COMPACT_PERCENT_WEAK_DIGIT_BEFORE_PERCENT_PENALTY = 0.16;
const EXPERIENCE_TOTAL_PATTERN = /^\d{1,3}(?:,\d{3})+$/;
const EXPERIENCE_PERCENT_PATTERN = /^\d{1,2}\.\d{3}$/;

export function normalizeExperienceTokens(tokens: ExperienceToken[]): string | null {
  const recognizedTokens = tokens.filter((token) => token.text);
  const percentCandidate =
    findExperiencePercentCandidate(recognizedTokens) ??
    findFallbackExperiencePercentCandidate(recognizedTokens);
  if (!percentCandidate) {
    return null;
  }

  const { decimalIndex, percentStartIndex, percentEndIndex } = percentCandidate;
  const totalTokens = recognizedTokens.slice(0, percentStartIndex);
  const total = normalizeExperienceTotalTokens(totalTokens);
  const percentTokens = recognizedTokens.slice(percentStartIndex, percentEndIndex + 1);
  const percentInteger =
    decimalIndex === null
      ? percentTokens
          .slice(0, -3)
          .map(getExperienceDigitText)
          .join("")
      : recognizedTokens
          .slice(percentStartIndex, decimalIndex)
          .map(getExperienceDigitText)
          .join("");
  const percentFraction =
    decimalIndex === null
      ? percentTokens
          .slice(-3)
          .map(getExperienceDigitText)
          .join("")
      : recognizedTokens
          .slice(decimalIndex + 1, percentEndIndex + 1)
          .map(getExperienceDigitText)
          .join("");
  const percent = `${percentInteger}.${percentFraction}`;

  if (!EXPERIENCE_PERCENT_PATTERN.test(percent)) {
    return null;
  }

  if (!total) {
    return hasExperienceTotalLikePrefix(totalTokens) ? `-- [${percent}%]` : null;
  }

  return `${total} [${percent}%]`;
}

function findExperiencePercentCandidate(
  tokens: ExperienceToken[],
): { decimalIndex: number | null; percentStartIndex: number; percentEndIndex: number } | null {
  for (let decimalIndex = tokens.length - 1; decimalIndex >= 0; decimalIndex -= 1) {
    if (tokens[decimalIndex].text !== "separator") {
      continue;
    }

    const percentEndIndex = findExperiencePercentFractionEndIndex(tokens, decimalIndex);
    if (percentEndIndex < 0) {
      continue;
    }

    const percentStartCandidates = findExperiencePercentStartCandidates(tokens, decimalIndex);
    for (const percentStartIndex of percentStartCandidates) {
      const totalTokens = tokens.slice(0, percentStartIndex);
      const total = normalizeExperienceTotalTokens(totalTokens);
      if (total) {
        return { decimalIndex, percentStartIndex, percentEndIndex };
      }
    }
  }

  return findExperiencePercentCandidateWithoutDecimal(tokens);
}

function findExperiencePercentFractionEndIndex(tokens: ExperienceToken[], decimalIndex: number): number {
  const fraction = tokens.slice(decimalIndex + 1, decimalIndex + 4);
  if (fraction.length !== 3 || !fraction.every(isExperienceDigitLikeToken)) {
    return -1;
  }

  for (let index = decimalIndex + 2; index <= decimalIndex + 3; index += 1) {
    if (hasLargeExperienceTokenGap(tokens[index - 1], tokens[index])) {
      return -1;
    }
  }

  return decimalIndex + 3;
}

function findExperiencePercentStartCandidates(tokens: ExperienceToken[], decimalIndex: number): number[] {
  const candidates: number[] = [];

  for (let digitCount = 1; digitCount <= 2; digitCount += 1) {
    const startIndex = decimalIndex - digitCount;
    if (startIndex < 0) {
      break;
    }

    const integerTokens = tokens.slice(startIndex, decimalIndex);
    if (!integerTokens.every(isExperienceDigitLikeToken)) {
      break;
    }

    let hasReadableSpacing = true;
    for (let index = startIndex + 1; index <= decimalIndex; index += 1) {
      if (hasLargeExperienceTokenGap(tokens[index - 1], tokens[index])) {
        hasReadableSpacing = false;
        break;
      }
    }

    if (hasReadableSpacing) {
      candidates.push(startIndex);
    }
  }

  return candidates;
}

function findExperiencePercentCandidateWithoutDecimal(
  tokens: ExperienceToken[],
): { decimalIndex: null; percentStartIndex: number; percentEndIndex: number } | null {
  const candidates: Array<{
    decimalIndex: null;
    percentStartIndex: number;
    percentEndIndex: number;
    score: number;
  }> = [];

  for (let percentEndIndex = tokens.length - 1; percentEndIndex >= 3; percentEndIndex -= 1) {
    if (!hasExperiencePercentTail(tokens, percentEndIndex)) {
      continue;
    }

    const fraction = tokens.slice(percentEndIndex - 2, percentEndIndex + 1);
    if (fraction.length !== 3 || !fraction.every(isExperienceDigitLikeToken)) {
      continue;
    }

    if (
      hasLargeExperiencePercentDigitGap(tokens[percentEndIndex - 2], tokens[percentEndIndex - 1]) ||
      hasLargeExperiencePercentDigitGap(tokens[percentEndIndex - 1], tokens[percentEndIndex])
    ) {
      continue;
    }

    const percentStartCandidates = findExperiencePercentStartCandidatesWithoutDecimal(
      tokens,
      percentEndIndex,
    );
    for (const percentStartIndex of percentStartCandidates) {
      const totalTokens = tokens.slice(0, percentStartIndex);
      const total = normalizeExperienceTotalTokens(totalTokens);
      if (total) {
        candidates.push({
          decimalIndex: null,
          percentStartIndex,
          percentEndIndex,
          score: scoreCompactPercentCandidate(tokens, percentStartIndex, percentEndIndex),
        });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function findFallbackExperiencePercentCandidate(
  tokens: ExperienceToken[],
): { decimalIndex: null; percentStartIndex: number; percentEndIndex: number } | null {
  const tailIndex = findFallbackExperiencePercentTailIndex(tokens);
  if (tailIndex < 0) {
    return null;
  }

  const digitIndexes: number[] = [];
  for (let index = tailIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (isExperienceDigitLikeToken(token)) {
      digitIndexes.unshift(index);
      continue;
    }
    if (token.text === "[" || token.text === "separator") {
      break;
    }
    if (digitIndexes.length > 0) {
      break;
    }
  }

  for (const digitCount of [5, 4]) {
    if (digitIndexes.length < digitCount) {
      continue;
    }

    const selected = digitIndexes.slice(-digitCount);
    const percentStartIndex = selected[0];
    const percentEndIndex = selected[selected.length - 1];
    const totalTokens = tokens.slice(0, percentStartIndex);
    if (hasExperienceTotalLikePrefix(totalTokens)) {
      return { decimalIndex: null, percentStartIndex, percentEndIndex };
    }
  }

  return null;
}

function findFallbackExperiencePercentTailIndex(tokens: ExperienceToken[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].text === "%" || tokens[index].text === "]") {
      return index;
    }
  }

  return -1;
}

function hasExperiencePercentTail(tokens: ExperienceToken[], percentEndIndex: number): boolean {
  const tail = tokens.slice(percentEndIndex + 1);
  if (tail.length === 0) {
    return false;
  }

  return tail.some((token, index) => {
    if (token.text !== "%" && token.text !== "]") {
      return false;
    }

    const previous = index === 0 ? tokens[percentEndIndex] : tail[index - 1];
    return !hasLargeExperienceTokenGap(previous, token);
  });
}

function findExperiencePercentStartCandidatesWithoutDecimal(
  tokens: ExperienceToken[],
  percentEndIndex: number,
): number[] {
  const candidates: number[] = [];
  const integerEndIndex = percentEndIndex - 3;

  for (let digitCount = 2; digitCount >= 1; digitCount -= 1) {
    const startIndex = integerEndIndex - digitCount + 1;
    if (startIndex < 0) {
      continue;
    }

    const integerTokens = tokens.slice(startIndex, integerEndIndex + 1);
    if (!integerTokens.every(isExperienceDigitLikeToken)) {
      continue;
    }

    let hasReadableSpacing = true;
    for (let index = startIndex + 1; index <= percentEndIndex; index += 1) {
      if (hasLargeExperiencePercentDigitGap(tokens[index - 1], tokens[index])) {
        hasReadableSpacing = false;
        break;
      }
    }

    if (hasReadableSpacing) {
      candidates.push(startIndex);
    }
  }

  return candidates;
}

function scoreCompactPercentCandidate(
  tokens: ExperienceToken[],
  percentStartIndex: number,
  percentEndIndex: number,
): number {
  const percentTokens = tokens.slice(percentStartIndex, percentEndIndex + 1);
  const confidenceScore =
    percentTokens.reduce((total, token) => total + token.confidence, 0) /
    Math.max(1, percentTokens.length);
  const explicitPercentTail = hasExplicitPercentTail(tokens, percentEndIndex);
  const lengthScore = Math.min(0.08, percentTokens.length * 0.012);
  const symbolScore = explicitPercentTail ? 0.06 : 0.03;
  const weakLastDigitPenalty =
    !explicitPercentTail &&
    percentTokens[percentTokens.length - 1]?.confidence < MIN_COMPACT_PERCENT_DIGIT_CONFIDENCE
      ? (MIN_COMPACT_PERCENT_DIGIT_CONFIDENCE - percentTokens[percentTokens.length - 1].confidence) *
        0.8
      : 0;

  return (
    confidenceScore +
    lengthScore +
    symbolScore -
    weakLastDigitPenalty -
    getCompactPercentTailPenalty(tokens, percentEndIndex)
  );
}

function hasExplicitPercentTail(tokens: ExperienceToken[], percentEndIndex: number): boolean {
  for (let index = percentEndIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].text === "%") {
      return true;
    }
    if (tokens[index].text === "]") {
      return false;
    }
  }

  return false;
}

function getCompactPercentTailPenalty(tokens: ExperienceToken[], percentEndIndex: number): number {
  let penalty = 0;

  for (let index = percentEndIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.text === "%" || token.text === "]") {
      break;
    }
    if (!isExperienceDigitLikeToken(token)) {
      continue;
    }

    const nextSymbol = findNextPercentTailSymbol(tokens, index);
    if (token.confidence >= MIN_COMPACT_PERCENT_DIGIT_CONFIDENCE) {
      penalty += COMPACT_PERCENT_DIGIT_TAIL_PENALTY * token.confidence;
      continue;
    }

    penalty += nextSymbol === "%" ? COMPACT_PERCENT_WEAK_DIGIT_BEFORE_PERCENT_PENALTY : 0.02;
  }

  return penalty;
}

function findNextPercentTailSymbol(tokens: ExperienceToken[], startIndex: number): string | null {
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].text === "%" || tokens[index].text === "]") {
      return tokens[index].text;
    }
  }

  return null;
}

function hasLargeExperienceTokenGap(left: ExperienceToken, right: ExperienceToken): boolean {
  const gap = right.x - (left.x + left.width);
  return gap > Math.max(4, left.width * 1.35, right.width * 1.35);
}

function hasLargeExperiencePercentDigitGap(left: ExperienceToken, right: ExperienceToken): boolean {
  const gap = right.x - (left.x + left.width);
  return gap > Math.max(10, left.width * 3.5, right.width * 3.5);
}

function normalizeExperienceTotalTokens(tokens: ExperienceToken[]): string | null {
  const text = tokens
    .map((token) => {
      const digit = getExperienceDigitText(token);
      if (digit) {
        return digit;
      }
      if (token.text === "separator") {
        return ",";
      }
      return "";
    })
    .join("")
    .replace(/,+$/g, "");

  return EXPERIENCE_TOTAL_PATTERN.test(text) ? text : null;
}

function hasExperienceTotalLikePrefix(tokens: ExperienceToken[]): boolean {
  const digitCount = tokens.filter(isExperienceDigitLikeToken).length;
  const separatorCount = tokens.filter((token) => token.text === "separator").length;
  return digitCount >= 5 && separatorCount >= 1;
}

function isExperienceDigitLikeToken(token: ExperienceToken): boolean {
  return Boolean(getExperienceDigitText(token));
}

function getExperienceDigitText(token: ExperienceToken): string {
  if (/^\d$/.test(token.text)) {
    return token.text;
  }

  return token.text === "]" ? "1" : "";
}
