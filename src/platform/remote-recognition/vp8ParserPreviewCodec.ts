import { VP8_PARSER_PREVIEW_PROFILE } from "../../contracts/recognition/precisionParserInputTransport";

export type Vp8ParserPreviewFrame = {
  imageData: ImageData;
  encodedBytes: number;
  encodeMs: number;
  decodeMs: number;
};

export type EncodedVp8ParserFrame = {
  encodedVp8: ArrayBuffer;
  encodedBytes: number;
  encodeMs: number;
};

type EncodedOutput = {
  data: Uint8Array;
  type: EncodedVideoChunkType;
  timestamp: number;
  duration: number | null;
  decoderConfig: VideoDecoderConfig | null;
};

const supportCache = new Map<
  string,
  Promise<{
    encoderConfig: VideoEncoderConfig;
    decoderConfig: VideoDecoderConfig;
  }>
>();
const encoderSupportCache = new Map<string, Promise<VideoEncoderConfig>>();

export async function reconstructVp8ParserPreviewFrame(
  source: ImageData,
): Promise<Vp8ParserPreviewFrame> {
  assertWebCodecsAvailable();
  const { encoderConfig, decoderConfig } = await getSupportedConfigs(
    source.width,
    source.height,
  );
  const encodedFrame = await encodeVp8Frame(source, encoderConfig);
  const encoded = encodedFrame.output;

  const decodeStartedAt = performance.now();
  const decodedFrame = await decodeIndependentFrame(
    encoded,
    encoded.decoderConfig ?? decoderConfig,
  );
  const decodedCanvas = createCanvas(source.width, source.height);
  const decodedContext = getCanvasContext(decodedCanvas);
  try {
    decodedContext.drawImage(decodedFrame, 0, 0, source.width, source.height);
  } finally {
    decodedFrame.close();
  }
  const imageData = decodedContext.getImageData(0, 0, source.width, source.height);
  const decodeMs = performance.now() - decodeStartedAt;

  return {
    imageData,
    encodedBytes: encoded.data.byteLength,
    encodeMs: encodedFrame.encodeMs,
    decodeMs,
  };
}

export async function encodeVp8ParserFrame(
  source: ImageData,
): Promise<EncodedVp8ParserFrame> {
  assertWebCodecsEncoderAvailable();
  const encoded = await encodeVp8Frame(source);
  const copied = encoded.output.data.slice();
  return {
    encodedVp8: copied.buffer as ArrayBuffer,
    encodedBytes: copied.byteLength,
    encodeMs: encoded.encodeMs,
  };
}

async function encodeVp8Frame(
  source: ImageData,
  providedEncoderConfig?: VideoEncoderConfig,
): Promise<{
  output: EncodedOutput;
  encodeMs: number;
}> {
  const encoderConfig =
    providedEncoderConfig ??
    (await getSupportedEncoderConfig(source.width, source.height));
  const sourceCanvas = createCanvas(source.width, source.height);
  const sourceContext = getCanvasContext(sourceCanvas);
  sourceContext.putImageData(source, 0, 0);

  const encodedOutputs: EncodedOutput[] = [];
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedOutputs.push({
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? null,
        decoderConfig: metadata?.decoderConfig ?? null,
      });
    },
    error: (error) => {
      encoderError = toError(error, "vp8-parser-preview-encode-failed");
    },
  });

  const encodeStartedAt = performance.now();
  try {
    encoder.configure(encoderConfig);
    const frame = new VideoFrame(sourceCanvas, {
      timestamp: 0,
      duration: 1_000_000,
    });
    try {
      encoder.encode(frame, { keyFrame: true });
    } finally {
      frame.close();
    }
    await encoder.flush();
  } finally {
    encoder.close();
  }
  const encodeMs = performance.now() - encodeStartedAt;
  if (encoderError) {
    throw encoderError;
  }
  if (encodedOutputs.length !== 1) {
    throw new Error(
      `vp8-parser-preview-unexpected-chunk-count:${encodedOutputs.length}`,
    );
  }
  const encoded = encodedOutputs[0];
  if (encoded.type !== "key") {
    throw new Error("vp8-parser-preview-keyframe-not-honored");
  }
  if (encoded.data.byteLength > VP8_PARSER_PREVIEW_PROFILE.hardPayloadBytes) {
    throw new Error(
      `vp8-parser-preview-payload-too-large:${encoded.data.byteLength}`,
    );
  }

  return {
    output: encoded,
    encodeMs,
  };
}

