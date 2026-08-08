// @ts-nocheck
// Browser-side ensemble and streaming correction.
//
// Input:
//   - sample metadata from the runtime manifest
//   - OCR rows from browser_ocr_eval.js for paddle_en, paddle_unified, template_js
//
// Output:
//   - one stream row per sample with stream_value and diagnostic notes
//
// The algorithm is intentionally deterministic.  It combines OCR candidates,
// uses the EXP bar only as a soft prior, estimates the cycle's total EXP from
// no_bar frames, and applies conservative suffix/history repairs.

const SELECTED_WEIGHTS = {
  paddle_english: { no_bar: 105, partial_bar: 92, full_bar: 72 },
  paddle_en: { no_bar: 105, partial_bar: 92, full_bar: 72 },
  paddle_unified: { no_bar: 88, partial_bar: 58, full_bar: 86 },
  template_js: { no_bar: 72, partial_bar: 48, full_bar: 42 },
};

const ATTEMPT_MULTIPLIER = {
  paddle_english: 0.24,
  paddle_en: 0.24,
  paddle_unified: 0.22,
  template_js: 0.18,
};

const CATEGORY_BAR_MULTIPLIER = {
  no_bar: 0.35,
  partial_bar: 1.0,
  full_bar: 1.6,
};

const DEFAULT_OPTIONS = {
  // Candidate ensemble weights.
  ensembleBarWeight: 2.0,
  streamBarWeight: 0.5,
  ocrConsistentBonus: 2.0,

  // If raw OCR percent is supported by the visible bar, do not let suffix
  // repair override it unless the alternative is very strong.
  rawPercentBarTolerance: 3.0,
  rawPercentSuffixPenalty: 800.0,
  rawPercentKeepBonus: 1.0,
  rawPercentKeepMaxConsistency: 450.0,

  // Streaming memory.  delaySeconds remains 0 for the current real-time path;
  // practical evaluation separately allows next/next-next frame recovery.
  recentHistorySize: 4,
  minTotalSamples: 2,
  delaySeconds: 0,

  // Optional Maple EXP-table prior.  It is present for experiments but is not
  // required for the current browser-only benchmark result.
  expTable: [],
  expTableMinTotal: 200000000,
  expTableMaxSnapRelativeError: 0.0045,
  expTableMaxOriginalPercentDiff: 0.15,
  expTableMaxBarDiff: 0.75,
  expTableBarWeight: 3.0,
  expTableMinBarGain: 0.60,
};

const VALUE_RE = /^([\d,]+)\s+\[(\d{1,3})\.(\d{3})%\]$/;
const WEAK_SOURCE_TOKENS = ['font_beam:', 'font_slot', 'bar_repaint:inpaint'];

function parseValue(value) {
  const match = VALUE_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  const number = Number.parseInt(match[1].replace(/\D/g, ''), 10);
  const milliPercent = Number.parseInt(`${match[2]}${match[3]}`, 10);
  if (!Number.isFinite(number) || !Number.isFinite(milliPercent)) return null;
  return { number, milliPercent, value: formatValue(number, milliPercent) };
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null;
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : null;
}

function parseMilliPercent(raw) {
  if (raw == null || raw === '') return null;
  const value = Math.round(Number.parseFloat(String(raw)) * 1000);
  return Number.isFinite(value) ? value : null;
}

function formatPercent(milliPercent) {
  const whole = Math.floor(milliPercent / 1000);
  const frac = String(Math.abs(milliPercent % 1000)).padStart(3, '0');
  return `${whole}.${frac}`;
}

function formatValue(number, milliPercent) {
  return `${Math.round(number).toLocaleString('en-US')} [${formatPercent(Math.round(milliPercent))}%]`;
}

function candidateFromValue(value) {
  const parsed = parseValue(value);
  if (!parsed || parsed.number <= 0 || parsed.milliPercent < 0 || parsed.milliPercent > 200000) return null;
  return {
    number: parsed.number,
    milliPercent: parsed.milliPercent,
    value: parsed.value,
    score: 0,
    engines: new Set(),
    selectedEngines: new Set(),
    attemptCount: 0,
    rawNotes: [],
  };
}

