import { describe, expect, it } from "vitest";
import { buildTroubleshooterViewModel } from "./buildTroubleshooterViewModel";
import { normalizeDebugSample } from "./sample";

const NOW = 1_000_000;
const IMAGE = "data:image/png;base64,AA==";
const PARSER_FAILURE = {
  reason: "webgpu-unavailable",
  technicalMessage: "navigator.gpu.requestAdapter() returned null",
  diagnostic: {
    stage: "gpu-adapter",
    status: "failed",
    code: "gpu-adapter-unavailable",
    technicalMessage: "navigator.gpu.requestAdapter() returned null",
    details: { executionProvider: "webgpu" },
  },
};

describe("buildTroubleshooterViewModel", () => {
  it("uses the atomic runtime source and exposes its parser input contract", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "runtime-source-sample",
        body: {
          kind: "special-core-issue",
          schemaVersion: 2,
          sample: {
            sampledAt: NOW,
            source: {
              kind: "buff-slot-top-right-quadrant-v1",
              parserInputMode: "topRightQuadrant",
              coordinateSpace: "capture-pixels",
              sourceSize: { width: 1920, height: 1080 },
              roi: { x: 960, y: 0, width: 960, height: 540 },
              dataUrl: IMAGE,
            },
            parser: {
              engine: "dl",
              version: "buff-slot-parser-v2",
              fallbackReason: null,
              runtime: {
                executionProvider: "remote",
                selectionSource: "user-opt-in",
                modelId: "buff-detector-yolov8n-q1-544x960-fp16",
              },
              performance: {
                detectMs: 300,
              },
            },
            rawDataUrl: null,
            result: { detected: false, candidateCount: 0, debug: { boxCount: 0 } },
            specialCore: { candidateIcons: [] },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 10 },
            state: { status: "alerted", pendingDetections: [], alertedAt: NOW - 1_000 },
            timeline: {
              samples: [],
              playbackEvents: [
                {
                  status: "finished",
                  requestedAt: NOW - 1_000,
                  startedAt: NOW - 1_000,
                  finishedAt: NOW - 500,
                  soundId: "countdown",
                },
              ],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.evidence.find((item) => item.id === "source-raw")).toMatchObject({
      src: IMAGE,
      description: expect.stringContaining("실제 런타임 프레임"),
      metadata: expect.arrayContaining([
        expect.objectContaining({ label: "parser 입력", value: "topRightQuadrant" }),
        expect.objectContaining({ label: "원본 캡처", value: "1920x1080" }),
        expect.objectContaining({ label: "ROI", value: "960:0 · 960x540" }),
      ]),
    });
    expect(view.stages.find((item) => item.id === "recognition")?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "parser 방식", value: "dl" }),
        expect.objectContaining({ label: "저장 실행 방식", value: "원격 서버" }),
        expect.objectContaining({ label: "공유 parser 처리", value: "300ms" }),
        expect.objectContaining({ label: "저장 parser", value: "buff-slot-parser-v2" }),
      ]),
    );
    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({ label: "실제 재생", value: "소리 재생 완료 확인" }),
    );
  });

  it.each([
    {
      feature: "buff expiry",
      body: {
        kind: "buff-expiry-issue",
        sample: {
          sampledAt: NOW,
          rawDataUrl: IMAGE,
          parser: { engine: null, version: null, fallbackReason: null, failure: PARSER_FAILURE },
          next: {
            parser: { boxCount: 0 },
            identity: { targetObservations: [] },
            countdown: { observations: [] },
            tracking: { tracks: [], pendingTracks: [] },
          },
        },
        buffExpiry: {
          config: { enabled: true },
          state: { status: "unavailable", tracks: [], pendingTracks: [] },
        },
      },
      diagnosticId: "buff-parser-runtime-failed",
      legacyDiagnosticId: "buff-no-boxes",
    },
    {
      feature: "precision skill",
      body: {
        kind: "skill-issue",
        sample: {
          sampledAt: NOW,
          rawDataUrl: IMAGE,
          parser: { engine: null, version: null, fallbackReason: null, failure: PARSER_FAILURE },
          result: { value: null, confidence: 0 },
          buffDuration: {
            detected: false,
            boxCount: 0,
            detectedCount: 0,
            error: "정밀 감지를 시작하지 못했습니다.",
          },
        },
        skill: {
          id: "skill-parser-failure",
          config: {
            id: "skill-parser-failure",
            name: "정밀 스킬",
            detectionSource: "buff-duration",
            enabled: true,
            alertThresholdSeconds: 10,
          },
          state: { status: "idle" },
        },
      },
      diagnosticId: "skill-parser-runtime-failed",
      legacyDiagnosticId: "skill-report-frame-error",
    },
    {
      feature: "special core",
      body: {
        kind: "special-core-issue",
        sample: {
          sampledAt: NOW,
          rawDataUrl: IMAGE,
          parser: { engine: null, version: null, fallbackReason: null, failure: PARSER_FAILURE },
          result: {
            detected: false,
            candidateCount: 0,
            debug: {
              boxCount: 0,
              detectedCount: 0,
              error: "정밀 감지를 시작하지 못했습니다.",
            },
          },
          specialCore: { candidateIcons: [] },
        },
        specialCore: {
          config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 5 },
          state: { status: "unavailable", pendingDetections: [] },
          timeline: { samples: [], playbackEvents: [] },
        },
      },
      diagnosticId: "special-core-parser-runtime-failed",
      legacyDiagnosticId: "special-core-report-frame-error",
    },
  ])(
    "distinguishes a $feature parser runtime failure from a zero-box result",
    ({ body, diagnosticId, legacyDiagnosticId }) => {
      const view = buildTroubleshooterViewModel({ id: diagnosticId, body }, { now: NOW });

      expect(view.diagnostics).toContainEqual(
        expect.objectContaining({
          id: diagnosticId,
          title: "그래픽 분석 장치를 준비하지 못함",
        }),
      );
      expect(view.diagnostics.map((entry) => entry.id)).not.toContain(
        legacyDiagnosticId,
      );
      expect(view.stages.find((entry) => entry.id === "detection")).toMatchObject({
        status: "blocked",
        summary: "parser 실행 실패",
      });
      expect(
        view.stages.find((entry) => entry.id === "detection")?.metrics,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "실패 단계", value: "그래픽 장치 연결" }),
          expect.objectContaining({ label: "오류 코드", value: "gpu-adapter-unavailable" }),
        ]),
      );
    },
  );

  it("keeps buff matcher scores separate from probability confidence", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "53adf202-c7ac-4c48-9457-d95ebb48dd3b",
        storedAt: "2026-07-10T01:42:53.616Z",
        body: {
          kind: "buff-expiry-issue",
          schemaVersion: 1,
          submittedAt: "2026-07-10T01:42:52.427Z",
          appBuild: { channel: "production", branch: "main", shortCommit: "cdcfe96" },
          reportIssue: { reason: "buff-expiry-missed", label: "버프가 꺼졌는데 알림이 안 울려요" },
          diagnostics: { capture: { hasStream: true, size: { width: 1368, height: 800 } } },
          sample: {
            rawDataUrl: IMAGE,
            boxes: Array.from({ length: 29 }, () => ({})),
            result: { confidence: 5.727, candidateCount: 29, detected: true },
            next: {
              parser: { boxCount: 29 },
              identity: {
                targetObservations: [{}, {}, {}],
              },
              countdown: {
                observations: [
                  { countdown: { kind: "none", totalSeconds: null } },
                  { countdown: { kind: "none", totalSeconds: null } },
                  { countdown: { kind: "none", totalSeconds: null } },
                ],
              },
              tracking: { tracks: [], pendingTracks: [] },
              iconEvidence: [
                {
                  group: "unionLuck",
                  score: 5.727,
                  margin: 4.226,
                  normalizedIconDataUrl: IMAGE,
                },
              ],
            },
          },
          buffExpiry: {
            config: { enabled: true, alertLeadSeconds: 10 },
            state: { status: "tracking", tracks: [], pendingTracks: [] },
            lastSnapshot: { sampledAt: NOW, tracks: [], pendingTracks: [] },
          },
        },
      },
      { now: NOW },
    );

    expect(view.feature).toBe("buff-expiry");
    expect(view.verdict).toMatchObject({
      tone: "critical",
      title: "대상 버프는 찾았지만 남은 시간을 읽지 못함",
    });
    expect(view.summaryMetrics.map((item) => item.value)).not.toContain("6%");
    expect(view.evidence.find((item) => item.id === "buff-icon-0")?.metadata).toContainEqual(
      expect.objectContaining({ label: "일치 점수", value: "5.727" }),
    );
    expect(view.stages.find((item) => item.id === "reading")).toMatchObject({
      status: "blocked",
      summary: "0개 유효 시간",
    });
  });

  it("uses the selected buff-expiry incident instead of contradictory report-time state", () => {
    const body = createBuffExpiryIncidentTroubleshooterBody();
    const view = buildTroubleshooterViewModel(
      { id: "buff-incident-selected", body },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "버프칸", value: "1개" }),
        expect.objectContaining({ label: "대상 일치", value: "1개" }),
        expect.objectContaining({ label: "실제 재생", value: "재생 실패" }),
      ]),
    );
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "buff-incident-playback-failed",
        title: "브라우저 소리 재생이 실패했습니다",
      }),
    );
    expect(view.diagnostics.map((entry) => entry.id)).not.toContain(
      "buff-incident-no-boxes",
    );
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      label: "사건 알림 예약·재생 기록",
      replayCoverage: "stored-evidence",
      summary: "재생 실패",
    });
    expect(view.stages.find((entry) => entry.id === "incident-binding")).toMatchObject({
      summary: "기능별 사건 증거와 전송 시점 자료가 분리돼 있습니다.",
      detail: expect.stringContaining("기능별 선택 사건 체인"),
    });
    expect(view.stages.find((entry) => entry.id === "report-time")).toMatchObject({
      summary: "후보 0개 · 실제 버프칸 0개 · 대상 0개",
      detail: expect.stringContaining("대신하거나 덮어쓰지 않습니다"),
    });
    expect(view.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "buff-incident-frame-0",
          label: "선택 사건 프레임 1",
        }),
        expect.objectContaining({
          id: "buff-report-time-source",
          label: "제보 전송 시점 입력",
        }),
      ]),
    );
  });

  it("explains every durable buff-expiry incident asset omission", () => {
    const body = createBuffExpiryIncidentTroubleshooterBody();
    const evidence = body.sample.buffExpiryEvidence;
    evidence.selection.support = "partial";
    evidence.selection.degradationReasons = [
      "payload-compacted",
      "asset-persist-failed",
      "asset-missing",
    ];
    evidence.omissions = evidence.selection.degradationReasons.map(
      (reason: string, index: number) => ({
        id: `omission:${index}`,
        reason,
        kind: "asset",
        subjectIds: ["buff-expiry-frame:epoch:1"],
        count: 1,
      }),
    );
    evidence.media = [];

    const view = buildTroubleshooterViewModel(
      { id: "buff-incident-omissions", body },
      { now: NOW },
    );
    const diagnosticIds = view.diagnostics.map((entry) => entry.id);

    expect(diagnosticIds).toEqual(
      expect.arrayContaining([
        "buff-incident-omission-payload-compacted",
        "buff-incident-omission-asset-persist-failed",
        "buff-incident-omission-asset-missing",
      ]),
    );
    expect(view.stages.find((entry) => entry.id === "input")).toMatchObject({
      status: "unavailable",
      summary: "선택 사건 이미지 없음",
    });
  });

  it("uses the selected hunt-stall incident instead of contradictory latest state", () => {
    const body = createHuntStallIncidentTroubleshooterBody();
    const view = buildTroubleshooterViewModel(
      { id: "hunt-incident-selected", body },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "선택 사건",
          value: "최근 사건 일치 · 판단 가능",
        }),
        expect.objectContaining({ label: "당시 판독", value: "채택 · 100 · 98%" }),
        expect.objectContaining({
          label: "알림 판정",
          value: "첫 알림 · alert · threshold-reached",
        }),
        expect.objectContaining({ label: "브라우저 재생", value: "재생 실패" }),
      ]),
    );
    expect(view.summaryMetrics.map((entry) => entry.value).join(" ")).not.toContain("999");
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "hunt-incident-conclusion-playback-failed",
        title: "브라우저 소리 재생이 실패했습니다",
      }),
    );
    expect(view.stages.find((entry) => entry.id === "incident-binding")).toMatchObject({
      summary: "기능별 사건 증거와 전송 시점 자료가 분리돼 있습니다.",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      label: "사건 브라우저 재생 기록",
      replayCoverage: "stored-evidence",
      summary: "재생 실패",
    });
    expect(view.stages.find((entry) => entry.id === "report-time")).toMatchObject({
      replayCoverage: "recognition-not-run",
      summary: "보조 화면 있음 · 독립 분석 없음",
      detail: expect.stringContaining("새 인식기를 실행하지 않습니다"),
    });
    expect(view.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "hunt-stall-incident-media-selected-raw",
          group: "source",
        }),
        expect.objectContaining({
          id: "hunt-stall-frozen-context-raw",
          group: "runtime",
        }),
      ]),
    );
    expect(view.evidence.map((entry) => entry.id)).not.toContain(
      "hunt-stall-incident-media-distractor-raw",
    );
  });

  it("marks a missing durable hunt-stall incident image as incomplete", () => {
    const body = createHuntStallIncidentTroubleshooterBody();
    const evidence = body.sample.huntStallEvidence;
    evidence.selection.support = "partial";
    evidence.selection.degradationReasons = ["asset-missing"];
    evidence.media[0].rawDataUrl = null;
    evidence.omissions = [
      {
        id: "omission:asset-missing",
        occurredAt: NOW,
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["frame:selected"],
        count: 1,
      },
    ];

    const view = buildTroubleshooterViewModel(
      { id: "hunt-incident-missing-asset", body },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "hunt-incident-omission-asset-missing",
        title: "저장된 사건 이미지 파일을 찾지 못했습니다",
      }),
    );
    expect(view.stages.find((entry) => entry.id === "input")).toMatchObject({
      status: "unavailable",
      summary: "선택 사건 원본 없음",
    });
  });

  it("keeps hunt-stall browser playback separate from physical audibility", () => {
    const body = createHuntStallIncidentTroubleshooterBody();
    const evidence = body.sample.huntStallEvidence;
    evidence.selection.operatorConclusion = "physical-audibility-unverifiable";
    evidence.playbackAttempts[0] = {
      ...evidence.playbackAttempts[0],
      status: "started",
      startedAt: NOW - 1_950,
      failedAt: null,
      error: null,
    };

    const view = buildTroubleshooterViewModel(
      { id: "hunt-incident-audibility", body },
      { now: NOW },
    );

    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "complete",
      summary: "브라우저 재생 시작",
      detail: expect.stringContaining("실제 청취와 OS 출력은 확인할 수 없습니다"),
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "실제 청취", value: "확인 불가" }),
      ]),
    });
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "hunt-incident-conclusion-physical-audibility-unverifiable",
      }),
    );
  });

  it("does not claim to reproduce a hunt-stall incident outside retention", () => {
    const body = createHuntStallIncidentTroubleshooterBody();
    const evidence = body.sample.huntStallEvidence;
    evidence.selection = {
      ...evidence.selection,
      status: "outside-retention",
      support: "unsupported",
      anchorKind: null,
      operatorConclusion: "evidence-outside-retention",
      frameIds: [],
      observationIds: [],
      activityEpochIds: [],
      stallEpisodeIds: [],
      cycleIds: [],
      decisionIds: [],
      attemptIds: [],
      mediaFrameIds: [],
      degradationReasons: ["outside-retention"],
    };
    evidence.frames = [];
    evidence.observations = [];
    evidence.activityEpochs = [];
    evidence.stallEpisodes = [];
    evidence.alertCycles = [];
    evidence.decisions = [];
    evidence.playbackAttempts = [];
    evidence.media = [];
    evidence.omissions = [
      {
        id: "omission:outside-retention",
        occurredAt: NOW,
        kind: "frame",
        reason: "outside-retention",
        subjectIds: [],
        count: 1,
      },
    ];

    const view = buildTroubleshooterViewModel(
      { id: "hunt-incident-outside-retention", body },
      { now: NOW },
    );

    expect(view.stages.find((entry) => entry.id === "input")).toMatchObject({
      status: "blocked",
      summary: "선택 사건 원본 없음",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "unavailable",
      replayCoverage: "stored-evidence",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "hunt-incident-omission-outside-retention" }),
        expect.objectContaining({ id: "hunt-incident-selection-unavailable" }),
      ]),
    );
    expect(
      view.evidence.some((entry) => entry.id.startsWith("hunt-stall-incident-")),
    ).toBe(false);
  });

  it("uses the selected skill incident instead of contradictory report-time state", () => {
    const body = createSkillIncidentTroubleshooterBody();
    const view = buildTroubleshooterViewModel(
      { id: "skill-incident-selected", body },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "선택 사건",
          value: "최근 사건 일치 · 일부 증거",
        }),
        expect.objectContaining({ label: "당시 인식", value: "4개 · 대상 일치" }),
        expect.objectContaining({ label: "당시 판독", value: "3초 · 흐름에 사용" }),
        expect.objectContaining({ label: "알림 판정", value: "재생 요청 · 중복 대상 억제" }),
        expect.objectContaining({ label: "브라우저 재생", value: "재생 실패" }),
      ]),
    );
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill-incident-playback-failed",
          title: "브라우저 소리 재생이 실패했습니다",
        }),
        expect.objectContaining({
          id: "skill-incident-target-arbitrated",
        }),
        expect.objectContaining({
          id: "skill-incident-omission-asset-missing",
        }),
      ]),
    );
    expect(view.stages.find((entry) => entry.id === "incident-binding")).toMatchObject({
      summary: "기능별 사건 증거와 전송 시점 자료가 분리돼 있습니다.",
    });
    expect(view.stages.find((entry) => entry.id === "detection")).toMatchObject({
      label: "사건 버프칸 탐색",
      summary: "4개 · 2행 · 행 규칙 통과 2개",
    });
    expect(view.stages.find((entry) => entry.id === "alert-decision")).toMatchObject({
      summary: "재생 요청 · 중복 대상 억제 · 선택 skill-a · 억제 skill-b",
    });
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      label: "사건 브라우저 재생 기록",
      replayCoverage: "stored-evidence",
      summary: "재생 실패",
    });
    expect(view.stages.find((entry) => entry.id === "report-time")).toMatchObject({
      summary: "버프칸 0개 · 판독 99 · 선택 사건과 별도",
      detail: expect.stringContaining("대신하거나 덮어쓰지 않습니다"),
    });
    expect(view.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill-incident-skill-media-frame-1",
          label: "선택 사건 이미지 1",
        }),
        expect.objectContaining({
          id: "skill-report-time-source",
          label: "제보 전송 시점 입력",
        }),
      ]),
    );
  });

  it("does not upgrade legacy skill playback records to browser-accepted playback", () => {
    const body = createSkillIncidentTroubleshooterBody();
    const evidence = body.sample.skillEvidence;
    evidence.selection.support = "partial";
    evidence.selection.playbackStartEvidence = "legacy-request-only";
    evidence.playbackAttempts = [
      {
        ...evidence.playbackAttempts[0],
        status: "started",
        error: null,
        startedMeaning: "legacy-request-recorded",
      },
    ];

    const view = buildTroubleshooterViewModel(
      { id: "skill-incident-legacy-playback", body },
      { now: NOW },
    );

    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({
        label: "브라우저 재생",
        value: "이전 형식 재생 요청 기록",
      }),
    );
    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "warning",
      detail: expect.stringContaining("play() 수락 여부와 실제 청취는 확인할 수 없습니다"),
    });
    expect(view.stages.find((entry) => entry.id === "alert")?.summary).not.toContain(
      "브라우저 play() 수락",
    );
  });

  it("keeps browser playback acceptance separate from physical audibility", () => {
    const body = createSkillIncidentTroubleshooterBody();
    const evidence = body.sample.skillEvidence;
    body.reportIssue.scenario = "playback-missing";
    evidence.playbackAttempts = [
      {
        ...evidence.playbackAttempts[0],
        status: "started",
        error: null,
        startedMeaning: "browser-play-accepted",
      },
    ];

    const view = buildTroubleshooterViewModel(
      { id: "skill-incident-browser-playback", body },
      { now: NOW },
    );

    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      status: "complete",
      summary: "브라우저 play() 수락",
      detail: expect.stringContaining("실제 청취와 OS 출력은 확인할 수 없습니다"),
    });
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "skill-incident-audibility-unknown",
        title: "브라우저 재생 시작은 확인됐지만 실제 청취 여부는 알 수 없습니다",
      }),
    );
  });

  it.each([
    ["never-produced", "필요한 사건 증거가 생성되지 않았습니다"],
    ["outside-retention", "문제 시점이 보관 범위보다 이전입니다"],
    ["reset-epoch", "화면 공유 또는 기능 재시작 경계를 넘었습니다"],
    ["media-oversize", "사건 이미지 한 장이 보관 한도를 넘었습니다"],
    ["media-budget-exhausted", "브라우저 이미지 보관 한도에 도달했습니다"],
    ["metadata-cap", "사건 메타데이터 보관 한도에 도달했습니다"],
    ["payload-compacted", "전송 크기 조정으로 사건 이미지가 제외됐습니다"],
    ["asset-persist-failed", "사건 이미지를 영구 저장하지 못했습니다"],
    ["asset-missing", "저장된 사건 이미지 파일을 찾지 못했습니다"],
    ["ambiguous-target", "문제 대상을 하나로 좁히지 못했습니다"],
  ])("explains buff-expiry omission %s", (reason, title) => {
    const body = createBuffExpiryIncidentTroubleshooterBody();
    body.sample.buffExpiryEvidence.selection.support = "partial";
    body.sample.buffExpiryEvidence.selection.degradationReasons = [reason];

    const view = buildTroubleshooterViewModel(
      { id: `buff-incident-${reason}`, body },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: `buff-incident-omission-${reason}`,
        title,
      }),
    );
  });

  it.each([
    {
      name: "zero parser boxes",
      diagnosticId: "buff-incident-no-boxes",
      prepare(body: any) {
        body.reportIssue.scenario = "not-recognized";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.frames[0].recognition = {
          ...evidence.frames[0].recognition,
          parserBoxCount: 0,
          parsedRowCount: 0,
          eligibleBoxCount: 0,
          acceptedTargetCount: 0,
        };
        evidence.observations = [];
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "buff-slot localization unavailable",
      diagnosticId: "buff-incident-localization-unavailable",
      prepare(body: any) {
        body.reportIssue.scenario = "not-recognized";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.frames[0].recognition = {
          ...evidence.frames[0].recognition,
          parserBoxCount: 2,
          parsedRowCount: 2,
          localizedBoxCount: 0,
          localizedRowCount: 0,
          spatialExcludedBoxCount: 2,
          localizationStatus: "unavailable",
          localizationReason: "anchor-not-found",
          upperExcludedBoxCount: 0,
          eligibleBoxCount: 0,
          acceptedTargetCount: 0,
        };
        evidence.observations = [];
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "row-policy exclusion",
      diagnosticId: "buff-incident-row-ineligible",
      prepare(body: any) {
        body.reportIssue.scenario = "not-recognized";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.frames[0].recognition = {
          ...evidence.frames[0].recognition,
          parserBoxCount: 2,
          parsedRowCount: 2,
          upperExcludedBoxCount: 2,
          eligibleBoxCount: 0,
          acceptedTargetCount: 0,
        };
        evidence.observations[0].targetAccepted = false;
        evidence.observations[0].decisionReason =
          "upper_rows_target_excluded:target_accepted";
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "matcher conflict",
      diagnosticId: "buff-incident-no-target",
      prepare(body: any) {
        body.reportIssue.scenario = "not-recognized";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.frames[0].recognition.acceptedTargetCount = 0;
        evidence.observations[0].targetAccepted = false;
        evidence.observations[0].decisionReason = "cross_bundle_conflict";
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "countdown rejection",
      diagnosticId: "buff-incident-no-countdown",
      prepare(body: any) {
        body.reportIssue.scenario = "wrong-value";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.observations[0].countdown = {
          text: "8",
          seconds: 8,
          decision: "implausible",
          reason: "flow-outlier",
        };
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "missing tracking episode",
      diagnosticId: "buff-incident-no-track",
      prepare(body: any) {
        body.reportIssue.scenario = "recognized-no-alert";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.episodes = [];
        evidence.transitions = [];
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "missing schedule",
      diagnosticId: "buff-incident-not-scheduled",
      prepare(body: any) {
        body.reportIssue.scenario = "recognized-no-alert";
        const evidence = body.sample.buffExpiryEvidence;
        evidence.cycles = [];
        evidence.cycleEvents = [];
        evidence.attempts = [];
      },
    },
    {
      name: "fired cycle without playback request",
      diagnosticId: "buff-incident-playback-not-requested",
      prepare(body: any) {
        body.reportIssue.scenario = "playback-missing";
        body.sample.buffExpiryEvidence.attempts = [];
      },
    },
  ])("identifies buff-expiry incident failure: $name", ({ prepare, diagnosticId }) => {
    const body = createBuffExpiryIncidentTroubleshooterBody();
    prepare(body);

    const view = buildTroubleshooterViewModel(
      { id: `buff-incident-${diagnosticId}`, body },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({ id: diagnosticId }),
    );
  });

  it("labels legacy buff-expiry replay as a current-code comparison", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "legacy-buff-expiry",
        body: {
          kind: "buff-expiry-issue",
          sample: {
            next: {
              parser: { boxCount: 1 },
              identity: { targetObservations: [{}] },
              countdown: {
                observations: [{ countdown: { totalSeconds: 10 } }],
              },
              tracking: { tracks: [{}], pendingTracks: [] },
            },
          },
          buffExpiry: {
            config: { enabled: true, alertLeadSeconds: 5 },
            state: { status: "tracking", tracks: [{}], pendingTracks: [] },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((entry) => entry.id === "alert")).toMatchObject({
      label: "현재 코드 판정 비교",
      detail: expect.stringContaining("제보 당시 실행 기록이 아닙니다"),
    });
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "buff-legacy-temporal-evidence-unavailable",
      }),
    );
  });

  it("explains a buff matcher positive-gate rejection with saved bundle provenance", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "buff-gate-rejected",
        body: {
          kind: "buff-expiry-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            result: { detected: false, confidence: 0, candidateCount: 1 },
            next: {
              moduleVersions: {
                parser: "parser-current",
                matcher: "buff-group-bundle-v1",
                matcherModel: "buff-group-bundles-20260711",
                matcherBundles: [
                  {
                    group: "potion",
                    bundleId: "buff-group-potion-deep-v1",
                    modelVersion: "potion-20260711-v1",
                  },
                ],
                countdown: "countdown-current",
              },
              parser: { boxCount: 1 },
              identity: {
                observations: [
                  {
                    identity: {
                      kind: "unknown",
                      group: null,
                      decisionReason: "positive_gate_below_threshold",
                      candidates: [
                        {
                          group: "potion",
                          bundleId: "buff-group-potion-deep-v1",
                          modelVersion: "potion-20260711-v1",
                          accepted: false,
                          score: 2.4,
                          threshold: 1.2,
                          margin: 1.2,
                          gateScore: 0.91,
                          gateThreshold: 0.93,
                          gateMargin: -0.02,
                          decisionReason: "positive_gate_below_threshold",
                        },
                      ],
                    },
                  },
                ],
                targetObservations: [],
              },
              countdown: { observations: [] },
              tracking: { tracks: [], pendingTracks: [] },
              iconEvidence: [
                {
                  group: "potion",
                  score: 2.4,
                  margin: 1.2,
                  bundleId: "buff-group-potion-deep-v1",
                  modelVersion: "potion-20260711-v1",
                  gateScore: 0.91,
                  gateMargin: -0.02,
                  decisionReason: "positive_gate_below_threshold",
                  normalizedIconDataUrl: IMAGE,
                },
              ],
            },
          },
          buffExpiry: {
            config: { enabled: true, selectedPrecisionTargetGroups: ["potion"] },
            state: { status: "waiting", tracks: [], pendingTracks: [] },
            lastSnapshot: { sampledAt: NOW, tracks: [], pendingTracks: [] },
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({ title: "대상 분류 후 아이콘 형태 검증 미통과" }),
    );
    expect(view.stages.find((item) => item.id === "identity")?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "저장 판정", value: "아이콘 형태 검증 기준 미달" }),
        expect.objectContaining({
          label: "저장 모델 potion",
          value: "buff-group-potion-deep-v1 · potion-20260711-v1",
        }),
      ]),
    );
    expect(view.evidence.find((item) => item.id === "buff-icon-0")?.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "형태 점수", value: "0.91" }),
        expect.objectContaining({ label: "판정", value: "아이콘 형태 검증 기준 미달" }),
      ]),
    );
  });

  it("explains a precision skill positive-gate rejection with saved bundle evidence", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "skill-gate-rejected",
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            result: { value: null, confidence: 0 },
            buffDuration: {
              targetSkillId: "janusDeepV2",
              targetDisplayName: "솔 야누스: 새벽 (정밀)",
              detected: false,
              boxCount: 18,
              detectedCount: 0,
              matcherEngine: "skill-bundle-v1",
              bundleId: "skill-deep-v2",
              modelVersion: "shared-test-v2",
              baseSkillId: "janus",
              score: 1.2,
              threshold: -0.3,
              margin: 1.5,
              gateScore: 0.92,
              gateThreshold: 0.95,
              gateMargin: -0.03,
              decisionReason: "positive_gate_below_threshold",
              candidateIcons: [
                {
                  imageDataUrl: IMAGE,
                  match: {
                    matched: false,
                    matcherEngine: "skill-bundle-v1",
                    bundleId: "skill-deep-v2",
                    modelVersion: "shared-test-v2",
                    baseSkillId: "janus",
                    score: 1.2,
                    threshold: -0.3,
                    margin: 1.5,
                    gateScore: 0.92,
                    gateThreshold: 0.95,
                    gateMargin: -0.03,
                    decisionReason: "positive_gate_below_threshold",
                  },
                },
              ],
            },
          },
          skill: {
            id: "skill-janus",
            config: {
              id: "skill-janus",
              name: "솔 야누스: 새벽",
              presetId: "sol-janus-dawn-deep-v2",
              detectionSource: "buff-duration",
              enabled: true,
              durationSeconds: 120,
              alertThresholdSeconds: 10,
            },
            state: {
              skillId: "skill-janus",
              status: "idle",
              estimatedExpiresAt: null,
              alertedAt: null,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        title: "솔 야누스: 새벽 (정밀) 아이콘 형태 검증 미통과",
      }),
    );
    expect(view.stages.find((item) => item.id === "recognition")?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "판정", value: "아이콘 형태 검증 기준 미달" }),
        expect.objectContaining({ label: "형태 점수", value: "0.92" }),
        expect.objectContaining({ label: "형태 기준", value: "0.95" }),
        expect.objectContaining({ label: "저장 번들", value: "skill-deep-v2" }),
        expect.objectContaining({ label: "저장 matcher", value: "shared-test-v2" }),
      ]),
    );
  });

  it("supports special-core reports and identifies an overdue alert", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "special-core-sample",
        body: {
          kind: "special-core-issue",
          submittedAt: NOW,
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: { detected: true, confidence: 4.25, candidateCount: 1 },
            specialCore: {
              candidateIcons: [
                {
                  imageDataUrl: IMAGE,
                  match: { matched: true, score: 4.25, threshold: 2.1, margin: 2.15 },
                },
              ],
            },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 5 },
            state: {
              status: "cooldown",
              lastSampledAt: NOW,
              boxCount: 18,
              detectedCount: 1,
              pendingDetections: [],
              activationConfirmedAt: NOW - 30_000,
              cooldownEndsAt: NOW - 1_000,
              alertDueAt: NOW - 6_000,
              alertedAt: null,
            },
            activationEvidence: {
              activationConfirmedAt: NOW - 30_000,
              confirmationIcons: [
                { imageDataUrl: IMAGE, match: { score: 4.1 } },
                { imageDataUrl: IMAGE, match: { score: 4.25 } },
              ],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.feature).toBe("special-core");
    expect(view.verdict).toMatchObject({
      tone: "critical",
      title: "알림 시각이 지났지만 완료 기록이 없음",
    });
    expect(view.stages.map((item) => item.label)).toEqual([
      "버프칸 입력",
      "버프칸 탐색",
      "특수 코어 판정",
      "활성화 연속 확인",
      "쿨타임·알림 재현",
    ]);
    expect(view.evidence.some((item) => item.group === "runtime")).toBe(true);
  });

  it("keeps special-core report-frame counts separate from older runtime state", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "special-core-frame-miss",
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            result: {
              detected: false,
              confidence: null,
              candidateCount: 0,
              debug: {
                boxCount: 0,
                detectedCount: 0,
                parserVersion: "parser-current",
                modelVersion: "special-current",
              },
            },
            specialCore: { performance: { boxCount: 0 }, candidateIcons: [] },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 5 },
            state: {
              status: "cooldown",
              boxCount: 18,
              detectedCount: 1,
              pendingDetections: [],
              alertDueAt: NOW + 10_000,
              alertedAt: null,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((item) => item.id === "detection")).toMatchObject({
      status: "blocked",
      summary: "0개 칸",
    });
    expect(view.stages.find((item) => item.id === "recognition")).toMatchObject({
      status: "blocked",
      summary: "비교할 후보 없음",
    });
    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({ label: "일치 후보", value: "0개" }),
    );
  });

  it("uses the selected special-core incident chain instead of contradictory latest state", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "special-core-selected-incident",
        body: {
          kind: "special-core-issue",
          reportIssue: {
            reason: "special-core-missed",
            scenario: "alert-did-not-play",
          },
          sample: {
            rawDataUrl: null,
            result: { detected: true, candidateCount: 99 },
            specialCoreEvidence: {
              schemaVersion: "special-core-incident-evidence-v1",
              frozenAt: NOW,
              selection: {
                policy: "special-core-scenario-selection-v1",
                status: "matched",
                support: "partial",
                anchorKind: "playback-attempt",
                selectedEventAt: NOW - 1_000,
                resetEpochId: "special-core-reset:1",
                candidateIds: ["playback:special-core-decision:1"],
                frameIds: ["special-core-frame:1"],
                observationIds: ["special-core-observation:1"],
                confirmationAttemptIds: ["special-core-confirmation:1"],
                activationIds: ["special-core-activation:1"],
                scheduleIds: ["special-core-schedule:1"],
                decisionIds: ["special-core-decision:1"],
                playbackAttemptIds: ["special-core-playback:1"],
                eventIds: [],
                configurationRevisionIds: ["special-core-config:1"],
                mediaFrameIds: ["special-core-frame:1"],
                relatedPlaybackIds: [],
                ambiguous: false,
                operatorConclusion: "playback-failed",
                physicalAudibility: "unknown",
                degradationReasons: ["asset-missing"],
              },
              configurations: [
                {
                  id: "special-core-config:1",
                  values: {
                    cooldownSeconds: 30,
                    alertLeadSeconds: 5,
                    soundId: "selected-sound",
                    effectiveVolume: 0.7,
                  },
                },
              ],
              frames: [
                {
                  id: "special-core-frame:1",
                  sampledAt: NOW - 3_000,
                  configRevisionId: "special-core-config:1",
                  source: { parserInputMode: "croppedRoi" },
                  parser: {
                    engine: "dl",
                    version: "incident-parser-v1",
                    runtime: { executionProvider: "wasm" },
                  },
                  parsedBoxes: [{ x: 1, y: 1, size: 20 }],
                  rowGroups: [{ rowIndex: 0 }],
                  eligibleBoxIndexes: [0],
                  timings: { detectMs: 12, totalMs: 20 },
                  runtimeFailure: null,
                },
              ],
              observations: [
                {
                  id: "special-core-observation:1",
                  frameId: "special-core-frame:1",
                  sampledAt: NOW - 3_000,
                  decision: "accepted",
                  reason: "candidate-accepted",
                  selectedCandidateBoxIndex: 0,
                  candidates: [
                    {
                      boxIndex: 0,
                      match: {
                        decisionReason: "base_and_positive_gate_passed",
                        score: 3.2,
                        threshold: 2.1,
                        gateScore: 0.97,
                        gateThreshold: 0.94,
                        bundleId: "special-core-v3",
                        modelVersion: "selected-model",
                        elapsedMs: 4,
                      },
                    },
                  ],
                },
              ],
              confirmationAttempts: [
                {
                  id: "special-core-confirmation:1",
                  kind: "new-activation",
                  status: "confirmed",
                  observationIds: [
                    "special-core-observation:0",
                    "special-core-observation:1",
                  ],
                  lastObservedAt: NOW - 3_000,
                },
              ],
              activations: [
                {
                  id: "special-core-activation:1",
                  confirmationKind: "new-activation",
                  observationIds: [
                    "special-core-observation:0",
                    "special-core-observation:1",
                  ],
                  confirmedAt: NOW - 3_000,
                  cooldownEndsAt: NOW + 27_000,
                  alertDueAt: NOW - 1_000,
                  status: "active",
                  timingConfigRevisionId: "special-core-config:1",
                },
              ],
              schedules: [
                {
                  id: "special-core-schedule:1",
                  activationId: "special-core-activation:1",
                  registeredAt: NOW - 3_000,
                  alertDueAt: NOW - 1_000,
                  status: "fired",
                },
              ],
              decisions: [
                {
                  id: "special-core-decision:1",
                  activationId: "special-core-activation:1",
                  scheduleId: "special-core-schedule:1",
                  occurredAt: NOW - 1_000,
                  dueAt: NOW - 1_000,
                  schedulerDelayMs: 0,
                  firedConfigRevisionId: "special-core-config:1",
                },
              ],
              playbackAttempts: [
                {
                  id: "special-core-playback:1",
                  decisionId: "special-core-decision:1",
                  requestedAt: NOW - 1_000,
                  failedAt: NOW - 900,
                  status: "failed",
                  error: "NotAllowedError",
                  configRevisionId: "special-core-config:1",
                  effectiveVolume: 0.7,
                },
              ],
              lifecycle: [],
              media: [
                {
                  id: "special-core-media:1",
                  frameId: "special-core-frame:1",
                  sampledAt: NOW - 3_000,
                  reason: "alert-decision",
                  imageDataUrl: IMAGE,
                },
              ],
              relatedPlayback: [],
              omissions: [
                {
                  id: "special-core-omission:1",
                  reason: "asset-missing",
                  kind: "asset",
                },
              ],
              reportFrame: null,
            },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 999, alertLeadSeconds: 999 },
            state: {
              status: "alerted",
              boxCount: 99,
              detectedCount: 99,
              lastAlertedAt: NOW,
              lastAlertPlayback: { status: "finished" },
            },
            timeline: {
              playbackEvents: [{ status: "finished", finishedAt: NOW }],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({
      tone: "critical",
      title: "브라우저가 알림 재생을 완료하지 못했습니다",
    });
    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "당시 인식", value: "후보 채택 · 1차 점수와 형태 검증 통과" }),
        expect.objectContaining({ label: "브라우저 재생", value: "재생 실패 (NotAllowedError)" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "recognition")).toMatchObject({
      status: "complete",
      summary: "후보 채택 · 1차 점수와 형태 검증 통과",
    });
    expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
      status: "blocked",
      summary: "재생 실패 (NotAllowedError)",
    });
    expect(view.stages.find((item) => item.id === "report-time")).toMatchObject({
      status: "unavailable",
      summary: "독립 분석 없음",
      replayCoverage: "recognition-not-run",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "저장된 사건 이미지 파일을 찾지 못했습니다" }),
      ]),
    );
    expect(view.evidence).toEqual([
      expect.objectContaining({
        id: "special-core-incident-special-core-media-1",
        group: "source",
        src: IMAGE,
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain("브라우저 재생 종료");
    expect(JSON.stringify(view)).not.toContain("999초");
  });

  it("shows V2 base and positive-gate evidence for a stored special-core miss", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "special-core-v2-gate-miss",
        body: {
          kind: "special-core-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: {
              detected: false,
              confidence: null,
              candidateCount: 1,
              debug: {
                bundleId: "special-core-deep-v2",
                modelVersion: "special-core-20260711-v2",
                decisionReason: "below_positive_gate_threshold",
                bestScore: 1.2,
                baseThreshold: 0,
                bestGateScore: 0.91,
                gateThreshold: 0.94,
                boxCount: 18,
                detectedCount: 0,
              },
            },
            specialCore: {
              candidateIcons: [
                {
                  imageDataUrl: IMAGE,
                  match: {
                    matched: false,
                    bundleId: "special-core-deep-v2",
                    modelVersion: "special-core-20260711-v2",
                    score: 1.2,
                    threshold: 0,
                    margin: 1.2,
                    gateScore: 0.91,
                    gateThreshold: 0.94,
                    decisionReason: "below_positive_gate_threshold",
                  },
                },
              ],
            },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 5 },
            state: {
              status: "waiting",
              boxCount: 18,
              detectedCount: 0,
              pendingDetections: [],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((item) => item.id === "recognition")).toMatchObject({
      status: "warning",
      summary: "형태 검증 기준 미달",
    });
    expect(view.stages.find((item) => item.id === "recognition")?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "판정", value: "형태 검증 기준 미달" }),
        expect.objectContaining({ label: "1차 점수", value: "1.2" }),
        expect.objectContaining({ label: "형태 점수", value: "0.91" }),
        expect.objectContaining({ label: "저장 번들", value: "special-core-deep-v2" }),
        expect.objectContaining({ label: "저장 모델", value: "special-core-20260711-v2" }),
      ]),
    );
  });

  it("shows Yein raw count separately from the confirmed flow and blocked alert", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "skill-yein-flow",
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            processedDataUrl: IMAGE,
            result: {
              value: 3,
              confidence: 0.91,
              recognizerVersion: "bottom-right-cooldown-cnn-v1",
            },
            buffDuration: {
              targetSkillId: "maehwaYeinDeepV1",
              targetDisplayName: "매화검 3초식 : 예인 VI",
              detected: true,
              boxCount: 18,
              detectedCount: 1,
              score: 0.99,
              margin: 0.1,
              decisionReason: "target_accepted",
              remainingCountModelStatus: "ready",
              remainingCount: {
                text: "3",
                count: 3,
                format: "remaining-count",
                confidence: 0.91,
              },
              candidateIcons: [
                {
                  name: "예인 후보",
                  imageDataUrl: IMAGE,
                  match: {
                    matched: true,
                    score: 0.99,
                    threshold: 0.8,
                    margin: 0.19,
                    decisionReason: "target_accepted",
                  },
                  remainingCount: { count: 3, confidence: 0.91 },
                },
              ],
            },
          },
          skill: {
            id: "skill-yein",
            config: {
              enabled: true,
              name: "매화검 3초식 : 예인 VI",
              presetId: "maehwa-yein-vi",
              detectionSource: "buff-duration",
              alertThresholdSeconds: 3,
            },
            state: {
              status: "running",
              observedRemainingCount: 11,
              countObservedAt: NOW - 5_000,
              alertedAt: null,
              rejectedReading: 3,
              pendingRemainingCountDrop: {
                observedRemainingCount: 3,
                observedAt: NOW - 2_000,
                lastObservedAt: NOW,
                count: 3,
                fromRemainingCount: 11,
                minReachableCount: 8,
              },
            },
            runtimeTimeline: {
              samples: [
                {
                  sampledAt: NOW,
                  remainingCountDecision: "implausible-drop-held",
                  remainingCountExpectedMin: 6,
                  remainingCountExpectedMax: 11,
                },
              ],
              alertEvents: [],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({
      tone: "warning",
      title: "불가능한 횟수 변화를 보류함",
    });
    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "원시 판독", value: "3회" }),
        expect.objectContaining({ label: "확정 횟수", value: "11회" }),
        expect.objectContaining({ label: "흐름 판정", value: "불가능한 감소 계속 보류" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "reading")).toMatchObject({
      label: "남은 횟수 판독",
      status: "complete",
      summary: "3회",
    });
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      label: "횟수 흐름 추적",
      status: "warning",
      summary: "불가능한 감소 보류",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "확정 횟수", value: "11회" }),
        expect.objectContaining({ label: "도달 가능 범위", value: "6~11회" }),
      ]),
    });
    expect(view.stages.find((item) => item.id === "alert")?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "확정 횟수", value: "11회" }),
        expect.objectContaining({ label: "알림 기준", value: "3회" }),
      ]),
    );
  });

  it("reports a skill audio failure separately from the alert decision", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "skill-playback-failed",
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            processedDataUrl: IMAGE,
            result: { value: 3, confidence: 0.9 },
          },
          skill: {
            config: {
              enabled: true,
              name: "테스트 스킬",
              detectionSource: "quickslot",
              alertThresholdSeconds: 5,
            },
            state: { status: "alerted", alertedAt: NOW - 1_000 },
            runtimeTimeline: {
              samples: [],
              alertEvents: [
                {
                  startedAt: NOW - 1_000,
                  alertCycleStartedAt: NOW - 1_000,
                  soundId: "test-sound",
                  status: "failed",
                  finishedAt: null,
                  failedAt: NOW - 900,
                  error: "NotAllowedError",
                },
              ],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({ tone: "critical", title: "소리 재생 실패" });
    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({ label: "실제 재생", value: "소리 재생 실패" }),
    );
    expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
      status: "blocked",
      summary: "소리 재생 실패",
    });
  });

  it("formats report-frame rune confidence as a probability", () => {
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: { detected: true, confidence: 0.92, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: { status: "candidate", stableCount: 3, alertedAt: null },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((item) => item.id === "recognition")?.metrics).toContainEqual(
      expect.objectContaining({ label: "신뢰도", value: "92%" }),
    );
  });

  it("renders full-frame ONNX score evidence without legacy proposal wording", () => {
    const modelVersion = "rune-strict-local-centernet-s4-v1";
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: {
              detected: false,
              confidence: 0.48,
              candidateCount: 0,
              detectorVersion: modelVersion,
            },
            runeEvidence: {
              current: {
                detectorVersion: modelVersion,
                candidateDataUrl: IMAGE,
                detected: false,
                confidence: 0.48,
                candidateCount: 0,
              },
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: modelVersion,
              stableCount: 0,
              candidateCount: 0,
            },
            lastSnapshot: {
              detectorVersion: modelVersion,
              detected: false,
              confidence: 0.48,
              candidateCount: 0,
              candidate: { x: 10, y: 20, width: 18, height: 18, confidence: 0.48 },
              detectionDebug: {
                detectorKind: "onnx-full-frame",
                classifier: modelVersion,
                modelScore: 0.48,
                modelThreshold: 0.51976274,
                reason: "score-below-threshold",
              },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((item) => item.id === "detection")).toMatchObject({
      label: "제보 이미지 전체 분석",
      status: "complete",
      summary: "분석 위치 저장됨",
      metrics: [
        expect.objectContaining({ label: "모델 점수", value: "48%" }),
        expect.objectContaining({ label: "판정 기준", value: "52%" }),
        expect.objectContaining({ label: "확정 위치", value: "0개" }),
      ],
    });
    expect(view.stages.find((item) => item.id === "recognition")).toMatchObject({
      status: "warning",
      summary: "룬 아님",
    });
    expect(view.stages.some((item) => item.label.includes("후보 탐색"))).toBe(false);
  });

  it("renders cascade proposal, shape, appearance, and final gates separately", () => {
    const modelVersion = "rune-cascade-v8";
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: {
              detected: false,
              confidence: 0.4,
              candidateCount: 0,
              detectorVersion: modelVersion,
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: modelVersion,
              stableCount: 0,
              candidateCount: 0,
            },
            lastSnapshot: {
              detectorVersion: modelVersion,
              detected: false,
              confidence: 0.4,
              candidateCount: 0,
              detectionDebug: {
                detectorKind: "onnx-cascade",
                classifier: modelVersion,
                proposalCount: 5,
                proposalScore: 0.91,
                selectedProposalRank: 2,
                shapeScore: 0.95,
                shapeThreshold: 0.89,
                shapePass: true,
                appearanceScore: 0.7,
                appearanceThreshold: 0.88,
                appearancePass: false,
                modelScore: 0.4,
                modelThreshold: 0.5,
                reason: "appearance-below-threshold",
              },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.stages.find((item) => item.id === "detection")).toMatchObject({
      label: "제보 이미지 후보 위치 탐색",
      summary: "5개 후보",
    });
    expect(view.stages.find((item) => item.id === "shape-gate")).toMatchObject({
      label: "반듯한 마름모 형태 확인",
      status: "complete",
      summary: "형태 통과",
    });
    expect(view.stages.find((item) => item.id === "appearance-gate")).toMatchObject({
      label: "룬 색감·외형 확인",
      status: "warning",
      summary: "외형 탈락",
    });
    expect(view.stages.find((item) => item.id === "recognition")).toMatchObject({
      label: "두 조건 결합",
      status: "warning",
      summary: "룬 아님",
    });
  });

  it("separates a detected report frame from the actual runtime and alert outcome", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "39c4d733-aeda-4ce5-add9-5453a18af117",
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: {
              detected: true,
              confidence: 0.9999,
              candidateCount: 1,
              detectorVersion: "rune-v13",
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: "rune-v13",
              stableCount: 0,
              candidateCount: 0,
              lastAlertedAt: null,
              lastAlertPlayback: null,
            },
            runtimeTrace: Array.from({ length: 12 }, (_, index) => ({
              sampledAt: NOW - 5_000 + index * 400,
              detected: false,
              confidence: 0,
              candidateCount: 0,
              stableCount: 0,
              shouldAlert: false,
              status: "waiting",
              reason: "waiting",
            })),
            lastSnapshot: {
              sampledAt: NOW,
              detectorVersion: "rune-v13",
              detected: true,
              confidence: 0.9999,
              candidateCount: 1,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({
      tone: "warning",
      title: "제보 이미지와 런타임 판정이 다름",
    });
    expect(view.summaryMetrics).toEqual([
      expect.objectContaining({ label: "제보 이미지 판정", value: "룬 감지" }),
      expect.objectContaining({ label: "저장 모델", value: "rune-v13" }),
      expect.objectContaining({ label: "런타임 판정", value: "미감지" }),
      expect.objectContaining({ label: "연속 감지", value: "0/3회" }),
      expect.objectContaining({ label: "실제 알림", value: "미발생" }),
    ]);
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      label: "실제 런타임 연속 감지",
      status: "warning",
      summary: "0/3회",
    });
    expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
      label: "실제 알림 기록",
      status: "warning",
      summary: "미발생",
    });
  });

  it("keeps legacy state-only rune outcomes unknown without runtime evidence", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "legacy-state-only-rune",
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: {
              detected: true,
              confidence: 0.99,
              candidateCount: 1,
              detectorVersion: "rune-strict-local-centernet-s4-v1",
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: "rune-strict-local-centernet-s4-v1",
              stableCount: 0,
              candidateCount: 0,
              lastAlertedAt: null,
              lastAlertPlayback: null,
            },
            lastSnapshot: {
              sampledAt: NOW,
              detectorVersion: "rune-strict-local-centernet-s4-v1",
              detected: true,
              confidence: 0.99,
              candidateCount: 1,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual([
      expect.objectContaining({ label: "제보 이미지 판정", value: "룬 감지" }),
      expect.objectContaining({
        label: "저장 모델",
        value: "rune-strict-local-centernet-s4-v1",
      }),
      expect.objectContaining({ label: "런타임 판정", value: "기록 없음" }),
      expect.objectContaining({ label: "연속 감지", value: "확인 불가" }),
      expect.objectContaining({ label: "실제 알림", value: "확인 불가" }),
    ]);
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rune-runtime-evidence-unavailable" }),
      ]),
    );
    expect(view.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "룬 후보 없음" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      status: "unavailable",
      summary: "기록 없음",
    });
    expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
      status: "unavailable",
      summary: "확인 불가",
      replayCoverage: "recognition-not-run",
    });
  });

  it("shows scene-cycle and confirmed-absence resets for current rune reports", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "scene-reset-sample",
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: { detected: true, confidence: 0.91, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "candidate",
              stableCount: 1,
              candidateCount: 1,
              scenePolicyVersion: "rune-scene-v1",
              sceneEpoch: 2,
              alertedSceneEpoch: 1,
              sceneChangedAt: NOW - 2_000,
              sceneChangeScore: 0.31,
              consecutiveMissCount: 0,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 3_000,
                detected: false,
                stableCount: 0,
                consecutiveMissCount: 2,
                scenePolicyVersion: "rune-scene-v1",
                sceneEpoch: 1,
                sceneChanged: false,
                shouldAlert: false,
                status: "waiting",
                reason: "confirmed-absent",
              },
              {
                sampledAt: NOW - 2_000,
                detected: true,
                confidence: 0.91,
                candidateCount: 1,
                stableCount: 1,
                consecutiveMissCount: 0,
                scenePolicyVersion: "rune-scene-v1",
                sceneEpoch: 2,
                sceneChanged: true,
                sceneChangeScore: 0.31,
                shouldAlert: false,
                status: "candidate",
                reason: "stabilizing",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rune-scene-cycle-reset", tone: "info" }),
        expect.objectContaining({ id: "rune-confirmed-absence-reset", tone: "info" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "장면 주기", value: "2 · rune-scene-v1" }),
        expect.objectContaining({ label: "장면 전환", value: "1회" }),
        expect.objectContaining({ label: "연속 미감지", value: "0회" }),
      ]),
    });
  });

  it("distinguishes browser playback from a silent effective volume", () => {
    const requestedAt = NOW - 2_000;
    const view = buildTroubleshooterViewModel(
      {
        id: "silent-playback-sample",
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: { detected: true, confidence: 0.92, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "alerted",
              stableCount: 3,
              candidateCount: 1,
              alertedAt: requestedAt,
              lastAlertPlayback: {
                status: "finished",
                decision: "initial",
                cycleId: `0:${requestedAt}:initial`,
                sceneEpoch: 0,
                requestedAt,
                startedAt: requestedAt + 25,
                finishedAt: requestedAt + 1_100,
                failedAt: null,
                error: null,
                soundId: "test-rune-sound",
                alertVolume: 1,
                masterVolume: 0,
                effectiveVolume: 0,
              },
            },
            runtimeTrace: [
              {
                sampledAt: requestedAt,
                detected: true,
                confidence: 0.92,
                candidateCount: 1,
                stableCount: 3,
                shouldAlert: true,
                status: "alerted",
                reason: "initial-alert",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({ label: "실제 알림", value: "무음 설정" }),
    );
    expect(view.verdict).toMatchObject({ tone: "critical", title: "룬 알림 볼륨이 0" });
    expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
      status: "blocked",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "브라우저 재생 시작" }),
        expect.objectContaining({ label: "브라우저 재생 종료" }),
        expect.objectContaining({ label: "최종 볼륨", value: "0%" }),
      ]),
    });
  });

  it("explains a false alert from the trigger frame instead of the later report frame", () => {
    const modelVersion = "rune-strict-local-centernet-s4-v1";
    const alertStartedAt = NOW - 10_417;
    const firstDetectedAt = alertStartedAt - 1_001;
    const reportSampledAt = NOW - 1_000;
    const view = buildTroubleshooterViewModel(
      {
        id: "203c4d22-9083-4d4d-8e9a-6bb51920f952",
        body: {
          kind: "rune-issue",
          reportIssue: {
            reason: "rune-false-positive",
            label: "다른 것을 룬으로 감지해요",
          },
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: reportSampledAt,
            result: {
              detected: false,
              confidence: 0.353,
              candidateCount: 0,
              detectorVersion: modelVersion,
            },
            runeEvidence: {
              lastAlert: {
                rawDataUrl: IMAGE,
                processedDataUrl: IMAGE,
                candidateDataUrl: IMAGE,
                sampledAt: alertStartedAt,
                candidateSampledAt: alertStartedAt,
                detectorVersion: modelVersion,
                confidence: 0.627,
              },
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: modelVersion,
              confidence: 0.353,
              stableCount: 0,
              candidateCount: 0,
              lastAlertedAt: alertStartedAt + 1_282,
              lastAlertPlayback: {
                status: "finished",
                decision: "initial",
                startedAt: alertStartedAt,
                finishedAt: alertStartedAt + 1_282,
                failedAt: null,
                error: null,
              },
            },
            runtimeTrace: [
              {
                sampledAt: firstDetectedAt,
                detected: true,
                confidence: 0.609,
                candidateCount: 1,
                candidate: { x: 91, y: 66, width: 13, height: 13 },
                stableCount: 1,
                shouldAlert: false,
                status: "candidate",
                reason: "stabilizing",
              },
              {
                sampledAt: alertStartedAt,
                detected: true,
                confidence: 0.627,
                candidateCount: 1,
                candidate: { x: 91, y: 66, width: 13, height: 13 },
                stableCount: 2,
                shouldAlert: true,
                status: "alerted",
                reason: "initial-alert",
              },
              {
                sampledAt: reportSampledAt - 400,
                detected: false,
                confidence: 0.354,
                candidateCount: 0,
                candidate: null,
                stableCount: 0,
                shouldAlert: false,
                status: "waiting",
                reason: "waiting",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({
      tone: "critical",
      title: "알림 프레임에서 모델 오감지 확인",
    });
    expect(view.summaryMetrics).toEqual([
      expect.objectContaining({ label: "제보 이미지 판정", value: "룬 없음" }),
      expect.objectContaining({ label: "저장 모델", value: modelVersion }),
      expect.objectContaining({ label: "런타임 판정", value: "알림 당시 감지" }),
      expect.objectContaining({
        label: "확정 근거",
        value: "2회 · 1001ms · 시간 조건",
      }),
      expect.objectContaining({ label: "실제 알림", value: "브라우저 재생 종료" }),
    ]);
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "rune-alert-report-frame-timeline",
        tone: "critical",
      }),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      status: "complete",
      summary: "알림 당시 2회 · 1001ms",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "알림 당시 점수", value: "63%" }),
        expect.objectContaining({ label: "제보 직전 마지막 판정", value: "미감지" }),
      ]),
    });
    expect(view.evidence).toContainEqual(
      expect.objectContaining({ id: "rune-last-alert-raw" }),
    );
  });

  it("uses frozen trigger evidence when the rolling runtime trace no longer contains the alert", () => {
    const modelVersion = "rune-strict-local-centernet-s4-v4";
    const triggerFrames = [NOW - 27_000, NOW - 26_000, NOW - 25_000].map(
      (sampledAt, index) => ({
        sampledAt,
        detectorVersion: modelVersion,
        rawDataUrl: IMAGE,
        detected: true,
        confidence: 0.67 + index * 0.01,
        candidateCount: 1,
        candidate: { x: 84, y: 23, width: 10, height: 10, confidence: 0.67 },
        status: index === 2 ? "alerted" : "candidate",
        stableCount: index + 1,
        firstDetectedAt: NOW - 27_000,
        stableDurationMs: index * 1_000,
        confirmationSatisfied: index === 2,
        confirmationSatisfiedBy: index === 2 ? "frames-and-duration" : null,
        shouldAlert: index === 2,
        reason: index === 2 ? "initial-alert" : "stabilizing",
        sceneEpoch: 1,
      }),
    );
    const triggerSummaryFrames = triggerFrames.map(
      ({ rawDataUrl: _rawDataUrl, ...frame }) => frame,
    );
    const view = buildTroubleshooterViewModel(
      {
        id: "2af9ccce-de3e-4ef9-a3bc-2e2e6ba380c9",
        body: {
          kind: "rune-issue",
          reportIssue: {
            reason: "rune-false-positive",
            label: "다른 것을 룬으로 감지해요",
          },
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            processedDataUrl: IMAGE,
            sampledAt: NOW,
            result: {
              detected: false,
              confidence: 0.2,
              candidateCount: 0,
              detectorVersion: modelVersion,
            },
            runeEvidence: {
              alertTrigger: {
                schemaVersion: "rune-alert-trigger-v1",
                cycleId: `1:${NOW - 25_000}:initial`,
                decision: "initial",
                triggeredAt: NOW - 25_000,
                detectorVersion: modelVersion,
                sceneEpoch: 1,
                frames: triggerFrames,
              },
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            confirmationPolicy: {
              version: "rune-confirmation-v2",
              mode: "all",
              requiredStableFrames: 3,
              requiredStableMilliseconds: 900,
            },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: modelVersion,
              stableCount: 0,
              candidateCount: 0,
              lastAlertPlayback: {
                status: "finished",
                cycleId: `1:${NOW - 25_000}:initial`,
                requestedAt: NOW - 25_000,
                startedAt: NOW - 24_900,
                finishedAt: NOW - 24_000,
              },
            },
            alertTrigger: {
              schemaVersion: "rune-alert-trigger-v1",
              cycleId: `1:${NOW - 25_000}:initial`,
              decision: "initial",
              triggeredAt: NOW - 25_000,
              detectorVersion: modelVersion,
              sceneEpoch: 1,
              frameCount: 3,
              frames: triggerSummaryFrames,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 1_000,
                detected: false,
                confidence: 0.2,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "waiting",
                reason: "waiting",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "런타임 판정", value: "알림 당시 감지" }),
        expect.objectContaining({ label: "확정 근거", value: "3회 · 2000ms · 횟수+시간 조건" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      status: "complete",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "고정 프레임", value: "3개" }),
        expect.objectContaining({ label: "알림 당시 모델", value: modelVersion }),
      ]),
    });
    expect(
      view.evidence.filter((item) => item.id.startsWith("rune-alert-trigger-frame-")),
    ).toHaveLength(3);
  });

  it("separates saved runtime incident frames from the later rune report frame", () => {
    const modelVersion = "rune-strict-local-centernet-s4-v4";
    const runtimeFrames = [
      {
        source: "runtime",
        phase: "before",
        outcome: "not-detected",
        sampledAt: NOW - 4_000,
        detectorVersion: modelVersion,
        detectionDebug: { modelScore: 0.22, modelThreshold: 0.53 },
        frameId: `frame:${NOW - 4_000}`,
        detected: false,
        confidence: 0.22,
        stableCount: 0,
        reason: "waiting",
      },
      {
        source: "runtime",
        phase: "signal",
        outcome: "near-threshold",
        sampledAt: NOW - 3_000,
        detectorVersion: modelVersion,
        detectionDebug: { modelScore: 0.49, modelThreshold: 0.53 },
        frameId: `frame:${NOW - 3_000}`,
        detected: false,
        confidence: 0.49,
        stableCount: 0,
        reason: "waiting",
      },
      {
        source: "runtime",
        phase: "after",
        outcome: "not-detected",
        sampledAt: NOW - 2_000,
        detectorVersion: modelVersion,
        detectionDebug: { modelScore: 0.18, modelThreshold: 0.53 },
        frameId: `frame:${NOW - 2_000}`,
        detected: false,
        confidence: 0.18,
        stableCount: 0,
        reason: "waiting",
      },
    ];
    const view = buildTroubleshooterViewModel(
      {
        id: "runtime-incident-sample",
        body: {
          kind: "rune-issue",
          reportIssue: {
            reason: "rune-missed",
            label: "룬이 떴는데 감지가 안돼요",
          },
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            processedDataUrl: IMAGE,
            sampledAt: NOW,
            result: {
              detected: true,
              confidence: 0.99,
              candidateCount: 1,
              detectorVersion: modelVersion,
            },
            runeEvidence: {
              selection: {
                policy: "rune-scenario-incident-v2",
                status: "matched",
                anchorKind: "episode",
                frameIds: runtimeFrames.map((frame) => frame.frameId),
                candidateCount: 2,
                sampleCount: 54,
                ambiguous: true,
              },
              mediaBudget: {
                omittedCapacity: 1,
                omittedOversized: 0,
              },
              runtimeFrames: runtimeFrames.map((frame) => ({
                frameId: frame.frameId,
                sampledAt: frame.sampledAt,
                rawDataUrl: IMAGE,
                roles: [`runtime-${frame.phase}`],
              })),
              runtimeIncident: {
                schemaVersion: "rune-runtime-incident-v1",
                id: "2:runtime",
                lastSignalAt: NOW - 3_000,
                frames: runtimeFrames,
              },
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            state: {
              status: "waiting",
              detectorVersion: modelVersion,
              stableCount: 0,
              candidateCount: 0,
            },
            runtimeIncident: {
              frameCount: 3,
              signalFrameCount: 1,
              lastSignalAt: NOW - 3_000,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 3_000,
                detected: false,
                confidence: 0.49,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "waiting",
                reason: "waiting",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "rune-runtime-incident-near-threshold",
        title: "실제 런타임에서는 판정 기준에 미치지 못함",
      }),
    );
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rune-selection-ambiguous",
          title: "제보 시간에 맞는 사건이 여러 개 있습니다",
          detail:
            "54개 런타임 샘플에서 사건 후보 2개를 찾았으며 가장 최근 사건을 선택했습니다.",
        }),
        expect.objectContaining({ id: "rune-selection-media-compacted" }),
      ]),
    );
    expect(
      view.evidence.filter((item) => item.id.startsWith("rune-runtime-incident-frame-")),
    ).toHaveLength(3);
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      summary: "고정 프레임에서 기준 근처",
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: "고정 런타임 프레임", value: "3개 · 신호 1개" }),
      ]),
    });
  });

  it("does not describe legacy negative-frame candidates as separate rune incidents", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "legacy-rune-negative-selection",
        body: {
          kind: "rune-issue",
          reportIssue: {
            reason: "rune-missed",
            scenario: "not-recognized",
            occurrence: "recent",
          },
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: { detected: false, confidence: 0.1, candidateCount: 0 },
            runeEvidence: {
              selection: {
                policy: "rune-scenario-incident-v1",
                status: "matched",
                anchorKind: "frame",
                frameIds: [`frame:${NOW - 1_000}`],
                candidateCount: 54,
                ambiguous: true,
              },
              runtimeFrames: [],
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            state: { status: "waiting", stableCount: 0, candidateCount: 0 },
            runtimeTrace: [],
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rune-selection-ambiguous",
          title: "이전 제보 방식이 여러 음성 기록을 후보로 선택했습니다",
          detail:
            "54개 후보 기록 중 마지막 기록이 선택됐습니다. 실제 사건 수를 뜻하지 않으며 당시 원본이 없으면 정확히 재현할 수 없습니다.",
        }),
        expect.objectContaining({ id: "rune-selection-media-unavailable" }),
      ]),
    );
  });

  it("shows an explicit rune worker failure instead of a negative model decision", () => {
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: {
            capture: { hasStream: true },
            runtimeAssets: {
              status: "update-required",
              runningBuild: { shortCommit: "3d0440c" },
              latestBuild: { shortCommit: "068d73a" },
            },
          },
          sample: {
            rawDataUrl: IMAGE,
            result: { detected: true, confidence: 0.99, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "unavailable",
              stableCount: 0,
              candidateCount: 0,
              lastDetectionError: {
                code: "rune-detection-worker-runtime-failed",
                phase: "worker-runtime",
                message: "Failed to load worker module",
                occurredAt: NOW,
                retryCount: 1,
              },
            },
            runtimeTrace: [
              {
                sampledAt: NOW,
                detected: false,
                outcome: "error",
                confidence: 0,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "unavailable",
                reason: "detector-error",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({ tone: "critical" });
    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({ label: "런타임 판정", value: "감지 오류" }),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      status: "blocked",
      summary: "감지기 실행 오류",
    });
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rune-runtime-detector-error", tone: "critical" }),
        expect.objectContaining({ id: "runtime-build-version-skew", tone: "critical" }),
      ]),
    );
  });

  it("shows both correlated attempts for a duplicate rune alert report", () => {
    const firstFrameId = `frame:${NOW - 5_000}`;
    const repeatFrameId = `frame:${NOW - 1_000}`;
    const view = buildTroubleshooterViewModel(
      {
        id: "duplicate-rune-alert",
        body: {
          kind: "rune-issue",
          reportIssue: {
            reason: "rune-false-positive",
            scenario: "duplicate-alert",
            label: "알림이 중복으로 울려요",
          },
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            sampledAt: NOW,
            result: {
              detected: false,
              confidence: 0.2,
              candidateCount: 0,
              detectorVersion: "rune-test",
            },
            runeEvidence: {
              selection: {
                status: "matched",
                anchorKind: "attempt",
                frameIds: [firstFrameId, repeatFrameId],
                episodeIds: ["rune-episode:2:1000"],
                cycleIds: ["2:5000:initial", "2:9000:repeat"],
                candidateCount: 2,
                ambiguous: false,
              },
              runtimeFrames: [
                {
                  frameId: firstFrameId,
                  sampledAt: NOW - 5_000,
                  rawDataUrl: IMAGE,
                  roles: ["alert-trigger"],
                },
                {
                  frameId: repeatFrameId,
                  sampledAt: NOW - 1_000,
                  rawDataUrl: IMAGE,
                  roles: ["alert-trigger"],
                },
              ],
              episodes: [
                {
                  episodeId: "rune-episode:2:1000",
                  alertAttemptIds: ["2:5000:initial", "2:9000:repeat"],
                },
              ],
              alertAttempts: [
                {
                  cycleId: "2:5000:initial",
                  parentEpisodeId: "rune-episode:2:1000",
                  decision: "initial",
                  frames: [
                    {
                      frameId: firstFrameId,
                      sampledAt: NOW - 5_000,
                      detected: true,
                      confidence: 0.9,
                      stableCount: 3,
                      reason: "initial-alert",
                      detectorVersion: "rune-test",
                    },
                  ],
                  playbackEvents: [{ status: "finished" }],
                },
                {
                  cycleId: "2:9000:repeat",
                  parentEpisodeId: "rune-episode:2:1000",
                  decision: "repeat",
                  frames: [
                    {
                      frameId: repeatFrameId,
                      sampledAt: NOW - 1_000,
                      detected: true,
                      confidence: 0.92,
                      stableCount: 3,
                      reason: "repeat-alert",
                      detectorVersion: "rune-test",
                    },
                  ],
                  playbackEvents: [{ status: "finished" }],
                },
              ],
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            state: {
              status: "alerted",
              detectorVersion: "rune-test",
              stableCount: 3,
              candidateCount: 1,
            },
            runtimeTrace: [],
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "rune-duplicate-attempts-correlated",
        title: "두 알림 시도가 같은 감지 구간에 연결됐습니다",
      }),
    );
    expect(view.summaryMetrics).toContainEqual(
      expect.objectContaining({
        id: "selected-episodes-attempts",
        value: "1개 / 2개",
      }),
    );
    expect(
      view.evidence.filter((item) => item.id.startsWith("rune-alert-trigger-frame-")),
    ).toHaveLength(2);
  });

  it("treats missing legacy runtime provenance as a possible execution failure", () => {
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: IMAGE,
            result: {
              detected: true,
              confidence: 0.99,
              candidateCount: 1,
              detectorVersion: "rune-v13",
            },
          },
          rune: {
            config: { enabled: true, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "waiting",
              detectorVersion: null,
              stableCount: 0,
              candidateCount: 0,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 500,
                detected: false,
                confidence: 0,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "waiting",
                reason: "waiting",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "rune-runtime-detector-may-not-have-run",
        tone: "warning",
      }),
    );
    expect(view.diagnostics).not.toContainEqual(
      expect.objectContaining({ id: "rune-report-runtime-frame-mismatch" }),
    );
  });

  it("prioritizes the disabled rune setting over report-frame detection", () => {
    const view = buildTroubleshooterViewModel(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            result: {
              detected: true,
              confidence: 0.99,
              candidateCount: 1,
              detectorVersion: "rune-strict-local-centernet-s4-v4",
            },
          },
          rune: {
            config: { enabled: false, region: { x: 0, y: 0, width: 1, height: 1 } },
            currentRegion: { x: 0, y: 0, width: 1, height: 1 },
            state: {
              status: "paused",
              detectorVersion: null,
              stableCount: 0,
              candidateCount: 0,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 500,
                detected: false,
                confidence: 0,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "paused",
                reason: "paused",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(view.verdict).toMatchObject({
      tone: "warning",
      title: "제보 당시 룬 알림이 꺼져 있었습니다",
    });
    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "런타임 판정", value: "알림 꺼짐" }),
        expect.objectContaining({ label: "연속 감지", value: "확인 안 함" }),
        expect.objectContaining({ label: "실제 알림", value: "알림 꺼짐" }),
      ]),
    );
    expect(view.stages.find((item) => item.id === "runtime")).toMatchObject({
      status: "unavailable",
      summary: "알림 꺼짐",
    });
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({ id: "rune-alert-disabled", tone: "warning" }),
    );
    expect(view.diagnostics).not.toContainEqual(
      expect.objectContaining({ id: "rune-runtime-detector-may-not-have-run" }),
    );
  });

  it.each([
    {
      name: "booster expiry incident",
      body: {
        kind: "booster-expiry-issue",
        reportIssue: {
          reason: "booster-expiry-missed",
          scenario: "alert-did-not-play",
        },
        sample: {
          rawDataUrl: null,
          timerDataUrl: null,
          result: { value: "9:59", confidence: 1, detected: true },
          boosterExpiryEvidence: {
            schemaVersion: "booster-expiry-incident-evidence-v1",
            frozenAt: NOW,
            selection: {
              policy: "booster-expiry-scenario-selection-v1",
              status: "matched",
              support: "partial",
              anchorKind: "playback-attempt",
              selectedEventAt: NOW - 1_000,
              resetEpochId: "booster-reset:1",
              candidateIds: ["playback:booster-decision:1"],
              frameIds: ["booster-frame:1"],
              observationIds: ["booster-observation:1"],
              candidateAttemptIds: ["booster-candidate:1"],
              cycleIds: ["booster-cycle:1"],
              scheduleIds: ["booster-schedule:1"],
              decisionIds: ["booster-decision:1"],
              playbackAttemptIds: ["booster-playback:1"],
              eventIds: [],
              configurationRevisionIds: ["booster-config:1"],
              mediaFrameIds: ["booster-frame:1"],
              relatedPlaybackIds: [],
              ambiguous: false,
              operatorConclusion: "playback-failed",
              physicalAudibility: "unknown",
              degradationReasons: ["asset-missing"],
            },
            configurations: [
              {
                id: "booster-config:1",
                values: {
                  alertLeadSeconds: 5,
                  soundId: "selected-sound",
                  effectiveVolume: 0.7,
                },
              },
            ],
            frames: [
              {
                id: "booster-frame:1",
                sampledAt: NOW - 6_000,
                configRevisionId: "booster-config:1",
                source: {
                  kind: "capture-top-strip-v1",
                  sourceDimensions: { width: 1920, height: 1080 },
                  sampledRegion: { width: 1920, height: 216 },
                },
                runtimeFailure: null,
              },
            ],
            observations: [
              {
                id: "booster-observation:1",
                frameId: "booster-frame:1",
                sampledAt: NOW - 6_000,
                decision: "accepted",
                reason: "timer-accepted",
                selectedTime: { text: "0:08", seconds: 8 },
                rawTime: { text: "0:08", seconds: 8 },
                timerCandidateCount: 1,
                timerMatchCount: 1,
                recognizerVersion: "booster-incident-model-v1",
                recognitionMs: 4,
                flow: { locked: true, source: "confirmed", predictedSeconds: 8 },
              },
            ],
            candidateAttempts: [
              {
                id: "booster-candidate:1",
                status: "confirmed",
                observationIds: ["booster-observation:1"],
                lastObservedAt: NOW - 6_000,
              },
            ],
            cycles: [
              {
                id: "booster-cycle:1",
                status: "active",
                observationIds: ["booster-observation:1"],
                confirmedAt: NOW - 6_000,
                expiresAt: NOW + 2_000,
                timingConfigRevisionId: "booster-config:1",
                contradictionCount: 0,
              },
            ],
            schedules: [
              {
                id: "booster-schedule:1",
                cycleId: "booster-cycle:1",
                registeredAt: NOW - 6_000,
                alertDueAt: NOW - 3_000,
                confirmedExpiresAt: NOW + 2_000,
                status: "fired",
              },
            ],
            decisions: [
              {
                id: "booster-decision:1",
                cycleId: "booster-cycle:1",
                scheduleId: "booster-schedule:1",
                occurredAt: NOW - 3_000,
                dueAt: NOW - 3_000,
                schedulerDelayMs: 0,
                firedConfigRevisionId: "booster-config:1",
              },
            ],
            playbackAttempts: [
              {
                id: "booster-playback:1",
                decisionId: "booster-decision:1",
                requestedAt: NOW - 3_000,
                failedAt: NOW - 2_900,
                status: "failed",
                error: "NotAllowedError",
                configRevisionId: "booster-config:1",
                effectiveVolume: 0.7,
              },
            ],
            lifecycle: [],
            media: [
              {
                id: "booster-media:1",
                frameId: "booster-frame:1",
                sampledAt: NOW - 6_000,
                reason: "alert-decision",
                imageDataUrl: IMAGE,
              },
            ],
            relatedPlayback: [],
            omissions: [
              {
                id: "booster-omission:1",
                reason: "asset-missing",
                kind: "asset",
              },
            ],
            reportFrame: null,
          },
        },
        boosterExpiry: {
          config: { enabled: true, alertLeadSeconds: 999 },
          state: {
            status: "alerted",
            remainingSeconds: 599,
            lastAlertPlayback: { status: "finished" },
          },
        },
      },
      feature: "booster-expiry",
      label: "부스터 종료 알림",
    },
    {
      name: "booster expiry",
      body: {
        kind: "booster-expiry-issue",
        diagnostics: { capture: { hasStream: true } },
        sample: {
          rawDataUrl: IMAGE,
          result: { value: "1:00", confidence: 0.9, detected: true },
          timerEvidence: [],
          confirmationEvidence: [],
        },
        boosterExpiry: {
          config: { enabled: true, alertLeadSeconds: 10 },
          state: { status: "confirming", remainingSeconds: 60 },
        },
      },
      feature: "booster-expiry",
      label: "부스터 종료 알림",
    },
    {
      name: "hunt stall",
      body: {
        kind: "hunt-stall-issue",
        diagnostics: { capture: { hasStream: true } },
        sample: {
          rawDataUrl: IMAGE,
          mode: "manual-experience",
          result: { value: "12.34", confidence: 0.91 },
          runtimeTrace: [],
          cropHistory: [],
        },
        huntStall: {
          config: { enabled: true, mode: "manual-experience", stallThresholdSeconds: 10 },
          state: { status: "monitoring", recognizedText: "12.34", unchangedSeconds: 2 },
        },
      },
      feature: "hunt-stall",
      label: "사냥 멈춤 알림",
    },
    {
      name: "quickslot skill",
      body: {
        kind: "skill-issue",
        diagnostics: { capture: { hasStream: true } },
        sample: {
          rawDataUrl: IMAGE,
          processedDataUrl: IMAGE,
          result: { value: 17, confidence: 0.88 },
        },
        skill: {
          config: {
            enabled: true,
            name: "테스트 스킬",
            detectionSource: "quickslot",
            alertThresholdSeconds: 5,
          },
          state: { status: "running", observedRemainingSeconds: 17 },
        },
      },
      feature: "skill",
      label: "스킬 알림",
    },
  ])("builds a complete $name view without feature leakage", ({ name, body, feature, label }) => {
    const view = buildTroubleshooterViewModel({ id: "sample", body }, { now: NOW });

    expect(view.feature).toBe(feature);
    expect(view.featureLabel).toBe(label);
    expect(view.stages.length).toBeGreaterThanOrEqual(4);
    if (name === "booster expiry incident") {
      expect(view.verdict).toMatchObject({ tone: "critical", title: "재생 실패" });
      expect(view.summaryMetrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "당시 판독", value: "판독 채택 · 0:08" }),
          expect.objectContaining({ label: "브라우저 재생", value: "재생 실패 · NotAllowedError" }),
        ]),
      );
      expect(view.stages.find((item) => item.id === "reading")).toMatchObject({
        status: "complete",
        summary: "판독 채택 · 0:08",
      });
      expect(view.stages.find((item) => item.id === "alert")).toMatchObject({
        status: "blocked",
        summary: "재생 실패 · NotAllowedError",
      });
      expect(view.stages.find((item) => item.id === "report-time")).toMatchObject({
        status: "unavailable",
        summary: "독립 분석 없음",
        replayCoverage: "recognition-not-run",
      });
      expect(view.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "저장된 사건 이미지 파일을 찾지 못했습니다" }),
        ]),
      );
      expect(view.evidence).toEqual([
        expect.objectContaining({
          id: "booster-expiry-incident-booster-media-1",
          group: "source",
          src: IMAGE,
        }),
      ]);
      const rendered = JSON.stringify({
        verdict: view.verdict,
        summaryMetrics: view.summaryMetrics,
        diagnostics: view.diagnostics,
        stages: view.stages,
      });
      expect(rendered).not.toContain("9:59");
      expect(rendered).not.toContain("999초");
      expect(rendered).not.toContain("브라우저 재생 종료");
      return;
    }
    expect(view.evidence.some((item) => item.id === "source-raw")).toBe(true);
    expect(view.stages[view.stages.length - 1]?.replayCoverage).toBe(
      "decision-replayed",
    );
  });

  it.each([
    {
      name: "quickslot skill",
      body: {
        kind: "skill-issue",
        sample: {
          result: {
            value: null,
            runtimeFailure: {
              stage: "recognizer",
              code: "recognizer-failed",
              technicalMessage: "session crashed",
              occurredAt: NOW,
            },
          },
        },
        skill: {
          config: { enabled: true, detectionSource: "quickslot" },
          state: { status: "detecting" },
        },
      },
      diagnosticId: "skill-runtime-analysis-failed",
      excludedDiagnosticId: null,
      blockedStage: "recognition",
    },
    {
      name: "hunt stall",
      body: {
        kind: "hunt-stall-issue",
        sample: {
          mode: "manual-experience",
          result: { value: null },
          runtimeTrace: [
            {
              sampledAt: NOW,
              runtimeFailure: {
                stage: "feature-analysis",
                code: "feature-analysis-failed",
                technicalMessage: "worker failed",
                occurredAt: NOW,
              },
            },
          ],
        },
        huntStall: {
          config: { enabled: true, mode: "manual-experience" },
          state: { status: "monitoring" },
        },
      },
      diagnosticId: "hunt-stall-runtime-analysis-failed",
      excludedDiagnosticId: null,
      blockedStage: "recognition",
    },
    {
      name: "booster expiry",
      body: {
        kind: "booster-expiry-issue",
        sample: {
          result: { value: null },
          timerEvidence: [],
          confirmationEvidence: [],
          runtimeTrace: [
            {
              sampledAt: NOW,
              runtimeFailure: {
                stage: "feature-analysis",
                code: "feature-analysis-failed",
                technicalMessage: "worker failed",
                occurredAt: NOW,
              },
            },
          ],
        },
        boosterExpiry: {
          config: { enabled: true, alertLeadSeconds: 10 },
          state: { status: "waiting" },
        },
      },
      diagnosticId: "booster-runtime-analysis-failed",
      excludedDiagnosticId: "booster-report-frame-error",
      blockedStage: "reading",
    },
    {
      name: "buff expiry after parser",
      body: {
        kind: "buff-expiry-issue",
        sample: {
          parser: { engine: "dl", version: "parser-v1" },
          result: {
            value: null,
            runtimeFailure: {
              stage: "feature-analysis",
              code: "feature-analysis-failed",
              technicalMessage: "matcher worker failed",
              occurredAt: NOW,
            },
          },
          next: {
            parser: { boxCount: 0 },
            identity: { targetObservations: [] },
            countdown: { observations: [] },
            tracking: { tracks: [], pendingTracks: [] },
          },
        },
        buffExpiry: {
          config: { enabled: true, alertLeadSeconds: 5 },
          state: { status: "unavailable", tracks: [], pendingTracks: [] },
        },
      },
      diagnosticId: "buff-runtime-analysis-failed",
      excludedDiagnosticId: "buff-no-boxes",
      blockedStage: "detection",
    },
  ])(
    "separates $name execution failures from valid zero-recognition results",
    ({ body, diagnosticId, excludedDiagnosticId, blockedStage }) => {
      const view = buildTroubleshooterViewModel(
        { id: "runtime-failure", body },
        { now: NOW },
      );

      expect(view.diagnostics).toContainEqual(
        expect.objectContaining({ id: diagnosticId, tone: "critical" }),
      );
      if (excludedDiagnosticId) {
        expect(view.diagnostics).not.toContainEqual(
          expect.objectContaining({ id: excludedDiagnosticId }),
        );
      }
      expect(view.stages.find((item) => item.id === blockedStage)).toMatchObject({
        status: "blocked",
      });
    },
  );

  it("shows hunt-stall repeat scheduling and rapid request evidence", () => {
    const view = buildTroubleshooterViewModel(
      {
        id: "hunt-repeat",
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            rawDataUrl: IMAGE,
            mode: "manual-experience",
            runtimeTrace: [
              { sampledAt: NOW - 2_000, shouldAlert: true },
              { sampledAt: NOW - 1_000, shouldAlert: true },
            ],
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "manual-experience",
              stallThresholdSeconds: 10,
              repeatAlertEnabled: true,
              repeatAlertIntervalSeconds: 5,
              repeatAlertMaxCount: null,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 20,
              hasObservedExperienceChange: true,
              alertedAt: NOW - 20_000,
              lastRepeatedAlertAt: NOW - 1_000,
              repeatedAlertCount: 2,
              lastAlertPlayback: { status: "finished" },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(view.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repeat",
          label: "반복",
          value: "2회 · 5초 간격 · 계속",
        }),
      ]),
    );
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "반복 간격보다 빠른 알림 요청" }),
      ]),
    );
  });

  it("keeps an unwrapped legacy sample readable through the fallback adapter", () => {
    const view = buildTroubleshooterViewModel({
      id: "legacy",
      kind: "unknown-report",
      sample: { rawDataUrl: IMAGE, result: { value: "legacy" } },
    });

    expect(view.feature).toBe("unknown");
    expect(view.title).toContain("legacy");
    expect(view.metadata.reportContract).toBeNull();
    expect(view.evidence).toHaveLength(1);
    expect(view.stages[0]).toMatchObject({ id: "input", status: "complete" });
  });
});

