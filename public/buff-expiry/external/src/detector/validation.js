import { groupByNear, median, overlapRatio } from "./geometry.js?v=row-detector-v3-20260524";
import { rectMean } from "./features.js?v=row-detector-v3-20260524";

export function validateCandidateLayout(features, candidates, sizeCluster, options = {}) {
  const side = sizeCluster.side;
  const sideTolerance = Math.max(2, Math.round(side * 0.09));
  const sameSize = candidates.filter((candidate) => Math.abs(candidate.side - side) <= sideTolerance);
  const reduced = sameSize;
  const rows = buildRows(features, reduced, side);
  const alignedRows = chooseRightAlignedStack(features, rows, side, options);
  const boxes = alignedRows.flatMap((row, rowIndex) =>
    row.boxes
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((box, col) => ({
        x: Math.round(box.x),
        y: Math.round(row.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        side: Math.round(box.side ?? box.width),
        row: rowIndex,
        col,
        confidence: clampConfidence(box.score),
        source: "local-bevel+validation",
      })),
  );
  const outputSide = boxes.length ? Math.round(median(boxes.map((box) => box.side))) : side;

  return {
    side: outputSide,
    detectSide: side,
    boxes,
    rows: alignedRows,
    rawRows: rows,
    score: scoreLayout(features, alignedRows, side),
    rejected: reduced.filter((candidate) => !boxes.some((box) => overlapRatio(candidate, box) > 0.5)),
  };
}

function buildRows(features, candidates, side) {
  const groups = splitByBaseline(candidates, side);
  const rows = [];

  for (const group of groups) {
    const runs = chooseContiguousRuns(group.items, side);
    for (const run of runs) {
      if (run.length && hasStableBaseline(run, side) && hasEnoughShortRowEvidence(run)) {
        rows.push(makeRow(run, side));
      }
    }
  }

  return mergeSplitRows(features, rows, side).sort((a, b) => a.y - b.y);
}

function makeRow(run, side, yOverride = null) {
  const rightEdge = Math.max(...run.map((box) => box.x + box.width));
  const rowScore = run.reduce((sum, box) => sum + box.score, 0) / run.length;
  const y = yOverride ?? Math.round(median(run.map((box) => box.y)));
  return {
    y,
    bottom: Math.round(median(run.map((box) => box.y + box.height - 1))),
    rightEdge,
    pitch: inferPitch(run, side),
    boxes: run,
    score: rowScore * Math.sqrt(run.length),
  };
}

function splitByBaseline(items, side) {
  const tolerance = baselineTolerance(side);
  const sizeTolerance = Math.max(1.5, side * 0.055);
  const groups = [];

  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const top = item.y;
    const bottom = item.y + item.height - 1;
    const itemSide = item.side ?? item.width;
    const group = groups.find(
      (entry) =>
        Math.abs(entry.top - top) <= tolerance &&
        Math.abs(entry.bottom - bottom) <= tolerance &&
        Math.abs(entry.side - itemSide) <= sizeTolerance,
    );

    if (group) {
      group.items.push(item);
      group.top = median(group.items.map((candidate) => candidate.y));
      group.bottom = median(group.items.map((candidate) => candidate.y + candidate.height - 1));
      group.side = median(group.items.map((candidate) => candidate.side ?? candidate.width));
    } else {
      groups.push({
        top,
        bottom,
        side: itemSide,
        items: [item],
      });
    }
  }

  return groups;
}

function hasStableBaseline(items, side) {
  if (items.length <= 1) return true;
  const tolerance = baselineTolerance(side);
  const tops = items.map((item) => item.y);
  const bottoms = items.map((item) => item.y + item.height - 1);
  const sides = items.map((item) => item.side ?? item.width);
  return (
    Math.max(...tops) - Math.min(...tops) <= tolerance &&
    Math.max(...bottoms) - Math.min(...bottoms) <= tolerance &&
    Math.max(...sides) - Math.min(...sides) <= Math.max(2, side * 0.06)
  );
}

function hasEnoughShortRowEvidence(items) {
  if (items.length >= 3) return true;
  const average = items.reduce((sum, item) => sum + item.score, 0) / items.length;
  return average >= 0.86;
}

function baselineTolerance(side) {
  return Math.max(4.5, side * 0.095);
}

