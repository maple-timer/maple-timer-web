export function makeDetectionOutput({
  started,
  calibration,
  working,
  features,
  roi,
  candidates,
  clusters,
  best,
  softSideCandidates,
  detectionMode,
  strictCandidates,
}) {
  const boxes = scaleBoxes(best.boxes, working.inverseScale, features.originX, features.originY);
  const scaledCandidates = scaleBoxes(candidates, working.inverseScale, features.originX, features.originY);
  const scaledRejected = scaleBoxes(best.rejected ?? [], working.inverseScale, features.originX, features.originY);

  return {
    boxes,
    candidates: scaledCandidates,
    rejected: scaledRejected,
    roi: scaleRect(roi, working.inverseScale),
    inferredSide: best.side ? Math.round(best.side * working.inverseScale) : null,
    rowCounts: summarizeRows(boxes),
    elapsedMs: roundElapsed(started),
    unsupported: false,
    unsupportedReason: null,
    debug: {
      workingScale: working.scale,
      sizeClusters: clusters.map((cluster) => ({
        side: Math.round(cluster.side * working.inverseScale),
        count: cluster.count,
        score: Math.round(cluster.score * 100) / 100,
      })),
      calibration,
      sideCandidates: calibration.sideCandidates,
      softSideCandidates: softSideCandidates.map((side) => Math.round(side * working.inverseScale)),
      detectionMode,
      strictCandidateCount: strictCandidates.length,
      rows: mapDebugRows(best.rows ?? [], features, working.inverseScale),
      rawRows: mapDebugRows(best.rawRows ?? [], features, working.inverseScale),
      grid: best.grid ? scaleGridDebug(best.grid, working.inverseScale, features.originX, features.originY) : null,
    },
  };
}

export function makeEmptyDetection(started, calibration, roi) {
  return {
    boxes: [],
    candidates: [],
    rejected: [],
    roi,
    inferredSide: null,
    rowCounts: [],
    elapsedMs: roundElapsed(started),
    unsupported: true,
    unsupportedReason: calibration.unsupportedReason,
    debug: {
      workingScale: 1,
      sizeClusters: [],
      calibration,
      sideCandidates: [],
      softSideCandidates: [],
      detectionMode: "unsupported-resolution",
      strictCandidateCount: 0,
      rows: [],
      rawRows: [],
    },
  };
}

export function summarizeRows(boxes) {
  if (!boxes.length) return [];
  const rows = new Map();
  for (const box of boxes) {
    rows.set(box.row, (rows.get(box.row) ?? 0) + 1);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
}

export function scaleBoxes(boxes, scale, offsetX = 0, offsetY = 0) {
  return boxes.map((box) => ({
    ...box,
    x: Math.round((offsetX + box.x) * scale),
    y: Math.round((offsetY + box.y) * scale),
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
    side: box.side ? Math.round(box.side * scale) : undefined,
  }));
}

export function scaleRect(rect, scale) {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

function mapDebugRows(rows, features, inverseScale) {
  return rows.map((row) => ({
    y: Math.round((features.originY + row.y) * inverseScale),
    rightEdge: Math.round((features.originX + row.rightEdge) * inverseScale),
    pitch: Math.round((row.pitch ?? 0) * inverseScale),
    count: row.boxes.length,
    score: Math.round(row.score * 100) / 100,
    xs: row.boxes.map((box) => Math.round((features.originX + box.x) * inverseScale)),
  }));
}

function scaleGridDebug(grid, inverseScale, offsetX, offsetY) {
  if (!grid.model) return grid;
  return {
    ...grid,
    model: {
      ...grid.model,
      side: Math.round(grid.model.side * inverseScale),
      pitch: Math.round(grid.model.pitch * inverseScale),
      rowStep: Math.round(grid.model.rowStep * inverseScale),
      topY: Math.round((offsetY + grid.model.topY) * inverseScale),
      rightEdge: Math.round((offsetX + grid.model.rightEdge) * inverseScale),
    },
  };
}

function roundElapsed(started) {
  return Math.round((performance.now() - started) * 10) / 10;
}