function parseJsonList(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function truthy(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}

function attemptValue(attempt) {
  return String(attempt.parsed_value || attempt.parsedValue || attempt.value || '');
}

function attemptParsed(attempt) {
  if ('parsed_ok' in attempt) return truthy(attempt.parsed_ok);
  if ('parsedOk' in attempt) return truthy(attempt.parsedOk);
  return Boolean(attemptValue(attempt));
}

function engineCategoryWeight(engine, category) {
  return SELECTED_WEIGHTS[engine]?.[category] ?? 0;
}

function percentFloat(milliPercent) {
  return milliPercent / 1000;
}

function circularPercentDiff(left, right) {
  const diff = Math.abs((left % 100) - (right % 100));
  return Math.min(diff, 100 - diff);
}

function parseFloatOrNull(raw) {
  const value = Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(value) ? value : null;
}

function barPercentScore(milliPercent, sample, category, barWeight) {
  // EXP bar measurement is useful but not authoritative.  Bar animation can
  // lag the printed text after large EXP gains, so this returns a bounded score
  // instead of directly replacing OCR percent.
  const barConfidence = parseFloatOrNull(sample?.bar_confidence);
  if (barConfidence == null || barConfidence < 0.60 || barWeight <= 0) return { score: 0, note: '' };
  const barPercent = parseFloatOrNull(sample?.bar_percent);
  const lowerBound = parseFloatOrNull(sample?.bar_lower_bound);
  const upperBound = parseFloatOrNull(sample?.bar_upper_bound);
  const printedPercent = percentFloat(milliPercent);
  const categoryWeight = CATEGORY_BAR_MULTIPLIER[category] ?? 1.0;
  const strength = barWeight * categoryWeight * Math.max(0.2, Math.min(1.0, barConfidence));

  if (barPercent == null) {
    const tolerance = 2.5 + (1.0 - Math.max(0.2, Math.min(1.0, barConfidence))) * 2.0;
    if (lowerBound != null) {
      const violation = Math.max(0, lowerBound - printedPercent - tolerance);
      const score = violation === 0 ? 2.0 * strength : -Math.min(18.0, violation * 2.1 * strength);
      return { score, note: `bar_lower=${lowerBound.toFixed(3)};bar_score=${score.toFixed(2)}` };
    }
    if (upperBound != null) {
      const violation = Math.max(0, printedPercent - upperBound - tolerance);
      const score = violation === 0 ? 2.0 * strength : -Math.min(18.0, violation * 2.1 * strength);
      return { score, note: `bar_upper=${upperBound.toFixed(3)};bar_score=${score.toFixed(2)}` };
    }
    return { score: 0, note: '' };
  }

  const diff = circularPercentDiff(printedPercent, barPercent);
  let score;
  if (diff <= 0.35) score = 18.0 * strength;
  else if (diff <= 0.80) score = 10.0 * strength;
  else if (diff <= 1.50) score = 3.0 * strength;
  else score = -Math.min(diff, 8.0) * 1.75 * strength;
  return { score, note: `bar_diff=${diff.toFixed(3)};bar_score=${score.toFixed(2)}` };
}

function addCandidate(candidates, engine, value, selected, rawNote, category) {
  const parsed = candidateFromValue(value);
  if (!parsed) return;
  const key = `${parsed.number}|${parsed.milliPercent}`;
  let candidate = candidates.get(key);
  if (!candidate) {
    candidate = parsed;
    candidates.set(key, candidate);
  }
  candidate.engines.add(engine);
  candidate.rawNotes.push(rawNote);
  if (selected) {
    candidate.score += engineCategoryWeight(engine, category);
    candidate.selectedEngines.add(engine);
  } else {
    candidate.score += engineCategoryWeight(engine, category) * (ATTEMPT_MULTIPLIER[engine] ?? 0.12);
    candidate.attemptCount += 1;
  }
}

function collectCandidates(sample, engineRowsByName) {
  // Merge the selected prediction and all alternate attempts from every engine.
  // Later stages can recover a correct value even when no single engine chose
  // it as its top result.
  const candidates = new Map();
  const category = sample.category || 'unknown';
  for (const [engine, byId] of Object.entries(engineRowsByName)) {
    const row = byId.get(sample.id);
    if (!row) continue;
    addCandidate(candidates, engine, row.predicted_value || row.predictedValue || '', true, `${engine}:selected`, category);

    for (const [index, item] of parseJsonList(row.candidate_json || row.candidateJson).entries()) {
      addCandidate(candidates, engine, item.value || '', false, `${engine}:${item.source || `candidate_${index}`}`, category);
    }
    for (const attempt of parseJsonList(row.attempt_json || row.attemptJson)) {
      if (!attemptParsed(attempt)) continue;
      addCandidate(candidates, engine, attemptValue(attempt), false, `${engine}:${attempt.variant || 'attempt'}`, category);
    }
    for (const attempt of parseJsonList(row.attempts_json || row.attemptsJson)) {
      if (!attemptParsed(attempt)) continue;
      addCandidate(candidates, engine, attemptValue(attempt), false, `${engine}:${attempt.variant || 'attempt'}`, category);
    }
  }
  return candidates;
}

function expectedNumberLength(candidates) {
  const counts = new Map();
  for (const candidate of candidates.values()) {
    const support = candidate.selectedEngines.size * 3 + candidate.engines.size;
    if (!support) continue;
    const length = String(Math.round(candidate.number)).length;
    counts.set(length, (counts.get(length) ?? 0) + support);
  }
  let best = null;
  for (const [length, count] of counts.entries()) {
    if (!best || count > best.count) best = { length, count };
  }
  return best?.length ?? null;
}

function chooseOneFrameCandidate(sample, engineRowsByName, options) {
  // First-pass candidate choice for a single crop.  This has no temporal state:
  // it only uses engine support, candidate repetition, number-length agreement,
  // and a soft bar-percent prior.
  const candidates = collectCandidates(sample, engineRowsByName);
  if (!candidates.size) return { selected: null, ranked: [], status: 'no_candidates' };
  const lengthMode = expectedNumberLength(candidates);
  const category = sample.category || 'unknown';
  const barPercent = parseFloatOrNull(sample.bar_percent);

  for (const candidate of candidates.values()) {
    candidate.score += 13.0 * Math.max(0, candidate.engines.size - 1);
    candidate.score += 3.0 * Math.min(candidate.attemptCount, 6);
    if (lengthMode != null) candidate.score -= 18.0 * Math.abs(String(Math.round(candidate.number)).length - lengthMode);
    const bar = barPercentScore(candidate.milliPercent, sample, category, options.ensembleBarWeight);
    candidate.score += bar.score;
    if (bar.note) candidate.rawNotes.push(bar.note);
  }

  const ranked = [...candidates.values()].sort((a, b) => {
    const barDeltaA = Math.abs(percentFloat(a.milliPercent) - (barPercent ?? percentFloat(a.milliPercent)));
    const barDeltaB = Math.abs(percentFloat(b.milliPercent) - (barPercent ?? percentFloat(b.milliPercent)));
    return (
      b.score - a.score ||
      b.selectedEngines.size - a.selectedEngines.size ||
      b.engines.size - a.engines.size ||
      barDeltaA - barDeltaB
    );
  });
  return { selected: ranked[0], ranked, status: 'ok' };
}

function streamCandidateJson(ranked) {
  if (!ranked.length) return '[]';
  const bestScore = Math.max(...ranked.map((candidate) => candidate.score));
  const seen = new Set();
  const items = [];
  for (const [index, candidate] of ranked.slice(0, 40).entries()) {
    const key = `${candidate.number}|${candidate.milliPercent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = Math.max(0.01, Math.min(6.0, 0.02 + (bestScore - candidate.score) / 85.0 + index * 0.015));
    items.push({
      number_digits: String(Math.round(candidate.number)),
      percent_digits: String(Math.round(candidate.milliPercent)),
      score: Math.round(cost * 10000) / 10000,
      source: `browser_ensemble:${[...candidate.engines].sort().join(',')}`,
      value: candidate.value,
    });
  }
  return JSON.stringify(items);
}

function buildStreamInputRows(samples, engineRowsByName, options) {
  return [...samples]
    .sort((a, b) => Number(a.frame_index || 0) - Number(b.frame_index || 0))
    .map((sample) => {
      const { selected, ranked, status } = chooseOneFrameCandidate(sample, engineRowsByName, options);
      return {
        id: sample.id,
        frame_index: sample.frame_index || '',
        timestamp: sample.timestamp || '',
        cycle: sample.cycle || 'cycle_1',
        category: sample.category || '',
        number_digits: selected ? String(Math.round(selected.number)) : '',
        percent: selected ? formatPercent(Math.round(selected.milliPercent)) : '',
        sequence: selected?.value || '',
        temporal_flags: status === 'ok' ? '' : status,
        candidate_json: streamCandidateJson(ranked),
        bar_percent: sample.bar_percent || '',
        bar_confidence: sample.bar_confidence || '',
        bar_fill_x1: sample.bar_fill_x1 || '',
        bar_y: sample.bar_y || '',
        bar_bound_mode: sample.bar_bound_mode || '',
        bar_lower_bound: sample.bar_lower_bound || '',
        bar_upper_bound: sample.bar_upper_bound || '',
        one_frame_value: selected?.value || '',
        one_frame_score: selected ? selected.score.toFixed(3) : '',
      };
    });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function expectedMilli(number, total) {
  return (number / total) * 100000.0;
}

function numberCenter(total, milliPercent) {
  return (total * milliPercent) / 100000.0;
}

function percentDigits(rawPercent) {
  const text = String(rawPercent ?? '').trim();
  if (!text) return '';
  const [wholeRaw, fracRaw = ''] = text.split('.');
  const whole = String(Number.parseInt(wholeRaw || '0', 10));
  const frac = `${fracRaw}000`.slice(0, 3);
  return `${whole}${frac}`;
}

function isWeakSource(source) {
  return WEAK_SOURCE_TOKENS.some((token) => String(source || '').includes(token));
}

function ocrCandidateItems(row) {
  const seen = new Set();
  const out = [];
  for (const [idx, item] of parseJsonList(row.candidate_json).entries()) {
    const number = parseNumber(item.number_digits);
    const milli = parseNumber(item.percent_digits);
    const score = Number.parseFloat(String(item.score ?? '0.25'));
    if (number == null || milli == null || !Number.isFinite(score) || number <= 0 || milli < 0 || milli > 100000) continue;
    const key = `${number}|${milli}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ number, milliPercent: milli, score, idx, source: String(item.source || '') });
  }
  return out;
}

