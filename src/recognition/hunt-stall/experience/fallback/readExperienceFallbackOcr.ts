import { recognizeBox } from "../../../template-digit/matching";
import {
  type DigitBox,
  findForegroundComponents,
} from "../../../template-digit/segmentation";
import {
  mergeOverlappingExperienceBoxes,
  normalizeExperienceBoxToBitmap,
  splitWideExperienceBoxes,
} from "./experienceOcrBoxSegmentation";
import {
  isExperienceTextComponent,
  selectDominantExperienceTextRow,
} from "./experienceOcrPreprocess";
import {
  recognizeExperienceDigit,
  recognizeExperienceSymbol,
} from "./experienceOcrTemplateRecognizer";
import {
  normalizeExperienceTokens,
  type ExperienceToken,
} from "./experienceOcrTokenNormalizer";

export type ExperienceFallbackOcrResult = {
  text: string | null;
  confidence: number;
  debugText: string;
};

export function readExperienceFallbackOcr(imageData: ImageData): ExperienceFallbackOcrResult {
  const boxes = splitWideExperienceBoxes(
    imageData,
    mergeOverlappingExperienceBoxes(
      selectDominantExperienceTextRow(
        findForegroundComponents(imageData).filter((box) =>
          isExperienceTextComponent(box, imageData.width, imageData.height),
        ),
        imageData.height,
      ),
    ),
  );

  if (boxes.length === 0) {
    return { text: null, confidence: 0, debugText: "" };
  }

  const tokens = boxes.map((box) => recognizeExperienceToken(imageData, box, boxes));
  const debugText = tokens.map(formatExperienceDebugToken).join("");
  const text = normalizeExperienceTokens(tokens);
  const confidence =
    tokens.reduce((total, item) => total + item.confidence, 0) / Math.max(1, tokens.length);

  if (!text || confidence < 0.62) {
    return { text: null, confidence, debugText };
  }

  return { text, confidence, debugText };
}

function formatExperienceDebugToken(token: ExperienceToken): string {
  if (!token.text) {
    return "?";
  }
  return token.text === "separator" ? "." : token.text;
}

function recognizeExperienceToken(
  imageData: ImageData,
  box: DigitBox,
  allBoxes: DigitBox[],
): ExperienceToken {
  if (isSmallExperienceSeparator(box, imageData.height)) {
    return { text: "separator", confidence: 0.96, x: box.x, width: box.width };
  }

  const normalized = normalizeExperienceBoxToBitmap(imageData, box);
  const symbol = recognizeExperienceSymbol(normalized);
  if (symbol.text === "[" && symbol.confidence >= 0.68) {
    return { ...symbol, x: box.x, width: box.width };
  }
  if (symbol.text === "%" && symbol.confidence >= 0.78) {
    return { ...symbol, x: box.x, width: box.width };
  }

  const experienceDigit = recognizeExperienceDigit(normalized);
  if (experienceDigit.confidence >= 0.74) {
    return { ...experienceDigit, x: box.x, width: box.width };
  }
  if (symbol.text === "]" && symbol.confidence >= 0.68) {
    return { ...symbol, x: box.x, width: box.width };
  }

  const recognized = recognizeBox(imageData, box, allBoxes.length);
  return /^[0-9]$/.test(recognized.text)
    ? { ...recognized, x: box.x, width: box.width }
    : { text: "", confidence: 0, x: box.x, width: box.width };
}

function isSmallExperienceSeparator(box: DigitBox, imageHeight: number): boolean {
  return box.width <= Math.max(4, imageHeight * 0.22) && box.height <= Math.max(4, imageHeight * 0.24);
}
