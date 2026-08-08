import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRecognitionSessionSnapshot } from "../../application/remote-recognition/remoteRecognitionSessionController";
import {
  createInitialParserFrameDiagnostics,
  createInitialParserProviderSnapshot,
} from "../../application/remote-recognition/remoteRecognitionSessionController";
import { PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW } from "../../contracts/recognition/precisionParserInputTransport";
import { RemoteRecognitionControl } from "./RemoteRecognitionControl";

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

describe("RemoteRecognitionControl", () => {
  afterEach(cleanup);

  it("opens setup instead of enabling remote processing immediately", () => {
    const onOpenSetup = vi.fn();
    const onStop = vi.fn();
    render(
      <RemoteRecognitionControl
        readiness="ready"
        snapshot={IDLE_SNAPSHOT}
        onOpenSetup={onOpenSetup}
        onStop={onStop}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "원격 처리 연결" }),
    );

    expect(onOpenSetup).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByText("연결 안 됨")).toBeInTheDocument();
  });

  it("releases a ready session when switched off", () => {
    const onOpenSetup = vi.fn();
    const onStop = vi.fn();
    render(
      <RemoteRecognitionControl
        readiness="ready"
        snapshot={{
          ...IDLE_SNAPSHOT,
          phase: "ready",
          serviceState: "available",
          session: {
            expiresAt: Date.now() + 15_000,
            heartbeatIntervalMs: 5_000,
            modelSetId: "studio-foundation-v1",
            frameAnalysisEnabled: false,
          },
        }}
        onOpenSetup={onOpenSetup}
        onStop={onStop}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "원격 처리 연결" }),
    );

    expect(onStop).toHaveBeenCalledOnce();
    expect(onOpenSetup).not.toHaveBeenCalled();
    expect(
      screen.getByText("실제 화면 분석을 확인했습니다. 현재 알림은 아직 이 기기에서 처리합니다."),
    ).toBeInTheDocument();
  });

  it("reopens settings without releasing a ready session", () => {
    const onOpenSetup = vi.fn();
    const onStop = vi.fn();
    render(
      <RemoteRecognitionControl
        readiness="ready"
        snapshot={{
          ...IDLE_SNAPSHOT,
          phase: "ready",
          serviceState: "available",
          session: {
            expiresAt: Date.now() + 15_000,
            heartbeatIntervalMs: 5_000,
            modelSetId: "studio-foundation-v1",
            frameAnalysisEnabled: true,
          },
        }}
        onOpenSetup={onOpenSetup}
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "설정" }));

    expect(onOpenSetup).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps setup disabled until screen sharing is ready", () => {
    render(
      <RemoteRecognitionControl
        readiness="screen-share-required"
        snapshot={IDLE_SNAPSHOT}
        onOpenSetup={() => undefined}
        onStop={() => undefined}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "원격 처리 연결" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("화면 공유 필요")).toBeInTheDocument();
  });

  it("shows when actual alerts are using the VP8 parser input", () => {
    render(
      <RemoteRecognitionControl
        readiness="ready"
        snapshot={{
          ...IDLE_SNAPSHOT,
          phase: "ready",
          serviceState: "available",
          session: {
            expiresAt: Date.now() + 15_000,
            heartbeatIntervalMs: 5_000,
            modelSetId: "studio-foundation-v1",
            frameAnalysisEnabled: false,
          },
          parserFrames: {
            ...createInitialParserFrameDiagnostics(),
            successfulFrames: 3,
            lastE2eMs: 442.4,
          },
          parserProvider: {
            active: true,
            consentVersion:
              "remote-recognition-parser-provider-preview-2026-08-02",
            generation: 1,
          },
        }}
        parserInputTransport={PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW}
        onOpenSetup={() => undefined}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("원격 처리 중")).toBeInTheDocument();
    expect(
      screen.getByText(
        "정밀 기능의 parser는 원격 서버에서, 이후 판독과 알림은 이 기기에서 처리합니다.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("최근 전송 E2E 442ms")).toBeInTheDocument();
  });

  it("shows the tester and connection codes while ready", () => {
    render(
      <RemoteRecognitionControl
        readiness="ready"
        snapshot={{
          ...IDLE_SNAPSHOT,
          phase: "ready",
          serviceState: "available",
          identity: { betaAlias: "BETA-WRV95", connectionCode: "7Z72-DRC7" },
          session: {
            expiresAt: Date.now() + 15_000,
            heartbeatIntervalMs: 5_000,
            modelSetId: "studio-foundation-v1",
            frameAnalysisEnabled: false,
          },
        }}
        onOpenSetup={() => undefined}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("BETA-WRV95 · 7Z72-DRC7")).toBeInTheDocument();
  });
});
