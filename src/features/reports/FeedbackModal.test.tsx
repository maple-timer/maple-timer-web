import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HuntStallRuntimeState, RuneSnapshot } from "../../alertTypes";
import type { Profile, SkillRuntimeState } from "../../types";
import { createRuntimeState } from "../../lib/timer";
import { FeedbackModal } from "./FeedbackModal";
import { buildPrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import { createLegacyReportFrameSourceContext } from "../../contracts/reporting/frameSourceDiagnostics";

const PRECISION_PARSER_RUNTIME = buildPrecisionParserRuntimeReport(
  { executionProvider: "webgpu", selectionSource: "default" },
  { status: "idle" },
);
const FRAME_SOURCE_CONTEXT = createLegacyReportFrameSourceContext(null);

function makeProfile(): Profile {
  const now = new Date().toISOString();
  return {
    id: "profile-1",
    name: "사냥 프로필",
    createdAt: now,
    updatedAt: now,
    captureHint: "window",
    displayMode: "center-large",
    masterVolume: 0.9,
    alertDefaults: { volume: 0.85, soundId: "띵동띵동" },
    skills: [
      {
        id: "skill-1",
        name: "솔 야누스",
        countdownSource: "duration",
        durationSeconds: 60,
        alertThresholdSeconds: 5,
        recognitionStartSeconds: 60,
        region: null,
        regionsByLayout: {},
        recognitionMode: "digit-template",
        soundId: "띵동띵동",
        volume: 0.85,
        enabled: true,
      },
    ],
  };
}

function makeRuneTriggerFrame(
  sampledAt: number,
  stableCount: number,
  shouldAlert = false,
): NonNullable<RuneSnapshot["lastAlertTrigger"]>["frames"][number] {
  return {
    sampledAt,
    detectorVersion: "rune-cascade-v9",
    detectionDebug: {
      detectorKind: "onnx",
      classifier: "rune-cascade-v9",
      shapeScore: 0.94,
      shapeThreshold: 0.89,
      shapePass: true,
      appearanceScore: 0.93,
      appearanceThreshold: 0.88,
      appearancePass: true,
      modelScore: 0.93,
      modelThreshold: 0.88,
      inferenceMs: 8,
      reason: "accepted",
    },
    rawDataUrl: `data:image/png;base64,trigger${stableCount}`,
    detected: true,
    confidence: 0.93,
    candidateCount: 1,
    candidate: { x: 8, y: 12, width: 14, height: 14, confidence: 0.93 },
    status: shouldAlert ? "alerted" : "candidate",
    stableCount,
    firstDetectedAt: sampledAt - (stableCount - 1) * 1_000,
    stableDurationMs: (stableCount - 1) * 1_000,
    confirmationSatisfied: shouldAlert,
    confirmationSatisfiedBy: shouldAlert ? "frames-and-duration" : null,
    shouldAlert,
    reason: shouldAlert ? "initial-alert" : "stabilizing",
    sceneEpoch: 0,
  };
}

function renderFeedbackModal({
  states,
  runeSnapshot = null,
  huntStallState = null,
  huntStallSnapshot = null,
}: {
  states?: Record<string, SkillRuntimeState>;
  runeSnapshot?: RuneSnapshot | null;
  huntStallState?: HuntStallRuntimeState | null;
  huntStallSnapshot?: Parameters<typeof FeedbackModal>[0]["huntStallSnapshot"];
} = {}) {
  const profile = makeProfile();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <FeedbackModal
      profile={profile}
      states={states ?? { "skill-1": createRuntimeState("skill-1") }}
      snapshots={{}}
      runeSnapshot={runeSnapshot}
      huntStallState={huntStallState}
      huntStallSnapshot={huntStallSnapshot}
      videoRef={{ current: null }}
      stream={null}
      captureSize={null}
      currentLayoutKey={null}
      frameSourceContext={FRAME_SOURCE_CONTEXT}
      precisionParserRuntime={PRECISION_PARSER_RUNTIME}
      onClose={() => undefined}
      onSubmitted={() => undefined}
    />,
  );

  return { fetchMock };
}

async function fillMessageAndGoToDiagnostics(message: string) {
  fireEvent.change(screen.getByLabelText("내용"), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "추가 진단 자료" })).toBeInTheDocument());
}

async function goToReview() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "최종 검토" })).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "선택한 내용 보내기" })).toBeEnabled(),
  );
}

async function fillMessageAndGoToReview(message: string) {
  await fillMessageAndGoToDiagnostics(message);
  await goToReview();
}

