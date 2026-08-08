export type HuntStallReading = {
  fingerprint: string;
  recognizedText: string | null;
  debugText?: string;
  confidence: number;
  foregroundRatio: number;
  ocrCandidates?: Array<{ text: string; source: string; score: number }>;
  rawRecognizedText?: string | null;
  correctedRecognizedText?: string | null;
  correctionApplied?: boolean;
  correctionReason?: string | null;
  barPercent?: number | null;
  barConfidence?: number | null;
  barCoverage?: "no_bar" | "partial_bar" | "full_bar" | "unknown";
  oneFrameRecognizedText?: string | null;
};

export type HuntStallTextOcrResult = {
  text: string | null;
  debugText: string;
  confidence: number;
};

export type HuntStallImageReadingResult = {
  processedImageData: ImageData;
  reading: HuntStallReading;
};
