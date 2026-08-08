import { getFrameCalibration, scaleSideCandidates } from "./calibration.js?v=row-detector-v3-20260524";
import { buildFeatures } from "./features.js?v=row-detector-v3-20260524";
import { findBeveledSquareCandidates, findStrictBeveledSquareCandidates } from "./finder.js?v=row-detector-v3-20260524";
import { makeEmptyDetection, makeDetectionOutput, scaleRect } from "./output.js?v=row-detector-v3-20260524";
import { makeUpperRightRoi } from "./roi.js?v=row-detector-v3-20260524";
import { resolveGridV3ExtendRawRows } from "./grid-v3.js?v=row-detector-v3-20260524";
import { inferSizeClusters } from "./size.js?v=row-detector-v3-20260524";
import { validateCandidateLayout } from "./validation.js?v=row-detector-v3-20260524";

export function runDetectionPipeline(imageData, settings) {
  const started = performance.now();
  const detectorMode = normalizeDetectorMode(settings.detectorMode);
  const calibration = getFrameCalibration(imageData.width, imageData.height, settings);
  if (!calibration.sideCandidates.length) {
    const roi = makeUpperRightRoi(imageData.width, imageData.height, {
      ...settings,
      gameRect: calibration.gameRect,
    });
    return makeEmptyDetection(started, calibration, roi);
  }

  const working = makeWorkingImageData(imageData, settings.maxDetectWidth);
  const roi = makeUpperRightRoi(working.imageData.width, working.imageData.height, {
    ...settings,
    gameRect: scaleRect(calibration.gameRect, working.scale),
  });
  const features = buildFeatures(working.imageData, roi);
  const sideCandidates = scaleSideCandidates(calibration.sideCandidates, working.scale);
  const allowFrameEdgeCandidates = detectorMode === "v3" || calibration.sideCandidates.length === 1;
  const strictCandidates = findStrictBeveledSquareCandidates(features, {
    ...settings,
    sideCandidates,
    allowFrameEdgeCandidates,
  });
  const strictClusters = inferSizeClusters(strictCandidates).slice(0, 8);
  const strictBest = chooseBestLayout(features, strictCandidates, strictClusters, settings);
  if (detectorMode === "v3") {
    const softSideCandidates = chooseSoftSideCandidates(sideCandidates, strictBest, strictClusters);
    const seedCandidates = findBeveledSquareCandidates(features, {
      ...settings,
      sideCandidates: softSideCandidates,
      allowFrameEdgeCandidates,
    });
    const seedClusters = inferSizeClusters(seedCandidates).slice(0, 8);
    const rawBest = chooseBestLayout(features, seedCandidates, seedClusters, settings);
    const detectionMode = softSideCandidates.length < sideCandidates.length ? "v3-grid-soft-pruned-by-strict-side" : "v3-grid-soft";
    const best = resolveGridV3ExtendRawRows(features, rawBest, settings);
    return makeDetectionOutput({
      started,
      calibration,
      working,
      features,
      roi,
      candidates: seedCandidates,
      clusters: seedClusters,
      best,
      softSideCandidates,
      detectionMode,
      strictCandidates,
    });
  }

  const softSideCandidates = chooseSoftSideCandidates(sideCandidates, strictBest, strictClusters);

  let candidates = strictCandidates;
  let clusters = strictClusters;
  let best = strictBest;
  let detectionMode = "strict";

  if (detectorMode !== "v1" || !isConfidentStrictSingleRow(strictBest, strictCandidates, calibration)) {
    candidates = findBeveledSquareCandidates(features, {
      ...settings,
      sideCandidates: softSideCandidates,
      allowFrameEdgeCandidates,
    });
    clusters = inferSizeClusters(candidates).slice(0, 8);
    best = chooseBestLayout(features, candidates, clusters, settings);
    detectionMode = softSideCandidates.length < sideCandidates.length ? "soft-pruned-by-strict-side" : "soft";
  }

  detectionMode = `v1-${detectionMode}`;

  return makeDetectionOutput({
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
  });
}

function chooseBestLayout(features, candidates, clusters, settings) {
  let best = emptyLayout();
  for (const cluster of clusters) {
    const layout = validateCandidateLayout(features, candidates, cluster, settings);
    if (layout.score > best.score) {
      best = layout;
    }
  }
  return best;
}

function normalizeDetectorMode(value) {
  return ["v1", "v3"].includes(value) ? value : "v1";
}

function isConfidentStrictSingleRow(layout, candidates, calibration) {
  if (calibration.gameWidth === 1920) return false;
  if (!layout.boxes.length || layout.rows.length !== 1) return false;
  if (layout.boxes.length < 2 || layout.boxes.length > 4) return false;
  if (candidates.length > 30) return false;
  return layout.boxes.every((box) => box.confidence >= 0.86);
}

function chooseSoftSideCandidates(sideCandidates, strictBest, strictClusters) {
  if (sideCandidates.length <= 1 || !strictClusters.length) return sideCandidates;
  if (strictBest.detectSide && strictBest.boxes.length >= 3 && strictBest.score >= 12) {
    return [strictBest.detectSide];
  }

  return sideCandidates;
}

function emptyLayout() {
  return {
    side: null,
    boxes: [],
    rows: [],
    rejected: [],
    score: 0,
  };
}

function makeWorkingImageData(imageData, maxDetectWidth) {
  const scale = Math.min(1, maxDetectWidth / imageData.width);
  if (scale === 1) {
    return {
      imageData,
      scale: 1,
      inverseScale: 1,
    };
  }

  const width = Math.max(1, Math.round(imageData.width * scale));
  const height = Math.max(1, Math.round(imageData.height * scale));
  const source = makeCanvas(imageData.width, imageData.height);
  const target = makeCanvas(width, height);
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const targetContext = target.getContext("2d", { willReadFrequently: true });
  sourceContext.putImageData(imageData, 0, 0);
  targetContext.imageSmoothingEnabled = true;
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(source, 0, 0, width, height);

  return {
    imageData: targetContext.getImageData(0, 0, width, height),
    scale,
    inverseScale: 1 / scale,
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
