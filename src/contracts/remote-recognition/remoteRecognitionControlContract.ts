import { REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION } from "./remoteRecognitionClientTelemetry";

export const REMOTE_RECOGNITION_CONTROL_SCHEMA =
  "maple-timer.remote-recognition-control";
export const REMOTE_RECOGNITION_CONTROL_VERSION = 1;
export const REMOTE_RECOGNITION_CONTROL_PIPELINE =
  "shared-buff-slot-precision-v1";
export const REMOTE_RECOGNITION_READINESS_CONSENT_VERSION =
  "remote-recognition-preview-2026-08-02";
/** @deprecated Use the readiness-specific name. Kept for API contract compatibility. */
export const REMOTE_RECOGNITION_CONSENT_VERSION =
  REMOTE_RECOGNITION_READINESS_CONSENT_VERSION;
export const REMOTE_RECOGNITION_PARSER_FRAME_PURPOSE = "parser-provider";
export const REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION =
  "remote-recognition-parser-provider-preview-2026-08-02";
export const REMOTE_RECOGNITION_PARSER_FRAME_MIME_TYPE = "video/vp8";
export const REMOTE_RECOGNITION_PARSER_FRAME_MAX_BYTES = 256 * 1024;
export const REMOTE_RECOGNITION_BETA_ALIAS_PATTERN =
  /^BETA-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
export const REMOTE_RECOGNITION_CONNECTION_CODE_PATTERN =
  /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
export const REMOTE_RECOGNITION_CLIENT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const REMOTE_RECOGNITION_CONTROL_POLICY = {
  admissionTtlMs: 15_000,
  sessionIdleTtlMs: 15_000,
  heartbeatIntervalMs: 5_000,
  probeRounds: 5,
  probeIntervalMs: 1_000,
} as const;

export type RemoteRecognitionControlMarker = {
  schema: typeof REMOTE_RECOGNITION_CONTROL_SCHEMA;
  version: typeof REMOTE_RECOGNITION_CONTROL_VERSION;
};

export type RemoteRecognitionServiceState =
  | "available"
  | "full"
  | "maintenance"
  | "unavailable";

export type RemoteRecognitionControlFailureCode =
  | "invalid-contract"
  | "invalid-request"
  | "origin-not-allowed"
  | "not-entitled"
  | "access-code-in-use"
  | "client-reconnect-busy"
  | "rate-limited"
  | "capacity-full"
  | "service-unavailable"
  | "admission-not-found"
  | "admission-expired"
  | "session-not-found"
  | "session-expired"
  | "session-frame-idle"
  | "invalid-token"
  | "probe-failed"
  | "transport-not-enabled"
  | "request-timeout"
  | "network-error"
  | "invalid-response"
  | "internal-error";

export type RemoteRecognitionControlFailurePhase =
  | "status"
  | "entitlement"
  | "admission"
  | "probe"
  | "session"
  | "transport";

export type RemoteRecognitionControlFailureResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "error";
  error: {
    code: RemoteRecognitionControlFailureCode;
    phase: RemoteRecognitionControlFailurePhase;
    retryable: boolean;
    retryAfterMs: number | null;
    technicalMessage: string;
  };
};

export type RemoteRecognitionServiceStatusResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  serviceState: RemoteRecognitionServiceState;
  admissionAvailable: boolean;
  frameAnalysisEnabled: boolean;
  retryAfterMs: number | null;
};

export type RemoteRecognitionAdmissionRequest = {
  contract: RemoteRecognitionControlMarker;
  accessCode: string;
  client: {
    appBuild: string;
    channel: "production" | "preview" | "development";
    runtimeVersion: string;
    clientInstanceId: string;
    admissionAttemptId: string;
    betaAlias?: string;
  };
  requestedPipeline: typeof REMOTE_RECOGNITION_CONTROL_PIPELINE;
  consent: {
    version: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION;
    remoteFrameProcessing: true;
    normalFrameStorage: "none";
  };
};

export type RemoteRecognitionAdmissionResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  admissionId: string;
  admissionToken: string;
  betaAlias: string | null;
  connectionCode: string | null;
  expiresAt: number;
  probe: {
    requiredRounds: number;
    intervalMs: number;
  };
  capabilities: {
    frameAnalysisEnabled: boolean;
    entitlementLeaseVersion: 1 | null;
  };
};

