import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuneSnapshot } from "../../alertTypes";
import {
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_THRESHOLD,
} from "../../recognition/rune/runeOnnxContract";
import {
  createRuneIssueReportSnapshot,
  createRuneReportFrameSample,
} from "./runeReportSnapshot";

const mocks = vi.hoisted(() => ({
  sampleVideoRegion: vi.fn(),
  cropRuneCandidateToUrl: vi.fn(),
  imageDataToUrl: vi.fn(),
  createRuneMaskPreview: vi.fn(),
  detect: vi.fn(),
}));

vi.mock("../../lib/capture", () => ({
  sampleVideoRegion: mocks.sampleVideoRegion,
}));

vi.mock("../../lib/imageData", () => ({
  cropRuneCandidateToUrl: mocks.cropRuneCandidateToUrl,
  imageDataToUrl: mocks.imageDataToUrl,
}));

vi.mock("../../lib/runeDetection", () => ({
  createRuneMaskPreview: mocks.createRuneMaskPreview,
}));

describe("rune report snapshot helpers", () => {
  beforeEach(() => {
    mocks.sampleVideoRegion.mockReset();
    mocks.cropRuneCandidateToUrl.mockReset();
    mocks.imageDataToUrl.mockReset();
    mocks.createRuneMaskPreview.mockReset();
    mocks.detect.mockReset();
  });

  it("builds frame evidence from the minimap region", async () => {
    const video = { readyState: HTMLMediaElement.HAVE_CURRENT_DATA } as HTMLVideoElement;
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const imageData = {} as ImageData;
    const candidate = { x: 1, y: 2, width: 12, height: 12, confidence: 0.82 };
    const detection = {
      detected: true,
      confidence: 0.82,
      candidates: [candidate],
      debug: { classifier: "rune-v13" },
    };
    const maskImageData = {} as ImageData;
    mocks.sampleVideoRegion.mockReturnValue({
      imageData,
      rawPreviewUrl: "data:image/png;base64,raw",
      region: { width: 120, height: 90 },
    });
    mocks.detect.mockResolvedValue(detection);
    mocks.createRuneMaskPreview.mockReturnValue(maskImageData);
    mocks.imageDataToUrl.mockReturnValue("data:image/png;base64,mask");
    mocks.cropRuneCandidateToUrl.mockReturnValue("data:image/png;base64,candidate");

    const frame = await createRuneReportFrameSample(video, region, {
      detect: mocks.detect,
    });

    expect(mocks.sampleVideoRegion).toHaveBeenCalledWith(video, region, true, 420);
    expect(mocks.detect).toHaveBeenCalledWith(imageData);
    expect(mocks.createRuneMaskPreview).toHaveBeenCalledWith(imageData, [candidate]);
    expect(frame).toMatchObject({
      detection,
      maskPreviewUrl: "data:image/png;base64,mask",
      candidatePreviewUrl: "data:image/png;base64,candidate",
    });
  });

  it("keeps the existing issue snapshot when the video is not ready", async () => {
    const existingSnapshot: RuneSnapshot = {
      sampledAt: 1_000,
      rawPreviewUrl: "data:image/png;base64,raw",
      maskPreviewUrl: "data:image/png;base64,mask",
      candidatePreviewUrl: null,
      candidateRawPreviewUrl: null,
      candidateMaskPreviewUrl: null,
      candidateRegionLabel: null,
      candidateSampledAt: null,
      candidate: null,
      detected: false,
      confidence: 0,
      candidateCount: 0,
    };

    const snapshot = await createRuneIssueReportSnapshot({
      existingSnapshot,
      video: null,
      region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      issueReason: "rune-missed",
      sampledAt: 2_000,
    });

    expect(snapshot).toBe(existingSnapshot);
    expect(mocks.sampleVideoRegion).not.toHaveBeenCalled();
  });

  it("creates an issue snapshot from the current frame", async () => {
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
    } as HTMLVideoElement;
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const candidate = { x: 3, y: 4, width: 14, height: 16, confidence: 0.91 };
    mocks.sampleVideoRegion.mockReturnValue({
      imageData: {} as ImageData,
      rawPreviewUrl: "data:image/png;base64,raw",
      region: { width: 300, height: 240 },
    });
    mocks.detect.mockResolvedValue({
      detected: true,
      confidence: 0.91,
      candidates: [candidate],
      debug: { classifier: "rune-v13" },
    });
    mocks.createRuneMaskPreview.mockReturnValue({} as ImageData);
    mocks.imageDataToUrl.mockReturnValue("data:image/png;base64,mask");
    mocks.cropRuneCandidateToUrl.mockReturnValue("data:image/png;base64,candidate");

    const snapshot = await createRuneIssueReportSnapshot({
      existingSnapshot: null,
      video,
      region,
      issueReason: "rune-missed",
      sampledAt: 2_000,
      detector: { detect: mocks.detect },
    });

    expect(snapshot).toMatchObject({
      sampledAt: 2_000,
      detectorVersion: "rune-v13",
      rawPreviewUrl: "data:image/png;base64,raw",
      maskPreviewUrl: "data:image/png;base64,mask",
      candidatePreviewUrl: "data:image/png;base64,candidate",
      candidateRawPreviewUrl: "data:image/png;base64,raw",
      candidateMaskPreviewUrl: "data:image/png;base64,mask",
      candidateRegionLabel: "14x16",
      candidateSampledAt: 2_000,
      detected: true,
      confidence: 0.91,
      candidateCount: 1,
    });
  });

  it("keeps the best model location as evidence when the score is below threshold", async () => {
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
    } as HTMLVideoElement;
    const imageData = {} as ImageData;
    const modelCandidate = {
      x: 10,
      y: 20,
      width: 18,
      height: 18,
      pixelCount: 0,
      confidence: 0.42,
      source: "onnx-full-frame" as const,
    };
    mocks.sampleVideoRegion.mockReturnValue({
      imageData,
      rawPreviewUrl: "data:image/png;base64,raw",
      region: { width: 300, height: 240 },
    });
    mocks.detect.mockResolvedValue({
      detected: false,
      confidence: 0.42,
      candidates: [],
      debug: {
        classifier: RUNE_ONNX_MODEL_VERSION,
        detectorKind: "onnx-full-frame",
        modelScore: 0.42,
        modelThreshold: RUNE_ONNX_THRESHOLD,
        modelCandidate,
        reason: "score-below-threshold",
      },
    });
    mocks.createRuneMaskPreview.mockReturnValue({} as ImageData);
    mocks.imageDataToUrl.mockReturnValue("data:image/png;base64,mask");
    mocks.cropRuneCandidateToUrl.mockReturnValue("data:image/png;base64,candidate");

    const snapshot = await createRuneIssueReportSnapshot({
      existingSnapshot: null,
      video,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      issueReason: "rune-missed",
      sampledAt: 3_000,
      detector: { detect: mocks.detect },
    });

    expect(mocks.createRuneMaskPreview).toHaveBeenCalledWith(imageData, [modelCandidate]);
    expect(snapshot).toMatchObject({
      detected: false,
      candidateCount: 0,
      candidate: {
        x: 10,
        y: 20,
        width: 18,
        height: 18,
        confidence: 0.42,
        source: "onnx-full-frame",
      },
      candidatePreviewUrl: "data:image/png;base64,candidate",
      detectionDebug: {
        detectorKind: "onnx-full-frame",
        modelScore: 0.42,
        modelThreshold: RUNE_ONNX_THRESHOLD,
        reason: "score-below-threshold",
      },
    });
  });
});
