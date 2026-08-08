import { describe, expect, it } from "vitest";
import model from "./bottomRightCooldownCnn.model.json";
import { recognizeBottomRightCooldownCnn } from "./bottomRightCooldownCnnRuntime";
import {
  BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION,
} from "./bottomRightRemainingCountContract";
import { createBottomRightRemainingCountRecognizer } from "./bottomRightRemainingCountRecognizer";

describe("bottom-right remaining-count recognition", () => {
  it("keeps the generated model and raw runtime decision contract", () => {
    expect(model.version).toBe(BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION);

    const result = recognizeBottomRightCooldownCnn(createEmptyIcon(), model, {
      minConfidence: 0.62,
      maxCandidates: 5,
    });

    expect(result).toMatchObject({
      kind: "none",
      text: null,
      totalSeconds: null,
      expectedSeconds: null,
      format: "none",
      textRegion: "none",
      confidence: 0.8092,
      status: "medium",
      bestGuess: {
        className: "NULL",
        probability: 0.809194,
      },
      debug: {
        roi: { x: 8, y: 10, width: 24, height: 22 },
      },
    });
    expect(result.candidates.slice(0, 3).map((candidate: {
      className: string;
      probability: number;
    }) => [
      candidate.className,
      candidate.probability,
    ])).toEqual([
      ["NULL", 0.809194],
      ["2", 0.093175],
      ["5", 0.082718],
    ]);
  });

  it("maps the raw CNN result to the stable remaining-count observation", () => {
    const recognizer = createBottomRightRemainingCountRecognizer();

    expect(recognizer.getStatus()).toBe("ready");
    expect(recognizer.recognizeIfReady(createEmptyIcon())).toMatchObject({
      kind: "none",
      text: null,
      count: null,
      expectedCount: null,
      format: "none",
      textRegion: "none",
      confidence: 0.8092,
      status: "medium",
      bestGuess: {
        text: null,
        count: null,
        probability: 0.8092,
        className: "NULL",
      },
      debug: {
        roi: { x: 8, y: 10, width: 24, height: 22 },
      },
    });
  });
});

function createEmptyIcon() {
  return {
    width: 32,
    height: 32,
    data: new Uint8ClampedArray(32 * 32 * 4),
  };
}