describe("FeedbackModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers separate Discord and KakaoTalk inquiry callouts", () => {
    renderFeedbackModal();

    expect(
      screen.getByText("답장이 필요하면 디스코드로 문의해주세요."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("운영자와 직접 대화하고 사진·동영상도 보낼 수 있어요."),
    ).toBeInTheDocument();
    expect(screen.getByText("휴대폰에서는 카카오톡이 편해요.")).toBeInTheDocument();
    expect(
      screen.getByText("채팅으로 문의하고 답장도 받을 수 있어요."),
    ).toBeInTheDocument();
    const discordLink = screen.getByRole("link", { name: "디스코드 문의" });
    expect(discordLink).toHaveAttribute(
      "href",
      "https://discord.gg/ACXssjgs9g",
    );
    expect(discordLink).toHaveAttribute("target", "_blank");
    expect(
      discordLink.closest(".feedback-discord-callout")?.querySelector(".discord-brand-icon"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "카카오톡 문의" })).toHaveAttribute(
      "href",
      "https://open.kakao.com/o/sjmV5jti",
    );
  });

  it("collects no contact and explains that replies go through Discord or KakaoTalk", async () => {
    renderFeedbackModal();

    expect(screen.queryByLabelText("연락처 선택 입력")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /이 창으로 보낸 문의에는 개별 답장을 드리지 않아요\.\s*답장이 필요하면 아래 채널을 이용해주세요\./,
      ),
    ).toBeInTheDocument();

    await fillMessageAndGoToReview("답장 없는 문의 흐름 확인");

    expect(screen.getByRole("region", { name: "최종 검토" })).toBeInTheDocument();
    expect(screen.queryByText("연락처")).not.toBeInTheDocument();
  });

  it("submits text feedback without optional diagnostics by default", async () => {
    const { fetchMock } = renderFeedbackModal();

    await fillMessageAndGoToReview("숫자 인식이 한 번씩 튑니다.");
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/feedback", expect.anything()));
    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);

    expect(request.method).toBe("POST");
    expect(body.kind).toBe("bug");
    expect(body.message).toBe("숫자 인식이 한 번씩 튑니다.");
    expect(body.contact).toBeNull();
    expect(body.appBuild).toEqual(
      expect.objectContaining({
        name: "maple-timer",
        shortCommit: expect.any(String),
        runtimeOrigin: "http://localhost:3000",
      }),
    );
    expect(body.attachments).toHaveLength(0);
    expect(body.diagnostics.precisionParserRuntime).toMatchObject({
      executionProvider: "webgpu",
      cpuFallbackStatus: "idle",
    });
    expect(body.diagnostics.capture.frameSource).toEqual({
      coordinateSpace: "capture",
      layoutKey: null,
      gameViewport: {
        state: "legacy-passthrough",
        captureSize: null,
        region: null,
        gameResolution: null,
        revision: 0,
      },
    });
    expect(body.diagnostics.settings).toBeUndefined();
  });

  it("shows a read-only final review before submitting", async () => {
    const { fetchMock } = renderFeedbackModal();

    await fillMessageAndGoToDiagnostics("a");

    expect(fetchMock).not.toHaveBeenCalled();
    await goToReview();

    expect(screen.getByRole("region", { name: "최종 검토" })).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByLabelText("내용")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("changes the feedback type from the segmented picker", async () => {
    const { fetchMock } = renderFeedbackModal();

    fireEvent.click(screen.getByRole("radio", { name: "제안" }));
    await fillMessageAndGoToReview("이런 기능이 있으면 좋겠습니다.");
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.kind).toBe("suggestion");
  });

  it("shows a progress indicator while feedback is being uploaded", async () => {
    const profile = makeProfile();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          window.setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ ok: true }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            50,
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FeedbackModal
        profile={profile}
        states={{ "skill-1": createRuntimeState("skill-1") }}
        snapshots={{}}
        runeSnapshot={null}
        huntStallState={null}
        huntStallSnapshot={null}
        videoRef={{ current: null }}
        stream={null}
        captureSize={null}
        currentLayoutKey={null}
        frameSourceContext={FRAME_SOURCE_CONTEXT}
        precisionParserRuntime={PRECISION_PARSER_RUNTIME}
        onClose={() => undefined}
        onSubmitted={() => undefined}
      />,
    );

    await fillMessageAndGoToReview("전송 중 상태가 필요합니다.");
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    expect(await screen.findByRole("status", { name: "피드백 전송 중" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전송 중" })).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("includes settings only when the user checks the settings option", async () => {
    const { fetchMock } = renderFeedbackModal();

    await fillMessageAndGoToDiagnostics("현재 설정도 같이 확인해주세요.");
    fireEvent.click(screen.getByLabelText("현재 설정값 첨부"));
    await goToReview();
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.diagnostics.settings.profile.skills[0].name).toBe("솔 야누스");
  });

  it("warns that attached images may include private in-game information", async () => {
    renderFeedbackModal();

    await fillMessageAndGoToDiagnostics("첨부 안내를 확인합니다.");

    expect(screen.getByText(/선택한 항목만 함께 전송됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/게임 닉네임, 채팅/)).toBeInTheDocument();
    expect(screen.getByLabelText("전체 공유 화면 첨부")).toBeDisabled();
    expect(screen.getByLabelText("Crop 영역 이미지 첨부")).toBeDisabled();
  });

  it("includes a two-minute-old latest rune trigger when crop attachments are selected", async () => {
    const triggeredAt = Date.now() - 2 * 60_000;
    const { fetchMock } = renderFeedbackModal({
      runeSnapshot: {
        sampledAt: triggeredAt,
        detectorVersion: "rune-cascade-v9",
        rawPreviewUrl: "data:image/png;base64,runeRaw",
        maskPreviewUrl: "data:image/png;base64,runeMask",
        candidatePreviewUrl: "data:image/png;base64,runeCandidate",
        candidateRawPreviewUrl: "data:image/png;base64,runeCandidateRaw",
        candidateMaskPreviewUrl: "data:image/png;base64,runeCandidateMask",
        candidateRegionLabel: "12x12",
        candidateSampledAt: 1,
        candidate: { x: 1, y: 2, width: 12, height: 12, confidence: 0.86 },
        detected: true,
        confidence: 0.86,
        candidateCount: 1,
        lastAlertTrigger: {
          schemaVersion: "rune-alert-trigger-v1",
          cycleId: "rune-cycle-1",
          episodeId: "rune-episode-1",
          decision: "initial",
          triggeredAt,
          detectorVersion: "rune-cascade-v9",
          sceneEpoch: 0,
          frames: [
            makeRuneTriggerFrame(triggeredAt - 3_000, 1),
            makeRuneTriggerFrame(triggeredAt - 2_000, 2),
            makeRuneTriggerFrame(triggeredAt - 1_000, 3),
            makeRuneTriggerFrame(triggeredAt, 4, true),
          ],
        },
      },
    });

    await fillMessageAndGoToDiagnostics("룬 감지 실패 케이스입니다.");
    fireEvent.click(screen.getByLabelText("Crop 영역 이미지 첨부"));
    fireEvent.click(screen.getByLabelText("현재 설정값 첨부"));
    await goToReview();
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.attachments).toEqual([
      expect.objectContaining({ name: "rune-minimap-raw.png" }),
      expect.objectContaining({ name: "rune-minimap-mask.png" }),
      expect.objectContaining({ name: "rune-alert-trigger-01.png" }),
      expect.objectContaining({ name: "rune-alert-trigger-02.png" }),
      expect.objectContaining({ name: "rune-alert-trigger-03.png" }),
      expect.objectContaining({ name: "rune-alert-trigger-04.png" }),
    ]);
    expect(body.diagnostics.settings.runeRuntime.latestAlertTrigger).toMatchObject({
      schemaVersion: "rune-alert-trigger-v1",
      cycleId: "rune-cycle-1",
      decision: "initial",
      detectorVersion: "rune-cascade-v9",
      frameCount: 4,
      retainedFrameCount: 4,
    });
    expect(
      body.diagnostics.settings.runeRuntime.latestAlertTrigger.frames,
    ).toHaveLength(4);
    expect(
      body.diagnostics.settings.runeRuntime.latestAlertTrigger.frames[0],
    ).not.toHaveProperty("rawDataUrl");
  });

  it("includes hunt stall crop images and state diagnostics when selected", async () => {
    const { fetchMock } = renderFeedbackModal({
      huntStallState: {
        status: "detecting",
        lastChangedAt: null,
        lastSampledAt: 10,
        lastReadableAt: null,
        lastReadFailureAt: 10,
        unreadableSinceAt: 10,
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        lastAlertedAt: null,
        stableSampleCount: 1,
        unchangedSeconds: 0,
        fingerprint: "1010",
        recognizedText: null,
        alertedRecognizedText: null,
        pendingRecognizedText: null,
        pendingRecognizedCount: 0,
        lastRejectedRecognizedText: "12?34",
        lastReadFailureReason: "ocr-empty",
        lastDecision: "ocr-empty",
        hasObservedExperienceChange: false,
        hasObservedCooldownPresence: false,
        cooldownLastDetectedAt: null,
        cooldownMissingSinceAt: null,
        cooldownMissingSeconds: 0,
        cooldownConsecutiveReadableCount: 0,
        confidence: 0.32,
        changeScore: 0.04,
      },
      huntStallSnapshot: {
        sampledAt: 11,
        rawPreviewUrl: "data:image/png;base64,huntRaw",
        processedPreviewUrl: "data:image/png;base64,huntProcessed",
        regionLabel: "220x14",
        recognizedText: null,
        debugText: "12?34",
        confidence: 0.32,
        foregroundRatio: 0.03,
        changeScore: 0.04,
      },
    });

    await fillMessageAndGoToDiagnostics("사냥 멈춤 경험치 인식이 불안정합니다.");
    fireEvent.click(screen.getByLabelText("Crop 영역 이미지 첨부"));
    fireEvent.click(screen.getByLabelText("현재 설정값 첨부"));
    await goToReview();
    fireEvent.click(screen.getByRole("button", { name: "선택한 내용 보내기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.attachments).toEqual([
      expect.objectContaining({ name: "hunt-stall-exp-raw.png" }),
      expect.objectContaining({ name: "hunt-stall-exp-processed.png" }),
    ]);
    expect(body.diagnostics.settings.huntStallRuntime).toMatchObject({
      status: "detecting",
      lastDecision: "ocr-empty",
      lastReadFailureReason: "ocr-empty",
      snapshotDebugText: "12?34",
      regionLabel: "220x14",
    });
  });
});
