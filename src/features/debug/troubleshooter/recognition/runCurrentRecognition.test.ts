import { describe, expect, it } from "vitest";
import type { TroubleshooterViewModel } from "../model";
import {
  getCurrentRecognitionAvailability,
  getCurrentRecognitionBuffSlotInputMode,
  getCurrentRecognitionSource,
  getCurrentRecognitionSources,
} from "./runCurrentRecognition";

function createView(
  overrides: Partial<TroubleshooterViewModel> = {},
): TroubleshooterViewModel {
  return {
    feature: "rune",
    featureLabel: "룬 알림",
    modeLabel: "미니맵 감지",
    title: "테스트",
    metadata: {
      sampleId: "sample",
      kind: "rune-issue",
      reportContract: null,
      schemaVersion: 1,
      submittedAt: null,
      storedAt: null,
      issueReason: "test",
      issueLabel: "테스트",
      sourceUrl: "",
      appBuildLabel: "test",
      environmentLabel: "test",
      captureLabel: "test",
      viewportLabel: "test",
      frameSourceLabel: "기록 없음 (이전 제보)",
      gameViewportLabel: "기록 없음 (이전 제보)",
      incident: null,
    },
    verdict: { tone: "info", title: "테스트", detail: "테스트" },
    summaryMetrics: [],
    diagnostics: [],
    stages: [],
    evidence: [],
    rawSample: { body: { kind: "rune-issue" } },
    ...overrides,
  };
}

