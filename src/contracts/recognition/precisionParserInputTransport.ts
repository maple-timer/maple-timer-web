export const PRECISION_PARSER_INPUT_TRANSPORT_SOURCE = "source-rgba";
export const PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW = "vp8-preview-v1";

export type PrecisionParserInputTransport =
  | typeof PRECISION_PARSER_INPUT_TRANSPORT_SOURCE
  | typeof PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW;

export const DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT: PrecisionParserInputTransport =
  PRECISION_PARSER_INPUT_TRANSPORT_SOURCE;

export const VP8_PARSER_PREVIEW_PROFILE = {
  codec: "vp8",
  bitrate: 4_000_000,
  framerate: 1,
  bitrateMode: "variable",
  latencyMode: "realtime",
  hardwareAcceleration: "no-preference",
  contentHint: "detail",
  hardPayloadBytes: 256 * 1024,
} as const;

export type PrecisionParserInputTransportDiagnostics = {
  transport: PrecisionParserInputTransport;
  successfulSamples: number;
  failedSamples: number;
  droppedSamples: number;
  averageEncodedBytes: number | null;
  averageEncodeMs: number | null;
  averageDecodeMs: number | null;
  averageE2eMs: number | null;
  averageServerTotalMs: number | null;
  lastEncodedBytes: number | null;
  lastEncodeMs: number | null;
  lastDecodeMs: number | null;
  lastE2eMs: number | null;
  lastServerTotalMs: number | null;
  lastSampledAt: number | null;
  lastError: string | null;
};

export function createPrecisionParserInputTransportDiagnostics(
  transport: PrecisionParserInputTransport,
): PrecisionParserInputTransportDiagnostics {
  return {
    transport,
    successfulSamples: 0,
    failedSamples: 0,
    droppedSamples: 0,
    averageEncodedBytes: null,
    averageEncodeMs: null,
    averageDecodeMs: null,
    averageE2eMs: null,
    averageServerTotalMs: null,
    lastEncodedBytes: null,
    lastEncodeMs: null,
    lastDecodeMs: null,
    lastE2eMs: null,
    lastServerTotalMs: null,
    lastSampledAt: null,
    lastError: null,
  };
}