export type RemoteRecognitionProbeRound = {
  round: number;
  status: "ok" | "error";
  elapsedMs: number;
};

export type RemoteRecognitionProbeSummary = {
  completedRounds: number;
  successfulRounds: number;
  medianMs: number;
  maxMs: number;
  totalElapsedMs: number;
};

export type RemoteRecognitionProbeResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  admissionId: string;
  accepted: boolean;
  rounds: RemoteRecognitionProbeRound[];
  summary: RemoteRecognitionProbeSummary;
};

export type RemoteRecognitionFrameProbePayload = {
  sequence: number;
  sampledAt: number;
  width: number;
  height: number;
  encodedRgba: ArrayBuffer;
};

export type RemoteRecognitionFrameProbeRound = {
  round: number;
  status: "ok";
  elapsedMs: number;
  sampledAt: number;
  encodedBytes: number;
  width: number;
  height: number;
  parser: {
    engine: "onnxruntime-native";
    modelId: string;
    executionProviders: string[];
    boxCount: number;
  };
  timings: {
    decodeMs: number;
    preprocessMs: number;
    inferenceMs: number;
    postprocessMs: number;
    serverTotalMs: number;
  };
};

export type RemoteRecognitionFrameProbeResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  admissionId: string;
  accepted: boolean;
  requiredRounds: number;
  round: RemoteRecognitionFrameProbeRound;
  summary: RemoteRecognitionProbeSummary;
};

export type RemoteRecognitionParserFramePayload = {
  sequence: number;
  sampledAt: number;
  width: number;
  height: number;
  encodedVp8: ArrayBuffer;
};

export type RemoteRecognitionParserBox = {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
};

export type RemoteRecognitionParserFrameResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  sessionId: string;
  purpose: typeof REMOTE_RECOGNITION_PARSER_FRAME_PURPOSE;
  expiresAt: number;
  frame: {
    sequence: number;
    sampledAt: number;
    encodedBytes: number;
    width: number;
    height: number;
    parser: {
      engine: "onnxruntime-native";
      modelId: string;
      modelInputWidth: number;
      modelInputHeight: number;
      onnxRuntimeVersion: string;
      executionProviders: string[];
      boxCount: number;
    };
    boxes: RemoteRecognitionParserBox[];
    timings: {
      decodeMs: number;
      preprocessMs: number;
      inferenceMs: number;
      postprocessMs: number;
      serverTotalMs: number;
    };
  };
};

export type RemoteRecognitionParserFrameProviderRequest = {
  sampledAt: number;
  width: number;
  height: number;
  encodedVp8: ArrayBuffer;
  encodeMs: number;
};

export type RemoteRecognitionParserFrameProviderResult = {
  response: RemoteRecognitionParserFrameResponse;
  e2eMs: number;
};

export type RemoteRecognitionParserFrameProvider = (
  request: RemoteRecognitionParserFrameProviderRequest,
) => Promise<RemoteRecognitionParserFrameProviderResult>;

export class RemoteRecognitionParserFrameDroppedError extends Error {
  readonly sampledAt: number | null;
  readonly replacedBySampledAt: number | null;

  constructor({
    sampledAt,
    replacedBySampledAt,
  }: {
    sampledAt: number | null;
    replacedBySampledAt: number | null;
  }) {
    super("remote-recognition-parser-frame-dropped");
    this.name = "RemoteRecognitionParserFrameDroppedError";
    this.sampledAt = sampledAt;
    this.replacedBySampledAt = replacedBySampledAt;
  }
}

export type RemoteRecognitionSessionResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  sessionId: string;
  sessionToken: string;
  betaAlias: string | null;
  connectionCode: string | null;
  expiresAt: number;
  idleTimeoutMs: number;
  heartbeatIntervalMs: number;
  modelSetId: string;
  capabilities: {
    frameAnalysisEnabled: boolean;
    entitlementLeaseVersion: 1 | null;
    clientTelemetryVersion?:
      | typeof REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION
      | null;
  };
};

export type RemoteRecognitionHeartbeatResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  sessionId: string;
  expiresAt: number;
};

