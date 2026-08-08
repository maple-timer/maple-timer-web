import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRecognitionSessionSnapshot } from "../../application/remote-recognition/remoteRecognitionSessionController";
import {
  createInitialParserFrameDiagnostics,
  createInitialParserProviderSnapshot,
} from "../../application/remote-recognition/remoteRecognitionSessionController";
import { RemoteRecognitionSetupDialog } from "./RemoteRecognitionSetupDialog";
import {
  createPrecisionParserInputTransportDiagnostics,
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
  type PrecisionParserInputTransportDiagnostics,
} from "../../contracts/recognition/precisionParserInputTransport";
import { REMOTE_RECOGNITION_READINESS_CONSENT_VERSION } from "../../contracts/remote-recognition/remoteRecognitionControlContract";

const IDLE_SNAPSHOT: RemoteRecognitionSessionSnapshot = {
  phase: "idle",
  identity: null,
  serviceState: null,
  probe: null,
  probeDiagnostics: null,
  session: null,
  parserProvider: createInitialParserProviderSnapshot(),
  parserFrames: createInitialParserFrameDiagnostics(),
  failure: null,
};

describe("RemoteRecognitionSetupDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    Reflect.deleteProperty(navigator, "clipboard");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("requires an access code and both consents before setup", async () => {
    const onStart = vi.fn(async () => undefined);
    renderDialog({ snapshot: IDLE_SNAPSHOT, onStart });

    fireEvent.click(screen.getByRole("button", { name: "연결 확인 시작" }));

    expect(await screen.findByText("초대 코드를 입력해주세요.")).toBeInTheDocument();
    expect(screen.getAllByText("안내를 확인해주세요.")).toHaveLength(2);
    expect(screen.queryByLabelText(/베타 별칭/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/초대 코드는 저장하지 않고.*임의 식별자만 이 브라우저에 저장/),
    ).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/초대 코드/), {
      target: { value: "  preview-code  " },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /준비 확인을 위한 화면 전송에 동의합니다/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "연결 확인 시작" }));
    // The ongoing-use consent lives in the controller snapshot; without it
    // the start stays blocked.
    expect(onStart).not.toHaveBeenCalled();

    cleanup();
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        parserProvider: {
          ...IDLE_SNAPSHOT.parserProvider,
          consentVersion:
            "remote-recognition-parser-provider-preview-2026-08-02",
        },
      },
      onStart,
    });
    fireEvent.change(screen.getByLabelText(/초대 코드/), {
      target: { value: "  preview-code  " },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /준비 확인을 위한 화면 전송에 동의합니다/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "연결 확인 시작" }));

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith(
        "preview-code",
        REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
      ),
    );
  });

  it("shows the current identity and copies its values independently", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDialog({ snapshot: createReadySnapshot() });

    expect(screen.getByText("현재 연결 정보")).toBeInTheDocument();
    expect(screen.getByText("BETA-23AHK")).toBeInTheDocument();
    expect(screen.getByText("7HJK-9MNP")).toBeInTheDocument();
    expect(
      screen.getByText(/문의하거나 로그를 확인할 때 아래 두 값을 알려주세요/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "테스터 코드 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("BETA-23AHK"));
    expect(
      screen.getByRole("button", { name: "테스터 코드 복사됨" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "연결 코드 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("7HJK-9MNP"));
  });

  it("keeps a stopped or failed identity visible as recent information", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "failed",
        identity: {
          betaAlias: "BETA-23AHK",
          connectionCode: "7HJK-9MNP",
        },
        failure: {
          code: "network-error",
          phase: "session",
          retryable: true,
          retryAfterMs: null,
          technicalMessage: "network-failed",
        },
      },
    });

    expect(screen.getByText("최근 연결 정보")).toBeInTheDocument();
    expect(screen.getByText("BETA-23AHK")).toBeInTheDocument();
    expect(screen.getByText("7HJK-9MNP")).toBeInTheDocument();
  });

  it("shows a copy failure without hiding the connection identity", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    renderDialog({ snapshot: createReadySnapshot() });

    fireEvent.click(screen.getByRole("button", { name: "연결 코드 복사" }));

    expect(
      await screen.findByRole("button", { name: "연결 코드 복사 실패" }),
    ).toBeInTheDocument();
    expect(screen.getByText("7HJK-9MNP")).toBeInTheDocument();
  });

  it("keeps readiness and ongoing provider consent separate after setup succeeds", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "ready",
        serviceState: "available",
        probe: {
          completedRounds: 5,
          successfulRounds: 5,
          medianMs: 12,
          maxMs: 18,
          totalElapsedMs: 5_050,
        },
        probeDiagnostics: {
          completedRounds: 5,
          parserModelId: "buff-detector-test",
          executionProviders: ["CoreMLExecutionProvider"],
          averageCaptureMs: 3.2,
          averageCompressionMs: 7.8,
          averageRoundTripMs: 105.4,
          averageEncodedBytes: 128_000,
          averageDecodeMs: 1.2,
          averagePreprocessMs: 31.3,
          averageInferenceMs: 48.6,
          averagePostprocessMs: 4.1,
          averageServerTotalMs: 85.2,
        },
        session: {
          expiresAt: Date.now() + 15_000,
          heartbeatIntervalMs: 5_000,
          modelSetId: "studio-foundation-v1",
          frameAnalysisEnabled: false,
        },
      },
    });

    expect(screen.getByText("서버 연결 확인이 끝났습니다")).toBeInTheDocument();
    expect(
      screen.getByText(/실제 화면 5회의 파서 분석을 통과했습니다/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 해제" })).toBeInTheDocument();
    expect(screen.getByText("연결 확인 6단계")).toBeInTheDocument();
    expect(screen.getByText("probe")).toBeInTheDocument();
    expect(
      screen.getByText("우상단 버프 영역을 1초 간격으로 다섯 번 분석합니다."),
    ).toBeInTheDocument();
    // 105ms appears as the probe row duration and again in the timing grid.
    expect(screen.getAllByText("105ms")).toHaveLength(2);
    // The probe timings render inline under the checklist without a click.
    expect(screen.getByText("실제 화면 분석 시간")).toBeInTheDocument();
    expect(screen.getByText("왕복 평균")).toBeInTheDocument();
    expect(screen.getByText("서버 전체")).toBeInTheDocument();
    expect(screen.getByText("85ms")).toBeInTheDocument();
    expect(
      screen.queryByText(/1초 측정 간격은 포함하지 않습니다/),
    ).not.toBeInTheDocument();
    // Consent and the provider switch now live on the input page only.
    expect(
      screen.queryByRole("checkbox", { name: /실사용 원격 처리에 동의합니다/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "실사용 원격 처리" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("30초 안정성 측정")).not.toBeInTheDocument();
  });

  it("shows capacity failures in user-facing language", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "failed",
        serviceState: "full",
        failure: {
          code: "capacity-full",
          phase: "admission",
          retryable: true,
          retryAfterMs: 5_000,
          technicalMessage: "remote-recognition-capacity-full",
        },
      },
    });

    expect(
      screen.getByText("현재 사용할 수 있는 자리가 없습니다"),
    ).toBeInTheDocument();
    expect(screen.queryByText("remote-recognition-capacity-full")).not.toBeInTheDocument();
    expect(screen.getByText("연결 확인 6단계")).toBeInTheDocument();
    expect(
      screen.getByTitle("현재 사용할 수 있는 자리가 없습니다"),
    ).toBeInTheDocument();
  });

  it("explains when the tester code is active in another browser", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "failed",
        failure: {
          code: "access-code-in-use",
          phase: "admission",
          retryable: true,
          retryAfterMs: 15_000,
          technicalMessage: "remote-recognition-access-code-in-use",
        },
      },
    });

    expect(
      screen.getByText("이 초대 코드는 다른 브라우저에서 사용 중입니다"),
    ).toBeInTheDocument();
    expect(screen.getByText(/기존 브라우저에서 연결을 해제/)).toBeInTheDocument();
    // A code-shaped failure returns to the input view so the user can act.
    expect(screen.getByLabelText(/초대 코드/)).toBeInTheDocument();
    expect(screen.queryByText("연결 확인 6단계")).not.toBeInTheDocument();
  });

  it("asks the same client to retry when its previous attempt is still busy", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "failed",
        failure: {
          code: "client-reconnect-busy",
          phase: "admission",
          retryable: true,
          retryAfterMs: 1_000,
          technicalMessage: "remote-recognition-client-reconnect-busy",
        },
      },
    });

    expect(screen.getByText("기존 연결에서 처리 중입니다")).toBeInTheDocument();
    expect(screen.getByText("잠시 후 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText(/초대 코드/)).toBeInTheDocument();
    expect(screen.queryByText("연결 확인 6단계")).not.toBeInTheDocument();
  });

  it("maps a session invalid response to the session step", () => {
    renderDialog({
      snapshot: {
        ...IDLE_SNAPSHOT,
        phase: "failed",
        failure: {
          code: "invalid-response",
          phase: "session",
          retryable: false,
          retryAfterMs: null,
          technicalMessage: "remote-recognition-session-beta-alias-mismatch",
        },
      },
    });

    expect(screen.getByText("연결 확인 6단계")).toBeInTheDocument();
    expect(screen.getByText("session")).toBeInTheDocument();
    expect(screen.getByText("network")).toBeInTheDocument();
    expect(
      screen.getByTitle("원격 처리 연결을 준비하지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "코드 다시 입력" }),
    ).toBeInTheDocument();
  });

  it("collects the ongoing consent on the input page", () => {
    const onParserProviderConsentChange = vi.fn();
    renderDialog({
      snapshot: IDLE_SNAPSHOT,
      onParserProviderConsentChange,
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /실사용 원격 처리에 동의합니다/,
      }),
    );

    expect(onParserProviderConsentChange.mock.calls[0]?.[0]).toBe(true);
  });

  it("makes the live VP8 parser experiment explicit and reversible", () => {
    const onVp8ParserPreviewChange = vi.fn();
    renderDialog({
      snapshot: {
        ...createReadySnapshot(),
        parserProvider: {
          active: true,
          consentVersion:
            "remote-recognition-parser-provider-preview-2026-08-02",
          generation: 1,
        },
      },
      parserInputTransport: PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
      parserInputTransportDiagnostics: {
        ...createPrecisionParserInputTransportDiagnostics(
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
        ),
        successfulSamples: 8,
        averageEncodedBytes: 54_000,
        averageEncodeMs: 12.4,
        averageDecodeMs: 3.1,
      },
      onVp8ParserPreviewChange,
    });

    expect(
      screen.getByText(/실사용 원격 처리가 켜져 있습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("원격 parser 결과가 실제 알림에 사용됩니다"),
    ).toBeInTheDocument();
    expect(screen.getByText("8회")).toBeInTheDocument();
    expect(screen.getByText("52.7KB")).toBeInTheDocument();
    // Turning remote processing off while connected is 연결 해제, not a
    // progress-page switch.
    expect(
      screen.queryByRole("switch", { name: "실사용 원격 처리" }),
    ).not.toBeInTheDocument();
    expect(onVp8ParserPreviewChange).not.toHaveBeenCalled();
  });

  it("applies the recorded intent once when the session becomes ready", async () => {
    const onVp8ParserPreviewChange = vi.fn();
    const consentedIdle: RemoteRecognitionSessionSnapshot = {
      ...IDLE_SNAPSHOT,
      parserProvider: {
        ...IDLE_SNAPSHOT.parserProvider,
        consentVersion: "remote-recognition-parser-provider-preview-2026-08-02",
      },
    };
    const props = {
      isOpen: true,
      readiness: "ready" as const,
      parserInputTransport: DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
      parserInputTransportDiagnostics:
        createPrecisionParserInputTransportDiagnostics(
          DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
        ),
      onStart: vi.fn(async () => undefined),
      onStop: async () => undefined,
      onParserProviderConsentChange: vi.fn(),
      onVp8ParserPreviewChange,
      onClose: () => undefined,
    };
    const { rerender } = render(
      <RemoteRecognitionSetupDialog {...props} snapshot={consentedIdle} />,
    );
    expect(onVp8ParserPreviewChange).not.toHaveBeenCalled();

    rerender(
      <RemoteRecognitionSetupDialog
        {...props}
        snapshot={{
          ...createReadySnapshot(),
          parserProvider: consentedIdle.parserProvider,
        }}
      />,
    );

    await waitFor(() =>
      expect(onVp8ParserPreviewChange).toHaveBeenCalledWith(true),
    );
  });
});

