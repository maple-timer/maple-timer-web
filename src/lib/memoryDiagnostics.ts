import type { AppBuildChannel } from "../contracts/deployment/appBuildInfo";
import {
  getRuntimePerformanceDiagnosticsSnapshot,
  observeRuntimeWorkerRequest,
  observeRuntimeWorkerResponse,
  type RuntimePerformanceDiagnosticsSnapshot,
} from "./runtimePerformanceDiagnostics";

export type MemoryDiagnosticsMode = "off" | "panel" | "lab";

export type MemoryDiagnosticsBuildInfo = {
  channel: AppBuildChannel;
  branch?: string;
  shortCommit?: string;
  deploymentUrl?: string | null;
};

type WorkerLikeOptions = {
  type?: WorkerType;
  name?: string;
  credentials?: RequestCredentials;
};

export type MemoryDiagnosticsWorkerEntry = {
  id: number;
  scriptUrl: string;
  scriptLabel: string;
  createdAtMs: number;
  ageMs: number;
  terminatedAtMs: number | null;
  state: "active" | "terminated";
  options: WorkerLikeOptions | null;
  postedMessages: number;
  receivedMessages: number;
  errors: number;
};

export type MemoryDiagnosticsWorkerSnapshot = {
  installed: boolean;
  activeCount: number;
  createdCount: number;
  terminatedCount: number;
  postedMessages: number;
  receivedMessages: number;
  errors: number;
  workers: MemoryDiagnosticsWorkerEntry[];
};

export type MemoryDiagnosticsDomSnapshot = {
  elementCount: number;
  elementCountsByTag: Array<{ tag: string; count: number }>;
  canvasCount: number;
  canvasPixels: number;
  largestCanvases: Array<{ width: number; height: number; pixels: number }>;
  imageCount: number;
  dataImageCount: number;
  dataImageCharacters: number;
  videoCount: number;
  videos: Array<{
    width: number;
    height: number;
    readyState: number;
    hasSrcObject: boolean;
    trackCount: number;
  }>;
  iframeCount: number;
  stylesheetCount: number;
  localStorageCharacters: number | null;
  sessionStorageCharacters: number | null;
};

export type MemoryDiagnosticsResourceSnapshot = {
  resourceCount: number;
  workerResourceCount: number;
  imageResourceCount: number;
  scriptResourceCount: number;
  totalTransferSize: number | null;
  totalDecodedBodySize: number | null;
  largestResources: Array<{
    name: string;
    initiatorType: string;
    transferSize: number | null;
    decodedBodySize: number | null;
  }>;
};

export type MemoryDiagnosticsProfileSnapshot = {
  loaded: boolean;
  rawCharacters: number;
  skillCount: number | null;
  enabledSkillCount: number | null;
  precisionSkillCount: number | null;
  runeEnabled: boolean | null;
  huntStallEnabled: boolean | null;
  buffExpiryEnabled: boolean | null;
  boosterExpiryEnabled: boolean | null;
  specialCoreEnabled: boolean | null;
  enabledGeneralTimerCount: number | null;
};

export type UserAgentSpecificMemoryBreakdown = {
  bytes: number;
  types?: string[];
  attribution?: Array<{
    scope?: string;
    url?: string;
    container?: {
      id?: string;
      src?: string;
    };
  }>;
};

export type UserAgentSpecificMemorySnapshot =
  | {
      supported: true;
      available: true;
      bytes: number;
      breakdown: UserAgentSpecificMemoryBreakdown[];
      error: null;
    }
  | {
      supported: boolean;
      available: false;
      bytes: null;
      breakdown: [];
      error: string | null;
    };

export type PerformanceMemorySnapshot = {
  supported: boolean;
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
};

export type MemoryDiagnosticsSample = {
  sampledAt: string;
  elapsedMs: number;
  url: string;
  build: MemoryDiagnosticsBuildInfo;
  userAgent: string;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  crossOriginIsolated: boolean;
  performanceMemory: PerformanceMemorySnapshot;
  userAgentSpecificMemory: UserAgentSpecificMemorySnapshot;
  workers: MemoryDiagnosticsWorkerSnapshot;
  dom: MemoryDiagnosticsDomSnapshot;
  resources: MemoryDiagnosticsResourceSnapshot;
  profile: MemoryDiagnosticsProfileSnapshot;
  runtimePerformance: RuntimePerformanceDiagnosticsSnapshot;
};

