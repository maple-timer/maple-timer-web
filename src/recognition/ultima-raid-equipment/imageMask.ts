export type RelativePixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ConnectedComponent = {
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveRelativeRegion(
  image: ImageData,
  region: RelativePixelRegion,
): PixelRegion {
  const x = Math.max(0, Math.floor(image.width * region.x));
  const y = Math.max(0, Math.floor(image.height * region.y));
  const right = Math.min(
    image.width,
    Math.max(x + 1, Math.ceil(image.width * (region.x + region.width))),
  );
  const bottom = Math.min(
    image.height,
    Math.max(y + 1, Math.ceil(image.height * (region.y + region.height))),
  );

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function forEachPixel(
  image: ImageData,
  region: PixelRegion,
  visit: (pixel: {
    localIndex: number;
    red: number;
    green: number;
    blue: number;
    alpha: number;
  }) => void,
) {
  for (let localY = 0; localY < region.height; localY += 1) {
    for (let localX = 0; localX < region.width; localX += 1) {
      const imageOffset =
        ((region.y + localY) * image.width + region.x + localX) * 4;
      visit({
        localIndex: localY * region.width + localX,
        red: image.data[imageOffset],
        green: image.data[imageOffset + 1],
        blue: image.data[imageOffset + 2],
        alpha: image.data[imageOffset + 3],
      });
    }
  }
}

export function findLargestConnectedComponent(
  mask: Uint8Array,
  width: number,
  height: number,
): ConnectedComponent {
  const components = findConnectedComponents(mask, width, height);
  let largest: ConnectedComponent = {
    size: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  for (const component of components) {
    if (component.size > largest.size) {
      largest = component;
    }
  }

  return largest;
}

export function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): ConnectedComponent[] {
  const queue = new Int32Array(mask.length);
  const components: ConnectedComponent[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let clusterSize = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue[tail] = start;
    tail += 1;
    mask[start] = 2;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      clusterSize += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) {
        tail = enqueueMaskedNeighbor(mask, queue, current - 1, tail);
      }
      if (x + 1 < width) {
        tail = enqueueMaskedNeighbor(mask, queue, current + 1, tail);
      }
      if (y > 0) {
        tail = enqueueMaskedNeighbor(mask, queue, current - width, tail);
      }
      if (y + 1 < height) {
        tail = enqueueMaskedNeighbor(mask, queue, current + width, tail);
      }
    }

    components.push({
      size: clusterSize,
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }

  return components;
}

function enqueueMaskedNeighbor(
  mask: Uint8Array,
  queue: Int32Array,
  index: number,
  tail: number,
): number {
  if (mask[index] !== 1) {
    return tail;
  }

  mask[index] = 2;
  queue[tail] = index;
  return tail + 1;
}
