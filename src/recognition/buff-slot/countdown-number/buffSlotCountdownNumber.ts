import {
  recognizeCenterRoiOcrV4,
  type CenterRoiOcrV4Result,
} from "./center-roi-ocr-v4.mjs";
import type {
  BuffSlotCountdownIcon,
  BuffSlotCountdownModelStatus,
  BuffSlotCountdownNumberRecognizer,
  BuffSlotCountdownObservation,
} from "./buffSlotCountdownNumberTypes";

const CENTER_ROI_OCR_V4_MODEL_URL = new URL(
  "./center-roi-ocr-v4.model.json",
  import.meta.url,
);

export const BUFF_SLOT_COUNTDOWN_NUMBER_MODEL_VERSION = "center-roi-ocr-v4";

type CountdownModels = {
  centerRoiOcrV4Model: unknown;
};

export function createBuffSlotCountdownNumberRecognizer(): BuffSlotCountdownNumberRecognizer {
  return new LazyBuffSlotCountdownNumberRecognizer();
}

class LazyBuffSlotCountdownNumberRecognizer implements BuffSlotCountdownNumberRecognizer {
  private models: CountdownModels | null = null;
  private modelPromise: Promise<CountdownModels> | null = null;
  private failed = false;

  getStatus(): BuffSlotCountdownModelStatus {
    if (this.models) {
      return "ready";
    }
    if (this.failed) {
      return "error";
    }
    if (this.modelPromise) {
      return "loading";
    }
    return "idle";
  }

  preload(): Promise<BuffSlotCountdownModelStatus> {
    if (this.models) {
      return Promise.resolve("ready");
    }
    if (this.failed) {
      return Promise.resolve("error");
    }
    if (this.modelPromise) {
      return this.waitForModels();
    }
    this.modelPromise = loadModels()
      .then((models) => {
        this.models = models;
        return models;
      })
      .catch((error) => {
        this.failed = true;
        throw error;
      });
    return this.waitForModels();
  }

  recognizeIfReady(icon: BuffSlotCountdownIcon): BuffSlotCountdownObservation | null {
    if (!this.models) {
      void this.preload();
      return null;
    }

    return toCountdownObservation(
      recognizeCenterRoiOcrV4(
        {
          width: icon.width,
          height: icon.height,
          data: icon.data,
        },
        this.models.centerRoiOcrV4Model,
        {
          maxCandidates: 5,
        },
      ),
    );
  }

  private waitForModels(): Promise<BuffSlotCountdownModelStatus> {
    if (!this.modelPromise) {
      return Promise.resolve(this.getStatus());
    }
    return this.modelPromise
      .then(() => "ready" as const)
      .catch(() => "error" as const);
  }
}

async function loadModels(): Promise<CountdownModels> {
  const centerRoiOcrV4Model = await loadJson(CENTER_ROI_OCR_V4_MODEL_URL);
  return { centerRoiOcrV4Model };
}

async function loadJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`버프칸 숫자 인식 모델 로딩 실패: ${response.status}`);
  }
  return response.json();
}

function toCountdownObservation(result: CenterRoiOcrV4Result): BuffSlotCountdownObservation {
  return {
    kind: result.kind,
    text: result.text,
    totalSeconds: result.totalSeconds,
    format: result.format,
    textRegion: result.textRegion,
    confidence: round(result.confidence),
    status: result.status,
    routerTarget: result.route.routeClass,
    routerConfidence: round(result.route.confidence),
    routerStatus: getCenterRoiRouteStatus(result.route.confidence),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getCenterRoiRouteStatus(confidence: number): "high" | "medium" | "low" | "missing" {
  if (confidence >= 0.82) {
    return "high";
  }
  if (confidence >= 0.62) {
    return "medium";
  }
  if (confidence > 0) {
    return "low";
  }
  return "missing";
}