type MemoryDiagnosticsStore = {
  installed: boolean;
  nativeWorker: typeof Worker | null;
  createdCount: number;
  terminatedCount: number;
  postedMessages: number;
  receivedMessages: number;
  errors: number;
  workers: Map<number, Omit<MemoryDiagnosticsWorkerEntry, "ageMs">>;
  nextWorkerId: number;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown?: UserAgentSpecificMemoryBreakdown[];
  }>;
};

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

const PROFILE_STORAGE_KEY = "maple-hunt-timer.profile.v1";
const DIAGNOSTICS_GLOBAL_KEY = "__MAPLE_TIMER_MEMORY_DIAGNOSTICS__";

declare global {
  interface Window {
    __MAPLE_TIMER_MEMORY_DIAGNOSTICS__?: MemoryDiagnosticsStore;
  }
}

function getLocationUrl(locationLike?: Location | URL): URL | null {
  if (locationLike instanceof URL) {
    return locationLike;
  }

  if (locationLike) {
    return new URL(locationLike.href);
  }

  if (typeof window === "undefined") {
    return null;
  }

  return new URL(window.location.href);
}

export function getMemoryDiagnosticsMode(
  buildInfo: MemoryDiagnosticsBuildInfo,
  locationLike?: Location | URL,
): MemoryDiagnosticsMode {
  if (buildInfo.channel === "production") {
    return "off";
  }

  const url = getLocationUrl(locationLike);
  if (!url) {
    return "off";
  }

  if (url.pathname === "/memory-lab") {
    return "lab";
  }

  if (url.searchParams.get("diag") === "memory") {
    return "panel";
  }

  return "off";
}

function getOrCreateStore(): MemoryDiagnosticsStore {
  if (typeof window === "undefined") {
    throw new Error("memory diagnostics are only available in a browser");
  }

  const existing = window[DIAGNOSTICS_GLOBAL_KEY];
  if (existing) {
    return existing;
  }

  const store: MemoryDiagnosticsStore = {
    installed: false,
    nativeWorker: null,
    createdCount: 0,
    terminatedCount: 0,
    postedMessages: 0,
    receivedMessages: 0,
    errors: 0,
    workers: new Map(),
    nextWorkerId: 1,
  };
  window[DIAGNOSTICS_GLOBAL_KEY] = store;
  return store;
}

function normalizeWorkerOptions(options?: WorkerOptions): WorkerLikeOptions | null {
  if (!options) {
    return null;
  }

  return {
    type: options.type,
    name: options.name,
    credentials: options.credentials,
  };
}

export function getWorkerScriptLabel(scriptUrl: string): string {
  try {
    const url = new URL(scriptUrl, window.location.href);
    const segments = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] ?? scriptUrl);
  } catch {
    const segments = scriptUrl.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? scriptUrl;
  }
}

