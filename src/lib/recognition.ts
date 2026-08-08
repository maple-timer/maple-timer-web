import type { RecognitionResult } from "../types";
import {
  preprocessCooldownImageData,
  recognizeCooldownDigits,
} from "../recognition/cooldown-digit/recognizeCooldownDigits";

export const preprocessImageData = preprocessCooldownImageData;
export const recognizeDigits = recognizeCooldownDigits;

export type RecognitionEngine = {
  id: string;
  label: string;
  recognize: (imageData: ImageData) => RecognitionResult;
};

export const digitTemplateEngine: RecognitionEngine = {
  id: "digit-template",
  label: "Cooldown Segment",
  recognize: recognizeDigits,
};

export function getRecognitionEngine(): RecognitionEngine {
  return digitTemplateEngine;
}