function suffixPercentCandidates(rawDigits, targets) {
  // Generate possible percent values when OCR saw only a reliable suffix.  For
  // example, if the crop confidently contains "...636" and history/bar says the
  // value is near 84%, this can produce 84.636.
  const candidates = new Set();
  if (!rawDigits) return candidates;
  const rawMilli = Number.parseInt(rawDigits, 10);
  if (Number.isFinite(rawMilli) && rawMilli >= 0 && rawMilli <= 100000) candidates.add(rawMilli);
  const usefulTargets = targets.filter((target) => target >= 0 && target <= 100000);
  if (Number.isFinite(rawMilli)) usefulTargets.push(rawMilli);
  const maxLen = Math.min(5, rawDigits.length);
  for (let suffixLen = maxLen; suffixLen >= 2; suffixLen -= 1) {
    const suffix = Number.parseInt(rawDigits.slice(-suffixLen), 10);
    const step = 10 ** suffixLen;
    for (let milli = suffix; milli <= 100000; milli += step) {
      if (!usefulTargets.length) {
        candidates.add(milli);
        continue;
      }
      const distance = Math.min(...usefulTargets.map((target) => Math.abs(milli - target)));
      if (suffixLen >= 4 && distance <= 1800) candidates.add(milli);
      else if (suffixLen === 3 && distance <= 1100) candidates.add(milli);
      else if (suffixLen === 2 && distance <= 350) candidates.add(milli);
    }
  }
  return candidates;
}

function numberCandidatesFromSuffix(numberDigits, center, total) {
  // Full-bar crops frequently hide leading number digits while preserving the
  // tail.  Rebuild plausible full numbers by aligning the visible suffix around
  // the expected number center implied by total EXP and percent.
  const text = String(numberDigits || '');
  if (!text) return [];
  const tolerance = Math.max(240000.0, total * 0.00011);
  const candidates = new Map();
  const maxSuffix = Math.min(10, text.length);
  for (let suffixLen = maxSuffix; suffixLen > 2; suffixLen -= 1) {
    const suffix = Number.parseInt(text.slice(-suffixLen), 10);
    const modulo = 10 ** suffixLen;
    const nearest = Math.round((center - suffix) / modulo);
    for (let offset = -3; offset <= 3; offset += 1) {
      const multiplier = nearest + offset;
      if (multiplier < 0) continue;
      const candidate = suffix + multiplier * modulo;
      if (candidate <= 0 || candidate > total * 1.08) continue;
      const distance = Math.abs(candidate - center);
      if (distance > tolerance) continue;
      const current = candidates.get(candidate);
      if (!current || suffixLen > current.suffixLen || distance < current.distance) {
        candidates.set(candidate, { number: candidate, suffixLen, distance });
      }
    }
  }
  return [...candidates.values()];
}

function pairKey(pair) {
  return `${pair.number}|${pair.milliPercent}`;
}

