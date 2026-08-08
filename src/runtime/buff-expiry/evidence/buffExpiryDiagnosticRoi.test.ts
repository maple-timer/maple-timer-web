import { describe, expect, it } from "vitest";
import { getBuffExpiryPrecisionDiagnosticRoi } from "./buffExpiryDiagnosticRoi";

describe("getBuffExpiryPrecisionDiagnosticRoi", () => {
  it.each([
    { width: 1920, height: 1080, expected: { x: 883, y: 0, width: 1037, height: 389 } },
    { width: 1368, height: 800, expected: { x: 629, y: 0, width: 739, height: 288 } },
    { width: 1, height: 1, expected: { x: 0, y: 0, width: 1, height: 1 } },
  ])("keeps the existing diagnostic crop for $width x $height", ({ width, height, expected }) => {
    expect(getBuffExpiryPrecisionDiagnosticRoi(width, height)).toEqual(expected);
  });
});
