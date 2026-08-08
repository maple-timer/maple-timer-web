import type { ImageLike, RgbaImage } from "../types.js";
import { clampInt } from "./math.js";

export function cropAndResize(image: ImageLike, x: number, y: number, size: number, outputSize: number): RgbaImage {
  const out = new Uint8ClampedArray(outputSize * outputSize * 4);
  const data = image.data;
  const scale = size / outputSize;
  for (let oy = 0; oy < outputSize; oy++) {
    const sy = y + (oy + 0.5) * scale - 0.5;
    const y1 = clampInt(Math.floor(sy), 0, image.height - 1);
    const y2 = clampInt(y1 + 1, 0, image.height - 1);
    const wy = sy - Math.floor(sy);
    for (let ox = 0; ox < outputSize; ox++) {
      const sx = x + (ox + 0.5) * scale - 0.5;
      const x1 = clampInt(Math.floor(sx), 0, image.width - 1);
      const x2 = clampInt(x1 + 1, 0, image.width - 1);
      const wx = sx - Math.floor(sx);
      const i11 = (y1 * image.width + x1) * 4;
      const i21 = (y1 * image.width + x2) * 4;
      const i12 = (y2 * image.width + x1) * 4;
      const i22 = (y2 * image.width + x2) * 4;
      const oi = (oy * outputSize + ox) * 4;
      for (let c = 0; c < 4; c++) {
        const top = (data[i11 + c] ?? 0) * (1 - wx) + (data[i21 + c] ?? 0) * wx;
        const bottom = (data[i12 + c] ?? 0) * (1 - wx) + (data[i22 + c] ?? 0) * wx;
        out[oi + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return { width: outputSize, height: outputSize, data: out };
}