function pairCandidates(row, total, previousMilli, options) {
  // Build candidate number/percent pairs that are internally consistent with
  // the current cycle's total EXP.  Sources include direct OCR candidates,
  // percent suffix repair, and number suffix repair.
  const rawNumber = parseNumber(row.number_digits);
  const rawMilli = parseMilliPercent(row.percent);
  const rawDigits = percentDigits(row.percent);
  const ocrItems = ocrCandidateItems(row);
  const category = row.category || '';
  const stableItems = ocrItems.filter((item) => !isWeakSource(item.source));

  if (rawNumber != null && rawMilli != null && rawNumber > 0 && rawNumber <= total * 1.03) {
    const rawConsistency = Math.abs(expectedMilli(rawNumber, total) - rawMilli);
    if (rawConsistency <= 45) {
      return [{ number: rawNumber, milliPercent: rawMilli, notes: [], score: -1000.0 }];
    }
  }

  const targets = [];
  if (rawNumber != null && rawNumber > 0 && rawNumber <= total * 1.08) targets.push(expectedMilli(rawNumber, total));
  for (const item of stableItems.slice(0, 8)) {
    if (item.number > 0 && item.number <= total * 1.08) targets.push(expectedMilli(item.number, total));
    targets.push(item.milliPercent);
  }
  if (previousMilli != null) {
    targets.push(previousMilli);
    targets.push(previousMilli + 450);
  }
  if (rawMilli != null) targets.push(rawMilli);

  const percentCandidates = suffixPercentCandidates(rawDigits, targets);
  if (rawMilli != null && rawMilli >= 0 && rawMilli <= 100000) percentCandidates.add(rawMilli);
  const rawTarget = rawNumber != null && rawNumber > 0 && rawNumber <= total * 1.03 ? expectedMilli(rawNumber, total) : null;
  const rawNumberKeepable = rawTarget != null && [...percentCandidates].some((milli) => Math.abs(milli - rawTarget) <= 1200);

  const pairs = [];
  for (const item of ocrItems) {
    if (item.number <= 0 || item.number > total * 1.10) continue;
    const consistency = Math.abs(expectedMilli(item.number, total) - item.milliPercent);
    let score = consistency * 0.06 + item.score * 5.0 + item.idx * 0.08;
    const notes = [];
    if (rawNumber != null && item.number !== rawNumber) {
      notes.push(`ocr_candidate${item.idx + 1}_number`);
      score += ['partial_bar', 'full_bar'].includes(category) ? 0.65 : 2.5;
    }
    if (rawMilli != null && item.milliPercent !== rawMilli) {
      notes.push(`ocr_candidate${item.idx + 1}_percent`);
      score += ['partial_bar', 'full_bar'].includes(category) ? 0.35 : 2.5;
    }
    if (item.source.includes('font_beam:') || item.source.includes('font_slot')) {
      notes.push(item.source.includes('font_slot') ? 'slot_substitution' : 'glyph_beam');
      score += 12.0;
    } else if (item.source.includes('bar_repaint:inpaint')) {
      notes.push('inpaint_recovery');
    }
    if (consistency <= 90) score -= 1.0;
    if (
      options.ocrConsistentBonus > 0 &&
      ['partial_bar', 'full_bar'].includes(category) &&
      consistency <= 30 &&
      item.idx <= 8 &&
      !isWeakSource(item.source)
    ) {
      score -= options.ocrConsistentBonus;
    }
    pairs.push({ number: item.number, milliPercent: item.milliPercent, notes, score });
  }

  for (const milli of [...percentCandidates].sort((a, b) => a - b)) {
    const center = numberCenter(total, milli);
    const numberOptions = [];
    if (rawNumber != null) {
      numberOptions.push({ number: rawNumber, suffixLen: String(row.number_digits || '').length, distance: Math.abs(rawNumber - center) });
      numberOptions.push(...numberCandidatesFromSuffix(row.number_digits, center, total));
    }
    for (const option of numberOptions) {
      const consistency = Math.abs(expectedMilli(option.number, total) - milli);
      if (consistency > 2200 && option.distance > total * 0.018) continue;
      const notes = [];
      if (rawNumber != null && option.number !== rawNumber) notes.push(`number_suffix${option.suffixLen}`);
      if (rawMilli != null && milli !== rawMilli) notes.push('percent_suffix');
      let score = consistency * 0.08 + (option.distance / Math.max(total, 1.0)) * 8000.0;
      if (rawNumber != null && option.number !== rawNumber) {
        score += rawNumberKeepable && ['partial_bar', 'full_bar'].includes(category) ? 7.0 : (['partial_bar', 'full_bar'].includes(category) ? 1.8 : 5.0);
        score -= Math.min(0.6, option.suffixLen * 0.05);
      }
      if (rawMilli != null && milli !== rawMilli) score += ['partial_bar', 'full_bar'].includes(category) ? 0.20 : 4.0;
      if (rawNumber != null && option.number === rawNumber) score -= 0.25;
      if (rawMilli != null && milli === rawMilli) score -= 0.25;
      pairs.push({ number: option.number, milliPercent: milli, notes, score });
    }
  }
  return pairs;
}

function barPenalty(candidatePercent, estimate, weight) {
  if (!estimate || estimate.confidence < 0.10) return 0.0;
  const delta = Math.abs(candidatePercent - estimate.percent);
  const tolerance = 5.5 + (1.0 - estimate.confidence) * 6.0;
  let penalty = Math.max(0.0, delta - tolerance) * 0.018 * estimate.confidence * weight;
  if (delta > 25.0) penalty += Math.min(0.55, (delta - 25.0) * 0.018 * estimate.confidence * weight);
  return penalty;
}

function parseBarEstimate(row) {
  const percent = parseFloatOrNull(row.bar_percent);
  const confidence = parseFloatOrNull(row.bar_confidence);
  if (percent == null || confidence == null || percent < 0 || percent > 100 || confidence <= 0) return null;
  return { percent, confidence };
}

class StreamingState {
  constructor(options) {
    this.options = options;
    this.totalSamples = [];
    this.previousOutput = null;
    this.recentOutputs = [];
    this.percentNumberVotes = new Map();
    this.numberPercentVotes = new Map();
  }

