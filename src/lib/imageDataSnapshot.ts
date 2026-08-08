import type { RgbaImageSnapshot } from "../alertTypes";

export function cloneImageDataSnapshot(
  imageData: ImageData | null | undefined,
): RgbaImageSnapshot | null {
  if (!imageData) {
    return null;
  }

  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}