function chooseContiguousRuns(items, side) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.x - a.x);
  if (sorted.length === 1) {
    return sorted[0].score >= 0.86 ? [sorted] : [];
  }

  const runs = [];
  for (let start = 0; start < sorted.length; start += 1) {
    const run = [sorted[start]];
    let pitch = null;
    runs.push([...run]);
    for (let i = start + 1; i < sorted.length; i += 1) {
      const previous = run[run.length - 1];
      const candidate = sorted[i];
      const distance = previous.x - candidate.x;
      if (distance < side * 0.72) {
        continue;
      }
      if (distance > side * 1.75) {
        break;
      }
      if (pitch === null) {
        pitch = distance;
        run.push(candidate);
        runs.push([...run]);
        continue;
      }
      if (Math.abs(distance - pitch) <= Math.max(3, side * 0.12)) {
        if (run.length >= 3 && candidate.score < 0.86) {
          break;
        }
        run.push(candidate);
        runs.push([...run]);
      } else {
        break;
      }
    }
  }

  const eligibleRuns = runs.filter((run) => runPassesSelfEvidence(run, side));
  const ranked = eligibleRuns
    .map((run) => run.sort((a, b) => a.x - b.x))
    .sort(
      (a, b) =>
        b.length - a.length ||
        averageScore(b) - averageScore(a) ||
        rightEdge(b) - rightEdge(a),
    );

  const kept = [];
  for (const run of ranked) {
    if (!kept.some((other) => runsOverlapHorizontally(run, other, side))) {
      kept.push(run);
    }
  }

  return kept;
}

function runPassesSelfEvidence(run, side) {
  if (!run.length) return false;
  const average = averageScore(run);
  if (run.length === 1) return average >= 0.86;
  if (!hasPlausiblePitch(run, side)) return false;

  if (run.length === 2) {
    const minimumBoxScore = Math.min(...run.map((box) => box.score));
    const minimumLineScore = Math.min(...run.map((box) => minLineEvidence(box)));
    return average >= 0.94 && minimumBoxScore >= 0.9 && minimumLineScore >= 0.88;
  }

  return average >= 0.72;
}

function hasPlausiblePitch(run, side) {
  if (run.length < 2) return true;
  const pitch = inferPitch(run, side);
  return pitch >= side * 0.78 && pitch <= side * 1.24;
}

function inferPitch(items, side) {
  if (items.length < 2) return side;
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(sorted[i].x - sorted[i - 1].x);
  }
  return Math.round(median(gaps));
}

function chooseRightAlignedStack(features, rows, side) {
  if (!rows.length) return [];
  const completedRows = completeRightEdgeTimerCells(features, rows, side);
  const evidenceRows = completedRows.filter((row) => row.boxes.length > 1 || row.score >= 0.9);
  const groups = groupByNear(evidenceRows, Math.max(8, side * 0.3), (row) => row.rightEdge);
  const ranked = groups
    .map((group) => {
      const stacked = normalizeRowStack(group.items, side);
      return {
        rows: stacked,
        score: scoreLayout(features, stacked, side),
      };
    })
    .sort((a, b) => b.score - a.score);

  let stacked = ranked[0]?.rows ?? [];
  stacked = pruneInvalidSingletonContinuations(features, stacked, side);
  stacked = appendMissingSingletonContinuation(features, stacked, completedRows, side);
  stacked = normalizeRowStack(stacked, side);
  stacked = trimWeakLeftOverhangRows(stacked, side);
  if (stacked.length > 1 && stacked.every((row) => row.boxes.length === 1)) {
    return [];
  }
  return stacked;
}

function normalizeRowStack(rows, side) {
  const nonOverlapping = [];
  const minimumRowStep = side * 0.78;
  const maximumRowStep = side * 1.35;
  for (const row of [...rows].sort((a, b) => a.y - b.y)) {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    if (!previous || row.y - previous.y >= minimumRowStep) {
      if (previous && row.y - previous.y > maximumRowStep) {
        continue;
      }
      nonOverlapping.push(row);
    } else if (row.score > previous.score) {
      nonOverlapping[nonOverlapping.length - 1] = row;
    }
  }

  return nonOverlapping;
}

