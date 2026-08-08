import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUNE_ONNX_APPEARANCE_THRESHOLD,
  RUNE_ONNX_MODEL_VERSION,
  RUNE_ONNX_SHAPE_THRESHOLD,
  RUNE_ONNX_THRESHOLD,
} from "../../../../../recognition/rune/runeOnnxContract";
import type { TroubleshooterViewModel } from "../../model";
import { runRuneRecognition } from "./rune";

const workerMocks = vi.hoisted(() => ({
  detect: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../../../../platform/runtime-workers/rune/runeDetectionWorkerClient", () => ({
  createRuneDetectionWorkerClient: () => workerMocks,
}));

describe("runRuneRecognition", () => {
  beforeEach(() => {
    workerMocks.detect.mockReset();
    workerMocks.reset.mockReset();
  });

  it("shows the current model version without pretending to replay temporal confirmation", async () => {
    workerMocks.detect.mockResolvedValue({
      detected: true,
      confidence: 0.99,
      candidates: [
        {
          x: 10,
          y: 20,
          width: 14,
          height: 14,
          pixelCount: 80,
          confidence: 0.99,
          cnnScore: 0.995,
        },
      ],
      debug: {
        purplePixelRatio: 0.01,
        componentCount: 3,
        proposalCount: 2,
        classifier: "rune-v13",
      },
    });

    const result = await runRuneRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      view: {} as TroubleshooterViewModel,
    });

    expect(result.metrics).toContainEqual(
      expect.objectContaining({ label: "현재 모델", value: "rune-v13" }),
    );
    expect(result.stages).toEqual([
      expect.objectContaining({ label: "보라색 후보 탐색", summary: "2개 후보" }),
      expect.objectContaining({ label: "룬 형태 판정", summary: "룬 확정" }),
    ]);
    expect(result.stages.some((stage) => stage.label.includes("연속 감지"))).toBe(false);
    expect(workerMocks.reset).toHaveBeenCalledOnce();
  });

  it("shows the cascade proposal and independent gate decisions", async () => {
    workerMocks.detect.mockResolvedValue({
      detected: false,
      confidence: 0.48,
      candidates: [],
      debug: {
        proposalCount: 5,
        classifier: RUNE_ONNX_MODEL_VERSION,
        detectorKind: "onnx-cascade",
        selectedProposalRank: 2,
        shapeScore: 0.95,
        shapeThreshold: RUNE_ONNX_SHAPE_THRESHOLD,
        shapePass: true,
        appearanceScore: 0.7,
        appearanceThreshold: RUNE_ONNX_APPEARANCE_THRESHOLD,
        appearancePass: false,
        modelScore: 0.48,
        modelThreshold: RUNE_ONNX_THRESHOLD,
        reason: "appearance-below-threshold",
      },
    });

    const result = await runRuneRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      view: {} as TroubleshooterViewModel,
    });

    expect(result.metrics).toContainEqual(
      expect.objectContaining({ label: "최종 판정 점수", value: "48%" }),
    );
    expect(result.stages).toEqual([
      expect.objectContaining({ label: "후보 위치 탐색", summary: "5개 후보" }),
      expect.objectContaining({ label: "반듯한 마름모 형태 확인", summary: "형태 통과" }),
      expect.objectContaining({ label: "룬 색감·외형 확인", summary: "외형 탈락" }),
      expect.objectContaining({ label: "두 조건 결합", summary: "룬 아님" }),
    ]);
    expect(result.stages.some((stage) => stage.label.includes("보라색 후보"))).toBe(false);
    expect(workerMocks.reset).toHaveBeenCalledOnce();
  });

  it("reruns the exact alert trigger frames through the current confirmation flow", async () => {
    workerMocks.detect.mockImplementation(async () => ({
      detected: true,
      confidence: 0.91,
      candidates: [
        {
          x: 20,
          y: 30,
          width: 12,
          height: 12,
          pixelCount: 0,
          confidence: 0.91,
          source: "onnx-cascade",
        },
      ],
      debug: {
        proposalCount: 5,
        classifier: RUNE_ONNX_MODEL_VERSION,
        detectorKind: "onnx-cascade",
        selectedProposalRank: 1,
        shapeScore: 0.97,
        shapeThreshold: RUNE_ONNX_SHAPE_THRESHOLD,
        shapePass: true,
        appearanceScore: 0.96,
        appearanceThreshold: RUNE_ONNX_APPEARANCE_THRESHOLD,
        appearancePass: true,
        modelScore: 0.91,
        modelThreshold: RUNE_ONNX_THRESHOLD,
      },
    }));

    const result = await runRuneRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      view: {} as TroubleshooterViewModel,
      sequenceFrames: [1_000, 2_000, 3_000, 4_000].map((sampledAt, index) => ({
        imageData: {} as ImageData,
        sampledAt,
        label: `프레임 ${index + 1}`,
        src: `data:image/png;base64,${index + 1}`,
      })),
    });

    expect(workerMocks.detect).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      tone: "positive",
      title: "현재 모델도 저장된 알림 흐름을 확정함",
    });
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "모델 감지", value: "4/4개" }),
        expect.objectContaining({ label: "알림 확정", value: "예" }),
      ]),
    );
    expect(result.stages[result.stages.length - 1]).toMatchObject({
      label: "현재 확정 로직 재현",
      status: "complete",
    });
    expect(result.evidence).toHaveLength(4);
    expect(workerMocks.reset).toHaveBeenCalledOnce();
  });
});