  totalEstimate() {
    // Total EXP is inferred from no_bar frames:
    //   total ~= current_exp * 100000 / milli_percent
    // Median + light outlier trimming avoids a single bad OCR frame poisoning
    // the whole cycle.
    if (this.totalSamples.length < this.options.minTotalSamples) return null;
    let values = [...this.totalSamples];
    for (let index = 0; index < 3; index += 1) {
      const med = median(values);
      const narrowed = values.filter((value) => Math.abs(value / med - 1.0) <= 0.015);
      if (narrowed.length < this.options.minTotalSamples || narrowed.length === values.length) break;
      values = narrowed;
    }
    return median(values);
  }

  observe(row) {
    // Only no_bar frames are trusted enough to update total EXP.  Bar-covered
    // frames are corrected by the current total; they do not define it.
    if (row.category !== 'no_bar') return;
    const number = parseNumber(row.number_digits);
    const milli = parseMilliPercent(row.percent);
    if (number == null || milli == null || milli < 300 || milli > 97000) return;
    const estimate = (number * 100000.0) / milli;
    const current = this.totalEstimate();
    if (current != null && Math.abs(estimate / current - 1.0) > 0.025) return;
    this.totalSamples.push(estimate);
  }

  choose(row) {
    // Main streaming decision.  If total is not known yet, output provisional
    // one-frame OCR.  Once known, rank internally consistent candidates with
    // history, bar, and raw-percent guards.
    const total = this.totalEstimate();
    if (total == null) {
      const output = this.rawOutput(row, 'raw_no_total');
      this.remember(output);
      return { ...output, totalEstimate: '' };
    }

    const barEstimate = this.options.streamBarWeight > 0 ? parseBarEstimate(row) : null;
    let candidates = pairCandidates(row, total, this.previousOutput?.milliPercent ?? null, this.options);
    candidates = candidates.concat(this.hiddenBarSuffixPairs(row, total, candidates));
    if (!candidates.length) {
      const output = this.rawOutput(row, 'raw_no_pair');
      this.remember(output);
      return { ...output, totalEstimate: total };
    }

    const rawNumber = parseNumber(row.number_digits);
    const rawMilli = parseMilliPercent(row.percent);
    const rawMilliTrusted = this.rawMilliTrusted(row, rawMilli);
    const rawPercentVisuallySupported = this.barSupportsMilli(rawMilli, barEstimate);
    const scored = [];
    for (const candidate of candidates) {
      let score = candidate.score;
      const consistency = Math.abs((candidate.number / total) * 100000.0 - candidate.milliPercent);
      if (score <= -900.0 && (row.category !== 'no_bar' || consistency > 8.0)) {
        score = consistency * 0.06 + 0.4;
      }
      if (this.previousOutput) {
        const previous = this.previousOutput;
        if (candidate.milliPercent < previous.milliPercent - 420) {
          score += 80.0 + (previous.milliPercent - candidate.milliPercent) * 0.08;
        }
        if (candidate.number < previous.number - Math.max(800000, total * 0.00045)) score += 80.0;
        if (candidate.milliPercent > previous.milliPercent + 8500) {
          score += (candidate.milliPercent - previous.milliPercent - 8500) * 0.01;
        }
      }
      score += this.recentHistoryPenalty(candidate, total);
      if (row.category === 'no_bar' && candidate.number === rawNumber && candidate.milliPercent === rawMilli) score -= 1.2;
      if (row.category === 'partial_bar' && rawMilliTrusted && rawMilli != null && candidate.milliPercent !== rawMilli) score += 1.5;
      if (
        rawPercentVisuallySupported &&
        rawMilli != null &&
        candidate.milliPercent !== rawMilli &&
        candidate.notes.includes('percent_suffix')
      ) {
        score += this.options.rawPercentSuffixPenalty;
      }
      if (
        this.options.rawPercentKeepBonus > 0 &&
        ['partial_bar', 'full_bar'].includes(row.category) &&
        rawPercentVisuallySupported &&
        rawMilli != null &&
        candidate.milliPercent === rawMilli &&
        consistency <= this.options.rawPercentKeepMaxConsistency
      ) {
        score -= this.options.rawPercentKeepBonus;
      }
      score += barPenalty(candidate.milliPercent / 1000.0, barEstimate, this.options.streamBarWeight);
      scored.push({ score, candidate });
    }

    let chosen = scored.sort((a, b) => a.score - b.score)[0].candidate;
    chosen = this.applyHistoryVotes(chosen, row, total);
    chosen = this.applyRecentHistoryVotes(chosen, row, total);
    chosen = this.applyPartialTotalPercentRepair(chosen, row, total, barEstimate);
    const output = {
      number: chosen.number,
      milliPercent: chosen.milliPercent,
      value: formatValue(chosen.number, chosen.milliPercent),
      status: 'confirmed',
      notes: chosen.notes,
      totalEstimate: total,
    };
    this.remember(output, row);
    return output;
  }

  rawOutput(row, note) {
    const candidate = ocrCandidateItems(row)[0];
    const number = candidate?.number ?? parseNumber(row.number_digits);
    const milliPercent = candidate?.milliPercent ?? parseMilliPercent(row.percent);
    if (number == null || milliPercent == null) return { number: null, milliPercent: null, value: '', status: 'pending', notes: [note] };
    return { number, milliPercent, value: formatValue(number, milliPercent), status: 'provisional', notes: [note] };
  }

  remember(output, row) {
    if (output.number == null || output.milliPercent == null) return;
    this.previousOutput = { number: output.number, milliPercent: output.milliPercent, notes: output.notes || [], score: 0 };
    this.recentOutputs.push(this.previousOutput);
    while (this.recentOutputs.length > this.options.recentHistorySize) this.recentOutputs.shift();
    const weight = { no_bar: 4, partial_bar: 2, full_bar: 2 }[row?.category] ?? 1;
    this.addVote(this.percentNumberVotes, output.milliPercent, output.number, weight);
    this.addVote(this.numberPercentVotes, output.number, output.milliPercent, weight);
  }