function createSkillIncidentTroubleshooterBody(): any {
  const frameId = "skill-frame:epoch:1";
  const observationId = "skill-observation:1";
  const cycleId = "skill-cycle:1";
  return {
    kind: "skill-issue",
    reportIssue: {
      reason: "skill-alert-timing",
      scenario: "recognized-no-alert",
      occurrence: "recent",
      affectedTargetId: "skill-a",
    },
    incident: {
      id: "incident:skill:1",
      scenario: "recognized-no-alert",
      occurrence: "recent",
      evidence: {
        source: "runtime-atomic",
        sampledAt: NOW,
        windowStartedAt: NOW - 60_000,
        windowEndedAt: NOW,
        frameCount: 1,
        mediaCount: 1,
        stateBinding: "runtime-atomic",
      },
      completeness: {
        sourceImage: false,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
        affectedTarget: false,
      },
      journal: {
        status: "unavailable",
        capturedAt: NOW - 2_000,
        entries: [],
      },
      correlation: {
        frameIds: [],
        cycleIds: [],
        playbackIds: [],
        configRevisions: [],
      },
      evidenceManifest: { references: [] },
    },
    sample: {
      sampledAt: NOW,
      source: { dataUrl: IMAGE },
      fullFrameDataUrl: IMAGE,
      result: { value: 99 },
      buffDuration: { boxCount: 0, detected: false },
      skillEvidence: {
        schemaVersion: "skill-incident-evidence-v1",
        archiveUpdatedAt: NOW - 1_000,
        frozenAt: NOW - 1_000,
        selectedSkillId: "skill-a",
        leaseId: "skill-lease:1",
        selection: {
          policy: "skill-alert-scenario-selection-v1",
          status: "matched",
          support: "partial",
          anchorKind: "attempt",
          selectedEventAt: NOW - 2_000,
          selectedSkillId: "skill-a",
          mode: "precision-countdown",
          targetId: "janus",
          epochId: "skill-epoch:skill-a:1",
          candidateIds: ["candidate:1"],
          frameIds: [frameId],
          observationIds: [observationId],
          cycleIds: [cycleId],
          decisionIds: ["skill-decision:1", "skill-decision:2"],
          arbitrationIds: ["skill-arbitration:1"],
          attemptIds: ["skill-playback:1"],
          eventIds: [],
          configurationRevisionIds: ["skill-config:1"],
          mediaIds: ["skill-media:frame:1"],
          ambiguous: false,
          playbackStartEvidence: "not-recorded",
          physicalAudibility: "unknown",
          degradationReasons: ["asset-missing"],
        },
        epochs: [
          {
            id: "skill-epoch:skill-a:1",
            skillId: "skill-a",
            mode: "precision-countdown",
          },
        ],
        frames: [
          {
            id: frameId,
            epochId: "skill-epoch:skill-a:1",
            skillId: "skill-a",
            sampledAt: NOW - 3_000,
            source: "runtime",
            mode: "precision-countdown",
            targetId: "janus",
            provider: "wasm",
            recognizerVersion: "center-ocr-v5",
            runtimeFailure: null,
          },
        ],
        observations: [
          {
            id: observationId,
            frameId,
            epochId: "skill-epoch:skill-a:1",
            sampledAt: NOW - 3_000,
            mode: "precision-countdown",
            recognitionDecision: "accepted",
            parser: {
              boxCount: 4,
              rowCount: 2,
              eligibleBoxCount: 2,
              candidateCount: 2,
              decisionReason: "top-rows-filtered",
            },
            matcher: {
              accepted: true,
              candidateCount: 1,
              decisionReason: "target_accepted",
              bundleId: "skill-deep-v2",
              modelVersion: "janus-v2",
              score: 4.2,
              threshold: 2.1,
              margin: 2.1,
              gateMargin: 0.2,
            },
            value: {
              kind: "countdown",
              rawValue: 3,
              text: "3",
              confidence: 0.98,
              decision: "accepted",
              reason: null,
            },
            flow: {
              confirmedValue: 3,
              expectedMin: 2,
              expectedMax: 4,
              decisionReason: "accepted-decrease",
            },
            runtimeFailure: null,
          },
        ],
        cycles: [
          {
            id: cycleId,
            status: "terminal",
            lastEventAt: NOW - 2_000,
            terminalReason: "alert-requested",
          },
        ],
        decisions: [
          {
            id: "skill-decision:1",
            outcome: "requested",
          },
          {
            id: "skill-decision:2",
            outcome: "suppressed-duplicate-target",
          },
        ],
        arbitrations: [
          {
            id: "skill-arbitration:1",
            winnerSkillId: "skill-a",
            suppressedSkillIds: ["skill-b"],
          },
        ],
        playbackAttempts: [
          {
            id: "skill-playback:1",
            requestedAt: NOW - 2_000,
            failedAt: NOW - 1_900,
            status: "failed",
            startedMeaning: null,
            error: "NotAllowedError",
          },
        ],
        lifecycle: [],
        configurations: [{ id: "skill-config:1" }],
        media: [
          {
            id: "skill-media:frame:1",
            frameId,
            capturedAt: NOW - 3_000,
            reason: "alert-decision",
            variant: "precision-source",
            dataUrl: "data:image/jpeg;base64,Q0M=",
          },
        ],
        omissions: [
          {
            id: "skill-omission:1",
            reason: "asset-missing",
            kind: "asset",
            subjectIds: ["skill-media:missing"],
            count: 1,
          },
        ],
        reportFrame: {
          id: `skill-report-time:${NOW}`,
          source: "report-time",
          sampledAt: NOW,
        },
      },
    },
    skill: {
      id: "skill-a",
      config: {
        id: "skill-a",
        name: "솔 야누스 : 새벽",
        presetId: "sol-janus-dawn-deep-v2",
        detectionSource: "buff-duration",
      },
      state: {
        status: "detecting",
        alertedAt: null,
      },
    },
  };
}