export type RemoteRecognitionReleaseResponse = {
  contract: RemoteRecognitionControlMarker;
  status: "ok";
  released: true;
};

export type RemoteRecognitionConnectionIdentity = {
  betaAlias: string;
  connectionCode: string;
};

export class RemoteRecognitionControlContractError extends Error {
  constructor(
    readonly code: RemoteRecognitionControlFailureCode,
    readonly phase: RemoteRecognitionControlFailurePhase,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
    this.name = "RemoteRecognitionControlContractError";
  }
}

export function createRemoteRecognitionControlMarker(): RemoteRecognitionControlMarker {
  return {
    schema: REMOTE_RECOGNITION_CONTROL_SCHEMA,
    version: REMOTE_RECOGNITION_CONTROL_VERSION,
  };
}

export function parseRemoteRecognitionServiceStatusResponse(
  value: unknown,
): RemoteRecognitionServiceStatusResponse {
  const input = requireSuccessRecord(value, "status");
  const serviceState = requireLiteral(
    input.serviceState,
    "serviceState",
    ["available", "full", "maintenance", "unavailable"] as const,
  );
  const admissionAvailable = requireBoolean(
    input.admissionAvailable,
    "admissionAvailable",
  );
  if (admissionAvailable !== (serviceState === "available")) {
    invalidResponse("admission availability does not match service state");
  }
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    serviceState,
    admissionAvailable,
    frameAnalysisEnabled: requireBoolean(
      input.frameAnalysisEnabled,
      "frameAnalysisEnabled",
    ),
    retryAfterMs: requireNullableNonNegativeNumber(
      input.retryAfterMs,
      "retryAfterMs",
    ),
  };
}

export function parseRemoteRecognitionAdmissionResponse(
  value: unknown,
): RemoteRecognitionAdmissionResponse {
  const input = requireSuccessRecord(value, "admission");
  const probe = requireRecord(input.probe, "probe");
  const capabilities = requireRecord(input.capabilities, "capabilities");
  const parsed: RemoteRecognitionAdmissionResponse = {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: requireText(input.admissionId, "admissionId"),
    admissionToken: requireText(input.admissionToken, "admissionToken"),
    betaAlias: parseOptionalBetaAlias(input.betaAlias),
    connectionCode: parseOptionalConnectionCode(input.connectionCode),
    expiresAt: requirePositiveNumber(input.expiresAt, "expiresAt"),
    probe: {
      requiredRounds: requirePositiveInteger(
        probe.requiredRounds,
        "probe.requiredRounds",
      ),
      intervalMs: requirePositiveInteger(probe.intervalMs, "probe.intervalMs"),
    },
    capabilities: {
      frameAnalysisEnabled: requireBoolean(
        capabilities.frameAnalysisEnabled,
        "capabilities.frameAnalysisEnabled",
      ),
      entitlementLeaseVersion: parseOptionalEntitlementLeaseVersion(
        capabilities.entitlementLeaseVersion,
      ),
    },
  };
  if (
    parsed.probe.requiredRounds !== REMOTE_RECOGNITION_CONTROL_POLICY.probeRounds ||
    parsed.probe.intervalMs !== REMOTE_RECOGNITION_CONTROL_POLICY.probeIntervalMs
  ) {
    invalidResponse("admission probe policy is unsupported");
  }
  return parsed;
}

export function parseRemoteRecognitionProbeResponse(
  value: unknown,
): RemoteRecognitionProbeResponse {
  const input = requireSuccessRecord(value, "probe");
  if (!Array.isArray(input.rounds)) {
    invalidResponse("rounds must be an array");
  }
  const rounds = input.rounds.map((value, index) => {
    const round = requireRecord(value, `rounds[${index}]`);
    return {
      round: requirePositiveInteger(round.round, `rounds[${index}].round`),
      status: requireLiteral(
        round.status,
        `rounds[${index}].status`,
        ["ok", "error"] as const,
      ),
      elapsedMs: requireNonNegativeNumber(
        round.elapsedMs,
        `rounds[${index}].elapsedMs`,
      ),
    };
  });
  const summary = requireRecord(input.summary, "summary");
  const parsed: RemoteRecognitionProbeResponse = {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: requireText(input.admissionId, "admissionId"),
    accepted: requireBoolean(input.accepted, "accepted"),
    rounds,
    summary: {
      completedRounds: requireNonNegativeInteger(
        summary.completedRounds,
        "summary.completedRounds",
      ),
      successfulRounds: requireNonNegativeInteger(
        summary.successfulRounds,
        "summary.successfulRounds",
      ),
      medianMs: requireNonNegativeNumber(summary.medianMs, "summary.medianMs"),
      maxMs: requireNonNegativeNumber(summary.maxMs, "summary.maxMs"),
      totalElapsedMs: requireNonNegativeNumber(
        summary.totalElapsedMs,
        "summary.totalElapsedMs",
      ),
    },
  };
  if (parsed.summary.completedRounds !== rounds.length) {
    invalidResponse("completed round count does not match rounds");
  }
  if (
    parsed.summary.successfulRounds !==
    rounds.filter((round) => round.status === "ok").length
  ) {
    invalidResponse("successful round count does not match rounds");
  }
  return parsed;
}