  addVote(map, key, value, weight) {
    if (!map.has(key)) map.set(key, new Map());
    const bucket = map.get(key);
    bucket.set(value, (bucket.get(value) ?? 0) + weight);
  }

  bestVote(map) {
    let best = null;
    for (const [value, weight] of map.entries()) {
      if (!best || weight > best.weight) best = { value, weight };
    }
    return best;
  }

  hiddenBarSuffixPairs(row, total, existing) {
    // A fallback for cases where the visible raw percent is believable but the
    // number's leading digits were hidden by the EXP bar.
    if (row.category === 'no_bar') return [];
    const rawNumber = parseNumber(row.number_digits);
    const rawMilli = parseMilliPercent(row.percent);
    if (rawNumber == null || rawMilli == null) return [];
    const center = numberCenter(total, rawMilli);
    const rawDistance = Math.abs(rawNumber - center);
    if (rawDistance <= Math.max(260000.0, total * 0.00012)) return [];
    const seen = new Set(existing.map(pairKey));
    const repairs = [];
    for (const item of numberCandidatesFromSuffix(row.number_digits, center, total)) {
      const key = `${item.number}|${rawMilli}`;
      if (seen.has(key)) continue;
      const score = (item.distance / Math.max(total, 1.0)) * 16000.0 + 0.25 - Math.min(0.25, item.suffixLen * 0.04);
      repairs.push({ number: item.number, milliPercent: rawMilli, notes: [`stream_number_suffix${item.suffixLen}`], score });
      seen.add(key);
    }
    return repairs;
  }

  rawMilliTrusted(row, rawMilli) {
    // Reject raw percent when it jumps backwards or too far forwards relative
    // to the last accepted stream output.
    if (rawMilli == null || rawMilli < 0 || rawMilli > 100000) return false;
    if (row.category === 'no_bar' || !this.previousOutput) return true;
    const previous = this.previousOutput.milliPercent;
    if (rawMilli < previous - 650) return false;
    if (rawMilli > previous + 9000) return false;
    return true;
  }

  barSupportsMilli(rawMilli, barEstimate) {
    if (rawMilli == null || !barEstimate || barEstimate.confidence < 0.70) return false;
    return Math.abs(rawMilli / 1000.0 - barEstimate.percent) <= this.options.rawPercentBarTolerance;
  }

  recentHistoryPenalty(candidate, total) {
    if (!this.recentOutputs.length) return 0;
    const latest = this.recentOutputs[this.recentOutputs.length - 1];
    let penalty = 0;
    if (candidate.milliPercent < latest.milliPercent - 500) penalty += 45.0 + (latest.milliPercent - candidate.milliPercent) * 0.05;
    if (candidate.number < latest.number - Math.max(600000.0, total * 0.00030)) penalty += 35.0;
    if (this.recentOutputs.length >= 2) {
      const previous = this.recentOutputs[this.recentOutputs.length - 2];
      const expectedStep = latest.milliPercent - previous.milliPercent;
      const candidateStep = candidate.milliPercent - latest.milliPercent;
      if (expectedStep >= 0 && expectedStep <= 2500 && candidateStep >= 0) {
        const excess = candidateStep - Math.max(2500, expectedStep * 3 + 600);
        if (excess > 0) penalty += excess * 0.012;
      }
    }
    return penalty;
  }

  applyHistoryVotes(chosen, row, total) {
    // Older frames in the same cycle can vote for the number tied to a percent
    // or the percent tied to a number.  This fixes repeated low-level glyph
    // errors while preserving monotonicity.
    if (row.category === 'no_bar') return chosen;
    let number = chosen.number;
    let milli = chosen.milliPercent;
    const notes = [...chosen.notes];
    const expectedNumber = numberCenter(total, milli);
    const numberVotes = this.percentNumberVotes.get(milli);
    if (numberVotes) {
      const best = this.bestVote(numberVotes);
      const chosenDistance = Math.abs(number - expectedNumber);
      const bestDistance = Math.abs(best.value - expectedNumber);
      let allow = best.weight >= 3 && bestDistance <= Math.max(260000.0, chosenDistance + 180000.0);
      if (row.category === 'full_bar') {
        allow = best.weight >= 3 && chosenDistance > Math.max(60000.0, total * 0.000025) && bestDistance + 10000.0 < chosenDistance;
      }
      if (best.value !== number && allow) {
        number = best.value;
        notes.push('past_percent_vote');
      }
    }
    const percentVotes = this.numberPercentVotes.get(number);
    if (percentVotes) {
      const best = this.bestVote(percentVotes);
      const chosenConsistency = Math.abs((number / total) * 100000.0 - milli);
      const bestConsistency = Math.abs((number / total) * 100000.0 - best.value);
      let allow = best.weight >= 3 && bestConsistency <= Math.max(120.0, chosenConsistency + 180.0);
      if (row.category === 'full_bar') {
        allow = best.weight >= 3 && chosenConsistency > 12.0 && bestConsistency + 12.0 < chosenConsistency;
      }
      if (best.value !== milli && allow) {
        milli = best.value;
        notes.push('past_number_vote');
      }
    }
    if (number === chosen.number && milli === chosen.milliPercent) return chosen;
    return { number, milliPercent: milli, notes: [...new Set(notes)], score: chosen.score };
  }

