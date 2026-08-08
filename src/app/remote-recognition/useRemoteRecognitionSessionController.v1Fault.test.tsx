import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import type {
  RemoteRecognitionParserFramePayload,
  RemoteRecognitionParserFrameResponse,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RemoteRecognitionControlRequestOptions } from "../../application/remote-recognition/remoteRecognitionControlPort";
import type { RemoteRecognitionV1ClientFaultDecoratorOptions } from "../../application/remote-recognition/remoteRecognitionV1ClientFaultDecorator";
import {
  useRemoteRecognitionSessionController,
  useStableRemoteRecognitionV1ClientFaultDecorator,
} from "./useRemoteRecognitionSessionController";

const REVIEWED_COMMIT = "a".repeat(40);
const REVIEWED_BRANCH = "codex/remote-recognition-v1-owner-gate";

const compositionMocks = vi.hoisted(() => {
  const commitSha = "a".repeat(40);
  const branch = "codex/remote-recognition-v1-owner-gate";
  return {
    browserPort: {
      analyzeSessionParserFrame: vi.fn(),
    },
    buildInfo: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha,
      shortCommit: commitSha.slice(0, 7),
      branch,
      deploymentUrl: "https://preview.maple-timer.pages.dev",
      buildTime: "2026-08-05T00:00:00.000Z",
      channel: "preview" as const,
      remoteRecognitionV1TestArm: true,
    },
    controllerConstructor: vi.fn(),
  };
});

vi.mock(
  "../../platform/remote-recognition/remoteRecognitionControlClient",
  () => ({
    browserRemoteRecognitionControlClient: compositionMocks.browserPort,
  }),
);

vi.mock("../../platform/runtime-build/currentAppBuildInfo", () => ({
  appBuildInfo: compositionMocks.buildInfo,
  formatAppBuildInfo: () =>
    `preview ${compositionMocks.buildInfo.branch}@${compositionMocks.buildInfo.shortCommit}`,
}));

vi.mock(
  "../../application/remote-recognition/remoteRecognitionSessionController",
  () => {
    const snapshot = {
      phase: "idle",
      identity: null,
      serviceState: null,
      probe: null,
      probeDiagnostics: null,
      session: null,
      parserProvider: { active: false, consentVersion: null, generation: 0 },
      parserFrames: {
        successfulFrames: 0,
        failedFrames: 0,
        droppedFrames: 0,
        lastE2eMs: null,
        lastServerTotalMs: null,
        lastEncodedBytes: null,
        lastSampledAt: null,
        lastError: null,
      },
      failure: null,
    };
    return {
      RemoteRecognitionSessionController: class {
        constructor(...args: unknown[]) {
          compositionMocks.controllerConstructor(...args);
        }

        subscribe = () => () => undefined;
        getSnapshot = () => snapshot;
        start = vi.fn(async () => undefined);
        stop = vi.fn(async () => undefined);
        setParserProviderConsent = vi.fn();
        setParserProviderEnabled = vi.fn();
        failParserProvider = vi.fn(async () => undefined);
        analyzeParserFrame = vi.fn();
      },
    };
  },
);

