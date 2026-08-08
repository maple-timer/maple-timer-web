import type { RgbaImageSnapshot } from "../../../alertTypes";

const EVIDENCE_IMAGE_QUALITY = 0.82;

export function encodeUltimaRaidEquipmentEvidenceFrame(
  image: ImageData | RgbaImageSnapshot | null | undefined,
): string | null {
  if (!image || !image.width || !image.height) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const target = context.createImageData(image.width, image.height);
  target.data.set(image.data);
  context.putImageData(target, 0, 0);
  return canvas.toDataURL("image/webp", EVIDENCE_IMAGE_QUALITY);
}
