import type {
  HuntStallImageReadingResult,
  HuntStallReading,
  HuntStallTextOcrResult,
} from "../../../contracts/recognition/huntStallExperienceRecognition";
import { countForegroundPixels } from "../../template-digit/segmentation";
import { createExperienceFingerprint } from "./experienceOcrFingerprint";
import type { ExperienceOcrV2Result } from "./experienceOcrV2";

export function buildHuntStallReadingFromProcessedImage(
  processedImageData: ImageData,
  ocr: HuntStallTextOcrResult,
): HuntStallReading {
  const foregroundPixels = countForegroundPixels(processedImageData);
  const foregroundRatio =
    foregroundPixels / Math.max(1, processedImageData.width * processedImageData.height);

  return {
    fingerprint: createExperienceFingerprint(processedImageData),
    recognizedText: ocr.text,
    debugText: ocr.debugText,
    confidence: ocr.confidence,
    foregroundRatio,
  };
}

export function buildHuntStallReadingFromExperienceOcrV2(
  ocr: ExperienceOcrV2Result,
  minConfidence: number,
): HuntStallImageReadingResult {
  const foregroundPixels = countForegroundPixels(ocr.processedImageData);
  const foregroundRatio =
    foregroundPixels / Math.max(1, ocr.processedImageData.width * ocr.processedImageData.height);
  const recognizedText = ocr.confidence >= minConfidence ? ocr.text : null;

  return {
    processedImageData: ocr.processedImageData,
    reading: {
      fingerprint: createExperienceFingerprint(ocr.processedImageData),
      recognizedText,
      debugText: recognizedText ? ocr.debugText : ocr.candidates[0]?.text ?? ocr.debugText,
      confidence: ocr.confidence,
      foregroundRatio,
      ocrCandidates: ocr.candidates.map((candidate) => ({
        text: candidate.text,
        source: candidate.source,
        score: candidate.score,
      })),
    },
  };
}