async function getSupportedEncoderConfig(
  width: number,
  height: number,
): Promise<VideoEncoderConfig> {
  const key = `${width}x${height}`;
  const existing = encoderSupportCache.get(key);
  if (existing) {
    return existing;
  }
  const encoderConfig = createEncoderConfig(width, height);
  const pending = VideoEncoder.isConfigSupported(encoderConfig)
    .then((support) => {
      if (!support.supported) {
        throw new Error("vp8-parser-preview-codec-unsupported");
      }
      return support.config ?? encoderConfig;
    })
    .catch((error) => {
      encoderSupportCache.delete(key);
      throw error;
    });
  encoderSupportCache.set(key, pending);
  return pending;
}

async function getSupportedConfigs(
  width: number,
  height: number,
): Promise<{
  encoderConfig: VideoEncoderConfig;
  decoderConfig: VideoDecoderConfig;
}> {
  const key = `${width}x${height}`;
  const existing = supportCache.get(key);
  if (existing) {
    return existing;
  }
  const pending = resolveSupportedConfigs(width, height).catch((error) => {
    supportCache.delete(key);
    throw error;
  });
  supportCache.set(key, pending);
  return pending;
}

async function resolveSupportedConfigs(
  width: number,
  height: number,
): Promise<{
  encoderConfig: VideoEncoderConfig;
  decoderConfig: VideoDecoderConfig;
}> {
  const encoderConfig = createEncoderConfig(width, height);
  const decoderConfig: VideoDecoderConfig = {
    codec: VP8_PARSER_PREVIEW_PROFILE.codec,
    codedWidth: width,
    codedHeight: height,
    optimizeForLatency: true,
    hardwareAcceleration: VP8_PARSER_PREVIEW_PROFILE.hardwareAcceleration,
  };
  const [encoderSupport, decoderSupport] = await Promise.all([
    VideoEncoder.isConfigSupported(encoderConfig),
    VideoDecoder.isConfigSupported(decoderConfig),
  ]);
  if (!encoderSupport.supported || !decoderSupport.supported) {
    throw new Error("vp8-parser-preview-codec-unsupported");
  }
  return {
    encoderConfig: encoderSupport.config ?? encoderConfig,
    decoderConfig: decoderSupport.config ?? decoderConfig,
  };
}

function createEncoderConfig(
  width: number,
  height: number,
): VideoEncoderConfig {
  return {
    codec: VP8_PARSER_PREVIEW_PROFILE.codec,
    width,
    height,
    framerate: VP8_PARSER_PREVIEW_PROFILE.framerate,
    bitrate: VP8_PARSER_PREVIEW_PROFILE.bitrate,
    bitrateMode: VP8_PARSER_PREVIEW_PROFILE.bitrateMode,
    latencyMode: VP8_PARSER_PREVIEW_PROFILE.latencyMode,
    hardwareAcceleration: VP8_PARSER_PREVIEW_PROFILE.hardwareAcceleration,
    contentHint: VP8_PARSER_PREVIEW_PROFILE.contentHint,
  };
}

function decodeIndependentFrame(
  encoded: EncodedOutput,
  config: VideoDecoderConfig,
): Promise<VideoFrame> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let decoder: VideoDecoder | null = null;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      decoder?.close();
      reject(new Error("vp8-parser-preview-decode-timeout"));
    }, 5_000);
    try {
      decoder = new VideoDecoder({
        output: (frame) => {
          if (settled) {
            frame.close();
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          decoder?.close();
          resolve(frame);
        },
        error: (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          decoder?.close();
          reject(toError(error, "vp8-parser-preview-decode-failed"));
        },
      });
      decoder.configure(config);
      decoder.decode(
        new EncodedVideoChunk({
          type: encoded.type,
          timestamp: encoded.timestamp,
          ...(encoded.duration === null ? {} : { duration: encoded.duration }),
          data: encoded.data,
        }),
      );
    } catch (error) {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeoutId);
        decoder?.close();
        reject(toError(error, "vp8-parser-preview-decode-failed"));
      }
    }
  });
}

function assertWebCodecsAvailable(): void {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoDecoder === "undefined" ||
    typeof VideoFrame === "undefined" ||
    typeof EncodedVideoChunk === "undefined"
  ) {
    throw new Error("vp8-parser-preview-webcodecs-unavailable");
  }
}

function assertWebCodecsEncoderAvailable(): void {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("vp8-parser-preview-webcodecs-unavailable");
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("vp8-parser-preview-canvas-unavailable");
  }
  context.imageSmoothingEnabled = false;
  return context;
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message) {
    return error;
  }
  return new Error(fallback);
}
