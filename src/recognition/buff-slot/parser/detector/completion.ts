import type { BuffIconBox, ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect } from "../types.js";
import { alignFinalGridCoordinates } from "./alignment.js";
import { createDetectionContext } from "./context.js";
import { stabilizeDetectedRows } from "./grid.js";
import { nms } from "./math.js";
import { pruneDetachedDamageRows } from "./pruning.js";
import {
  normalizeFinalBoxSizes,
  normalizeCompactSupportedColumns,
  normalizeIrregularRowColumns,
  snapCompactRowsToLocalPitch,
  polishDetectedRowsToFrame,
  recoverScoredTopRightTwoRowGrid,
  separateOverlappingFinalBoxes,
  snapRowsToScoredNonOverlappingPitch,
  snapDenseAdjacentRows,
  snapRightRailSingletonColumns,
  snapTopRowToLowerVerticalPitch,
} from "./finalBoxNormalization.js";
import { completeFinalSupportedTopRowGaps, completeStructuralRowGaps, fillDetectedRowGaps } from "./rowGapCompletion.js";
import {
  applyRightAlignedGridRules,
  completeDetectedRowOuterEdges,
  completeDetectedRowRightEdges,
  completeRowsToSharedRightEdge,
  completeStrongRowLeftEdges,
  completeSupportedTopRowColumns,
  completeCompactDenseInternalLocalPitchGaps,
} from "./rightAlignedCompletion.js";
import { completeMissingShortRightRailRows, completeShortSupportedGridRows, completeSingletonSupportedShortRows } from "./shortRailCompletion.js";
import {
  completeMissingTopRailRows,
  completeSparseSupportedTopRow,
  completeTopClippedRightEdgeRows,
  completeTopRightWrappedRows,
  completeVisibleTopRightRow,
} from "./topRowCompletion.js";
import { completeMissingRowsFromVerticalGaps } from "./verticalRowCompletion.js";

export {
  normalizeCompactSupportedColumns,
  normalizeFinalBoxSizes,
  recoverScoredTopRightTwoRowGrid,
  separateOverlappingFinalBoxes,
  snapRowsToScoredNonOverlappingPitch,
  snapCompactShortRailRowsToGrid,
  snapCompactRowsToLocalPitch,
  snapLowConfidenceCompactInternalGaps,
  snapRightRailSingletonColumns,
} from "./finalBoxNormalization.js";
export { completeStrongRowLeftEdges } from "./rightAlignedCompletion.js";

