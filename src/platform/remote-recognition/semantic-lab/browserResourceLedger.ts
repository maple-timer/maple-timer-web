export const SEMANTIC_LAB_RESOURCE_KINDS = [
  "reactRoot",
  "mediaTrack",
  "worker",
  "timeout",
  "interval",
  "animationFrame",
  "videoFrameCallback",
  "audioElement",
  "audioContext",
  "objectUrl",
  "fetch",
  "imageBitmap",
  "providerRequest",
  "collector",
] as const;

export type SemanticLabResourceKind =
  (typeof SEMANTIC_LAB_RESOURCE_KINDS)[number];
export type SemanticLabPass = "local" | "remote";

type Scope = {
  id: number;
  pass: SemanticLabPass;
  active: boolean;
  live: Map<SemanticLabResourceKind, Set<unknown>>;
  observed: Map<SemanticLabResourceKind, number>;
};

type NativeBrowserResources = {
  setTimeout(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
  clearTimeout(id?: number): void;
  setInterval(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
  clearInterval(id?: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  requestVideoFrameCallback: typeof HTMLVideoElement.prototype.requestVideoFrameCallback;
  cancelVideoFrameCallback: typeof HTMLVideoElement.prototype.cancelVideoFrameCallback;
  Worker: typeof Worker;
  AudioContext: typeof AudioContext | undefined;
  webkitAudioContext: typeof AudioContext | undefined;
  Audio: typeof Audio;
  createObjectURL: typeof URL.createObjectURL;
  revokeObjectURL: typeof URL.revokeObjectURL;
  fetch: typeof window.fetch;
};

export type SemanticLabResourceSnapshot = Readonly<{
  pass: SemanticLabPass;
  active: boolean;
  live: Readonly<Record<SemanticLabResourceKind, number>>;
  observed: Readonly<Record<SemanticLabResourceKind, number>>;
}>;

export type SemanticLabResourceScope = {
  readonly pass: SemanticLabPass;
  register(kind: SemanticLabResourceKind, resource?: object): () => void;
  registerMediaStream(stream: MediaStream): () => void;
  snapshot(): SemanticLabResourceSnapshot;
  assertObserved(kinds: readonly SemanticLabResourceKind[]): void;
  assertClean(): void;
  end(): void;
};

export type SemanticLabBrowserResourceLedger = {
  begin(pass: SemanticLabPass): SemanticLabResourceScope;
  restore(): void;
};

export function installSemanticLabBrowserResourceLedger(): SemanticLabBrowserResourceLedger {
  const native = captureNativeBrowserResources();
  const scopes = new Map<number, Scope>();
  const timerOwners = new Map<number, { scope: Scope; kind: "timeout" | "interval" }>();
  const animationOwners = new Map<number, Scope>();
  const videoFrameOwners = new WeakMap<
    HTMLVideoElement,
    Map<number, Scope>
  >();
  const workerOwners = new WeakMap<Worker, Scope>();
  const audioContextOwners = new WeakMap<AudioContext, Scope>();
  let activeScope: Scope | null = null;
  let nextScopeId = 1;
  let restored = false;

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler !== "function") {
      throw new Error("semantic-lab-string-timer-forbidden");
    }
    const owner = activeScope;
    let id = 0;
    id = native.setTimeout.call(window, () => {
      const current = timerOwners.get(id);
      if (current) {
        removeLive(current.scope, current.kind, id);
        timerOwners.delete(id);
      }
      handler(...args);
    }, timeout);
    if (owner) {
      addLive(owner, "timeout", id);
      timerOwners.set(id, { scope: owner, kind: "timeout" });
    }
    return id;
  }) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) {
      const owner = timerOwners.get(id);
      if (owner) removeLive(owner.scope, owner.kind, id);
      timerOwners.delete(id);
    }
    native.clearTimeout.call(window, id);
  }) as typeof window.clearTimeout;
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler !== "function") {
      throw new Error("semantic-lab-string-timer-forbidden");
    }
    const owner = activeScope;
    const id = native.setInterval.call(window, () => handler(...args), timeout);
    if (owner) {
      addLive(owner, "interval", id);
      timerOwners.set(id, { scope: owner, kind: "interval" });
    }
    return id;
  }) as unknown as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) {
      const owner = timerOwners.get(id);
      if (owner) removeLive(owner.scope, owner.kind, id);
      timerOwners.delete(id);
    }
    native.clearInterval.call(window, id);
  }) as typeof window.clearInterval;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const owner = activeScope;
    let id = 0;
    id = native.requestAnimationFrame.call(window, (time) => {
      const current = animationOwners.get(id);
      if (current) removeLive(current, "animationFrame", id);
      animationOwners.delete(id);
      callback(time);
    });
    if (owner) {
      addLive(owner, "animationFrame", id);
      animationOwners.set(id, owner);
    }
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    const owner = animationOwners.get(id);
    if (owner) removeLive(owner, "animationFrame", id);
    animationOwners.delete(id);
    native.cancelAnimationFrame.call(window, id);
  }) as typeof window.cancelAnimationFrame;

  HTMLVideoElement.prototype.requestVideoFrameCallback = function (
    callback: VideoFrameRequestCallback,
  ) {
    const owner = activeScope;
    let id = 0;
    id = native.requestVideoFrameCallback.call(this, (now, metadata) => {
      const owners = videoFrameOwners.get(this);
      const current = owners?.get(id);
      if (current) removeLive(current, "videoFrameCallback", id);
      owners?.delete(id);
      callback(now, metadata);
    });
    if (owner) {
      addLive(owner, "videoFrameCallback", id);
      const owners = videoFrameOwners.get(this) ?? new Map<number, Scope>();
      owners.set(id, owner);
      videoFrameOwners.set(this, owners);
    }
    return id;
  };
  HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id: number) {
    const owners = videoFrameOwners.get(this);
    const owner = owners?.get(id);
    if (owner) removeLive(owner, "videoFrameCallback", id);
    owners?.delete(id);
    native.cancelVideoFrameCallback.call(this, id);
  };

  class TrackedWorker extends native.Worker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options);
      const owner = activeScope;
      if (owner) {
        addLive(owner, "worker", this);
        workerOwners.set(this, owner);
      }
    }

    override terminate() {
      const owner = workerOwners.get(this);
      if (owner) removeLive(owner, "worker", this);
      workerOwners.delete(this);
      return super.terminate();
    }
  }
  window.Worker = TrackedWorker as typeof Worker;

  if (native.AudioContext) {
    class TrackedAudioContext extends native.AudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const owner = activeScope;
        if (owner) {
          addLive(owner, "audioContext", this);
          audioContextOwners.set(this, owner);
        }
      }

      override async close() {
        try {
          await super.close();
        } finally {
          const owner = audioContextOwners.get(this);
          if (owner) removeLive(owner, "audioContext", this);
          audioContextOwners.delete(this);
        }
      }
    }
    window.AudioContext = TrackedAudioContext as typeof AudioContext;
    if (native.webkitAudioContext) {
      window.webkitAudioContext = TrackedAudioContext as typeof AudioContext;
    }
  }

  window.Audio = (function (src?: string) {
    const audio = new native.Audio(src);
    const owner = activeScope;
    if (owner) {
      addLive(owner, "audioElement", audio);
      const release = () => removeLive(owner, "audioElement", audio);
      audio.addEventListener("ended", release, { once: true });
      audio.addEventListener("error", release, { once: true });
      const nativePause = audio.pause.bind(audio);
      audio.pause = () => {
        release();
        nativePause();
      };
    }
    return audio;
  }) as unknown as typeof Audio;

  URL.createObjectURL = ((value: Blob | MediaSource) => {
    const url = native.createObjectURL.call(URL, value);
    if (activeScope) addLive(activeScope, "objectUrl", url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    for (const scope of scopes.values()) removeLive(scope, "objectUrl", url);
    native.revokeObjectURL.call(URL, url);
  }) as typeof URL.revokeObjectURL;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const owner = activeScope;
    const request = {};
    if (owner) addLive(owner, "fetch", request);
    return native.fetch.call(window, input, init).finally(() => {
      if (owner) removeLive(owner, "fetch", request);
    });
  }) as typeof window.fetch;

  return Object.freeze({
    begin(pass: SemanticLabPass) {
      if (restored || activeScope) {
        throw new Error("semantic-lab-resource-scope-overlap");
      }
      const scope = createScope(nextScopeId, pass);
      nextScopeId += 1;
      scopes.set(scope.id, scope);
      activeScope = scope;

      const api: SemanticLabResourceScope = {
        pass,
        register(kind, resource = {}) {
          assertActiveScope(scope);
          addLive(scope, kind, resource);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            removeLive(scope, kind, resource);
          };
        },
        registerMediaStream(stream) {
          assertActiveScope(scope);
          const releases = stream.getTracks().map((track) => {
            const release = api.register("mediaTrack", track);
            const nativeStop = track.stop.bind(track);
            track.stop = () => {
              release();
              nativeStop();
            };
            track.addEventListener("ended", release, { once: true });
            return release;
          });
          return () => releases.forEach((release) => release());
        },
        snapshot: () => snapshotScope(scope),
        assertObserved(kinds) {
          for (const kind of kinds) {
            if ((scope.observed.get(kind) ?? 0) < 1) {
              throw new Error(`semantic-lab-resource-not-observed:${kind}`);
            }
          }
        },
        assertClean() {
          const snapshot = snapshotScope(scope);
          const dirty = SEMANTIC_LAB_RESOURCE_KINDS.filter(
            (kind) => snapshot.live[kind] !== 0,
          );
          if (dirty.length > 0) {
            throw new Error(`semantic-lab-resource-leak:${dirty.join(",")}`);
          }
        },
        end() {
          assertActiveScope(scope);
          api.assertClean();
          scope.active = false;
          activeScope = null;
        },
      };
      return Object.freeze(api);
    },
    restore() {
      if (restored) return;
      if (activeScope || [...scopes.values()].some((scope) => scope.active)) {
        throw new Error("semantic-lab-resource-ledger-active");
      }
      for (const scope of scopes.values()) {
        const snapshot = snapshotScope(scope);
        if (SEMANTIC_LAB_RESOURCE_KINDS.some((kind) => snapshot.live[kind] !== 0)) {
          throw new Error("semantic-lab-resource-ledger-dirty");
        }
      }
      restored = true;
      window.setTimeout = native.setTimeout as unknown as typeof window.setTimeout;
      window.clearTimeout = native.clearTimeout as unknown as typeof window.clearTimeout;
      window.setInterval = native.setInterval as unknown as typeof window.setInterval;
      window.clearInterval = native.clearInterval as unknown as typeof window.clearInterval;
      window.requestAnimationFrame = native.requestAnimationFrame;
      window.cancelAnimationFrame = native.cancelAnimationFrame;
      HTMLVideoElement.prototype.requestVideoFrameCallback =
        native.requestVideoFrameCallback;
      HTMLVideoElement.prototype.cancelVideoFrameCallback =
        native.cancelVideoFrameCallback;
      window.Worker = native.Worker;
      if (native.AudioContext) window.AudioContext = native.AudioContext;
      if (native.webkitAudioContext) {
        window.webkitAudioContext = native.webkitAudioContext;
      }
      window.Audio = native.Audio;
      URL.createObjectURL = native.createObjectURL;
      URL.revokeObjectURL = native.revokeObjectURL;
      window.fetch = native.fetch;
    },
  });
}