describe("current recognition availability", () => {
  it("prefers the exact raw source over another source image", () => {
    const view = createView({
      evidence: [
        {
          id: "source-full-frame",
          group: "source",
          label: "전체",
          description: "",
          src: "data:image/png;base64,full",
          capturedAt: null,
          metadata: [],
        },
        {
          id: "source-raw",
          group: "source",
          label: "원본",
          description: "",
          src: "data:image/png;base64,raw",
          capturedAt: null,
          metadata: [],
        },
      ],
    });

    expect(getCurrentRecognitionSource(view)?.id).toBe("source-raw");
    expect(getCurrentRecognitionAvailability(view).available).toBe(true);
  });

  it("does not offer a rerun without a stored source image", () => {
    const availability = getCurrentRecognitionAvailability(createView());
    expect(availability).toEqual({
      available: false,
      reason: "현재 인식기에 다시 넣을 원본 화면이 저장되지 않았습니다.",
    });
  });

  it("offers only selected hunt-stall incident raw frames for current comparison", () => {
    const view = createView({
      feature: "hunt-stall",
      evidence: [
        {
          id: "hunt-stall-incident-media-a-raw",
          group: "source",
          label: "선택 사건 원본 1",
          description: "정상 감지 루프 입력",
          src: "data:image/png;base64,incident-a",
          capturedAt: 1_000,
          metadata: [],
        },
        {
          id: "hunt-stall-incident-media-a-processed",
          group: "recognition",
          label: "선택 사건 전처리 1",
          description: "전처리",
          src: "data:image/png;base64,processed",
          capturedAt: 1_000,
          metadata: [],
        },
        {
          id: "hunt-stall-frozen-context-raw",
          group: "runtime",
          label: "동결 시점 보조 원본",
          description: "보조 화면",
          src: "data:image/png;base64,frozen",
          capturedAt: 2_000,
          metadata: [],
        },
      ],
    });

    expect(getCurrentRecognitionSources(view)).toEqual([
      {
        id: "hunt-stall-incident-media-a-raw",
        label: "선택 사건 원본 1",
        description: "정상 감지 루프 입력",
        src: "data:image/png;base64,incident-a",
      },
    ]);
  });

  it("offers report and alert frames separately for rune false positives", () => {
    const view = createView({
      evidence: [
        {
          id: "source-raw",
          group: "source",
          label: "미니맵 원본",
          description: "제보 원본",
          src: "data:image/png;base64,report",
          capturedAt: 2_000,
          metadata: [],
        },
        {
          id: "rune-last-alert-raw",
          group: "alert",
          label: "최근 알림 원본",
          description: "알림 원본",
          src: "data:image/png;base64,alert",
          capturedAt: 1_000,
          metadata: [],
        },
      ],
    });

    expect(getCurrentRecognitionSources(view)).toEqual([
      expect.objectContaining({
        id: "rune-last-alert-raw",
        label: "알림 프레임",
        src: "data:image/png;base64,alert",
      }),
      expect.objectContaining({
        id: "source-raw",
        label: "제보 프레임",
        src: "data:image/png;base64,report",
      }),
    ]);
    expect(getCurrentRecognitionSource(view, "rune-last-alert-raw")?.src).toBe(
      "data:image/png;base64,alert",
    );
    expect(getCurrentRecognitionAvailability(view, "rune-last-alert-raw").available).toBe(true);
  });

  it("offers the exact rune trigger sequence before the later report frame", () => {
    const view = createView({
      evidence: [
        {
          id: "source-raw",
          group: "source",
          label: "미니맵 원본",
          description: "제보 원본",
          src: "data:image/png;base64,report",
          capturedAt: 4_000,
          metadata: [],
        },
        ...[1_000, 2_000, 3_000].map((capturedAt, index) => ({
          id: `rune-alert-trigger-frame-0${index + 1}`,
          group: "alert" as const,
          label: `알림 확정 프레임 ${index + 1}/3`,
          description: "트리거",
          src: `data:image/png;base64,trigger-${index + 1}`,
          capturedAt,
          metadata: [],
        })),
      ],
    });

    const sources = getCurrentRecognitionSources(view);
    expect(sources[0]).toMatchObject({
      id: "rune-alert-trigger-sequence",
      label: "알림 확정 흐름",
      src: "data:image/png;base64,trigger-3",
      frames: [
        { sampledAt: 1_000 },
        { sampledAt: 2_000 },
        { sampledAt: 3_000 },
      ],
    });
    expect(sources[1]).toMatchObject({ id: "source-raw", label: "제보 프레임" });
    expect(getCurrentRecognitionAvailability(view).reason).toContain("3개 프레임");
  });

  it("offers the saved runtime incident sequence before the report frame", () => {
    const view = createView({
      evidence: [
        {
          id: "source-raw",
          group: "source",
          label: "미니맵 원본",
          description: "제보 원본",
          src: "data:image/png;base64,report",
          capturedAt: 4_000,
          metadata: [],
        },
        ...[1_000, 2_000, 3_000].map((capturedAt, index) => ({
          id: `rune-runtime-incident-frame-0${index + 1}`,
          group: "runtime" as const,
          label: `런타임 프레임 ${index + 1}/3`,
          description: "런타임",
          src: `data:image/png;base64,runtime-${index + 1}`,
          capturedAt,
          metadata: [],
        })),
      ],
    });

    const sources = getCurrentRecognitionSources(view);
    expect(sources[0]).toMatchObject({
      id: "rune-runtime-incident-sequence",
      label: "실제 런타임 흐름",
      sequenceKind: "runtime-incident",
      frames: [
        { sampledAt: 1_000 },
        { sampledAt: 2_000 },
        { sampledAt: 3_000 },
      ],
    });
    expect(sources[1]).toMatchObject({ id: "source-raw", label: "제보 프레임" });
    expect(getCurrentRecognitionAvailability(view).reason).toContain("실제 감지 루프");
  });

  it("does not offer a rerun for unknown report kinds", () => {
    const availability = getCurrentRecognitionAvailability(
      createView({ feature: "unknown" }),
    );
    expect(availability.available).toBe(false);
  });

  it("uses the explicit runtime source input mode", () => {
    const view = createView({
      feature: "special-core",
      rawSample: {
        body: {
          kind: "special-core-issue",
          sample: {
            source: { parserInputMode: "topRightQuadrant" },
          },
        },
      },
    });

    expect(getCurrentRecognitionBuffSlotInputMode(view)).toBe("topRightQuadrant");
  });

  it("offers only selected special-core incident media for a one-frame comparison", () => {
    const view = createView({
      feature: "special-core",
      evidence: [
        {
          id: "special-core-incident-media-a",
          group: "source",
          label: "선택 사건 버프칸 1",
          description: "정상 감지 루프 입력",
          src: "data:image/png;base64,incident",
          capturedAt: 2_000,
          metadata: [],
        },
        {
          id: "special-core-report-time-raw",
          group: "runtime",
          label: "동결 시점 참고 원본",
          description: "참고",
          src: "data:image/png;base64,report-time",
          capturedAt: 3_000,
          metadata: [],
        },
        {
          id: "source-raw",
          group: "source",
          label: "구형 원본",
          description: "구형",
          src: "data:image/png;base64,legacy",
          capturedAt: 4_000,
          metadata: [],
        },
      ],
      rawSample: {
        body: {
          kind: "special-core-issue",
          sample: {
            specialCoreEvidence: {
              schemaVersion: "special-core-incident-evidence-v1",
              selection: {
                frameIds: ["special-core-frame:1"],
                mediaFrameIds: ["special-core-frame:1"],
              },
              frames: [
                {
                  id: "special-core-frame:1",
                  source: { parserInputMode: "croppedRoi" },
                },
              ],
            },
          },
        },
      },
    });

    expect(getCurrentRecognitionSources(view)).toEqual([
      expect.objectContaining({
        id: "special-core-incident-media-a",
        src: "data:image/png;base64,incident",
        description: expect.stringContaining("한 프레임 판정만 비교"),
      }),
    ]);
    expect(getCurrentRecognitionAvailability(view)).toMatchObject({
      available: true,
      reason: "원본 한 프레임을 현재 parser와 인식기에 다시 넣습니다.",
    });
    expect(getCurrentRecognitionBuffSlotInputMode(view)).toBe("croppedRoi");
  });

  it("offers only selected booster incident media for a one-frame comparison", () => {
    const view = createView({
      feature: "booster-expiry",
      evidence: [
        {
          id: "booster-expiry-incident-media-a",
          group: "source",
          label: "선택 사건 상단 화면 1",
          description: "정상 감지 루프 입력",
          src: "data:image/png;base64,incident",
          capturedAt: 2_000,
          metadata: [],
        },
        {
          id: "booster-report-time-raw",
          group: "runtime",
          label: "동결 시점 참고 원본",
          description: "참고",
          src: "data:image/png;base64,report-time",
          capturedAt: 3_000,
          metadata: [],
        },
        {
          id: "source-raw",
          group: "source",
          label: "구형 원본",
          description: "구형",
          src: "data:image/png;base64,legacy",
          capturedAt: 4_000,
          metadata: [],
        },
      ],
      rawSample: {
        body: {
          kind: "booster-expiry-issue",
          sample: {
            boosterExpiryEvidence: {
              schemaVersion: "booster-expiry-incident-evidence-v1",
              selection: {
                frameIds: ["booster-frame:1"],
                mediaFrameIds: ["booster-frame:1"],
              },
            },
          },
        },
      },
    });

    expect(getCurrentRecognitionSources(view)).toEqual([
      expect.objectContaining({
        id: "booster-expiry-incident-media-a",
        src: "data:image/png;base64,incident",
        description: expect.stringContaining("감소 흐름, 확정, 예약과 알림 재생은 재현하지 않습니다"),
      }),
    ]);
    expect(getCurrentRecognitionAvailability(view)).toMatchObject({
      available: true,
      reason: "원본 한 프레임을 현재 parser와 인식기에 다시 넣습니다.",
    });
  });

  it("keeps legacy parser source semantics without double cropping", () => {
    const skill = createView({
      feature: "skill",
      modeLabel: "버프칸 정밀 감지",
      rawSample: {
        body: {
          kind: "skill-issue",
          skill: { config: { detectionSource: "buff-duration" } },
        },
      },
    });
    const specialCore = createView({ feature: "special-core" });
    const buffExpiry = createView({ feature: "buff-expiry" });

    expect(getCurrentRecognitionBuffSlotInputMode(skill)).toBe("topRightQuadrant");
    expect(getCurrentRecognitionBuffSlotInputMode(specialCore)).toBe("topRightQuadrant");
    expect(getCurrentRecognitionBuffSlotInputMode(buffExpiry)).toBe("fullFrame");
  });
});