function renderDialog({
  snapshot,
  onStart = vi.fn(async () => undefined),
  parserInputTransport = DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  parserInputTransportDiagnostics =
    createPrecisionParserInputTransportDiagnostics(parserInputTransport),
  onVp8ParserPreviewChange = vi.fn(),
  onParserProviderConsentChange = vi.fn(),
}: {
  snapshot: RemoteRecognitionSessionSnapshot;
  onStart?: (
    accessCode: string,
    readinessConsentVersion: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  ) => Promise<void>;
  parserInputTransport?: PrecisionParserInputTransport;
  parserInputTransportDiagnostics?: PrecisionParserInputTransportDiagnostics;
  onVp8ParserPreviewChange?: (enabled: boolean) => void;
  onParserProviderConsentChange?: (consented: boolean) => void;
}) {
  return render(
    <RemoteRecognitionSetupDialog
      isOpen
      readiness="ready"
      snapshot={snapshot}
      parserInputTransport={parserInputTransport}
      parserInputTransportDiagnostics={parserInputTransportDiagnostics}
      onStart={onStart}
      onStop={async () => undefined}
      onParserProviderConsentChange={onParserProviderConsentChange}
      onVp8ParserPreviewChange={onVp8ParserPreviewChange}
      onClose={() => undefined}
    />,
  );
}

function createReadySnapshot(): RemoteRecognitionSessionSnapshot {
  return {
    ...IDLE_SNAPSHOT,
    phase: "ready",
    identity: {
      betaAlias: "BETA-23AHK",
      connectionCode: "7HJK-9MNP",
    },
    serviceState: "available",
    probe: {
      completedRounds: 5,
      successfulRounds: 5,
      medianMs: 12,
      maxMs: 18,
      totalElapsedMs: 5_050,
    },
    session: {
      expiresAt: Date.now() + 15_000,
      heartbeatIntervalMs: 5_000,
      modelSetId: "studio-foundation-v1",
      frameAnalysisEnabled: false,
    },
  };
}
