import type {
  RemoteRecognitionControlPort,
  RemoteRecognitionControlRequestOptions,
} from "../../application/remote-recognition/remoteRecognitionControlPort";
import {
  RemoteRecognitionControlContractError,
  parseRemoteRecognitionAdmissionResponse,
  parseRemoteRecognitionControlFailure,
  parseRemoteRecognitionFrameProbeResponse,
  parseRemoteRecognitionHeartbeatResponse,
  parseRemoteRecognitionProbeResponse,
  parseRemoteRecognitionParserFrameResponse,
  parseRemoteRecognitionReleaseResponse,
  parseRemoteRecognitionServiceStatusResponse,
  parseRemoteRecognitionSessionResponse,
  REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION,
  REMOTE_RECOGNITION_PARSER_FRAME_MIME_TYPE,
  REMOTE_RECOGNITION_PARSER_FRAME_PURPOSE,
  type RemoteRecognitionAdmissionRequest,
  type RemoteRecognitionFrameProbePayload,
  type RemoteRecognitionParserFramePayload,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import {
  REMOTE_RECOGNITION_CLIENT_TELEMETRY_HEADER,
  serializeRemoteRecognitionClientTelemetry,
} from "../../contracts/remote-recognition/remoteRecognitionClientTelemetry";
import { createMapleTimerApiUrl } from "../../lib/mapleTimerApi";

type FetchLike = typeof fetch;

type RemoteRecognitionControlClientOptions = {
  fetch?: FetchLike;
  baseUrl?: string;
  requestTimeoutMs?: number;
  probeTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 12_000;

export class BrowserRemoteRecognitionControlClient
  implements RemoteRecognitionControlPort
{
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly probeTimeoutMs: number;

  constructor(options: RemoteRecognitionControlClientOptions = {}) {
    this.fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = (
      options.baseUrl ?? createMapleTimerApiUrl("/v1/remote-recognition/")
    ).replace(/\/$/, "");
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  getStatus(options?: RemoteRecognitionControlRequestOptions) {
    return this.request(
      "/status",
      { method: "GET" },
      parseRemoteRecognitionServiceStatusResponse,
      "status",
      this.requestTimeoutMs,
      options,
    );
  }

  createAdmission(
    request: RemoteRecognitionAdmissionRequest,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      "/admissions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
      parseRemoteRecognitionAdmissionResponse,
      "admission",
      this.requestTimeoutMs,
      options,
    );
  }

  probeAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/admissions/${encodeURIComponent(admissionId)}/probe`,
      authenticatedRequest("POST", admissionToken),
      parseRemoteRecognitionProbeResponse,
      "probe",
      this.probeTimeoutMs,
      options,
    );
  }

  probeAdmissionFrame(
    admissionId: string,
    admissionToken: string,
    frame: RemoteRecognitionFrameProbePayload,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/admissions/${encodeURIComponent(admissionId)}/frame-probe`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${admissionToken}`,
          "content-type": "application/x-maple-timer-rgba",
          "content-encoding": "gzip",
          "x-maple-timer-remote-frame-sequence": String(frame.sequence),
          "x-maple-timer-remote-frame-width": String(frame.width),
          "x-maple-timer-remote-frame-height": String(frame.height),
          "x-maple-timer-remote-frame-sampled-at": String(frame.sampledAt),
        },
        body: frame.encodedRgba,
      },
      parseRemoteRecognitionFrameProbeResponse,
      "probe",
      this.probeTimeoutMs,
      options,
    );
  }

  promoteAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/admissions/${encodeURIComponent(admissionId)}/promote`,
      authenticatedRequest("POST", admissionToken),
      parseRemoteRecognitionSessionResponse,
      "session",
      this.requestTimeoutMs,
      options,
    );
  }

  cancelAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/admissions/${encodeURIComponent(admissionId)}`,
      authenticatedRequest("DELETE", admissionToken, undefined, true),
      parseRemoteRecognitionReleaseResponse,
      "admission",
      this.requestTimeoutMs,
      options,
    );
  }

  heartbeatSession(
    sessionId: string,
    sessionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      authenticatedRequest("POST", sessionToken, options),
      parseRemoteRecognitionHeartbeatResponse,
      "session",
      this.requestTimeoutMs,
      options,
    );
  }

  analyzeSessionParserFrame(
    sessionId: string,
    sessionToken: string,
    frame: RemoteRecognitionParserFramePayload,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/frames`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": REMOTE_RECOGNITION_PARSER_FRAME_MIME_TYPE,
          "x-maple-timer-remote-frame-purpose":
            REMOTE_RECOGNITION_PARSER_FRAME_PURPOSE,
          "x-maple-timer-remote-consent-version":
            REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION,
          "x-maple-timer-remote-frame-sequence": String(frame.sequence),
          "x-maple-timer-remote-frame-width": String(frame.width),
          "x-maple-timer-remote-frame-height": String(frame.height),
          "x-maple-timer-remote-frame-sampled-at": String(frame.sampledAt),
          ...createClientTelemetryHeaders(options),
        },
        body: frame.encodedVp8,
      },
      parseRemoteRecognitionParserFrameResponse,
      "transport",
      this.probeTimeoutMs,
      options,
    );
  }

  stopSession(
    sessionId: string,
    sessionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ) {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}`,
      authenticatedRequest("DELETE", sessionToken, options, true),
      parseRemoteRecognitionReleaseResponse,
      "session",
      this.requestTimeoutMs,
      options,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
    phase: RemoteRecognitionControlContractError["phase"],
    timeoutMs: number,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<T> {
    if (options?.signal?.aborted) {
      throw new RemoteRecognitionControlContractError(
        "network-error",
        phase,
        false,
        null,
        "remote-recognition-request-aborted",
      );
    }
    const controller = new AbortController();
    const handleExternalAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", handleExternalAbort, {
      once: true,
    });
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      const value = await parseJsonResponse(response, phase);
      if (isErrorResponse(value)) {
        throw parseRemoteRecognitionControlFailure(value);
      }
      if (!response.ok) {
        throw invalidResponseError(
          phase,
          `remote-recognition-http-${response.status}`,
        );
      }
      return parse(value);
    } catch (error) {
      if (error instanceof RemoteRecognitionControlContractError) {
        throw error;
      }
      if (controller.signal.aborted) {
        const wasExternallyAborted = options?.signal?.aborted === true;
        throw new RemoteRecognitionControlContractError(
          wasExternallyAborted ? "network-error" : "request-timeout",
          phase,
          !wasExternallyAborted,
          null,
          wasExternallyAborted
            ? "remote-recognition-request-aborted"
            : "remote-recognition-request-timeout",
        );
      }
      throw new RemoteRecognitionControlContractError(
        "network-error",
        phase,
        true,
        null,
        error instanceof Error
          ? error.message
          : "remote-recognition-network-error",
      );
    } finally {
      window.clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", handleExternalAbort);
    }
  }
}

function authenticatedRequest(
  method: "POST" | "DELETE",
  token: string,
  options?: RemoteRecognitionControlRequestOptions,
  keepalive = false,
): RequestInit {
  return {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...createClientTelemetryHeaders(options),
    },
    keepalive,
  };
}

function createClientTelemetryHeaders(
  options?: RemoteRecognitionControlRequestOptions,
): Record<string, string> {
  if (!options?.clientTelemetry) {
    return {};
  }
  const serialized = serializeRemoteRecognitionClientTelemetry(
    options.clientTelemetry,
  );
  return serialized
    ? { [REMOTE_RECOGNITION_CLIENT_TELEMETRY_HEADER]: serialized }
    : {};
}

async function parseJsonResponse(
  response: Response,
  phase: RemoteRecognitionControlContractError["phase"],
): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    throw invalidResponseError(
      phase,
      "remote-recognition-response-not-json",
    );
  }
}

function isErrorResponse(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { status?: unknown }).status === "error"
  );
}

function invalidResponseError(
  phase: RemoteRecognitionControlContractError["phase"],
  message: string,
) {
  return new RemoteRecognitionControlContractError(
    "invalid-response",
    phase,
    false,
    null,
    message,
  );
}

export const browserRemoteRecognitionControlClient =
  new BrowserRemoteRecognitionControlClient();
