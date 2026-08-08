export type BuffSlotCountdownIcon = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BuffSlotCountdownModelStatus = "idle" | "loading" | "ready" | "error";

export type BuffSlotCountdownObservation = {
  kind: "exact" | "not_supported" | "none";
  text: string | null;
  totalSeconds: number | null;
  format: "seconds" | "minutes-seconds" | "unsupported" | "none";
  textRegion: "center" | "bottom-left" | "bottom-right" | "none";
  confidence: number;
  status: "high" | "medium" | "low" | "missing";
  routerTarget: string;
  routerConfidence: number;
  routerStatus: string;
};

export type BuffSlotCountdownNumberRecognizer = {
  getStatus(): BuffSlotCountdownModelStatus;
  preload(): Promise<BuffSlotCountdownModelStatus>;
  recognizeIfReady(icon: BuffSlotCountdownIcon): BuffSlotCountdownObservation | null;
};
