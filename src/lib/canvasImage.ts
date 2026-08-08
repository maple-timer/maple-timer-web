export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function imageDataToUrl(imageData: ImageData): string | null {
  return imageDataToCanvas(imageData)?.toDataURL("image/png") ?? null;
}