  applyRecentHistoryVotes(chosen, row, total) {
    if (row.category === 'no_bar' || this.recentOutputs.length < 2) return chosen;
    let number = chosen.number;
    let milli = chosen.milliPercent;
    const notes = [...chosen.notes];
    const expectedNumber = numberCenter(total, milli);
    const samePercentNumbers = new Map();
    const sameNumberPercents = new Map();
    [...this.recentOutputs].reverse().forEach((past, index) => {
      const weight = Math.max(1, this.options.recentHistorySize - index);
      if (past.milliPercent === milli) samePercentNumbers.set(past.number, (samePercentNumbers.get(past.number) ?? 0) + weight);
      if (past.number === number) sameNumberPercents.set(past.milliPercent, (sameNumberPercents.get(past.milliPercent) ?? 0) + weight);
    });
    if (samePercentNumbers.size) {
      const best = this.bestVote(samePercentNumbers);
      const chosenDistance = Math.abs(number - expectedNumber);
      const bestDistance = Math.abs(best.value - expectedNumber);
      if (
        best.value !== number &&
        best.weight >= 3 &&
        Math.abs(best.value - number) <= Math.max(1600000.0, total * 0.00075) &&
        bestDistance <= chosenDistance + Math.max(60000.0, total * 0.000035)
      ) {
        number = best.value;
        notes.push('recent_percent_vote');
      }
    }
    if (sameNumberPercents.size) {
      const best = this.bestVote(sameNumberPercents);
      const chosenConsistency = Math.abs((number / total) * 100000.0 - milli);
      const bestConsistency = Math.abs((number / total) * 100000.0 - best.value);
      if (best.value !== milli && best.weight >= 3 && Math.abs(best.value - milli) <= 1200 && bestConsistency + 20.0 < chosenConsistency) {
        milli = best.value;
        notes.push('recent_number_vote');
      }
    }
    if (number === chosen.number && milli === chosen.milliPercent) return chosen;
    return { number, milliPercent: milli, notes: [...new Set(notes)], score: chosen.score };
  }

  applyPartialTotalPercentRepair(chosen, row, total, barEstimate) {
    // For partial_bar, if the chosen number is solid and total EXP is known,
    // recompute percent from number/total when the visible bar is compatible.
    if (row.category !== 'partial_bar' || chosen.number <= 0 || chosen.number > total * 1.08) return chosen;
    const target = (chosen.number / total) * 100000.0;
    if (target < 0 || target > 100000 || Math.abs(target - chosen.milliPercent) < 10) return chosen;
    if (barEstimate && barEstimate.confidence >= 0.45) {
      const tolerance = 0.75 + (1.0 - Math.min(1.0, barEstimate.confidence)) * 0.5;
      if (Math.abs(target / 1000.0 - barEstimate.percent) > tolerance) return chosen;
    }
    const options = new Set([Math.floor(target) - 1, Math.floor(target), Math.floor(target) + 1, Math.round(target)]);
    const repaired = [...options].filter((milli) => milli >= 0 && milli <= 100000).sort((a, b) => Math.abs(target - a) - Math.abs(target - b))[0];
    if (repaired == null || repaired === chosen.milliPercent) return chosen;
    return { number: chosen.number, milliPercent: repaired, notes: [...new Set([...chosen.notes, 'partial_total_percent_repair'])], score: chosen.score };
  }
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const cycle = String(a.cycle || '').localeCompare(String(b.cycle || ''));
    if (cycle) return cycle;
    return Number.parseFloat(a.timestamp || '0') - Number.parseFloat(b.timestamp || '0');
  });
}

function simulateStreaming(rows, options) {
  // State is reset at each level-up/cycle.  Correct cycle metadata is required;
  // otherwise the total EXP estimate leaks across levels.
  const outputs = [];
  let currentCycle = null;
  let state = new StreamingState(options);

  for (const row of sortRows(rows)) {
    const cycle = row.cycle || 'cycle';
    if (currentCycle == null) currentCycle = cycle;
    if (cycle !== currentCycle) {
      state = new StreamingState(options);
      currentCycle = cycle;
    }
    state.observe(row);
    const result = state.choose(row);
    outputs.push({
      ...row,
      stream_delay_seconds: Number(options.delaySeconds || 0).toFixed(3),
      stream_number_digits: result.number == null ? '' : String(Math.round(result.number)),
      stream_percent: result.milliPercent == null ? '' : formatPercent(Math.round(result.milliPercent)),
      stream_value: result.value,
      stream_status: result.status,
      stream_notes: (result.notes || []).join('|'),
      stream_total_estimate: result.totalEstimate ? Number(result.totalEstimate).toFixed(3) : '',
    });
  }
  return outputs;
}

function indexRowsByEngine(browserRows) {
  const engines = {};
  for (const row of browserRows) {
    const engine = row.engine;
    if (!engine) continue;
    if (!engines[engine]) engines[engine] = new Map();
    engines[engine].set(row.id, row);
  }
  return engines;
}

function summarizeStreaming(rows) {
  const byCategory = {};
  for (const row of rows) {
    const category = row.category || 'unknown';
    byCategory[category] ??= { samples: 0, parsed: 0 };
    byCategory[category].samples += 1;
    if (row.stream_value) byCategory[category].parsed += 1;
  }
  return {
    samples: rows.length,
    parsed: rows.filter((row) => row.stream_value).length,
    by_category: byCategory,
  };
}

function snapTotal(estimate, table, options) {
  if (!Number.isFinite(estimate) || estimate < options.expTableMinTotal) return { row: null, snapError: null };
  const eligible = table.filter((item) => item.exp_to_next >= options.expTableMinTotal);
  if (!eligible.length) return { row: null, snapError: null };
  let nearest = null;
  for (const item of eligible) {
    const relativeError = Math.abs(item.exp_to_next - estimate) / item.exp_to_next;
    if (!nearest || relativeError < nearest.relativeError) nearest = { item, relativeError };
  }
  if (nearest.relativeError > options.expTableMaxSnapRelativeError) return { row: null, snapError: nearest.relativeError };
  return { row: nearest.item, snapError: nearest.relativeError };
}

function tablePercent(number, total) {
  if (total <= 0) return null;
  const milli = Math.round((number * 100000.0) / total);
  if (milli < 0 || milli > 100000) return null;
  return milli;
}