function createBuffExpiryIncidentTroubleshooterBody(): any {
  const frameId = "buff-expiry-frame:epoch:1";
  const observationId = `${frameId}:unionLuck:0`;
  const episodeId = "buff-expiry-episode:epoch:unionLuck:1";
  const cycleId = "buff-expiry-cycle:epoch:1";
  return {
    kind: "buff-expiry-issue",
    reportIssue: {
      reason: "buff-expiry-missed",
      scenario: "playback-missing",
      affectedTargetId: "unionLuck",
    },
    incident: {
      id: "incident:buff:1",
      scenario: "playback-missing",
      occurrence: "recent",
      evidence: {
        source: "runtime-atomic",
        sampledAt: NOW,
        windowStartedAt: NOW - 60_000,
        windowEndedAt: NOW,
        frameCount: 1,
        mediaCount: 1,
        stateBinding: "runtime-atomic",
      },
      completeness: {
        sourceImage: false,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
        affectedTarget: false,
      },
      journal: {
        status: "unavailable",
        capturedAt: NOW - 2_000,
        entries: [],
      },
      correlation: {
        frameIds: [],
        cycleIds: [],
        playbackIds: [],
        configRevisions: [],
      },
      evidenceManifest: { references: [] },
    },
    sample: {
      sampledAt: NOW,
      source: {
        dataUrl: "data:image/png;base64,QkI=",
      },
      parser: {
        engine: "dl",
        version: "report-time-parser",
      },
      next: {
        parser: { boxCount: 0 },
        identity: { targetObservations: [] },
        countdown: { observations: [] },
        tracking: { tracks: [], pendingTracks: [] },
      },
      buffExpiryEvidence: {
        schemaVersion: "buff-expiry-incident-evidence-v1",
        frozenAt: NOW - 1_000,
        selection: {
          policy: "buff-expiry-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "attempt",
          selectedEventAt: NOW - 2_000,
          affectedGroup: "unionLuck",
          frameIds: [frameId],
          observationIds: [observationId],
          episodeIds: [episodeId],
          cycleIds: [cycleId],
          attemptIds: ["attempt:1"],
          eventIds: [],
          mediaFrameIds: [frameId],
          degradationReasons: [],
        },
        frames: [
          {
            id: frameId,
            sampledAt: NOW - 3_000,
            source: "runtime",
            parser: {
              engine: "dl",
              version: "incident-parser",
              provider: "webgpu",
              modelVersion: "incident-model",
            },
            recognition: {
              parserBoxCount: 1,
              parsedRowCount: 1,
              upperExcludedBoxCount: 0,
              eligibleBoxCount: 1,
              matcherObservationCount: 1,
              selectedCandidateCount: 1,
              acceptedTargetCount: 1,
            },
            runtimeFailure: null,
          },
        ],
        observations: [
          {
            id: observationId,
            frameId,
            episodeId,
            sampledAt: NOW - 3_000,
            group: "unionLuck",
            targetAccepted: true,
            winningGroup: "unionLuck",
            decisionReason: "target_accepted",
            bundleDecisions: [
              {
                group: "unionLuck",
                accepted: true,
                score: 2.1,
                margin: 0.8,
                reason: "target_accepted",
              },
            ],
            countdown: {
              text: "3",
              seconds: 3,
              status: "high",
              confidence: 0.98,
              decision: "accepted",
              reason: null,
            },
          },
        ],
        episodes: [
          {
            id: episodeId,
            group: "unionLuck",
            status: "confirmed",
            confirmedAt: NOW - 3_000,
          },
        ],
        transitions: [
          {
            id: "transition:1",
            episodeId,
            kind: "confirmed",
            occurredAt: NOW - 3_000,
          },
        ],
        cycles: [
          {
            id: cycleId,
            episodeIds: [episodeId],
            status: "fired",
            dueAt: NOW - 2_000,
          },
        ],
        cycleEvents: [
          {
            id: "cycle-event:1",
            cycleId,
            status: "fired",
            occurredAt: NOW - 2_000,
          },
        ],
        attempts: [
          {
            id: "attempt:1",
            cycleId,
            requestedAt: NOW - 2_000,
            status: "failed",
            error: "NotAllowedError",
          },
        ],
        media: [
          {
            frameId,
            sampledAt: NOW - 3_000,
            reason: "fired-trigger",
            dataUrl: "data:image/jpeg;base64,Q0M=",
          },
        ],
        omissions: [],
        reportFrame: {
          id: `buff-expiry-report-time:${NOW}`,
          source: "report-time",
          sampledAt: NOW,
        },
      },
    },
    buffExpiry: {
      config: { enabled: true, alertLeadSeconds: 5 },
      state: {
        status: "tracking",
        tracks: [],
        pendingTracks: [],
        lastAlertPlayback: {
          status: "started",
          requestedAt: NOW,
          startedAt: NOW,
        },
      },
    },
  };
}

