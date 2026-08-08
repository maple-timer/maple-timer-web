export function preprocessImageData(source: ImageData): ImageData {
  const output = new ImageData(source.width, source.height);
  const input = source.data;
  const data = output.data;

  let sum = 0;
  let yellowPixels = 0;
  for (let index = 0; index < input.length; index += 4) {
    const red = input[index];
    const green = input[index + 1];
    const blue = input[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    sum += gray;
    if (isCooldownYellowPixel(red, green, blue)) {
      yellowPixels++;
    }
  }

  const pixelCount = input.length / 4;
  const average = sum / pixelCount;
  const threshold = Math.max(95, Math.min(205, average + 18));
  const useYellowMask = yellowPixels / pixelCount > 0.015;

  for (let index = 0; index < input.length; index += 4) {
    const red = input[index];
    const green = input[index + 1];
    const blue = input[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrasted = (gray - 128) * 1.55 + 128;
    const value = useYellowMask
      ? isCooldownYellowPixel(red, green, blue)
        ? 255
        : 0
      : contrasted >= threshold
        ? 255
        : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  return output;
}

function isCooldownYellowPixel(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return (
    max - min >= 45 &&
    red >= 90 &&
    green >= 85 &&
    blue <= 135 &&
    red > blue * 1.25 &&
    green > blue * 1.2 &&
    Math.abs(red - green) <= 85
  );
}