export function installMemoryDiagnosticsHooks(buildInfo: MemoryDiagnosticsBuildInfo): void {
  const mode = getMemoryDiagnosticsMode(buildInfo);
  if (mode === "off" || typeof window === "undefined" || typeof window.Worker === "undefined") {
    return;
  }

  const store = getOrCreateStore();
  if (store.installed) {
    return;
  }

  const NativeWorker = window.Worker;
  store.nativeWorker = NativeWorker;

  const InstrumentedWorker = new Proxy(NativeWorker, {
    construct(target, args, newTarget) {
      const [scriptUrlArg, optionsArg] = args as [string | URL, WorkerOptions | undefined];
      const worker = Reflect.construct(target, args, newTarget) as Worker;
      const id = store.nextWorkerId++;
      const scriptUrl = String(scriptUrlArg);
      const scriptLabel = getWorkerScriptLabel(scriptUrl);
      const workerKey = `${id}:${scriptLabel}`;
      const createdAtMs = nowMs();
      store.createdCount += 1;
      store.workers.set(id, {
        id,
        scriptUrl,
        scriptLabel,
        createdAtMs,
        terminatedAtMs: null,
        state: "active",
        options: normalizeWorkerOptions(optionsArg),
        postedMessages: 0,
        receivedMessages: 0,
        errors: 0,
      });

      const nativePostMessage = worker.postMessage.bind(worker);
      worker.postMessage = (function postMessageWithDiagnostics(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ) {
        const entry = store.workers.get(id);
        if (entry) {
          entry.postedMessages += 1;
        }
        store.postedMessages += 1;
        observeRuntimeWorkerRequest(workerKey, message);
        if (arguments.length >= 2) {
          nativePostMessage(message, transferOrOptions as StructuredSerializeOptions);
          return;
        }
        nativePostMessage(message);
      }) as Worker["postMessage"];

      const nativeTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        const entry = store.workers.get(id);
        if (entry && entry.state !== "terminated") {
          entry.state = "terminated";
          entry.terminatedAtMs = nowMs();
          store.terminatedCount += 1;
        }
        nativeTerminate();
      };

      worker.addEventListener("message", (event) => {
        const entry = store.workers.get(id);
        if (entry) {
          entry.receivedMessages += 1;
        }
        store.receivedMessages += 1;
        observeRuntimeWorkerResponse(workerKey, scriptLabel, event.data);
      });
      worker.addEventListener("error", () => {
        const entry = store.workers.get(id);
        if (entry) {
          entry.errors += 1;
        }
        store.errors += 1;
      });
      worker.addEventListener("messageerror", () => {
        const entry = store.workers.get(id);
        if (entry) {
          entry.errors += 1;
        }
        store.errors += 1;
      });

      return worker;
    },
  }) as typeof Worker;

  Object.defineProperty(window, "Worker", {
    value: InstrumentedWorker,
    configurable: true,
    writable: true,
  });
  store.installed = true;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function getWorkerDiagnosticsSnapshot(): MemoryDiagnosticsWorkerSnapshot {
  if (typeof window === "undefined" || !window[DIAGNOSTICS_GLOBAL_KEY]) {
    return {
      installed: false,
      activeCount: 0,
      createdCount: 0,
      terminatedCount: 0,
      postedMessages: 0,
      receivedMessages: 0,
      errors: 0,
      workers: [],
    };
  }

  const store = window[DIAGNOSTICS_GLOBAL_KEY];
  const currentMs = nowMs();
  const workers = [...store.workers.values()]
    .map((worker) => ({
      ...worker,
      ageMs: Math.max(0, Math.round(currentMs - worker.createdAtMs)),
    }))
    .sort((a, b) => {
      if (a.state !== b.state) {
        return a.state === "active" ? -1 : 1;
      }
      return b.createdAtMs - a.createdAtMs;
    });

  return {
    installed: store.installed,
    activeCount: workers.filter((worker) => worker.state === "active").length,
    createdCount: store.createdCount,
    terminatedCount: store.terminatedCount,
    postedMessages: store.postedMessages,
    receivedMessages: store.receivedMessages,
    errors: store.errors,
    workers,
  };
}

function sumStorageCharacters(storage: Storage | undefined): number | null {
  if (!storage) {
    return null;
  }

  try {
    let total = 0;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      total += key.length + (storage.getItem(key)?.length ?? 0);
    }
    return total;
  } catch {
    return null;
  }
}