function createHuntStallIncidentTroubleshooterBody(): any {
  const selectedAt = NOW - 2_000;
  return {
    kind: "hunt-stall-issue",
    reportIssue: {
      reason: "hunt-stall-no-alert",
      scenario: "playback-missing",
      occurrence: "recent",
    },
    incident: {
      id: "incident:hunt:1",
      scenario: "playback-missing",
      occurrence: "recent",
      evidence: {
        source: "runtime-atomic",
        sampledAt: selectedAt,
        windowStartedAt: NOW - 60_000,
        windowEndedAt: NOW,
        frameCount: 2,
        mediaCount: 1,
        stateBinding: "runtime-atomic",
      },
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
        affectedTarget: true,
      },
      journal: {
        status: "available",
        capturedAt: NOW,
        entries: [],
      },
      correlation: {
        frameIds: ["frame:selected"],
        cycleIds: ["cycle:selected"],
        playbackIds: ["attempt:selected"],
        configRevisions: ["config:selected"],
      },
      evidenceManifest: { references: [] },
    },
    sample: {
      sampledAt: NOW,
      rawDataUrl: "data:image/png;base64,RlJPWkVO",
      processedDataUrl: "data:image/png;base64,RlJPWkVOLVBBUlNFRA==",
      result: { value: 999, confidence: 1 },
      huntStallEvidence: {
        schemaVersion: "hunt-stall-incident-evidence-v1",
        frozenAt: NOW,
        selection: {
          policy: "hunt-stall-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "attempt",
          selectedEventAt: selectedAt,
          mode: "manual-experience",
          frameIds: ["frame:selected"],
          observationIds: ["observation:selected"],
          activityEpochIds: ["activity:selected"],
          stallEpisodeIds: ["episode:selected"],
          cycleIds: ["cycle:selected"],
          decisionIds: ["decision:selected"],
          attemptIds: ["attempt:selected"],
          configurationRevisionIds: ["config:selected"],
          mediaFrameIds: ["frame:selected"],
          relatedPlaybackIds: ["related:skill"],
          ambiguous: false,
          operatorConclusion: "playback-failed",
          physicalAudibility: "unknown",
          degradationReasons: [],
        },
        configurations: [
          {
            id: "config:selected",
            capturedAt: NOW - 10_000,
            values: {
              enabled: true,
              mode: "manual-experience",
              thresholdSeconds: 10,
            },
          },
        ],
        frames: [
          {
            id: "frame:selected",
            sampledAt: selectedAt,
            mode: "manual-experience",
            configRevisionId: "config:selected",
            region: { x: 100, y: 700, width: 500, height: 40 },
            recognizer: {
              engine: "experience-ocr",
              modelId: "hunt-ocr",
              modelVersion: "hunt-v2",
              provider: "wasm",
            },
            timings: { recognitionMs: 12 },
          },
          {
            id: "frame:distractor",
            sampledAt: NOW - 100,
            mode: "manual-experience",
          },
        ],
        observations: [
          {
            id: "observation:selected",
            frameId: "frame:selected",
            sampledAt: selectedAt,
            recognition: {
              decision: "accepted",
              rawText: "100",
              rawValue: 100,
              correctedValue: 100,
              confidence: 0.98,
              reason: null,
            },
            transition: {
              kind: "threshold-reached",
              reason: "threshold-reached",
              elapsedMs: 10_000,
              thresholdMs: 10_000,
              shouldAlert: true,
            },
          },
          {
            id: "observation:distractor",
            frameId: "frame:distractor",
            sampledAt: NOW - 100,
            recognition: {
              decision: "accepted",
              rawValue: 999,
              correctedValue: 999,
              confidence: 1,
            },
            transition: { kind: "activity-confirmed", shouldAlert: false },
          },
        ],
        activityEpochs: [
          {
            id: "activity:selected",
            startedAt: NOW - 12_000,
            reason: "manual-progress-confirmed",
          },
        ],
        stallEpisodes: [
          {
            id: "episode:selected",
            activityEpochId: "activity:selected",
            startedAt: NOW - 12_000,
            status: "alerted",
            alertCycleId: "cycle:selected",
            lastEvaluation: {
              elapsedMs: 10_000,
              thresholdMs: 10_000,
              outcome: "alert",
              reason: "threshold-reached",
            },
          },
        ],
        alertCycles: [
          {
            id: "cycle:selected",
            stallEpisodeId: "episode:selected",
            startedAt: selectedAt,
            status: "active",
          },
        ],
        decisions: [
          {
            id: "decision:selected",
            cycleId: "cycle:selected",
            kind: "initial",
            occurredAt: selectedAt,
            frameId: "frame:selected",
            observationId: "observation:selected",
            configRevisionId: "config:selected",
            evaluation: { outcome: "alert", reason: "threshold-reached" },
          },
        ],
        playbackAttempts: [
          {
            id: "attempt:selected",
            cycleId: "cycle:selected",
            decisionId: "decision:selected",
            requestedAt: selectedAt,
            startedAt: null,
            finishedAt: null,
            failedAt: selectedAt + 10,
            status: "failed",
            error: "NotAllowedError",
            effectiveVolume: 0.8,
          },
        ],
        lifecycle: [],
        relatedPlayback: [
          {
            id: "related:skill",
            feature: "skill",
            requestedAt: selectedAt,
            status: "finished",
          },
        ],
        media: [
          {
            id: "media:selected",
            frameId: "frame:selected",
            sampledAt: selectedAt,
            reason: "playback-failed",
            rawDataUrl: "data:image/png;base64,U0VMRUNURUQ=",
            processedDataUrl: "data:image/png;base64,UFJPQ0VTU0VE",
          },
          {
            id: "media:distractor",
            frameId: "frame:distractor",
            sampledAt: NOW - 100,
            reason: "current",
            rawDataUrl: "data:image/png;base64,RElTVFJBQ1RPUg==",
            processedDataUrl: null,
          },
        ],
        omissions: [],
        reportFrame: null,
      },
    },
    huntStall: {
      config: {
        enabled: true,
        mode: "manual-experience",
        stallThresholdSeconds: 30,
      },
      state: {
        status: "monitoring",
        recognizedText: "999",
        unchangedSeconds: 0,
        lastAlertPlayback: { status: "finished" },
      },
    },
  };
}

