const BOOTSTRAP_SCHEMA =
  "maple-timer.remote-recognition-v1-semantic-lab-bootstrap";
const BOOTSTRAP_VERSION = 1;
const CAPABILITY_HEADER = "x-maple-timer-semantic-lab-capability";
const ASSET_ID_PATTERN =
  /^asset-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CAPABILITY_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_PATH_PREFIX = "/__maple-remote-v1-semantic/assets/";
const MAX_ASSETS = 4_096;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_DIMENSION = 8_192;
const MAX_PIXELS = 33_554_432;
const PRESENT_TIMEOUT_MS = 5_000;

type SemanticLabAsset = {
  id: string;
  url: string;
  byteCount: number;
  byteSha256: string;
  rgbaSha256: string;
  width: number;
  height: number;
};

export type SemanticLabBootstrap = {
  schema: typeof BOOTSTRAP_SCHEMA;
  version: typeof BOOTSTRAP_VERSION;
  fixture: {
    manifestSha256: string;
    contentSha256: string;
    runtimeContractSha256: string;
  };
  capability: string;
  assets: readonly SemanticLabAsset[];
};

export type PresentedSemanticFrameReceipt = Readonly<{
  ordinal: number;
  assetByteSha256: string;
  rgbaSha256: string;
  presentedFrames: number;
}>;

export type CanvasSyntheticMediaSource = {
  readonly stream: MediaStream;
  readonly sourceSize: Readonly<{ width: number; height: number }>;
  present(assetId: string, ordinal: number): Promise<PresentedSemanticFrameReceipt>;
  snapshot(): Readonly<{
    disposed: boolean;
    nextOrdinal: number;
    decodedAssetCount: number;
    pendingPresentationCount: number;
    videoTrackCount: number;
    audioTrackCount: number;
  }>;
  dispose(): Promise<void>;
};

type CanvasCaptureTrack = MediaStreamTrack & { requestFrame(): void };
type FrameCallbackMetadata = VideoFrameCallbackMetadata & {
  presentedFrames?: number;
};

const PRESENTED_RECEIPTS = new WeakSet<object>();

export function validateSemanticLabBootstrap(
  value: unknown,
  expectedOrigin = window.location.origin,
): SemanticLabBootstrap {
  const input = exactObject(value, [
    "schema",
    "version",
    "fixture",
    "capability",
    "assets",
  ]);
  if (input.schema !== BOOTSTRAP_SCHEMA || input.version !== BOOTSTRAP_VERSION) {
    fail("semantic-lab-bootstrap-contract");
  }
  const fixture = exactObject(input.fixture, [
    "manifestSha256",
    "contentSha256",
    "runtimeContractSha256",
  ]);
  const manifestSha256 = sha256String(fixture.manifestSha256);
  const contentSha256 = sha256String(fixture.contentSha256);
  const runtimeContractSha256 = sha256String(
    fixture.runtimeContractSha256,
  );
  if (
    typeof input.capability !== "string" ||
    !CAPABILITY_PATTERN.test(input.capability)
  ) {
    fail("semantic-lab-bootstrap-capability");
  }
  if (
    !Array.isArray(input.assets) ||
    input.assets.length < 1 ||
    input.assets.length > MAX_ASSETS
  ) {
    fail("semantic-lab-bootstrap-assets");
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  let sourceWidth: number | null = null;
  let sourceHeight: number | null = null;
  const assets = input.assets.map((candidate) => {
    const asset = exactObject(candidate, [
      "id",
      "url",
      "byteCount",
      "byteSha256",
      "rgbaSha256",
      "width",
      "height",
    ]);
    if (
      typeof asset.id !== "string" ||
      !ASSET_ID_PATTERN.test(asset.id) ||
      ids.has(asset.id)
    ) {
      fail("semantic-lab-bootstrap-asset-id");
    }
    ids.add(asset.id);
    const width = boundedInteger(asset.width, 1, MAX_DIMENSION);
    const height = boundedInteger(asset.height, 1, MAX_DIMENSION);
    if (width * height > MAX_PIXELS) {
      fail("semantic-lab-bootstrap-asset-size");
    }
    if (sourceWidth === null) {
      sourceWidth = width;
      sourceHeight = height;
    } else if (width !== sourceWidth || height !== sourceHeight) {
      fail("semantic-lab-bootstrap-dimension-drift");
    }
    const byteCount = boundedInteger(asset.byteCount, 1, MAX_ASSET_BYTES);
    totalBytes += byteCount;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      fail("semantic-lab-bootstrap-byte-limit");
    }
    if (
      typeof asset.byteSha256 !== "string" ||
      !SHA256_PATTERN.test(asset.byteSha256) ||
      typeof asset.rgbaSha256 !== "string" ||
      !SHA256_PATTERN.test(asset.rgbaSha256)
    ) {
      fail("semantic-lab-bootstrap-asset-digest");
    }
    if (typeof asset.url !== "string") {
      fail("semantic-lab-bootstrap-asset-url");
    }
    let url: URL;
    try {
      url = new URL(asset.url);
    } catch {
      fail("semantic-lab-bootstrap-asset-url");
    }
    if (
      url.origin !== expectedOrigin ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== `${ASSET_PATH_PREFIX}${asset.id}`
    ) {
      fail("semantic-lab-bootstrap-asset-url");
    }
    return Object.freeze({
      id: asset.id,
      url: url.toString(),
      byteCount,
      byteSha256: asset.byteSha256,
      rgbaSha256: asset.rgbaSha256,
      width,
      height,
    });
  });

  return deepFreeze({
    schema: BOOTSTRAP_SCHEMA,
    version: BOOTSTRAP_VERSION,
    fixture: {
      manifestSha256,
      contentSha256,
      runtimeContractSha256,
    },
    capability: input.capability,
    assets,
  });
}

