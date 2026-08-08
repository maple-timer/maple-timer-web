export const COOLDOWN_DIGIT_RECOGNIZER_VERSION = "cooldown-template-v1";

export type NumericRecognitionResult = {
  value: number | null;
  confidence: number;
  debug?: {
    digitCount?: number;
    foregroundRatio?: number;
    recognizedText?: string;
    reason?: string;
  };
};

export type CooldownDigitRecognitionResult = NumericRecognitionResult;