describe("normalizeDebugSample", () => {
  it("reads the new report contract from wrapped payloads", () => {
    const normalized = normalizeDebugSample({
      body: {
        kind: "rune-issue",
        reportContract: {
          schema: "maple-timer.alert-report",
          version: 1,
        },
        rune: {},
      },
    });

    expect(normalized.reportContract).toEqual({
      schema: "maple-timer.alert-report",
      version: 1,
    });
  });

  it("keeps legacy and malformed contract payloads readable", () => {
    expect(normalizeDebugSample({ body: { kind: "rune-issue", rune: {} } })).toMatchObject({
      feature: "rune",
      reportContract: null,
    });
    expect(
      normalizeDebugSample({
        body: {
          kind: "rune-issue",
          reportContract: { schema: "maple-timer.alert-report", version: "1" },
          rune: {},
        },
      }),
    ).toMatchObject({ feature: "rune", reportContract: null });
  });

  it.each([
    ["buff-expiry-issue", "buffExpiry", "buff-expiry"],
    ["booster-expiry-issue", "boosterExpiry", "booster-expiry"],
    ["rune-issue", "rune", "rune"],
    ["hunt-stall-issue", "huntStall", "hunt-stall"],
    ["skill-issue", "skill", "skill"],
    ["special-core-issue", "specialCore", "special-core"],
    [
      "ultima-raid-equipment-issue",
      "ultimaRaidEquipment",
      "ultima-raid-equipment",
    ],
  ])("maps %s payloads to %s", (kind, key, expectedFeature) => {
    const normalized = normalizeDebugSample({ body: { kind, [key]: {} } });
    expect(normalized.feature).toBe(expectedFeature);
  });
});