export function parseRemoteRecognitionFrameProbeResponse(
  value: unknown,
): RemoteRecognitionFrameProbeResponse {
  const input = requireSuccessRecord(value, "frameProbe");
  const round = parseRemoteRecognitionFrameRound(input.round, "round");
  const summaryInput = requireRecord(input.summary, "summary");
  const requiredRounds = requirePositiveInteger(
    input.requiredRounds,
    "requiredRounds",
  );
  const summary: RemoteRecognitionProbeSummary = {
    completedRounds: requireNonNegativeInteger(
      summaryInput.completedRounds,
      "summary.completedRounds",
    ),
    successfulRounds: requireNonNegativeInteger(
      summaryInput.successfulRounds,
      "summary.successfulRounds",
    ),
    medianMs: requireNonNegativeNumber(summaryInput.medianMs, "summary.medianMs"),
    maxMs: requireNonNegativeNumber(summaryInput.maxMs, "summary.maxMs"),
    totalElapsedMs: requireNonNegativeNumber(
      summaryInput.totalElapsedMs,
      "summary.totalElapsedMs",
    ),
  };
  const accepted = requireBoolean(input.accepted, "accepted");
  if (
    requiredRounds !== REMOTE_RECOGNITION_CONTROL_POLICY.probeRounds ||
    summary.completedRounds < 1 ||
    summary.completedRounds > requiredRounds ||
    summary.successfulRounds !== summary.completedRounds ||
    accepted !== (summary.completedRounds === requiredRounds)
  ) {
    invalidResponse("frame probe summary is inconsistent");
  }
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: requireText(input.admissionId, "admissionId"),
    accepted,
    requiredRounds,
    round,
    summary,
  };
}

