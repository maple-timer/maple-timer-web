import type { GameViewport, ImageLike, Rect, ExtractBuffIconsOptions } from "../types.js";
import { KNOWN_GAME_RESOLUTIONS } from "./constants.js";

export function defaultSearchRoi(image: ImageLike, options: ExtractBuffIconsOptions): Rect {
  const viewport = detectGameViewport(image);
  const topSearchRatio = options.topSearchRatio ?? 0.34;
  const maxSearchHeight = options.maxSearchHeight ?? 420;
  const x = viewport.x + Math.floor(viewport.width * 0.5);
  const y = viewport.y;
  const width = viewport.x + viewport.width - x;
  const height = Math.min(viewport.height, Math.max(160, Math.floor(viewport.height * topSearchRatio)), maxSearchHeight);
  return { x, y, width, height };
}

export function detectGameViewport(image: ImageLike): GameViewport {
  let best: { rect: GameViewport; delta: number } | undefined;
  for (const [width, height] of KNOWN_GAME_RESOLUTIONS) {
    const extraWidth = image.width - width;
    const extraHeight = image.height - height;
    if (extraWidth < 0 || extraHeight < 0) continue;
    if (extraWidth > 24 || extraHeight > 96) continue;

    const rect = {
      x: Math.floor(extraWidth / 2),
      y: extraHeight,
      width,
      height,
    };
    const delta = extraWidth + extraHeight;
    if (!best || delta < best.delta) best = { rect, delta };
  }

  return best?.rect ?? { x: 0, y: 0, width: image.width, height: image.height };
}
