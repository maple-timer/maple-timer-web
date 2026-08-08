import { describe, expect, it } from "vitest";
import { HuntStallExperienceProcessor } from "./huntStallExperienceProcessor";
import type { HuntStallExperienceProcessInput } from "./huntStallExperienceRuntime";

describe("HuntStallExperienceProcessor", () => {
  it("runs canonical recognition and retains processed evidence when requested", () => {
    const processor = new HuntStallExperienceProcessor(() => performance.now());
    const result = processor.process(makeInput());

    expect(result.selectedIndex).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      label: "manual-experience",
      regionPixels: { x: 10, y: 20, width: 24, height: 12 },
      barPercent: null,
      barConfidence: null,
      barCoverage: "unknown",
    });
    expect(result.candidates[0].processedImageData).toBeInstanceOf(ImageData);
    expect(result.reading).toMatchObject({
      barPercent: null,
      barConfidence: null,
      barCoverage: "unknown",
      correctionApplied: false,
    });
    expect(result.performance.candidateCount).toBe(1);
  });

  it("rejects a process input with no crop candidates", () => {
    const processor = new HuntStallExperienceProcessor(() => performance.now());

    expect(() => processor.process({ ...makeInput(), candidates: [] })).toThrow(
      "hunt-stall-worker-no-candidates",
    );
  });
});

function makeInput(): HuntStallExperienceProcessInput {
  return {
    sampleIndex: 1,
    sourceWidth: 1368,
    sourceHeight: 807,
    barStrips: [],
    candidates: [
      {
        label: "manual-experience",
        regionPixels: { x: 10, y: 20, width: 24, height: 12 },
        imageData: new ImageData(24, 12),
      },
    ],
    includePreview: true,
    includeReportDiagnostics: false,
    applyStreamingCorrection: false,
  };
}
