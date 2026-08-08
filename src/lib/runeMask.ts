export function rgbToHsv(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else {
      hue = 60 * ((r - g) / delta + 4);
    }
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function isRunePurple(red: number, green: number, blue: number): boolean {
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const isPurpleHue = hue >= 220 && hue <= 315;
  const hasPurpleChannelBias = blue > green * 1.08 && red > green * 0.78;
  return isPurpleHue && hasPurpleChannelBias && saturation >= 0.22 && value >= 0.34;
}

export function isRuneCorePurple(red: number, green: number, blue: number): boolean {
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const isSaturatedPurpleCore =
    hue >= 260 &&
    hue <= 310 &&
    red >= 145 &&
    green <= 165 &&
    blue >= 175 &&
    saturation >= 0.38 &&
    value >= 0.62;
  const isPaleMagentaRuneCore =
    hue >= 292 &&
    hue <= 306 &&
    red >= 230 &&
    green >= 150 &&
    green <= 198 &&
    blue >= 230 &&
    saturation >= 0.22 &&
    value >= 0.88;
  return isSaturatedPurpleCore || isPaleMagentaRuneCore;
}

export function isRuneOutline(red: number, green: number, blue: number): boolean {
  const { saturation, value } = rgbToHsv(red, green, blue);
  return value >= 0.55 && Math.min(red, green, blue) >= 75 && saturation <= 0.55;
}

export function isRuneDarkOutline(red: number, green: number, blue: number): boolean {
  const { value } = rgbToHsv(red, green, blue);
  return value <= 0.3 && Math.max(red, green, blue) <= 96;
}

export function buildPurpleMask(imageData: ImageData): Uint8Array {
  const mask = new Uint8Array(imageData.width * imageData.height);
  const { data } = imageData;

  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    if (data[source + 3] > 24 && isRunePurple(data[source], data[source + 1], data[source + 2])) {
      mask[target] = 1;
    }
  }

  return mask;
}
