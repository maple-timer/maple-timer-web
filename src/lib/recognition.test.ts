import { describe, expect, it } from "vitest";
import {
  preprocessCooldownImageData,
  recognizeCooldownDigits,
} from "../recognition/cooldown-digit/recognizeCooldownDigits";
import {
  digitTemplateEngine,
  getRecognitionEngine,
  preprocessImageData,
  recognizeDigits,
} from "./recognition";

describe("recognition compatibility facade", () => {
  it("keeps the legacy entry points on the canonical cooldown recognizer", () => {
    expect(preprocessImageData).toBe(preprocessCooldownImageData);
    expect(recognizeDigits).toBe(recognizeCooldownDigits);
    expect(digitTemplateEngine.recognize).toBe(recognizeCooldownDigits);
    expect(getRecognitionEngine()).toBe(digitTemplateEngine);
    expect(digitTemplateEngine).toMatchObject({
      id: "digit-template",
      label: "Cooldown Segment",
    });
  });
});
