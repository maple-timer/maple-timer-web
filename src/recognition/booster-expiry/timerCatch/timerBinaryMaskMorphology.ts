export function dilateBinaryMask(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const output = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (
        data[index] ||
        (x > 0 && data[index - 1]) ||
        (x + 1 < width && data[index + 1]) ||
        (y > 0 && data[index - width]) ||
        (y + 1 < height && data[index + width])
      ) {
        output[index] = 1;
      }
    }
  }
  return output;
}

export function erodeBinaryMask(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const output = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (
        data[index] &&
        (x === 0 || data[index - 1]) &&
        (x + 1 === width || data[index + 1]) &&
        (y === 0 || data[index - width]) &&
        (y + 1 === height || data[index + width])
      ) {
        output[index] = 1;
      }
    }
  }
  return output;
}
