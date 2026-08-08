import type { RuneCandidate } from "../recognition/rune/runeDetectionTypes";
import { passesRuneCandidateFinalGate } from "./runeCandidateGate";
import { getRuneCandidateCnnCropBounds } from "./runeCandidateCnnCrop";
import { isRuneCorePurple, isRunePurple } from "./runeMask";
import {
  conv1Bias,
  conv1Weight,
  conv2Bias,
  conv2Weight,
  conv3Bias,
  conv3Weight,
  dense1Bias,
  dense1Weight,
  dense2Bias,
  dense2Weight,
  RUNE_CNN_INPUT_SIZE,
  RUNE_CNN_MODEL_VERSION,
  RUNE_CNN_THRESHOLD,
} from "./runeCnnModelData";

const MAX_CLASSIFIED_CANDIDATES = 16;
const COMPACT_COMPONENT_RESCUE_MAX_DIMENSION = 7;
const MIN_COMPACT_COMPONENT_RESCUE_CONFIDENCE = 0.81;
const MIN_COMPACT_COMPONENT_RESCUE_PIXELS = 20;
const COMPACT_CORE_DIAMOND_RESCUE_MAX_DIMENSION = 12;
const COMPACT_CORE_DIAMOND_RESCUE_MIN_DIMENSION = 7;
const MIN_COMPACT_CORE_DIAMOND_RESCUE_CONFIDENCE = 0.62;
const MIN_COMPACT_CORE_DIAMOND_RESCUE_CNN_SCORE = 0.78;
const MIN_COMPACT_CORE_DIAMOND_RESCUE_PIXELS = 34;

type ClassifiedRuneCandidate = RuneCandidate & {
  heuristicConfidence: number;
  cnnScore: number;
};

type ScoredRuneCandidate = ClassifiedRuneCandidate & {
  passesFinalGate: boolean;
  structuralRescue: boolean;
};

export type RuneCnnClassificationResult = {
  candidates: ClassifiedRuneCandidate[];
  confidence: number;
  detected: boolean;
};

export { RUNE_CNN_MODEL_VERSION, RUNE_CNN_THRESHOLD };

export function classifyRuneCandidatesWithCnn(
  imageData: ImageData,
  candidates: RuneCandidate[],
): RuneCnnClassificationResult {
  const accepted = candidates
    .slice(0, MAX_CLASSIFIED_CANDIDATES)
    .map((candidate) => {
      const score = scoreRuneCandidateWithCnn(imageData, candidate);
      const classified = {
        ...candidate,
        heuristicConfidence: candidate.confidence,
        cnnScore: score,
        confidence: score,
      };
      const passesFinalGate = passesRuneCandidateFinalGate(imageData, classified);
      const structuralRescue = passesFinalGate && isCompactComponentStructuralRune(classified);
      return {
        ...classified,
        confidence: structuralRescue ? Math.max(score, candidate.confidence) : score,
        passesFinalGate,
        structuralRescue,
      };
    })
    .filter(
      (candidate) =>
        candidate.passesFinalGate &&
        (candidate.cnnScore >= RUNE_CNN_THRESHOLD || candidate.structuralRescue),
    )
    .map(stripScoringDiagnostics)
    .sort((a, b) => b.confidence - a.confidence);
  const confidence = accepted[0]?.confidence ?? 0;

  return {
    candidates: accepted,
    confidence,
    detected: accepted.length > 0,
  };
}

export function scoreRuneCandidateWithCnn(imageData: ImageData, candidate: RuneCandidate): number {
  const input = renderRuneCandidateFeatures(imageData, candidate);
  const conv1 = reluConv2dSame(input, 3, 48, 48, conv1Weight, conv1Bias, 8);
  const pool1 = maxPool2d(conv1, 8, 48, 48);
  const conv2 = reluConv2dSame(pool1, 8, 24, 24, conv2Weight, conv2Bias, 16);
  const pool2 = maxPool2d(conv2, 16, 24, 24);
  const conv3 = reluConv2dSame(pool2, 16, 12, 12, conv3Weight, conv3Bias, 24);
  const pool3 = maxPool2d(conv3, 24, 12, 12);
  const dense1 = reluDense(pool3, dense1Weight, dense1Bias, 48);
  const logit = dense(dense1, dense2Weight, dense2Bias, 1)[0] ?? 0;
  return sigmoid(logit);
}

function isCompactComponentStructuralRune(candidate: ClassifiedRuneCandidate): boolean {
  const maxDimension = Math.max(candidate.width, candidate.height);
  const isTinyComponentRune =
    candidate.source === "component" &&
    maxDimension <= COMPACT_COMPONENT_RESCUE_MAX_DIMENSION &&
    candidate.pixelCount >= MIN_COMPACT_COMPONENT_RESCUE_PIXELS &&
    candidate.heuristicConfidence >= MIN_COMPACT_COMPONENT_RESCUE_CONFIDENCE;
  const isCoreDiamondRune =
    candidate.source === "component" &&
    maxDimension <= COMPACT_CORE_DIAMOND_RESCUE_MAX_DIMENSION &&
    Math.min(candidate.width, candidate.height) >= COMPACT_CORE_DIAMOND_RESCUE_MIN_DIMENSION &&
    candidate.pixelCount >= MIN_COMPACT_CORE_DIAMOND_RESCUE_PIXELS &&
    candidate.heuristicConfidence >= MIN_COMPACT_CORE_DIAMOND_RESCUE_CONFIDENCE &&
    candidate.cnnScore >= MIN_COMPACT_CORE_DIAMOND_RESCUE_CNN_SCORE;

  return (
    isTinyComponentRune ||
    isCoreDiamondRune
  );
}