function mergeSplitRows(features, rows, side) {
  const merged = [...rows];
  const baselineGroups = groupByNear(rows, mergeBaselineTolerance(side), (row) => row.y);

  for (const group of baselineGroups) {
    const fragments = group.items.filter((row) => row.boxes.length >= 2 || row.score >= 0.9);
    if (fragments.length < 2) continue;

    const anchors = fragments
      .filter((row) => row.boxes.length >= 2)
      .sort((a, b) => b.rightEdge - a.rightEdge || b.boxes.length - a.boxes.length);
    if (!anchors.length) continue;

    const anchor = anchors[0];
    const pitch = Math.max(1, anchor.pitch || side);
    const participants = fragments.filter((row) => rowsCanShareLine(row, anchor, pitch, side));
    if (participants.length < 2) continue;

    let boxes = dedupeRowBoxes(participants.flatMap((row) => row.boxes), side);
    boxes = fillSmallRowGaps(boxes, pitch, side);
    boxes = trimWeakMergedLeftEdge(features, boxes, side);

    if (boxes.length <= anchor.boxes.length || !hasPlausiblePitch(boxes, side) || hasLargeRowGap(boxes, pitch, side)) {
      continue;
    }

    merged.push(makeRow(boxes, side, Math.round(median(participants.map((row) => row.y)))));
  }

  return merged;
}

function rowsCanShareLine(row, anchor, pitch, side) {
  if (row === anchor) return true;
  if (Math.abs(row.y - anchor.y) > mergeBaselineTolerance(side)) return false;
  if (row.rightEdge > anchor.rightEdge + side * 0.45) return false;

  const rowLeft = leftEdge(row.boxes);
  const anchorLeft = leftEdge(anchor.boxes);
  const gap = anchorLeft - row.rightEdge;
  const overlapsAnchor = Math.min(row.rightEdge, anchor.rightEdge) - Math.max(rowLeft, anchorLeft) > side * 0.25;
  if (overlapsAnchor) return true;

  return gap >= -side * 0.25 && gap <= pitch * 1.2;
}

function mergeBaselineTolerance(side) {
  return Math.max(1.25, side * 0.04);
}

function dedupeRowBoxes(boxes, side) {
  const sorted = [...boxes].sort((a, b) => a.x - b.x || b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    const existing = kept.find((item) => Math.abs(item.x - box.x) <= side * 0.35);
    if (!existing) {
      kept.push(box);
    } else if (box.score > existing.score) {
      kept[kept.indexOf(existing)] = box;
    }
  }
  return kept.sort((a, b) => a.x - b.x);
}

function fillSmallRowGaps(boxes, pitch, side) {
  if (boxes.length < 2) return boxes;
  const filled = [boxes[0]];

  for (let i = 1; i < boxes.length; i += 1) {
    const previous = filled[filled.length - 1];
    const current = boxes[i];
    let expectedX = previous.x + pitch;
    while (current.x - expectedX > pitch * 0.45 && current.x - expectedX <= pitch * 1.55) {
      filled.push(makeSyntheticBox(Math.round(expectedX), Math.round(median([previous.y, current.y])), side, 0.82));
      expectedX += pitch;
    }
    filled.push(current);
  }

  return filled;
}

function hasLargeRowGap(boxes, pitch, side) {
  if (boxes.length < 2) return false;
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const maximumGap = Math.max(side * 1.45, pitch * 1.55);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].x - sorted[i - 1].x > maximumGap) {
      return true;
    }
  }
  return false;
}

function trimWeakMergedLeftEdge(features, boxes, side) {
  if (boxes.length < 11) return boxes;
  const [first, second] = boxes;
  if (!second || second.x - first.x > side * 1.35) return boxes;
  return isWeakMergedEndpointCell(features, first.x, first.y, side) ? boxes.slice(1) : boxes;
}

function trimWeakLeftOverhangRows(rows, side) {
  return rows.map((row, index) => {
    const next = rows[index + 1];
    if (!next || row.boxes.length < 12 || row.boxes.length - next.boxes.length > 2) {
      return row;
    }

    const sorted = [...row.boxes].sort((a, b) => a.x - b.x);
    if ((sorted[0].score ?? 1) >= 0.93) {
      return row;
    }

    return makeRow(sorted.slice(1), side, row.y);
  });
}

function isWeakMergedEndpointCell(features, x, y, side) {
  if (!isWithinFeatures(features, x, y, side)) return true;
  const stride = features.width + 1;
  const pad = Math.max(3, Math.round(side * 0.12));
  const innerWidth = side - pad * 2;
  const innerHeight = side - pad * 2;
  const edgeMean = rectMean(features.edgeIntegral, stride, x + pad, y + pad, innerWidth, innerHeight);
  const topMean = rectMean(features.lumaIntegral, stride, x + pad, y + 1, innerWidth, Math.max(3, Math.round(side * 0.16)));
  return edgeMean < 50 && topMean < 100;
}

