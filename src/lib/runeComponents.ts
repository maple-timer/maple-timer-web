import type { RuneComponent } from "../recognition/rune/runeDetectionTypes";

export type RuneComponentCollection = {
  components: RuneComponent[];
  purplePixels: number;
  componentCount: number;
};

export function collectPurpleComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): RuneComponentCollection {
  const visited = new Uint8Array(mask.length);
  const components: RuneComponent[] = [];
  let purplePixels = 0;
  let componentCount = 0;

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      purplePixels += 1;
    }

    if (!mask[index] || visited[index]) {
      continue;
    }

    componentCount += 1;
    components.push(collectComponent(mask, visited, width, height, index));
  }

  return { components, purplePixels, componentCount };
}

function collectComponent(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startIndex: number,
): RuneComponent {
  const stack = [startIndex];
  visited[startIndex] = 1;
  const component: RuneComponent = {
    minX: width,
    minY: height,
    maxX: 0,
    maxY: 0,
    pixelCount: 0,
    rows: new Map(),
  };

  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    const x = index % width;
    const y = Math.floor(index / width);
    component.minX = Math.min(component.minX, x);
    component.minY = Math.min(component.minY, y);
    component.maxX = Math.max(component.maxX, x);
    component.maxY = Math.max(component.maxY, y);
    component.pixelCount += 1;

    const row = component.rows.get(y) ?? { minX: x, maxX: x, count: 0 };
    row.minX = Math.min(row.minX, x);
    row.maxX = Math.max(row.maxX, x);
    row.count += 1;
    component.rows.set(y, row);

    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (
        next < 0 ||
        next >= mask.length ||
        visited[next] ||
        !mask[next] ||
        (next === index - 1 && x === 0) ||
        (next === index + 1 && x === width - 1)
      ) {
        continue;
      }
      visited[next] = 1;
      stack.push(next);
    }
  }

  return component;
}
