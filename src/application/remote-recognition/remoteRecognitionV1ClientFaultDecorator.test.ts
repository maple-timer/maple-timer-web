import { describe, expect, it, vi } from "vitest";
import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import {
  createRemoteRecognitionControlMarker,
  RemoteRecognitionControlContractError,
  type RemoteRecognitionParserFramePayload,
  type RemoteRecognitionParserFrameResponse,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RemoteRecognitionControlRequestOptions } from "./remoteRecognitionControlPort";
import {
  createRemoteRecognitionV1ClientFaultDecorator,
  REMOTE_RECOGNITION_V1_PARSER_FRAME_FAILURE_QUERY,
  type RemoteRecognitionV1ClientFaultDecoratorOptions,
  type RemoteRecognitionV1ParserFramePort,
} from "./remoteRecognitionV1ClientFaultDecorator";

const REVIEWED_COMMIT = "a".repeat(40);
const REVIEWED_BRANCH = "codex/remote-recognition-v1-owner-gate";

describe("createRemoteRecognitionV1ClientFaultDecorator", () => {
  it.each([1, 2, 3] as const)(
    "injects exactly %i fresh typed failures, then permanently delegates",
    async (failureCount) => {
      const response = parserFrameResponse();
      const delegatedPromise = Promise.resolve(response);
      const analyzeSessionParserFrame = vi.fn(() => delegatedPromise);
      const port = { analyzeSessionParserFrame };
      const decorator = createRemoteRecognitionV1ClientFaultDecorator(
        validOptions({
          port,
          search: failureSearch(String(failureCount)),
        }),
      );
      expect(decorator).not.toBeNull();
      expect(Object.keys(decorator!)).toEqual(["analyzeSessionParserFrame"]);
      expect(Object.isFrozen(decorator)).toBe(true);
      expect("heartbeatSession" in decorator!).toBe(false);
      expect("stopSession" in decorator!).toBe(false);

      const frame = parserFramePayload();
      const abortController = new AbortController();
      const options: RemoteRecognitionControlRequestOptions = {
        signal: abortController.signal,
      };
      const injectedFailures = Array.from({ length: failureCount }, () =>
        decorator!
          .analyzeSessionParserFrame(
            "session-reference",
            "token-reference",
            frame,
            options,
          )
          .catch((error: unknown) => error),
      );
      const delegated = decorator!.analyzeSessionParserFrame(
        "session-reference",
        "token-reference",
        frame,
        options,
      );

      expect(analyzeSessionParserFrame).toHaveBeenCalledOnce();
      expect(analyzeSessionParserFrame).toHaveBeenCalledWith(
        "session-reference",
        "token-reference",
        frame,
        options,
      );
      expect(delegated).toBe(delegatedPromise);
      await expect(delegated).resolves.toBe(response);

      const failures = await Promise.all(injectedFailures);
      expect(new Set(failures).size).toBe(failureCount);
      for (const failure of failures) {
        expect(failure).toBeInstanceOf(RemoteRecognitionControlContractError);
        expect(failure).toMatchObject({
          name: "RemoteRecognitionControlContractError",
          code: "network-error",
          phase: "transport",
          retryable: true,
          retryAfterMs: null,
          message: "remote-recognition-v1-parser-frame-failure-injected",
        });
      }

      const delegatedAgain = decorator!.analyzeSessionParserFrame(
        "session-reference",
        "token-reference",
        frame,
        options,
      );
      expect(delegatedAgain).toBe(delegatedPromise);
      expect(analyzeSessionParserFrame).toHaveBeenCalledTimes(2);
    },
  );

  it("discards the remaining budget instead of carrying it into another session", async () => {
    const response = parserFrameResponse();
    const delegatedPromise = Promise.resolve(response);
    const frame = parserFramePayload();
    const options: RemoteRecognitionControlRequestOptions = {
      signal: new AbortController().signal,
    };
    const analyzeSessionParserFrame = vi.fn(() => delegatedPromise);
    const decorator = createRemoteRecognitionV1ClientFaultDecorator(
      validOptions({
        port: { analyzeSessionParserFrame },
        search: failureSearch("3"),
      }),
    );
    expect(decorator).not.toBeNull();

    await expect(
      decorator!.analyzeSessionParserFrame(
        "first-session",
        "first-token",
        frame,
        options,
      ),
    ).rejects.toMatchObject({ code: "network-error", phase: "transport" });

    const differentSession = decorator!.analyzeSessionParserFrame(
      "second-session",
      "second-token",
      frame,
      options,
    );
    expect(differentSession).toBe(delegatedPromise);
    expect(analyzeSessionParserFrame).toHaveBeenLastCalledWith(
      "second-session",
      "second-token",
      frame,
      options,
    );

    const originalSessionAgain = decorator!.analyzeSessionParserFrame(
      "first-session",
      "first-token",
      frame,
      options,
    );
    expect(originalSessionAgain).toBe(delegatedPromise);
    expect(analyzeSessionParserFrame).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["absent", ""],
    ["zero", failureSearch("0")],
    ["four", failureSearch("4")],
    ["fraction", failureSearch("1.5")],
    ["leading whitespace", failureSearch(" 1")],
    ["trailing whitespace", failureSearch("1 ")],
    ["leading zero", failureSearch("01")],
    ["duplicate equal values", duplicateFailureSearch("1", "1")],
    ["duplicate distinct values", duplicateFailureSearch("1", "2")],
  ])("does not arm for a %s failure count", (_name, search) => {
    const port = createPort();

    expect(
      createRemoteRecognitionV1ClientFaultDecorator(
        validOptions({ port, search }),
      ),
    ).toBeNull();
    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "compile-time arm disabled",
      change: { compileTimeArm: false },
    },
    {
      name: "deployed build attestation disabled",
      change: {
        buildInfo: buildInfo({ remoteRecognitionV1TestArm: false }),
      },
    },
    {
      name: "local build",
      change: { buildInfo: buildInfo({ channel: "local" }) },
    },
    {
      name: "production build with every other gate true",
      change: { buildInfo: buildInfo({ channel: "production" }) },
    },
    {
      name: "different app name",
      change: { buildInfo: buildInfo({ name: "maple-timer-admin" }) },
    },
    {
      name: "short app commit",
      change: {
        buildInfo: buildInfo({ commitSha: REVIEWED_COMMIT.slice(0, 39) }),
      },
    },
    {
      name: "uppercase app commit",
      change: {
        buildInfo: buildInfo({ commitSha: REVIEWED_COMMIT.toUpperCase() }),
      },
    },
    {
      name: "different reviewed commit",
      change: { reviewedCommit: "b".repeat(40) },
    },
    {
      name: "malformed reviewed commit",
      change: { reviewedCommit: REVIEWED_COMMIT.slice(0, 39) },
    },
    {
      name: "mismatched short commit",
      change: { buildInfo: buildInfo({ shortCommit: "bbbbbbb" }) },
    },
    {
      name: "different reviewed branch",
      change: { reviewedBranch: "codex/another-reviewed-branch" },
    },
    {
      name: "invalid reviewed branch even when it matches the app",
      change: {
        buildInfo: buildInfo({ branch: "codex//invalid-branch" }),
        reviewedBranch: "codex//invalid-branch",
      },
    },
    {
      name: "unsupported reviewed branch character even when it matches the app",
      change: {
        buildInfo: buildInfo({ branch: "codex/remote+v1" }),
        reviewedBranch: "codex/remote+v1",
      },
    },
    {
      name: "lab unavailable",
      change: { labAvailable: false },
    },
  ] satisfies Array<{
    name: string;
    change: Partial<RemoteRecognitionV1ClientFaultDecoratorOptions>;
  }>)("does not arm when $name", ({ change }) => {
    const port = createPort();

    expect(
      createRemoteRecognitionV1ClientFaultDecorator(
        validOptions({ ...change, port }),
      ),
    ).toBeNull();
    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();
  });
});