describe("useStableRemoteRecognitionV1ClientFaultDecorator", () => {
  beforeEach(() => {
    compositionMocks.controllerConstructor.mockClear();
    compositionMocks.browserPort.analyzeSessionParserFrame.mockReset();
    compositionMocks.browserPort.analyzeSessionParserFrame.mockResolvedValue(
      {} as RemoteRecognitionParserFrameResponse,
    );
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("does not re-arm or replace the one-shot port when its owner rerenders", async () => {
    const firstResponse = {} as RemoteRecognitionParserFrameResponse;
    const secondResponse = {} as RemoteRecognitionParserFrameResponse;
    const firstDelegate = vi.fn().mockResolvedValue(firstResponse);
    const secondDelegate = vi.fn().mockResolvedValue(secondResponse);
    const { result, rerender } = renderHook(
      ({
        options,
      }: {
        options: RemoteRecognitionV1ClientFaultDecoratorOptions;
      }) => useStableRemoteRecognitionV1ClientFaultDecorator(options),
      {
        initialProps: {
          options: validOptions(firstDelegate, "1"),
        },
      },
    );
    const initialPort = result.current;
    expect(initialPort).not.toBeNull();

    const frame = parserFramePayload();
    const options: RemoteRecognitionControlRequestOptions = {
      signal: new AbortController().signal,
    };
    await expect(
      initialPort!.analyzeSessionParserFrame(
        "session-1",
        "session-token",
        frame,
        options,
      ),
    ).rejects.toMatchObject({ code: "network-error", phase: "transport" });

    rerender({ options: validOptions(secondDelegate, "3") });

    expect(result.current).toBe(initialPort);
    await expect(
      result.current!.analyzeSessionParserFrame(
        "session-1",
        "session-token",
        frame,
        options,
      ),
    ).resolves.toBe(firstResponse);
    expect(firstDelegate).toHaveBeenCalledWith(
      "session-1",
      "session-token",
      frame,
      options,
    );
    expect(secondDelegate).not.toHaveBeenCalled();
  });

  it("does not arm later in the same mount when the initial gate is closed", () => {
    const delegate = vi
      .fn()
      .mockResolvedValue({} as RemoteRecognitionParserFrameResponse);
    const { result, rerender } = renderHook(
      ({
        options,
      }: {
        options: RemoteRecognitionV1ClientFaultDecoratorOptions;
      }) => useStableRemoteRecognitionV1ClientFaultDecorator(options),
      {
        initialProps: {
          options: { ...validOptions(delegate, "1"), compileTimeArm: false },
        },
      },
    );

    expect(result.current).toBeNull();
    rerender({ options: validOptions(delegate, "3") });
    expect(result.current).toBeNull();
  });

  it("reads the compile globals and current URL into the real hook's sixth parser-frame dependency", async () => {
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_TEST_ARM__", true);
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__", REVIEWED_COMMIT);
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__", REVIEWED_BRANCH);
    window.history.replaceState(
      {},
      "",
      `/?remote-recognition-lab=1&remote-recognition-v1-parser-frame-failures=2`,
    );

    const { result } = renderHook(() =>
      useRemoteRecognitionSessionController({
        gameViewport: null,
        stream: null,
      }),
    );

    expect(result.current.isAvailable).toBe(true);
    expect(compositionMocks.controllerConstructor).toHaveBeenCalledOnce();
    const constructorArgs =
      compositionMocks.controllerConstructor.mock.calls[0];
    expect(constructorArgs?.[0]).toBe(compositionMocks.browserPort);
    expect(constructorArgs?.[3]).toBeUndefined();
    expect(constructorArgs?.[4]).toBeUndefined();
    const parserFramePort = constructorArgs?.[5] as
      RemoteRecognitionV1ClientFaultDecoratorOptions["port"] | undefined;
    expect(parserFramePort).toBeDefined();
    expect(parserFramePort).not.toBe(compositionMocks.browserPort);
    expect(Object.keys(parserFramePort!)).toEqual([
      "analyzeSessionParserFrame",
    ]);

    const frame = parserFramePayload();
    const options: RemoteRecognitionControlRequestOptions = {
      signal: new AbortController().signal,
    };
    for (let count = 0; count < 2; count += 1) {
      await expect(
        parserFramePort!.analyzeSessionParserFrame(
          "session-1",
          "session-token",
          frame,
          options,
        ),
      ).rejects.toMatchObject({
        code: "network-error",
        phase: "transport",
      });
    }
    await expect(
      parserFramePort!.analyzeSessionParserFrame(
        "session-1",
        "session-token",
        frame,
        options,
      ),
    ).resolves.toBeDefined();
    expect(
      compositionMocks.browserPort.analyzeSessionParserFrame,
    ).toHaveBeenCalledWith("session-1", "session-token", frame, options);
  });

  it("passes no sixth parser-frame dependency when the real hook is unarmed", () => {
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_TEST_ARM__", false);
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__", REVIEWED_COMMIT);
    vi.stubGlobal("__REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__", REVIEWED_BRANCH);
    window.history.replaceState(
      {},
      "",
      `/?remote-recognition-lab=1&remote-recognition-v1-parser-frame-failures=3`,
    );

    renderHook(() =>
      useRemoteRecognitionSessionController({
        gameViewport: null,
        stream: null,
      }),
    );

    expect(compositionMocks.controllerConstructor).toHaveBeenCalledOnce();
    const constructorArgs =
      compositionMocks.controllerConstructor.mock.calls[0];
    expect(constructorArgs?.[0]).toBe(compositionMocks.browserPort);
    expect(constructorArgs?.[5]).toBeUndefined();
  });
});

function validOptions(
  analyzeSessionParserFrame: RemoteRecognitionV1ClientFaultDecoratorOptions["port"]["analyzeSessionParserFrame"],
  failureCount: "1" | "2" | "3",
): RemoteRecognitionV1ClientFaultDecoratorOptions {
  return {
    port: { analyzeSessionParserFrame },
    compileTimeArm: true,
    buildInfo: buildInfo(),
    reviewedCommit: REVIEWED_COMMIT,
    reviewedBranch: REVIEWED_BRANCH,
    labAvailable: true,
    search: `?remote-recognition-v1-parser-frame-failures=${failureCount}`,
  };
}

function buildInfo(): AppBuildInfo {
  return {
    name: "maple-timer",
    version: "0.1.0",
    commitSha: REVIEWED_COMMIT,
    shortCommit: REVIEWED_COMMIT.slice(0, 7),
    branch: REVIEWED_BRANCH,
    deploymentUrl: "https://preview.maple-timer.pages.dev",
    buildTime: "2026-08-05T00:00:00.000Z",
    channel: "preview",
    remoteRecognitionV1TestArm: true,
  };
}

function parserFramePayload(): RemoteRecognitionParserFramePayload {
  return {
    sequence: 1,
    sampledAt: 1_785_600_001_000,
    width: 683,
    height: 384,
    encodedVp8: new Uint8Array([1, 2, 3]).buffer,
  };
}