export function collectDomDiagnostics(): MemoryDiagnosticsDomSnapshot {
  if (typeof document === "undefined") {
    return {
      elementCount: 0,
      elementCountsByTag: [],
      canvasCount: 0,
      canvasPixels: 0,
      largestCanvases: [],
      imageCount: 0,
      dataImageCount: 0,
      dataImageCharacters: 0,
      videoCount: 0,
      videos: [],
      iframeCount: 0,
      stylesheetCount: 0,
      localStorageCharacters: null,
      sessionStorageCharacters: null,
    };
  }

  const elements = [...document.querySelectorAll("*")];
  const countsByTag = new Map<string, number>();
  elements.forEach((element) => {
    const tag = element.tagName.toLowerCase();
    countsByTag.set(tag, (countsByTag.get(tag) ?? 0) + 1);
  });

  const canvases = [...document.querySelectorAll("canvas")];
  const canvasEntries = canvases
    .map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      pixels: canvas.width * canvas.height,
    }))
    .sort((a, b) => b.pixels - a.pixels);

  const images = [...document.querySelectorAll("img")];
  const dataImages = images.filter((image) => image.currentSrc.startsWith("data:") || image.src.startsWith("data:"));
  const videos = [...document.querySelectorAll("video")].map((video) => {
    const stream =
      typeof MediaStream !== "undefined" && video.srcObject instanceof MediaStream
        ? video.srcObject
        : null;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      hasSrcObject: Boolean(video.srcObject),
      trackCount: stream?.getTracks().length ?? 0,
    };
  });

  return {
    elementCount: elements.length,
    elementCountsByTag: [...countsByTag.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16),
    canvasCount: canvases.length,
    canvasPixels: canvasEntries.reduce((total, canvas) => total + canvas.pixels, 0),
    largestCanvases: canvasEntries.slice(0, 8),
    imageCount: images.length,
    dataImageCount: dataImages.length,
    dataImageCharacters: dataImages.reduce(
      (total, image) => total + (image.currentSrc || image.src || "").length,
      0,
    ),
    videoCount: videos.length,
    videos: videos.slice(0, 8),
    iframeCount: document.querySelectorAll("iframe").length,
    stylesheetCount: document.styleSheets.length,
    localStorageCharacters: sumStorageCharacters(typeof localStorage === "undefined" ? undefined : localStorage),
    sessionStorageCharacters: sumStorageCharacters(
      typeof sessionStorage === "undefined" ? undefined : sessionStorage,
    ),
  };
}

function normalizeResourceName(name: string): string {
  try {
    const url = new URL(name);
    return `${url.pathname}${url.search}`;
  } catch {
    return name;
  }
}

export function collectResourceDiagnostics(): MemoryDiagnosticsResourceSnapshot {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return {
      resourceCount: 0,
      workerResourceCount: 0,
      imageResourceCount: 0,
      scriptResourceCount: 0,
      totalTransferSize: null,
      totalDecodedBodySize: null,
      largestResources: [],
    };
  }

  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const totalTransferSize = resources.reduce((total, resource) => total + (resource.transferSize || 0), 0);
  const totalDecodedBodySize = resources.reduce((total, resource) => total + (resource.decodedBodySize || 0), 0);
  return {
    resourceCount: resources.length,
    workerResourceCount: resources.filter((resource) => resource.initiatorType === "worker").length,
    imageResourceCount: resources.filter((resource) => resource.initiatorType === "img").length,
    scriptResourceCount: resources.filter((resource) => resource.initiatorType === "script").length,
    totalTransferSize,
    totalDecodedBodySize,
    largestResources: resources
      .map((resource) => ({
        name: normalizeResourceName(resource.name),
        initiatorType: resource.initiatorType,
        transferSize: resource.transferSize || null,
        decodedBodySize: resource.decodedBodySize || null,
      }))
      .sort((a, b) => (b.decodedBodySize ?? 0) - (a.decodedBodySize ?? 0))
      .slice(0, 12),
  };
}

function readJsonProfile(): { raw: string; parsed: Record<string, unknown> } | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { raw, parsed };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countEnabled(items: unknown): number | null {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.filter((item) => !isRecord(item) || item.enabled !== false).length;
}

function getEnabledFlag(value: unknown): boolean | null {
  if (!isRecord(value)) {
    return null;
  }
  return value.enabled === true;
}

