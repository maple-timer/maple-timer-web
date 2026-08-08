import { describe, expect, it, vi } from "vitest";
import type { TroubleshooterViewModel } from "../../model";
import { runSkillRecognition } from "./skill";

const mocks = vi.hoisted(() => ({
  preprocessCooldownImageData: vi.fn(),
  recognizeCooldownDigits: vi.fn(),
  process: vi.fn(),
  reset: vi.fn(),
  target: {
    skillId: "janusDeepV2",
    detectorId: "skill-deep-v2:janus",
    matcherEngine: "skill-bundle-v1",
    matcherSkillId: "janus",
    displayName: "솔 야누스: 새벽 (정밀)",
    shortName: "야누스",
    maxBuffRowIndex: 1,
    valueKind: "countdown",
  } as Record<string, unknown>,
}));

vi.mock("../../../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient", () => ({
  createSkillBuffDurationEngine: () => ({
    process: mocks.process,
    reset: mocks.reset,
  }),
}));

vi.mock("../../../../../lib/skillBuffDuration/skillBuffDurationTargets", () => ({
  getSkillBuffDurationTargetForPresetId: () => mocks.target,
}));

vi.mock("../../../../../recognition/cooldown-digit/recognizeCooldownDigits", () => ({
  preprocessCooldownImageData: mocks.preprocessCooldownImageData,
  recognizeCooldownDigits: mocks.recognizeCooldownDigits,
}));

vi.mock("../imageData", () => ({
  iconToDataUrl: () => "data:image/png;base64,icon",
  imageDataToDataUrl: () => "data:image/png;base64,processed",
}));

describe("runSkillRecognition", () => {
  it("uses the canonical cooldown recognizer for quick-slot samples", async () => {
    const imageData = {} as ImageData;
    const processedImageData = {} as ImageData;
    mocks.preprocessCooldownImageData.mockReturnValue(processedImageData);
    mocks.recognizeCooldownDigits.mockReturnValue({
      value: 42,
      confidence: 0.95,
      debug: { digitCount: 2 },
    });

    const result = await runSkillRecognition({
      imageData,
      startedAt: performance.now(),
      view: {
        modeLabel: "퀵슬롯 감지",
        rawSample: {
          body: {
            kind: "skill-issue",
            skill: { config: { detectionSource: "quickslot" } },
          },
        },
      } as TroubleshooterViewModel,
    });

    expect(mocks.preprocessCooldownImageData).toHaveBeenCalledWith(imageData);
    expect(mocks.recognizeCooldownDigits).toHaveBeenCalledWith(processedImageData);
    expect(result.title).toBe("현재 인식값 42초");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "판독값", value: "42초" }),
        expect.objectContaining({ label: "인식기", value: "cooldown-template-v1" }),
      ]),
    );
  });

  it("shows the current bundle and positive-gate rejection without claiming a match", async () => {
    mocks.target = {
      skillId: "janusDeepV2",
      detectorId: "skill-deep-v2:janus",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "janus",
      displayName: "솔 야누스: 새벽 (정밀)",
      shortName: "야누스",
      maxBuffRowIndex: 1,
      valueKind: "countdown",
    };
    mocks.process.mockResolvedValue({
      boxCount: 18,
      parserVersion: "parser-current",
      detectedIcon: null,
      candidateIcons: [],
      detectionsBySkillId: {
        janusDeepV2: {
          detectedIcon: null,
          candidateIcons: [
            {
              icon: { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) },
              match: {
                matched: false,
                skillId: "janus",
                displayName: "야누스",
                matcherEngine: "skill-bundle-v1",
                bundleId: "skill-deep-v2",
                modelVersion: "shared-current-v2",
                baseSkillId: "janus",
                score: 1.2,
                threshold: -0.3,
                margin: 1.5,
                gateScore: 0.92,
                gateThreshold: 0.95,
                gateMargin: -0.03,
                decisionReason: "positive_gate_below_threshold",
              },
              countdown: null,
            },
          ],
        },
      },
    });

    const result = await runSkillRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      buffSlotInputMode: "topRightQuadrant",
      view: {
        modeLabel: "버프칸 정밀 감지",
        rawSample: {
          body: {
            kind: "skill-issue",
            skill: { config: { presetId: "sol-janus-dawn-deep-v2", detectionSource: "buff-duration" } },
          },
        },
      } as TroubleshooterViewModel,
    });

    expect(result.tone).toBe("warning");
    expect(result.title).toContain("아이콘 형태 검증이 기준에 미달");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "matcher 판정", value: "아이콘 형태 검증 기준 미달" }),
        expect.objectContaining({ label: "형태 점수", value: "0.92" }),
        expect.objectContaining({ label: "형태 기준", value: "0.95" }),
        expect.objectContaining({ label: "matcher 번들", value: "skill-deep-v2" }),
        expect.objectContaining({ label: "matcher", value: "shared-current-v2" }),
      ]),
    );
    expect(result.stages.find((stage) => stage.id === "matcher")).toMatchObject({
      status: "warning",
      summary: "아이콘 형태 검증 기준 미달",
    });
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({ buffSlotInputMode: "topRightQuadrant" }),
    );
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it("shows the canonical current remaining-count recognizer version for Yein", async () => {
    mocks.target = {
      skillId: "maehwaYeinDeepV1",
      detectorId: "skill-maehwa-yein-deep-v1",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "maehwaYein",
      displayName: "매화검 3초식 : 예인 VI",
      shortName: "예인",
      maxBuffRowIndex: 1,
      valueKind: "remaining-count",
    };
    const detectedIcon = {
      icon: { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) },
      match: {
        matched: true,
        displayName: "예인",
        matcherEngine: "skill-bundle-v1",
        bundleId: "skill-maehwa-yein-deep-v1",
        modelVersion: "yein-current",
        score: 2,
        threshold: 0,
        margin: 2,
        decisionReason: "target_accepted",
      },
      remainingCount: { count: 8, confidence: 0.94 },
    };
    mocks.process.mockResolvedValue({
      boxCount: 18,
      parserVersion: "parser-current",
      detectedIcon,
      candidateIcons: [detectedIcon],
      detectionsBySkillId: {
        maehwaYeinDeepV1: {
          detectedIcon,
          candidateIcons: [detectedIcon],
        },
      },
    });

    const result = await runSkillRecognition({
      imageData: {} as ImageData,
      startedAt: performance.now(),
      buffSlotInputMode: "topRightQuadrant",
      view: {
        modeLabel: "버프칸 정밀 감지",
        rawSample: {
          body: {
            kind: "skill-issue",
            skill: { config: { presetId: "maehwa-yein-vi", detectionSource: "buff-duration" } },
          },
        },
      } as TroubleshooterViewModel,
    });

    expect(result.tone).toBe("positive");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "남은 횟수", value: "8" }),
        expect.objectContaining({
          label: "횟수 인식기",
          value: "bottom-right-cooldown-cnn-v1",
        }),
      ]),
    );
  });
});
