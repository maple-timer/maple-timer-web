import { describe, expect, it } from "vitest";
import {
  getBuffExpiryCaptureRoi,
  getBuffExpiryFrameCalibration,
} from "./buffExpiryCalibration";
// @ts-expect-error The copied detector is a plain browser ESM asset under public/.
import { getFrameCalibration as getExternalDetectorFrameCalibration } from "../../../public/buff-expiry/external/src/detector/calibration.js";

describe("buffExpiryCalibration", () => {
  it("calibrates a native 1920x1080 capture", () => {
    const calibration = getBuffExpiryFrameCalibration(1920, 1080);

    expect(calibration).toMatchObject({
      resolutionKey: "1920x1080",
      gameRect: { x: 0, y: 0, width: 1920, height: 1080 },
      sideCandidates: [34, 47],
      unsupportedReason: null,
    });
  });

  it("calibrates captures that include a browser or OS title bar", () => {
    const calibration = getBuffExpiryFrameCalibration(1922, 1112);

    expect(calibration).toMatchObject({
      resolutionKey: "1920x1080",
      gameRect: { x: 1, y: 32, width: 1920, height: 1080 },
      sideCandidates: [34, 47],
      unsupportedReason: null,
    });
  });

  it("returns the in-game upper-right ROI for supported captures", () => {
    const { roi } = getBuffExpiryCaptureRoi(1922, 1112);

    expect(roi).toEqual({
      x: 961,
      y: 32,
      width: 960,
      height: 486,
    });
  });

  it("keeps 2560x1600 crop side candidates when the ROI resembles 1280x720", () => {
    const { calibration, roi } = getBuffExpiryCaptureRoi(2560, 1600);

    expect(calibration.resolutionKey).toBe("2560x1600");
    expect(calibration.sideCandidates).toEqual([66, 67]);
    expect(roi).toEqual({
      x: 1280,
      y: 0,
      width: 1280,
      height: 720,
    });

    const externalCalibration = getExternalDetectorFrameCalibration(roi.width, roi.height, {
      fallbackSides: calibration.sideCandidates,
      forceFallbackSides: true,
      roiStartXRatio: 0,
      roiEndYRatio: 1,
    });

    expect(externalCalibration).toMatchObject({
      resolutionKey: null,
      sideCandidates: [66, 67],
      gameRect: { x: 0, y: 0, width: 1280, height: 720 },
      matched: false,
    });
  });

  it("marks unknown resolutions unsupported", () => {
    const calibration = getBuffExpiryFrameCalibration(1814, 1000);

    expect(calibration.resolutionKey).toBeNull();
    expect(calibration.sideCandidates).toEqual([]);
    expect(calibration.unsupportedReason).toContain("지원하지 않는 해상도");
  });
});
