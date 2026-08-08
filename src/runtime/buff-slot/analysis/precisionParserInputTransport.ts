import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import { cropAndResize } from "../../../recognition/buff-slot/parser/detector/crop";

const NORMALIZED_ICON_SIZE = 32;

export function cropPrecisionParserInput(
  source: ImageData,
  roi: PixelRegion,
): ImageData {
  assertRegionInsideImage(source, roi);
  const output = new Uint8ClampedArray(roi.width * roi.height * 4);
  const sourceRowBytes = source.width * 4;
  const outputRowBytes = roi.width * 4;
  const sourceStartX = roi.x * 4;

  for (let y = 0; y < roi.height; y += 1) {
    const sourceOffset = (roi.y + y) * sourceRowBytes + sourceStartX;
    const outputOffset = y * outputRowBytes;
    output.set(
      source.data.subarray(sourceOffset, sourceOffset + outputRowBytes),
      outputOffset,
    );
  }

  return createImageData(output, roi.width, roi.height);
}

export function projectTransportAnalysisToSourcePixels({
  analysis,
  source,
  roi,
}: {
  analysis: BuffSlotAnalysis;
  source: ImageData;
  roi: PixelRegion;
}): BuffSlotAnalysis {
  assertRegionInsideImage(source, roi);
  const boxes = analysis.boxes.map((box) => {
    assertTransportBoxInsideRegion(box, roi);
    return {
      ...box,
      x: box.x + roi.x,
      y: box.y + roi.y,
    };
  });

  return {
    ...analysis,
    boxes,
    icons: boxes.map((box) =>
      cropAndResize(source, box.x, box.y, box.size, NORMALIZED_ICON_SIZE),
    ),
  };
}

function assertRegionInsideImage(source: ImageData, roi: PixelRegion): void {
  const values = [roi.x, roi.y, roi.width, roi.height];
  if (
    values.some((value) => !Number.isInteger(value)) ||
    roi.x < 0 ||
    roi.y < 0 ||
    roi.width <= 0 ||
    roi.height <= 0 ||
    roi.x + roi.width > source.width ||
    roi.y + roi.height > source.height
  ) {
    throw new Error("precision-parser-transport-roi-invalid");
  }
}

function assertTransportBoxInsideRegion(
  box: BuffSlotAnalysis["boxes"][number],
  roi: PixelRegion,
): void {
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.size) ||
    box.size <= 0 ||
    box.x < -1 ||
    box.y < -1 ||
    box.x + box.size > roi.width + 1 ||
    box.y + box.size > roi.height + 1
  ) {
    throw new Error("precision-parser-transport-box-invalid");
  }
}

function createImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  if (typeof ImageData === "function") {
    const browserData = new Uint8ClampedArray(data.length);
    browserData.set(data);
    return new ImageData(browserData, width, height);
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}