function priorCandidateItems(row, options) {
  const items = [];
  const seen = new Set();
  const add = (value, source, rank) => {
    const parsed = parseValue(value);
    if (!parsed) return;
    const key = `${parsed.number}|${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      number: parsed.number,
      originalMilli: parsed.milliPercent,
      source,
      rank,
      value: parsed.value,
    });
  };
  add(row.one_frame_value, 'one_frame', 0);
  add(row.stream_value, 'stream_current', 0);
  return items;
}

function sourceCost(candidate) {
  if (candidate.source === 'one_frame') return 0.0;
  if (candidate.source === 'stream_current') return 0.25;
  return 0.35 + Math.min(candidate.rank, 12) * 0.035;
}

function scorePriorCandidate(row, candidate, total, options) {
  const milli = tablePercent(candidate.number, total);
  if (milli == null) return null;
  const barPercent = parseFloatOrNull(row.bar_percent);
  const barDiff = barPercent == null ? null : Math.abs(milli / 1000.0 - barPercent);
  const originalDiff = candidate.originalMilli == null ? null : Math.abs(milli - candidate.originalMilli) / 1000.0;
  if (originalDiff != null && originalDiff > options.expTableMaxOriginalPercentDiff) return null;

  let score = sourceCost(candidate);
  const reason = [candidate.source];
  if (barDiff != null) {
    score += barDiff * options.expTableBarWeight;
    reason.push(`bar_diff=${barDiff.toFixed(3)}`);
  }
  if (originalDiff != null) {
    score += originalDiff * 0.65;
    reason.push(`ocr_percent_delta=${originalDiff.toFixed(3)}`);
  }
  const notes = row.stream_notes || '';
  if (candidate.source === 'stream_current' && (notes.includes('percent_suffix') || notes.includes('number_suffix'))) {
    score += 1.35;
    reason.push('current_suffix_penalty');
  }
  if (candidate.source === 'one_frame' && (notes.includes('percent_suffix') || notes.includes('number_suffix'))) {
    score -= 0.25;
    reason.push('one_frame_after_suffix_bonus');
  }
  return {
    candidate,
    tableMilli: milli,
    score,
    barDiff,
    reason: reason.join(';'),
    value: formatValue(candidate.number, milli),
  };
}

function shouldApplyPrior(row, current, best, options) {
  if (row.category !== 'full_bar') return false;
  const notes = row.stream_notes || '';
  if (!notes.includes('percent_suffix') && !notes.includes('stream_number_suffix')) return false;
  if (!['one_frame', 'stream_current'].includes(best.candidate.source)) return false;
  if (best.barDiff != null && best.barDiff > options.expTableMaxBarDiff) return false;
  if (!current) return false;
  if (best.value === row.stream_value) return false;
  if (current.barDiff == null || best.barDiff == null) return false;
  return current.barDiff - best.barDiff >= options.expTableMinBarGain;
}

function applyExpTablePrior(rows, table, options) {
  // Experimental prior using Maple's level EXP table.  It only applies to
  // full_bar suffix anomalies where snapping the total improves bar agreement.
  if (!Array.isArray(table) || !table.length) return { rows, changes: [] };
  const changes = [];
  const output = rows.map((row) => {
    const next = {
      ...row,
      exp_table_prior_applied: 'no',
      exp_table_prior_reason: '',
      exp_table_level: '',
      exp_table_total: '',
      exp_table_snap_relative_error: '',
    };
    const estimate = parseFloatOrNull(row.stream_total_estimate);
    const snapped = snapTotal(estimate, table, options);
    if (snapped.snapError != null) next.exp_table_snap_relative_error = snapped.snapError.toFixed(6);
    if (!snapped.row) return next;
    next.exp_table_level = String(snapped.row.level);
    next.exp_table_total = String(snapped.row.exp_to_next);

    const scored = priorCandidateItems(row, options)
      .map((candidate) => scorePriorCandidate(row, candidate, snapped.row.exp_to_next, options))
      .filter(Boolean);
    if (!scored.length) return next;
    const current = scored.find((item) => item.candidate.source === 'stream_current') || null;
    const best = [...scored].sort((a, b) => a.score - b.score || (a.candidate.source === 'one_frame' ? -1 : 1))[0];
    if (!shouldApplyPrior(row, current, best, options)) return next;

    const before = row.stream_value || '';
    next.stream_number_digits = String(best.candidate.number);
    next.stream_percent = formatPercent(best.tableMilli);
    next.stream_value = best.value;
    next.stream_status = 'confirmed';
    next.stream_notes = [row.stream_notes, `exp_table_prior_l${snapped.row.level}`].filter(Boolean).join('|');
    next.matches_reference = next.reference_value === best.value ? 'yes' : 'no';
    next.exp_table_prior_applied = 'yes';
    next.exp_table_prior_reason = best.reason;
    changes.push({
      id: row.id || '',
      frame_index: row.frame_index || '',
      level: String(snapped.row.level),
      total: String(snapped.row.exp_to_next),
      before,
      after: best.value,
      bar_percent: row.bar_percent || '',
      reason: best.reason,
    });
    return next;
  });
  return { rows: output, changes };
}

export function parseExpTableCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines.shift().split(',');
  const levelIndex = header.indexOf('level');
  const expIndex = header.indexOf('exp_to_next');
  return lines.map((line) => {
    const cells = line.split(',');
    return {
      level: Number.parseInt(cells[levelIndex], 10),
      exp_to_next: Number.parseInt(cells[expIndex], 10),
    };
  }).filter((row) => Number.isFinite(row.level) && Number.isFinite(row.exp_to_next));
}

export function buildBrowserStreamingRows(samples, browserRows, options = {}) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const engineRows = indexRowsByEngine(browserRows);
  const inputRows = buildStreamInputRows(samples, engineRows, mergedOptions);
  let streamRows = simulateStreaming(inputRows, mergedOptions);
  let expTableChanges = [];
  if (mergedOptions.expTable?.length) {
    const repaired = applyExpTablePrior(streamRows, mergedOptions.expTable, mergedOptions);
    streamRows = repaired.rows;
    expTableChanges = repaired.changes;
  }
  return {
    inputRows,
    streamRows,
    summary: summarizeStreaming(streamRows),
    options: mergedOptions,
    expTableChanges,
  };
}

export const browserStreamingInternals = {
  parseValue,
  formatValue,
  chooseOneFrameCandidate,
  buildStreamInputRows,
  simulateStreaming,
  applyExpTablePrior,
};
