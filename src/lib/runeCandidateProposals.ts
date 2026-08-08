import { collectPurpleComponents } from "./runeComponents";
import { collectRuneDiamondScanCandidates } from "./runeDiamondScan";
import { passesRuneCandidateProposalGate } from "./runeCandidateGate";
import type {
  RuneCandidate,
  RuneCandidateSource,
  RuneComponent,
} from "../recognition/rune/runeDetectionTypes";
import { buildPurpleMask } from "./runeMask";
import { scoreRuneComponent, scoreTallAttachedRuneComponent } from "./runeScoring";

const MIN_LINE_ATTACHED_COMPONENT_WIDTH = 24;
const MAX_LINE_ATTACHED_COMPONENT_HEIGHT = 32;
const MIN_LINE_ATTACHED_COMPONENT_ASPECT_RATIO = 1.45;
const MIN_LINE_SUPPRESSION_RUN_LENGTH = 16;
const MIN_LINE_RESCUE_COMPONENT_SIZE = 6;
const MAX_LINE_RESCUE_COMPONENT_SIZE = 22;
const MIN_TALL_ATTACHED_RUNE_WIDTH = 8;
const MAX_TALL_ATTACHED_RUNE_WIDTH = 16;
const MIN_TALL_ATTACHED_RUNE_HEIGHT = 20;
const MAX_TALL_ATTACHED_RUNE_HEIGHT = 34;
const MIN_TALL_ATTACHED_RUNE_PIXELS = 90;

export type RuneCandidateProposalResult = {
  mask: Uint8Array;
  purplePixels: number;
  componentCount: number;
  candidates: RuneCandidate[];
};

export function collectRuneCandidateProposals(imageData: ImageData): RuneCandidateProposalResult {
  const mask = buildPurpleMask(imageData);
  const { components, purplePixels, componentCount } = collectPurpleComponents(
    mask,
    imageData.width,
    imageData.height,
  );
  const candidates: RuneCandidate[] = components.flatMap((component) => {
    const candidate = scoreRuneComponent(component, imageData);
    return candidate ? [withSource(candidate, "component")] : [];
  });
  candidates.push(...collectLineAttachedRuneCandidates(mask, components, imageData));
  candidates.push(...collectTallAttachedRuneCandidates(components, imageData, candidates));
  candidates.push(...collectRuneDiamondScanCandidates(imageData, candidates));
  const gatedCandidates = candidates.filter((candidate) =>
    passesRuneCandidateProposalGate(imageData, candidate),
  );
  gatedCandidates.sort((a, b) => b.confidence - a.confidence);

  return {
    mask,
    purplePixels,
    componentCount,
    candidates: gatedCandidates,
  };
}

function collectTallAttachedRuneCandidates(
  components: RuneComponent[],
  imageData: ImageData,
  existingCandidates: RuneCandidate[],
): RuneCandidate[] {
  const candidates: RuneCandidate[] = [];

  for (const component of components) {
    if (!isTallAttachedRuneSizedComponent(component)) {
      continue;
    }

    const candidate = scoreTallAttachedRuneComponent(component, imageData);
    if (
      !candidate ||
      existingCandidates.some((existing) => overlapsCandidate(existing, candidate)) ||
      candidates.some((existing) => overlapsCandidate(existing, candidate))
    ) {
      continue;
    }
    candidates.push(withSource(candidate, "tall-attached"));
  }

  return candidates;
}

function collectLineAttachedRuneCandidates(
  mask: Uint8Array,
  components: RuneComponent[],
  imageData: ImageData,
): RuneCandidate[] {
  const candidates: RuneCandidate[] = [];

  for (const component of components) {
    if (!isLineAttachedComponent(component)) {
      continue;
    }

    const rescuedMask = suppressLongHorizontalRuns(mask, imageData.width, component);
    const { components: rescuedComponents } = collectPurpleComponents(
      rescuedMask,
      imageData.width,
      imageData.height,
    );

    for (const rescuedComponent of rescuedComponents) {
      if (
        !isInsideComponent(component, rescuedComponent) ||
        !isRescueSizedComponent(rescuedComponent)
      ) {
        continue;
      }

      const candidate = scoreRuneComponent(rescuedComponent, imageData, { allowLineRescue: true });
      if (!candidate || candidates.some((existing) => overlapsCandidate(existing, candidate))) {
        continue;
      }
      candidates.push(withSource(candidate, "line-rescue"));
    }
  }

  return candidates;
}

function isLineAttachedComponent(component: RuneComponent): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  return (
    width >= MIN_LINE_ATTACHED_COMPONENT_WIDTH &&
    height <= MAX_LINE_ATTACHED_COMPONENT_HEIGHT &&
    width / Math.max(1, height) >= MIN_LINE_ATTACHED_COMPONENT_ASPECT_RATIO
  );
}

function suppressLongHorizontalRuns(
  mask: Uint8Array,
  imageWidth: number,
  component: RuneComponent,
): Uint8Array {
  const rescuedMask = mask.slice();
  const minRunLength = Math.max(
    MIN_LINE_SUPPRESSION_RUN_LENGTH,
    Math.floor((component.maxX - component.minX + 1) * 0.08),
  );

  for (let y = component.minY; y <= component.maxY; y += 1) {
    let runStart = -1;
    for (let x = component.minX; x <= component.maxX + 1; x += 1) {
      const inBounds = x <= component.maxX;
      const isPurple = inBounds && mask[y * imageWidth + x] === 1;
      if (isPurple && runStart < 0) {
        runStart = x;
      }
      if (isPurple || runStart < 0) {
        continue;
      }

      const runEnd = x - 1;
      if (runEnd - runStart + 1 >= minRunLength) {
        for (let clearX = runStart; clearX <= runEnd; clearX += 1) {
          rescuedMask[y * imageWidth + clearX] = 0;
        }
      }
      runStart = -1;
    }
  }

  return rescuedMask;
}

function isInsideComponent(container: RuneComponent, component: RuneComponent): boolean {
  return (
    component.minX >= container.minX &&
    component.maxX <= container.maxX &&
    component.minY >= container.minY &&
    component.maxY <= container.maxY
  );
}

function isRescueSizedComponent(component: RuneComponent): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  return (
    width >= MIN_LINE_RESCUE_COMPONENT_SIZE &&
    height >= MIN_LINE_RESCUE_COMPONENT_SIZE &&
    width <= MAX_LINE_RESCUE_COMPONENT_SIZE &&
    height <= MAX_LINE_RESCUE_COMPONENT_SIZE
  );
}

function isTallAttachedRuneSizedComponent(component: RuneComponent): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  return (
    width >= MIN_TALL_ATTACHED_RUNE_WIDTH &&
    width <= MAX_TALL_ATTACHED_RUNE_WIDTH &&
    height >= MIN_TALL_ATTACHED_RUNE_HEIGHT &&
    height <= MAX_TALL_ATTACHED_RUNE_HEIGHT &&
    component.pixelCount >= MIN_TALL_ATTACHED_RUNE_PIXELS
  );
}

function overlapsCandidate(a: RuneCandidate, b: RuneCandidate): boolean {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return overlapArea / Math.max(1, smallerArea) > 0.6;
}

function withSource(candidate: RuneCandidate, source: RuneCandidateSource): RuneCandidate {
  return {
    ...candidate,
    source,
  };
}