export function collectProfileDiagnostics(): MemoryDiagnosticsProfileSnapshot {
  const profile = readJsonProfile();
  if (!profile) {
    return {
      loaded: false,
      rawCharacters: 0,
      skillCount: null,
      enabledSkillCount: null,
      precisionSkillCount: null,
      runeEnabled: null,
      huntStallEnabled: null,
      buffExpiryEnabled: null,
      boosterExpiryEnabled: null,
      specialCoreEnabled: null,
      enabledGeneralTimerCount: null,
    };
  }

  const skills = Array.isArray(profile.parsed.skills) ? profile.parsed.skills : [];
  const precisionSkillCount = skills.filter(
    (skill) => isRecord(skill) && skill.enabled !== false && skill.detectionSource === "buff-duration",
  ).length;

  return {
    loaded: true,
    rawCharacters: profile.raw.length,
    skillCount: skills.length,
    enabledSkillCount: countEnabled(skills),
    precisionSkillCount,
    runeEnabled: getEnabledFlag(profile.parsed.runeAlert),
    huntStallEnabled: getEnabledFlag(profile.parsed.huntStallAlert),
    buffExpiryEnabled: getEnabledFlag(profile.parsed.buffExpiryAlert),
    boosterExpiryEnabled: getEnabledFlag(profile.parsed.boosterExpiryAlert),
    specialCoreEnabled: getEnabledFlag(profile.parsed.specialCoreAlert),
    enabledGeneralTimerCount: countEnabled(profile.parsed.generalTimers),
  };
}

export function collectPerformanceMemory(): PerformanceMemorySnapshot {
  if (typeof performance === "undefined") {
    return {
      supported: false,
      usedJSHeapSize: null,
      totalJSHeapSize: null,
      jsHeapSizeLimit: null,
    };
  }

  const memory = (performance as PerformanceWithMemory).memory;
  return {
    supported: Boolean(memory),
    usedJSHeapSize: memory?.usedJSHeapSize ?? null,
    totalJSHeapSize: memory?.totalJSHeapSize ?? null,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
  };
}

export async function collectUserAgentSpecificMemory(): Promise<UserAgentSpecificMemorySnapshot> {
  if (typeof performance === "undefined") {
    return {
      supported: false,
      available: false,
      bytes: null,
      breakdown: [],
      error: null,
    };
  }

  const measure = (performance as PerformanceWithMemory).measureUserAgentSpecificMemory;
  if (typeof measure !== "function") {
    return {
      supported: false,
      available: false,
      bytes: null,
      breakdown: [],
      error: null,
    };
  }

  try {
    const result = await measure.call(performance);
    return {
      supported: true,
      available: true,
      bytes: result.bytes,
      breakdown: result.breakdown ?? [],
      error: null,
    };
  } catch (error) {
    return {
      supported: true,
      available: false,
      bytes: null,
      breakdown: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function collectMemoryDiagnosticsSample(
  buildInfo: MemoryDiagnosticsBuildInfo,
  startedAtMs: number,
): Promise<MemoryDiagnosticsSample> {
  const navigatorLike = typeof navigator === "undefined" ? null : (navigator as NavigatorWithDeviceMemory);
  return {
    sampledAt: new Date().toISOString(),
    elapsedMs: Math.max(0, Math.round(nowMs() - startedAtMs)),
    url: typeof window === "undefined" ? "" : window.location.href,
    build: buildInfo,
    userAgent: navigatorLike?.userAgent ?? "",
    deviceMemoryGb: navigatorLike?.deviceMemory ?? null,
    hardwareConcurrency: navigatorLike?.hardwareConcurrency ?? null,
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    performanceMemory: collectPerformanceMemory(),
    userAgentSpecificMemory: await collectUserAgentSpecificMemory(),
    workers: getWorkerDiagnosticsSnapshot(),
    dom: collectDomDiagnostics(),
    resources: collectResourceDiagnostics(),
    profile: collectProfileDiagnostics(),
    runtimePerformance: getRuntimePerformanceDiagnosticsSnapshot(),
  };
}

export function downloadMemoryDiagnostics(samples: MemoryDiagnosticsSample[], latest: MemoryDiagnosticsSample | null): void {
  if (typeof document === "undefined") {
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    latest,
    samples,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `maple-timer-memory-diagnostics-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
