import type { RemoteRecognitionParserFrameProvider } from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { SemanticLabResourceScope } from "./browserResourceLedger";

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_DIMENSION = 8_192;
const MAX_PIXELS = 33_554_432;

export type SemanticLabFakeRemoteParserProvider = Readonly<{
  analyze: RemoteRecognitionParserFrameProvider;
  snapshot(): Readonly<{
    disposed: boolean;
    requestCount: number;
    pendingRequestCount: number;
    lastSampledAt: number | null;
  }>;
  dispose(): Promise<void>;
}>;

export function createSemanticLabFakeRemoteParserProvider(
  resources: SemanticLabResourceScope,
): SemanticLabFakeRemoteParserProvider {
  let disposed = false;
  let requestCount = 0;
  let pendingRequestCount = 0;
  let lastSampledAt: number | null = null;
  const drains = new Set<Promise<void>>();

  const analyze: RemoteRecognitionParserFrameProvider = async (request) => {
    if (disposed) throw new Error("semantic-lab-fake-provider-disposed");
    validateRequest(request);
    if (lastSampledAt !== null && request.sampledAt <= lastSampledAt) {
      throw new Error("semantic-lab-fake-provider-clock-order");
    }
    const release = resources.register("providerRequest");
    requestCount += 1;
    pendingRequestCount += 1;
    lastSampledAt = request.sampledAt;
    let resolveDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      resolveDrain = resolve;
    });
    drains.add(drain);
    try {
      await Promise.resolve();
      if (disposed) throw new Error("semantic-lab-fake-provider-disposed");
      const sequence = requestCount;
      const size = Math.max(1, Math.min(32, request.width, request.height));
      return {
        e2eMs: 1,
        response: {
          contract: {
            schema: "maple-timer.remote-recognition-control",
            version: 1,
          },
          status: "ok",
          sessionId: "semantic-lab-fake-session",
          purpose: "parser-provider",
          expiresAt: Date.now() + 15_000,
          frame: {
            sequence,
            sampledAt: request.sampledAt,
            encodedBytes: request.encodedVp8.byteLength,
            width: request.width,
            height: request.height,
            parser: {
              engine: "onnxruntime-native",
              modelId: "semantic-lab-fake-parser-v1",
              modelInputWidth: 544,
              modelInputHeight: 960,
              onnxRuntimeVersion: "semantic-lab-fake",
              executionProviders: ["semantic-lab-fake-provider"],
              boxCount: 1,
            },
            boxes: [
              {
                x: Math.max(0, request.width - size),
                y: 0,
                size,
                confidence: 0.99,
                score: 990,
              },
            ],
            timings: {
              decodeMs: 0,
              preprocessMs: 0,
              inferenceMs: 0,
              postprocessMs: 0,
              serverTotalMs: 0,
            },
          },
        },
      };
    } finally {
      pendingRequestCount -= 1;
      release();
      resolveDrain();
      drains.delete(drain);
    }
  };

  return Object.freeze({
    analyze,
    snapshot: () =>
      Object.freeze({
        disposed,
        requestCount,
        pendingRequestCount,
        lastSampledAt,
      }),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await Promise.all([...drains]);
      if (pendingRequestCount !== 0 || drains.size !== 0) {
        throw new Error("semantic-lab-fake-provider-cleanup");
      }
    },
  });
}

function validateRequest(
  request: Parameters<RemoteRecognitionParserFrameProvider>[0],
) {
  if (
    !Number.isSafeInteger(request.sampledAt) ||
    request.sampledAt < 0 ||
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > MAX_DIMENSION ||
    request.height > MAX_DIMENSION ||
    request.width * request.height > MAX_PIXELS ||
    !(request.encodedVp8 instanceof ArrayBuffer) ||
    request.encodedVp8.byteLength < 10 ||
    request.encodedVp8.byteLength > MAX_PAYLOAD_BYTES ||
    !Number.isFinite(request.encodeMs) ||
    request.encodeMs < 0
  ) {
    throw new Error("semantic-lab-fake-provider-request");
  }
  const bytes = new Uint8Array(request.encodedVp8);
  if (
    (bytes[0] & 0x01) !== 0 ||
    bytes[3] !== 0x9d ||
    bytes[4] !== 0x01 ||
    bytes[5] !== 0x2a
  ) {
    throw new Error("semantic-lab-fake-provider-vp8-keyframe");
  }
}