export function parseRemoteRecognitionParserFrameResponse(
  value: unknown,
): RemoteRecognitionParserFrameResponse {
  const input = requireSuccessRecord(value, "parserFrame");
  const frameInput = requireRecord(input.frame, "frame");
  const parserInput = requireRecord(frameInput.parser, "frame.parser");
  const timingsInput = requireRecord(frameInput.timings, "frame.timings");
  if (!Array.isArray(parserInput.executionProviders)) {
    invalidResponse("frame.parser.executionProviders must be an array");
  }
  const executionProviders = parserInput.executionProviders.map(
    (provider, index) =>
      requireText(provider, `frame.parser.executionProviders[${index}]`),
  );
  if (executionProviders.length === 0 || executionProviders.length > 8) {
    invalidResponse("frame.parser.executionProviders must be bounded");
  }
  if (!Array.isArray(frameInput.boxes)) {
    invalidResponse("frame.boxes must be an array");
  }
  if (frameInput.boxes.length > 96) {
    invalidResponse("frame.boxes must be bounded");
  }
  const width = requirePositiveInteger(frameInput.width, "frame.width");
  const height = requirePositiveInteger(frameInput.height, "frame.height");
  const boxes = frameInput.boxes.map((value, index) => {
    const box = requireRecord(value, `frame.boxes[${index}]`);
    const parsed: RemoteRecognitionParserBox = {
      x: requireNonNegativeInteger(box.x, `frame.boxes[${index}].x`),
      y: requireNonNegativeInteger(box.y, `frame.boxes[${index}].y`),
      size: requirePositiveInteger(box.size, `frame.boxes[${index}].size`),
      confidence: requireUnitIntervalNumber(
        box.confidence,
        `frame.boxes[${index}].confidence`,
      ),
      score: requireNonNegativeNumber(
        box.score,
        `frame.boxes[${index}].score`,
      ),
    };
    if (parsed.x + parsed.size > width || parsed.y + parsed.size > height) {
      invalidResponse(`frame.boxes[${index}] exceeds frame bounds`);
    }
    return parsed;
  });
  const boxCount = requireNonNegativeInteger(
    parserInput.boxCount,
    "frame.parser.boxCount",
  );
  if (boxCount !== boxes.length) {
    invalidResponse("frame.parser.boxCount does not match frame.boxes");
  }
  const encodedBytes = requirePositiveInteger(
    frameInput.encodedBytes,
    "frame.encodedBytes",
  );
  if (encodedBytes > REMOTE_RECOGNITION_PARSER_FRAME_MAX_BYTES) {
    invalidResponse("frame.encodedBytes exceeds parser frame limit");
  }
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: requireText(input.sessionId, "sessionId"),
    purpose: requireLiteral(
      input.purpose,
      "purpose",
      [REMOTE_RECOGNITION_PARSER_FRAME_PURPOSE] as const,
    ),
    expiresAt: requirePositiveNumber(input.expiresAt, "expiresAt"),
    frame: {
      sequence: requirePositiveInteger(frameInput.sequence, "frame.sequence"),
      sampledAt: requirePositiveNumber(frameInput.sampledAt, "frame.sampledAt"),
      encodedBytes,
      width,
      height,
      parser: {
        engine: requireLiteral(
          parserInput.engine,
          "frame.parser.engine",
          ["onnxruntime-native"] as const,
        ),
        modelId: requireText(parserInput.modelId, "frame.parser.modelId"),
        modelInputWidth: requirePositiveInteger(
          parserInput.modelInputWidth,
          "frame.parser.modelInputWidth",
        ),
        modelInputHeight: requirePositiveInteger(
          parserInput.modelInputHeight,
          "frame.parser.modelInputHeight",
        ),
        onnxRuntimeVersion: requireText(
          parserInput.onnxRuntimeVersion,
          "frame.parser.onnxRuntimeVersion",
        ),
        executionProviders,
        boxCount,
      },
      boxes,
      timings: {
        decodeMs: requireNonNegativeNumber(
          timingsInput.decodeMs,
          "frame.timings.decodeMs",
        ),
        preprocessMs: requireNonNegativeNumber(
          timingsInput.preprocessMs,
          "frame.timings.preprocessMs",
        ),
        inferenceMs: requireNonNegativeNumber(
          timingsInput.inferenceMs,
          "frame.timings.inferenceMs",
        ),
        postprocessMs: requireNonNegativeNumber(
          timingsInput.postprocessMs,
          "frame.timings.postprocessMs",
        ),
        serverTotalMs: requireNonNegativeNumber(
          timingsInput.serverTotalMs,
          "frame.timings.serverTotalMs",
        ),
      },
    },
  };
}