function captureNativeBrowserResources(): NativeBrowserResources {
  const windowWithWebkit = window as Window &
    typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  if (
    typeof window.Worker !== "function" ||
    typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function" ||
    typeof HTMLVideoElement.prototype.cancelVideoFrameCallback !== "function"
  ) {
    throw new Error("semantic-lab-resource-primitives-unavailable");
  }
  return {
    setTimeout: window.setTimeout as NativeBrowserResources["setTimeout"],
    clearTimeout: window.clearTimeout as NativeBrowserResources["clearTimeout"],
    setInterval: window.setInterval as NativeBrowserResources["setInterval"],
    clearInterval: window.clearInterval as NativeBrowserResources["clearInterval"],
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    requestVideoFrameCallback:
      HTMLVideoElement.prototype.requestVideoFrameCallback,
    cancelVideoFrameCallback:
      HTMLVideoElement.prototype.cancelVideoFrameCallback,
    Worker: window.Worker,
    AudioContext: window.AudioContext,
    webkitAudioContext: windowWithWebkit.webkitAudioContext,
    Audio: window.Audio,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
    fetch: window.fetch,
  };
}

function createScope(id: number, pass: SemanticLabPass): Scope {
  return {
    id,
    pass,
    active: true,
    live: new Map(
      SEMANTIC_LAB_RESOURCE_KINDS.map((kind) => [kind, new Set()]),
    ),
    observed: new Map(SEMANTIC_LAB_RESOURCE_KINDS.map((kind) => [kind, 0])),
  };
}