export function finalizeDetectedBoxes(
  boxes: BuffIconBox[],
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  minGlobalX: number,
  maxIcons: number,
) {
  const ctx = createDetectionContext(maps, roi, image, options, maxIcons);
  const initialNms = nms(
    boxes
      .filter((box) => box.x >= minGlobalX - box.size && box.y >= 0 && box.x + box.size <= image.width && box.y + box.size <= image.height)
      .filter((box) => box.score >= (options.minBoxScore ?? 190))
      .sort((a, b) => b.score - a.score),
    0.35,
  ).slice(0, maxIcons);

  const coarseRows = stabilizeDetectedRows(initialNms, image);
  const coarseGapFilled = fillDetectedRowGaps(coarseRows, ctx);
  const coarseRightCompleted = completeDetectedRowRightEdges(coarseGapFilled, ctx);
  const gridSeedRows = stabilizeDetectedRows(coarseRightCompleted, image);
  const gridRuleRows = applyRightAlignedGridRules(gridSeedRows, ctx);
  const verticalGapCompleted = completeMissingRowsFromVerticalGaps(gridRuleRows, ctx);
  const verticalStabilized = stabilizeDetectedRows(verticalGapCompleted, image);
  const outerEdgeCompleted = completeDetectedRowOuterEdges(verticalStabilized, ctx);
  const outerStabilized = stabilizeDetectedRows(outerEdgeCompleted, image);
  const refinedGapFilled = fillDetectedRowGaps(outerStabilized, ctx);
  const refinedStabilized = stabilizeDetectedRows(refinedGapFilled, image);
  const denseSnapped = snapDenseAdjacentRows(refinedStabilized);
  const topPitchSnapped = snapTopRowToLowerVerticalPitch(denseSnapped, roi);
  const framePolished = polishDetectedRowsToFrame(topPitchSnapped, maps, roi);
  const structuralCompleted = completeStructuralRowGaps(framePolished, ctx);
  const gridAligned = alignFinalGridCoordinates(structuralCompleted, maps, roi, image);

  const topRailRecovered = completeMissingTopRailRows(gridAligned, ctx);
  const visibleTopRecovered = completeVisibleTopRightRow(topRailRecovered, ctx);
  const clippedTopRecovered = completeTopClippedRightEdgeRows(visibleTopRecovered, ctx);
  const shortRailRecovered = completeMissingShortRightRailRows(clippedTopRecovered, ctx);
  const shortGridRecovered = completeShortSupportedGridRows(shortRailRecovered, ctx);
  const singletonShortRecovered = completeSingletonSupportedShortRows(shortGridRecovered, ctx);
  const sparseTopRecovered = completeSparseSupportedTopRow(singletonShortRecovered, ctx);
  const shortGridAligned = alignFinalGridCoordinates(sparseTopRecovered, maps, roi, image);
  const wrappedTopRecovered = completeTopRightWrappedRows(shortGridAligned, ctx);
  const sharedRightCompleted = completeRowsToSharedRightEdge(wrappedTopRecovered, ctx);
  const finalTopGapsCompleted = completeFinalSupportedTopRowGaps(sharedRightCompleted, ctx);

  const prunedCoarse = pruneDetachedDamageRows(finalTopGapsCompleted, image);
  const selectedAfterFirstPrune = nms(
    prunedCoarse
      .filter((box) => box.x >= minGlobalX - box.size && box.y >= 0 && box.x + box.size <= image.width && box.y + box.size <= image.height)
      .filter((box) => box.score >= (options.minBoxScore ?? 190))
      .sort((a, b) => b.score - a.score),
    0.35,
  )
    .slice(0, maxIcons)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const finalSparseTopRecovered = completeSparseSupportedTopRow(selectedAfterFirstPrune, ctx);
  const finalWrappedTopRecovered = completeTopRightWrappedRows(finalSparseTopRecovered, ctx);
  const finalVisibleTopRecovered = completeVisibleTopRightRow(finalWrappedTopRecovered, ctx);
  const finalClippedTopRecovered = completeTopClippedRightEdgeRows(finalVisibleTopRecovered, ctx);
  const finalShortRailRecovered = completeMissingShortRightRailRows(finalClippedTopRecovered, ctx);
  const finalSingletonShortRecovered = completeSingletonSupportedShortRows(finalShortRailRecovered, ctx);
  const finalSharedRightCompleted = completeRowsToSharedRightEdge(finalSingletonShortRecovered, ctx);
  const finalLeftCompleted = completeStrongRowLeftEdges(finalSharedRightCompleted, ctx);
  const finalGridAligned = alignFinalGridCoordinates(finalLeftCompleted, maps, roi, image);
  const finalLeftRecompleted = completeStrongRowLeftEdges(finalGridAligned, ctx);
  const normalizedColumns = normalizeIrregularRowColumns(finalLeftRecompleted);
  const normalizedCompactColumns = normalizeCompactSupportedColumns(normalizedColumns, image);
  const localPitchSnapped = snapCompactRowsToLocalPitch(normalizedCompactColumns, maps, roi, image);
  const supportedTopColumns = completeSupportedTopRowColumns(localPitchSnapped, ctx);
  const shortRailAfterColumns = completeMissingShortRightRailRows(supportedTopColumns, ctx);
  const singletonShortAfterColumns = completeSingletonSupportedShortRows(shortRailAfterColumns, ctx);
  const prunedFinalPass = pruneDetachedDamageRows(singletonShortAfterColumns, image);
  const repairedAfterPrune = completeSupportedTopRowColumns(prunedFinalPass, ctx);
  const gapRepairedAfterPrune = fillDetectedRowGaps(repairedAfterPrune, ctx);
  const finalPruned = pruneDetachedDamageRows(gapRepairedAfterPrune, image);
  const finalLocalGapsCompleted = completeCompactDenseInternalLocalPitchGaps(finalPruned, ctx);
  const normalizedFinal = normalizeFinalBoxSizes(finalLocalGapsCompleted, image);
  const finalCompactColumns = normalizeCompactSupportedColumns(normalizedFinal, image);
  const finalLocalPitchSnapped = snapCompactRowsToLocalPitch(finalCompactColumns, maps, roi, image);
  const separatedFinal = separateOverlappingFinalBoxes(finalLocalPitchSnapped, image);
  const finalDenseSnapped = snapDenseAdjacentRows(separatedFinal);
  const rightRailColumnSnapped = snapRightRailSingletonColumns(finalDenseSnapped, image);
  const returnedCompactColumns = normalizeCompactSupportedColumns(rightRailColumnSnapped, image);
  return snapCompactRowsToLocalPitch(returnedCompactColumns, maps, roi, image).sort((a, b) => a.y - b.y || a.x - b.x);
}