function parseRemoteRecognitionFrameRound(
  value: unknown,
  label: string,
): RemoteRecognitionFrameProbeRound {
  const roundInput = requireRecord(value, label);
  const parserInput = requireRecord(roundInput.parser, `${label}.parser`);
  const timingsInput = requireRecord(roundInput.timings, `${label}.timings`);
  if (!Array.isArray(parserInput.executionProviders)) {
    invalidResponse(`${label}.parser.executionProviders must be an array`);
  }
  const executionProviders = parserInput.executionProviders.map(
    (provider, index) =>
      requireText(provider, `${label}.parser.executionProviders[${index}]`),
  );
  if (executionProviders.length === 0 || executionProviders.length > 8) {
    invalidResponse(`${label}.parser.executionProviders must be bounded`);
  }
  const boxCount = requireNonNegativeInteger(
    parserInput.boxCount,
    `${label}.parser.boxCount`,
  );
  if (boxCount > 96) {
    invalidResponse(`${label}.parser.boxCount must be bounded`);
  }
  return {
    round: requirePositiveInteger(roundInput.round, `${label}.round`),
    status: requireLiteral(
      roundInput.status,
      `${label}.status`,
      ["ok"] as const,
    ),
    elapsedMs: requireNonNegativeNumber(
      roundInput.elapsedMs,
      `${label}.elapsedMs`,
    ),
    sampledAt: requirePositiveNumber(
      roundInput.sampledAt,
      `${label}.sampledAt`,
    ),
    encodedBytes: requirePositiveInteger(
      roundInput.encodedBytes,
      `${label}.encodedBytes`,
    ),
    width: requirePositiveInteger(roundInput.width, `${label}.width`),
    height: requirePositiveInteger(roundInput.height, `${label}.height`),
    parser: {
      engine: requireLiteral(
        parserInput.engine,
        `${label}.parser.engine`,
        ["onnxruntime-native"] as const,
      ),
      modelId: requireText(parserInput.modelId, `${label}.parser.modelId`),
      executionProviders,
      boxCount,
    },
    timings: {
      decodeMs: requireNonNegativeNumber(
        timingsInput.decodeMs,
        `${label}.timings.decodeMs`,
      ),
      preprocessMs: requireNonNegativeNumber(
        timingsInput.preprocessMs,
        `${label}.timings.preprocessMs`,
      ),
      inferenceMs: requireNonNegativeNumber(
        timingsInput.inferenceMs,
        `${label}.timings.inferenceMs`,
      ),
      postprocessMs: requireNonNegativeNumber(
        timingsInput.postprocessMs,
        `${label}.timings.postprocessMs`,
      ),
      serverTotalMs: requireNonNegativeNumber(
        timingsInput.serverTotalMs,
        `${label}.timings.serverTotalMs`,
      ),
    },
  };
}

export function parseRemoteRecognitionSessionResponse(
  value: unknown,
): RemoteRecognitionSessionResponse {
  const input = requireSuccessRecord(value, "session");
  const capabilities = requireRecord(input.capabilities, "capabilities");
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: requireText(input.sessionId, "sessionId"),
    sessionToken: requireText(input.sessionToken, "sessionToken"),
    betaAlias: parseOptionalBetaAlias(input.betaAlias),
    connectionCode: parseOptionalConnectionCode(input.connectionCode),
    expiresAt: requirePositiveNumber(input.expiresAt, "expiresAt"),
    idleTimeoutMs: requirePositiveInteger(input.idleTimeoutMs, "idleTimeoutMs"),
    heartbeatIntervalMs: requirePositiveInteger(
      input.heartbeatIntervalMs,
      "heartbeatIntervalMs",
    ),
    modelSetId: requireText(input.modelSetId, "modelSetId"),
    capabilities: {
      frameAnalysisEnabled: requireBoolean(
        capabilities.frameAnalysisEnabled,
        "capabilities.frameAnalysisEnabled",
      ),
      entitlementLeaseVersion: parseOptionalEntitlementLeaseVersion(
        capabilities.entitlementLeaseVersion,
      ),
      clientTelemetryVersion: parseOptionalClientTelemetryVersion(
        capabilities.clientTelemetryVersion,
      ),
    },
  };
}

export function isValidRemoteRecognitionBetaAlias(value: string): boolean {
  return REMOTE_RECOGNITION_BETA_ALIAS_PATTERN.test(value);
}

export function isValidRemoteRecognitionClientUuid(value: string): boolean {
  return REMOTE_RECOGNITION_CLIENT_UUID_PATTERN.test(value);
}

export function deriveRemoteRecognitionBetaAliasFromAccessCode(
  accessCode: string,
): string | null {
  const suffix = accessCode.trim().toUpperCase().slice(-5);
  const betaAlias = `BETA-${suffix}`;
  return isValidRemoteRecognitionBetaAlias(betaAlias) ? betaAlias : null;
}

function parseOptionalBetaAlias(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !isValidRemoteRecognitionBetaAlias(value)
  ) {
    invalidResponse("betaAlias is invalid");
  }
  return value;
}

function parseOptionalEntitlementLeaseVersion(value: unknown): 1 | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== 1) {
    invalidResponse("entitlement lease version is unsupported");
  }
  return 1;
}

function parseOptionalConnectionCode(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !REMOTE_RECOGNITION_CONNECTION_CODE_PATTERN.test(value)
  ) {
    invalidResponse("connectionCode is invalid");
  }
  return value;
}

