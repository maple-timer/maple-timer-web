import { describe, expect, it } from "vitest";
import {
  dilateBinaryMask,
  erodeBinaryMask,
} from "./timerBinaryMaskMorphology";

describe("timer binary mask morphology", () => {
  it("dilates a single pixel into a cross-shaped neighborhood", () => {
    const output = dilateBinaryMask(
      Uint8Array.from([
        0, 0, 0,
        0, 1, 0,
        0, 0, 0,
      ]),
      3,
      3,
    );

    expect([...output]).toEqual([
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ]);
  });

  it("erodes pixels that do not have a full cross-shaped neighborhood", () => {
    const output = erodeBinaryMask(
      Uint8Array.from([
        0, 1, 0,
        1, 1, 1,
        0, 1, 0,
      ]),
      3,
      3,
    );

    expect([...output]).toEqual([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
  });
});