function stripScoringDiagnostics(candidate: ScoredRuneCandidate): ClassifiedRuneCandidate {
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    pixelCount: candidate.pixelCount,
    confidence: candidate.confidence,
    heuristicConfidence: candidate.heuristicConfidence,
    cnnScore: candidate.cnnScore,
    source: candidate.source,
  };
}

function renderRuneCandidateFeatures(
  imageData: ImageData,
  candidate: RuneCandidate,
): Float32Array {
  const output = new Float32Array(3 * RUNE_CNN_INPUT_SIZE * RUNE_CNN_INPUT_SIZE);
  const bounds = getRuneCandidateCnnCropBounds(imageData, candidate);

  for (let targetY = 0; targetY < RUNE_CNN_INPUT_SIZE; targetY += 1) {
    for (let targetX = 0; targetX < RUNE_CNN_INPUT_SIZE; targetX += 1) {
      const sourceX = Math.min(
        imageData.width - 1,
        Math.max(0, Math.floor(bounds.left + (targetX / RUNE_CNN_INPUT_SIZE) * bounds.size)),
      );
      const sourceY = Math.min(
        imageData.height - 1,
        Math.max(0, Math.floor(bounds.top + (targetY / RUNE_CNN_INPUT_SIZE) * bounds.size)),
      );
      const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
      const sourceRed = imageData.data[sourceIndex] ?? 0;
      const sourceGreen = imageData.data[sourceIndex + 1] ?? 0;
      const sourceBlue = imageData.data[sourceIndex + 2] ?? 0;
      const isRuneColor =
        isRunePurple(sourceRed, sourceGreen, sourceBlue) ||
        isRuneCorePurple(sourceRed, sourceGreen, sourceBlue);
      const pixelIndex = targetY * RUNE_CNN_INPUT_SIZE + targetX;
      if (!isRuneColor) {
        continue;
      }

      const red = sourceRed / 255;
      const green = sourceGreen / 255;
      const blue = sourceBlue / 255;
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const magenta = clamp01((red + blue) * 0.5 - green);
      const purpleBias = clamp01(Math.min(red, blue) - green * 0.65);
      const saturation = maxChannel - minChannel;
      output[pixelIndex] = magenta;
      output[RUNE_CNN_INPUT_SIZE * RUNE_CNN_INPUT_SIZE + pixelIndex] = purpleBias;
      output[2 * RUNE_CNN_INPUT_SIZE * RUNE_CNN_INPUT_SIZE + pixelIndex] = saturation;
    }
  }

  return output;
}

function reluConv2dSame(
  input: Float32Array,
  inputChannels: number,
  width: number,
  height: number,
  weights: Float32Array,
  bias: Float32Array,
  outputChannels: number,
): Float32Array {
  const output = new Float32Array(outputChannels * width * height);
  const spatialSize = width * height;

  for (let outputChannel = 0; outputChannel < outputChannels; outputChannel += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = bias[outputChannel] ?? 0;
        for (let inputChannel = 0; inputChannel < inputChannels; inputChannel += 1) {
          for (let kernelY = 0; kernelY < 3; kernelY += 1) {
            const sourceY = y + kernelY - 1;
            if (sourceY < 0 || sourceY >= height) {
              continue;
            }
            for (let kernelX = 0; kernelX < 3; kernelX += 1) {
              const sourceX = x + kernelX - 1;
              if (sourceX < 0 || sourceX >= width) {
                continue;
              }
              const inputIndex = inputChannel * spatialSize + sourceY * width + sourceX;
              const weightIndex =
                (((outputChannel * inputChannels + inputChannel) * 3 + kernelY) * 3) + kernelX;
              sum += input[inputIndex] * weights[weightIndex];
            }
          }
        }
        output[outputChannel * spatialSize + y * width + x] = Math.max(0, sum);
      }
    }
  }

  return output;
}

function maxPool2d(input: Float32Array, channels: number, width: number, height: number): Float32Array {
  const outputWidth = Math.floor(width / 2);
  const outputHeight = Math.floor(height / 2);
  const output = new Float32Array(channels * outputWidth * outputHeight);
  const inputSpatialSize = width * height;
  const outputSpatialSize = outputWidth * outputHeight;

  for (let channel = 0; channel < channels; channel += 1) {
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const sourceX = x * 2;
        const sourceY = y * 2;
        let maxValue = Number.NEGATIVE_INFINITY;
        for (let offsetY = 0; offsetY < 2; offsetY += 1) {
          for (let offsetX = 0; offsetX < 2; offsetX += 1) {
            const inputIndex = channel * inputSpatialSize + (sourceY + offsetY) * width + sourceX + offsetX;
            maxValue = Math.max(maxValue, input[inputIndex]);
          }
        }
        output[channel * outputSpatialSize + y * outputWidth + x] = maxValue;
      }
    }
  }

  return output;
}

function reluDense(input: Float32Array, weights: Float32Array, bias: Float32Array, outputUnits: number) {
  const output = dense(input, weights, bias, outputUnits);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.max(0, output[index]);
  }
  return output;
}

function dense(input: Float32Array, weights: Float32Array, bias: Float32Array, outputUnits: number) {
  const output = new Float32Array(outputUnits);
  for (let unit = 0; unit < outputUnits; unit += 1) {
    let sum = bias[unit] ?? 0;
    const weightOffset = unit * input.length;
    for (let index = 0; index < input.length; index += 1) {
      sum += input[index] * weights[weightOffset + index];
    }
    output[unit] = sum;
  }
  return output;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