function validOptions(
  overrides: Partial<RemoteRecognitionV1ClientFaultDecoratorOptions> = {},
): RemoteRecognitionV1ClientFaultDecoratorOptions {
  return {
    port: createPort(),
    compileTimeArm: true,
    buildInfo: buildInfo(),
    reviewedCommit: REVIEWED_COMMIT,
    reviewedBranch: REVIEWED_BRANCH,
    labAvailable: true,
    search: failureSearch("1"),
    ...overrides,
  };
}

function buildInfo(overrides: Partial<AppBuildInfo> = {}): AppBuildInfo {
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
    ...overrides,
  };
}

function failureSearch(value: string): string {
  return `?${REMOTE_RECOGNITION_V1_PARSER_FRAME_FAILURE_QUERY}=${value}`;
}

function duplicateFailureSearch(first: string, second: string): string {
  return `${failureSearch(first)}&${REMOTE_RECOGNITION_V1_PARSER_FRAME_FAILURE_QUERY}=${second}`;
}

function createPort(): RemoteRecognitionV1ParserFramePort & {
  analyzeSessionParserFrame: ReturnType<typeof vi.fn>;
} {
  return {
    analyzeSessionParserFrame: vi.fn(async () => parserFrameResponse()),
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

function parserFrameResponse(): RemoteRecognitionParserFrameResponse {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: "session-reference",
    purpose: "parser-provider",
    expiresAt: 1_785_600_016_000,
    frame: {
      sequence: 1,
      sampledAt: 1_785_600_001_000,
      encodedBytes: 3,
      width: 683,
      height: 384,
      parser: {
        engine: "onnxruntime-native",
        modelId: "buff-detector-test",
        modelInputWidth: 544,
        modelInputHeight: 960,
        onnxRuntimeVersion: "1.24.4",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 0,
      },
      boxes: [],
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 28,
        postprocessMs: 2,
        serverTotalMs: 35,
      },
    },
  };
}