function parseOptionalClientTelemetryVersion(
  value: unknown,
): typeof REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION | null {
  if (value === undefined || value === null) {
    return null;
  }
  const version = requirePositiveInteger(
    value,
    "capabilities.clientTelemetryVersion",
  );
  if (version !== REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION) {
    return null;
  }
  return REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION;
}

export function parseRemoteRecognitionHeartbeatResponse(
  value: unknown,
): RemoteRecognitionHeartbeatResponse {
  const input = requireSuccessRecord(value, "heartbeat");
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: requireText(input.sessionId, "sessionId"),
    expiresAt: requirePositiveNumber(input.expiresAt, "expiresAt"),
  };
}

export function parseRemoteRecognitionReleaseResponse(
  value: unknown,
): RemoteRecognitionReleaseResponse {
  const input = requireSuccessRecord(value, "release");
  if (input.released !== true) {
    invalidResponse("released must be true");
  }
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    released: true,
  };
}

export function parseRemoteRecognitionControlFailure(
  value: unknown,
): RemoteRecognitionControlContractError {
  const input = requireRecord(value, "response");
  assertMarker(input.contract);
  if (input.status !== "error") {
    invalidResponse("response status is not error");
  }
  const error = requireRecord(input.error, "error");
  return new RemoteRecognitionControlContractError(
    requireLiteral(
      error.code,
      "error.code",
      [
        "invalid-contract",
        "invalid-request",
        "origin-not-allowed",
        "not-entitled",
        "access-code-in-use",
        "client-reconnect-busy",
        "rate-limited",
        "capacity-full",
        "service-unavailable",
        "admission-not-found",
        "admission-expired",
        "session-not-found",
        "session-expired",
        "session-frame-idle",
        "invalid-token",
        "probe-failed",
        "transport-not-enabled",
        "request-timeout",
        "network-error",
        "invalid-response",
        "internal-error",
      ] as const,
    ),
    requireLiteral(
      error.phase,
      "error.phase",
      ["status", "entitlement", "admission", "probe", "session", "transport"] as const,
    ),
    requireBoolean(error.retryable, "error.retryable"),
    requireNullableNonNegativeNumber(error.retryAfterMs, "error.retryAfterMs"),
    requireText(error.technicalMessage, "error.technicalMessage"),
  );
}

function requireSuccessRecord(value: unknown, label: string): Record<string, unknown> {
  const input = requireRecord(value, label);
  assertMarker(input.contract);
  if (input.status === "error") {
    throw parseRemoteRecognitionControlFailure(input);
  }
  if (input.status !== "ok") {
    invalidResponse(`${label} status must be ok or error`);
  }
  return input;
}

function assertMarker(value: unknown): void {
  const marker = requireRecord(value, "contract");
  if (
    marker.schema !== REMOTE_RECOGNITION_CONTROL_SCHEMA ||
    marker.version !== REMOTE_RECOGNITION_CONTROL_VERSION
  ) {
    invalidResponse("unsupported remote recognition control contract");
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidResponse(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    invalidResponse(`${label} must be non-empty text`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    invalidResponse(`${label} must be boolean`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalidResponse(`${label} must be a positive number`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalidResponse(`${label} must be a non-negative number`);
  }
  return value;
}

function requireUnitIntervalNumber(value: unknown, label: string): number {
  const parsed = requireNonNegativeNumber(value, label);
  if (parsed > 1) {
    invalidResponse(`${label} must be between zero and one`);
  }
  return parsed;
}

function requireNullableNonNegativeNumber(
  value: unknown,
  label: string,
): number | null {
  return value === null ? null : requireNonNegativeNumber(value, label);
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = requirePositiveNumber(value, label);
  if (!Number.isInteger(parsed)) {
    invalidResponse(`${label} must be an integer`);
  }
  return parsed;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireNonNegativeNumber(value, label);
  if (!Number.isInteger(parsed)) {
    invalidResponse(`${label} must be an integer`);
  }
  return parsed;
}

function requireLiteral<const T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    invalidResponse(`${label} is unsupported`);
  }
  return value as T[number];
}

function invalidResponse(message: string): never {
  throw new RemoteRecognitionControlContractError(
    "invalid-response",
    "status",
    false,
    null,
    message,
  );
}
