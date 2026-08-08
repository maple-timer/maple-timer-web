import type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
import { readExperienceOcrV2 } from "./experienceOcrV2";
import { readExperienceFallbackOcr } from "./fallback/readExperienceFallbackOcr";
import { preprocessExperienceImageData } from "./fallback/experienceOcrPreprocess";
import {
  buildHuntStallReadingFromExperienceOcrV2,
  buildHuntStallReadingFromProcessedImage,
} from "./huntStallReading";

const MAX_EXPERIENCE_OCR_V2_INPUT_HEIGHT = 45;
const MIN_EXPERIENCE_OCR_V2_CONFIDENCE = 0.5;

export { normalizeExperienceTokens } from "./fallback/experienceOcrTokenNormalizer";
export type { ExperienceToken } from "./fallback/experienceOcrTokenNormalizer";
export type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
export { getFingerprintDifference } from "./experienceOcrFingerprint";
export { preprocessExperienceImageData } from "./fallback/experienceOcrPreprocess";
export { recognizeExperienceDigitBitmap } from "./fallback/experienceOcrTemplateRecognizer";

export function readHuntStallReading(processed: ImageData): HuntStallReading {
  const ocr = readExperienceFallbackOcr(processed);
  return buildHuntStallReadingFromProcessedImage(processed, ocr);
}

export function readHuntStallReadingFromImageData(source: ImageData): {
  processedImageData: ImageData;
  reading: HuntStallReading;
} {
  if (source.height > MAX_EXPERIENCE_OCR_V2_INPUT_HEIGHT) {
    const processedImageData = preprocessExperienceImageData(source);
    return {
      processedImageData,
      reading: readHuntStallReading(processedImageData),
    };
  }

  const ocr = readExperienceOcrV2(source);
  return buildHuntStallReadingFromExperienceOcrV2(ocr, MIN_EXPERIENCE_OCR_V2_CONFIDENCE);
}