function completeRightEdgeTimerCells(features, rows, side) {
  const anchorRightEdge = inferPrimaryRightEdge(rows, side);
  if (!anchorRightEdge) return rows;

  return rows.map((row) => {
    if (row.boxes.length < 2 || Math.abs(row.rightEdge - anchorRightEdge) <= side * 0.35) {
      return row;
    }

    const missingDistance = anchorRightEdge - row.rightEdge;
    if (missingDistance < side * 0.55 || missingDistance > side * 1.35) {
      return row;
    }

    const x = Math.round(anchorRightEdge - side);
    if (hasBoxNear(row, x, side)) {
      return row;
    }

    const y = findLikelyBuffCellTop(features, x, row.y, side, Math.max(5, side * 0.18));
    if (y === null) {
      return row;
    }

    return makeRow([...row.boxes, makeSyntheticBox(x, y, side, 0.9)], side, row.y);
  });
}

function inferPrimaryRightEdge(rows, side) {
  const strongRows = rows
    .filter((row) => row.boxes.length >= 3)
    .sort((a, b) => a.y - b.y || b.rightEdge - a.rightEdge);
  if (!strongRows.length) return null;

  const topY = strongRows[0].y;
  const upperStackRows = strongRows.filter((row) => row.y - topY <= side * 2.4);
  return Math.max(...upperStackRows.map((row) => row.rightEdge));
}

function pruneInvalidSingletonContinuations(features, rows, side) {
  if (rows.length <= 1) return rows;

  const kept = [];
  for (const row of [...rows].sort((a, b) => a.y - b.y)) {
    const previous = kept[kept.length - 1];
    if (!previous || row.boxes.length > 1) {
      kept.push(row);
      continue;
    }

    const gap = row.y - previous.y;
    const box = row.boxes[0];
    const rightAligned = Math.abs(row.rightEdge - previous.rightEdge) <= side * 0.45;
    const continuous = gap >= side * 0.72 && gap <= side * 1.45;
    if (rightAligned && continuous && looksLikeTimerBuffCell(features, box.x, box.y, side)) {
      kept.push(row);
    }
  }

  return kept;
}

function appendMissingSingletonContinuation(features, rows, sourceRows, side) {
  if (!rows.length) return rows;

  const ordered = [...rows].sort((a, b) => a.y - b.y);
  const anchorRightEdge = Math.max(...ordered.map((row) => row.rightEdge));
  const rowStep = inferRowStep(ordered, side);
  const last = ordered[ordered.length - 1];
  const expectedY = Math.round(last.y + rowStep);
  const x = Math.round(anchorRightEdge - side);
  if (!isWithinFeatures(features, x, expectedY, side)) {
    return ordered;
  }

  const existing = sourceRows.find((row) => {
    if (row.boxes.length !== 1) return false;
    if (Math.abs(row.y - expectedY) > Math.max(8, side * 0.25)) return false;
    if (Math.abs(row.rightEdge - anchorRightEdge) > side * 0.45) return false;
    const box = row.boxes[0];
    return looksLikeTimerBuffCell(features, box.x, box.y, side);
  });

  if (existing && !ordered.some((row) => Math.abs(row.y - existing.y) <= side * 0.35)) {
    return [...ordered, existing];
  }

  const y = findLikelyBuffCellTop(features, x, expectedY, side, Math.max(8, side * 0.25));
  if (y === null) {
    return ordered;
  }

  return [...ordered, makeRow([makeSyntheticBox(x, y, side, 0.88)], side, y)];
}

function inferRowStep(rows, side) {
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) {
    const gap = rows[i].y - rows[i - 1].y;
    if (gap >= side * 0.72 && gap <= side * 1.45) {
      gaps.push(gap);
    }
  }
  return gaps.length ? median(gaps) : Math.round(side * 1.08);
}

function hasBoxNear(row, x, side) {
  return row.boxes.some((box) => Math.abs(box.x - x) <= side * 0.35);
}

function findLikelyBuffCellTop(features, x, centerY, side, radius) {
  let best = null;
  const start = Math.round(centerY - radius);
  const end = Math.round(centerY + radius);
  for (let y = start; y <= end; y += 1) {
    const evidence = scoreTimerBuffCell(features, x, y, side);
    if (evidence.pass && (!best || evidence.score > best.score)) {
      best = { y, score: evidence.score };
    }
  }
  return best ? best.y : null;
}