export async function createCanvasSyntheticMediaSource(
  bootstrapValue: unknown,
): Promise<CanvasSyntheticMediaSource> {
  const bootstrap = validateSemanticLabBootstrap(bootstrapValue);
  assertBrowserPrimitives();
  const decodedAssets = new Map<
    string,
    { descriptor: SemanticLabAsset; bitmap: ImageBitmap }
  >();
  let host: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let verifyCanvas: HTMLCanvasElement | null = null;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  try {
    for (const descriptor of bootstrap.assets) {
      const response = await fetch(descriptor.url, {
        method: "GET",
        headers: { [CAPABILITY_HEADER]: bootstrap.capability },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (
        !response.ok ||
        response.type === "opaque" ||
        response.headers.get("content-type") !== "image/png"
      ) {
        fail("semantic-lab-asset-fetch");
      }
      const bytes = await response.arrayBuffer();
      if (
        bytes.byteLength !== descriptor.byteCount ||
        (await sha256(bytes)) !== descriptor.byteSha256
      ) {
        fail("semantic-lab-asset-byte-mismatch");
      }
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      if (bitmap.width !== descriptor.width || bitmap.height !== descriptor.height) {
        bitmap.close();
        fail("semantic-lab-asset-decode-size");
      }
      decodedAssets.set(descriptor.id, { descriptor, bitmap });
    }

    const first = decodedAssets.values().next().value as {
      descriptor: SemanticLabAsset;
      bitmap: ImageBitmap;
    };
    const mediaHost = document.createElement("div");
    const sourceCanvas = document.createElement("canvas");
    const verificationCanvas = document.createElement("canvas");
    const verificationVideo = document.createElement("video");
    host = mediaHost;
    canvas = sourceCanvas;
    verifyCanvas = verificationCanvas;
    video = verificationVideo;
    mediaHost.hidden = true;
    mediaHost.dataset.remoteV1SemanticMedia = "true";
    sourceCanvas.width = first.descriptor.width;
    sourceCanvas.height = first.descriptor.height;
    verificationCanvas.width = first.descriptor.width;
    verificationCanvas.height = first.descriptor.height;
    verificationVideo.muted = true;
    verificationVideo.playsInline = true;
    mediaHost.append(sourceCanvas, verificationCanvas, verificationVideo);
    document.body.append(mediaHost);
    const context = sourceCanvas.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
      willReadFrequently: true,
    });
    const verifyContext = verificationCanvas.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
      willReadFrequently: true,
    });
    if (!context || !verifyContext) fail("semantic-lab-canvas-context");
    context.drawImage(first.bitmap, 0, 0);
    await assertCanvasRgba(context, first.descriptor);

    const mediaStream = sourceCanvas.captureStream(0);
    stream = mediaStream;
    const videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length !== 1 || mediaStream.getAudioTracks().length !== 0) {
      stopTracks(mediaStream);
      fail("semantic-lab-media-track-contract");
    }
    const track = videoTracks[0] as CanvasCaptureTrack;
    if (typeof track.requestFrame !== "function") {
      stopTracks(mediaStream);
      fail("semantic-lab-request-frame-unavailable");
    }
    const nativeGetSettings = track.getSettings.bind(track);
    track.getSettings = () => ({
      ...nativeGetSettings(),
      displaySurface: "browser",
      width: first.descriptor.width,
      height: first.descriptor.height,
    });
    verificationVideo.srcObject = mediaStream;
    const playPromise = verificationVideo.play();
    track.requestFrame();
    await playPromise;

    let disposed = false;
    let nextOrdinal = 1;
    let lastPresentedFrames = 0;
    const pendingCallbacks = new Map<
      number,
      { timeout: number; reject(error: Error): void }
    >();

    const present = async (assetId: string, ordinal: number) => {
      if (disposed) fail("semantic-lab-media-disposed");
      if (!Number.isSafeInteger(ordinal) || ordinal !== nextOrdinal) {
        fail("semantic-lab-frame-order");
      }
      const asset = decodedAssets.get(assetId);
      if (!asset) fail("semantic-lab-frame-asset");
      context.drawImage(asset.bitmap, 0, 0);
      await assertCanvasRgba(context, asset.descriptor);
      const delivered = waitForPresentedFrame(
        verificationVideo,
        lastPresentedFrames,
        pendingCallbacks,
      );
      track.requestFrame();
      const presentedFrames = await delivered;
      verifyContext.drawImage(verificationVideo, 0, 0);
      await assertCanvasRgba(verifyContext, asset.descriptor);
      lastPresentedFrames = presentedFrames;
      nextOrdinal += 1;
      const receipt = Object.freeze({
        ordinal,
        assetByteSha256: asset.descriptor.byteSha256,
        rgbaSha256: asset.descriptor.rgbaSha256,
        presentedFrames,
      });
      PRESENTED_RECEIPTS.add(receipt);
      return receipt;
    };

    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      for (const [callbackId, pending] of pendingCallbacks) {
        verificationVideo.cancelVideoFrameCallback(callbackId);
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("semantic-lab-media-disposed"));
      }
      pendingCallbacks.clear();
      verificationVideo.pause();
      verificationVideo.srcObject = null;
      stopTracks(mediaStream);
      for (const asset of decodedAssets.values()) asset.bitmap.close();
      decodedAssets.clear();
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;
      verificationCanvas.width = 0;
      verificationCanvas.height = 0;
      mediaHost.remove();
      await Promise.resolve();
      if (
        mediaStream
          .getTracks()
          .some((candidate) => candidate.readyState !== "ended") ||
        verificationVideo.srcObject !== null ||
        pendingCallbacks.size !== 0
      ) {
        fail("semantic-lab-media-cleanup");
      }
    };

    return Object.freeze({
      stream: mediaStream,
      sourceSize: Object.freeze({
        width: first.descriptor.width,
        height: first.descriptor.height,
      }),
      present,
      snapshot: () =>
        Object.freeze({
          disposed,
          nextOrdinal,
          decodedAssetCount: decodedAssets.size,
          pendingPresentationCount: pendingCallbacks.size,
          videoTrackCount: mediaStream.getVideoTracks().length,
          audioTrackCount: mediaStream.getAudioTracks().length,
        }),
      dispose,
    });
  } catch (error) {
    try {
      video?.pause();
      if (video) video.srcObject = null;
      if (stream) stopTracks(stream);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (verifyCanvas) {
        verifyCanvas.width = 0;
        verifyCanvas.height = 0;
      }
      host?.remove();
    } catch {
      // The original construction failure remains authoritative.
    }
    for (const asset of decodedAssets.values()) asset.bitmap.close();
    decodedAssets.clear();
    throw error;
  }
}