function addLive(scope: Scope, kind: SemanticLabResourceKind, resource: unknown) {
  const resources = scope.live.get(kind);
  if (!resources || resources.has(resource)) return;
  resources.add(resource);
  scope.observed.set(kind, (scope.observed.get(kind) ?? 0) + 1);
}

function removeLive(
  scope: Scope,
  kind: SemanticLabResourceKind,
  resource: unknown,
) {
  scope.live.get(kind)?.delete(resource);
}

function snapshotScope(scope: Scope): SemanticLabResourceSnapshot {
  return Object.freeze({
    pass: scope.pass,
    active: scope.active,
    live: Object.freeze(
      Object.fromEntries(
        SEMANTIC_LAB_RESOURCE_KINDS.map((kind) => [
          kind,
          scope.live.get(kind)?.size ?? 0,
        ]),
      ) as Record<SemanticLabResourceKind, number>,
    ),
    observed: Object.freeze(
      Object.fromEntries(
        SEMANTIC_LAB_RESOURCE_KINDS.map((kind) => [
          kind,
          scope.observed.get(kind) ?? 0,
        ]),
      ) as Record<SemanticLabResourceKind, number>,
    ),
  });
}

function assertActiveScope(scope: Scope) {
  if (!scope.active) throw new Error("semantic-lab-resource-scope-ended");
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
