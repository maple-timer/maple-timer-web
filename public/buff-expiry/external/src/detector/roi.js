export function makeUpperRightRoi(width, height, options = {}) {
  const startX = options.roiStartXRatio ?? 0.5;
  const endY = options.roiEndYRatio ?? 0.45;
  const gameRect = options.gameRect ?? { x: 0, y: 0, width, height };
  const rectX = clamp(Math.floor(gameRect.x), 0, Math.max(0, width - 1));
  const rectY = clamp(Math.floor(gameRect.y), 0, Math.max(0, height - 1));
  const rectWidth = clamp(Math.floor(gameRect.width), 1, width - rectX);
  const rectHeight = clamp(Math.floor(gameRect.height), 1, height - rectY);
  const roiX = rectX + Math.floor(rectWidth * startX);
  const roiY = rectY;
  const roiWidth = rectX + rectWidth - roiX;
  const roiHeight = Math.floor(rectHeight * endY);

  return {
    x: roiX,
    y: roiY,
    width: Math.max(1, roiWidth),
    height: Math.max(1, roiHeight),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