function looksLikeTimerBuffCell(features, x, y, side) {
  return scoreTimerBuffCell(features, x, y, side).pass;
}

function scoreTimerBuffCell(features, x, y, side) {
  if (!isWithinFeatures(features, x, y, side)) {
    return { pass: false, score: 0 };
  }

  const stride = features.width + 1;
  const pad = Math.max(3, Math.round(side * 0.12));
  const inner = {
    x: x + pad,
    y: y + pad,
    width: side - pad * 2,
    height: side - pad * 2,
  };
  const topStripHeight = Math.max(3, Math.round(side * 0.16));
  const innerDark = rectMean(features.darkIntegral, stride, inner.x, inner.y, inner.width, inner.height);
  const borderDark = rectMean(features.borderDarkIntegral, stride, x, y, side, side);
  const midDark = rectMean(features.midDarkIntegral, stride, inner.x, inner.y, inner.width, inner.height);
  const softDark = rectMean(features.softDarkIntegral, stride, inner.x, inner.y, inner.width, inner.height);
  const edgeMean = rectMean(features.edgeIntegral, stride, inner.x, inner.y, inner.width, inner.height);
  const topMean = rectMean(features.lumaIntegral, stride, x + pad, y + 1, side - pad * 2, topStripHeight);
  const innerMean = rectMean(features.lumaIntegral, stride, inner.x, inner.y, inner.width, inner.height);

  const tooDarkForBuffSlot = innerDark > 0.78 || (borderDark > 0.82 && topMean < 92);
  const enoughTimerShape = edgeMean >= 82 && topMean >= 105 && innerMean >= 95;
  const pass = !tooDarkForBuffSlot && enoughTimerShape;
  const score =
    topMean / 255 +
    innerMean / 320 +
    edgeMean / 80 +
    midDark * 0.7 +
    softDark * 0.25 -
    innerDark * 0.55 -
    borderDark * 0.2;

  return { pass, score };
}

function isWithinFeatures(features, x, y, side) {
  return x >= 0 && y >= 0 && x + side <= features.width && y + side <= features.height;
}

function makeSyntheticBox(x, y, side, score) {
  return {
    x,
    y,
    width: side,
    height: side,
    side,
    score,
    top: score,
    bottom: score,
    left: score,
    right: score,
    synthetic: true,
  };
}

function averageScore(run) {
  if (!run.length) return 0;
  return run.reduce((sum, box) => sum + box.score, 0) / run.length;
}

function minLineEvidence(box) {
  const values = [box.top, box.bottom, box.left, box.right].filter(Number.isFinite);
  return values.length ? Math.min(...values) : box.score;
}

function rightEdge(run) {
  if (!run.length) return 0;
  return Math.max(...run.map((box) => box.x + box.width));
}

function leftEdge(run) {
  if (!run.length) return 0;
  return Math.min(...run.map((box) => box.x));
}

function runsOverlapHorizontally(a, b, side) {
  const aLeft = Math.min(...a.map((box) => box.x));
  const aRight = Math.max(...a.map((box) => box.x + box.width));
  const bLeft = Math.min(...b.map((box) => box.x));
  const bRight = Math.max(...b.map((box) => box.x + box.width));
  return Math.min(aRight, bRight) - Math.max(aLeft, bLeft) > side * 0.35;
}

function scoreLayout(features, rows, side) {
  if (!rows.length) return 0;
  const count = rows.reduce((sum, row) => sum + row.boxes.length, 0);
  const rowScore = rows.reduce((sum, row) => sum + row.score, 0);
  const topY = Math.min(...rows.map((row) => row.y));
  const rightEdge = Math.max(...rows.map((row) => row.rightEdge));
  const frameWidth = features.frameWidth ?? features.width;
  const frameHeight = features.frameHeight ?? features.height;
  const absoluteTopY = (features.originY ?? 0) + topY;
  const absoluteRightEdge = (features.originX ?? 0) + rightEdge;
  const topBias = Math.max(0, 1 - absoluteTopY / Math.max(1, frameHeight * 0.28));
  const rightBias = Math.max(0, 1 - (frameWidth - absoluteRightEdge) / Math.max(1, frameWidth * 0.18));
  const singleCandidatePenalty = count === 1 ? 8 : 0;
  return rowScore + Math.sqrt(count) + side / 200 + topBias * 18 + rightBias * 18 - singleCandidatePenalty;
}

function clampConfidence(score) {
  return Math.max(0, Math.min(1, score));
}
