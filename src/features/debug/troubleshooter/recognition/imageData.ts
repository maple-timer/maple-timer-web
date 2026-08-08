export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("원본 화면을 읽지 못했습니다.");
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("화면 분석용 Canvas를 만들지 못했습니다.");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("분석 결과 이미지를 만들지 못했습니다.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function iconToDataUrl(icon: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): string {
  return imageDataToDataUrl(
    new ImageData(new Uint8ClampedArray(icon.data), icon.width, icon.height),
  );
}