export function assertPresentedSemanticFrameReceipt(
  value: unknown,
): PresentedSemanticFrameReceipt {
  if (
    value === null ||
    typeof value !== "object" ||
    !PRESENTED_RECEIPTS.has(value)
  ) {
    fail("semantic-lab-presented-frame-receipt");
  }
  return value as PresentedSemanticFrameReceipt;
}

function waitForPresentedFrame(
  video: HTMLVideoElement,
  previousPresentedFrames: number,
  pending: Map<number, { timeout: number; reject(error: Error): void }>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let callbackId = 0;
    const timeout = window.setTimeout(() => {
      pending.delete(callbackId);
      video.cancelVideoFrameCallback(callbackId);
      reject(new Error("semantic-lab-video-frame-timeout"));
    }, PRESENT_TIMEOUT_MS);
    callbackId = video.requestVideoFrameCallback(
      (_now, metadata: FrameCallbackMetadata) => {
        window.clearTimeout(timeout);
        pending.delete(callbackId);
        const presentedFrames = metadata.presentedFrames;
        if (
          !Number.isSafeInteger(presentedFrames) ||
          presentedFrames <= previousPresentedFrames
        ) {
          reject(new Error("semantic-lab-video-frame-stale"));
          return;
        }
        resolve(presentedFrames);
      },
    );
    pending.set(callbackId, { timeout, reject });
  });
}

async function assertCanvasRgba(
  context: CanvasRenderingContext2D,
  descriptor: SemanticLabAsset,
) {
  const rgba = context.getImageData(
    0,
    0,
    descriptor.width,
    descriptor.height,
  );
  if (await sha256(rgba.data.buffer) !== descriptor.rgbaSha256) {
    fail("semantic-lab-rgba-mismatch");
  }
}

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function assertBrowserPrimitives() {
  if (
    typeof HTMLCanvasElement.prototype.captureStream !== "function" ||
    typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function" ||
    typeof createImageBitmap !== "function" ||
    !crypto.subtle
  ) {
    fail("semantic-lab-browser-primitives-unavailable");
  }
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail("semantic-lab-bootstrap-object");
  }
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== keys.length ||
    [...actualKeys].sort().some((key, index) => key !== [...keys].sort()[index])
  ) {
    fail("semantic-lab-bootstrap-keys");
  }
  return value as Record<string, unknown>;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail("semantic-lab-bootstrap-number");
  }
  return value as number;
}

function sha256String(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("semantic-lab-bootstrap-fixture");
  }
  return value;
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function fail(code: string): never {
  throw new Error(code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
