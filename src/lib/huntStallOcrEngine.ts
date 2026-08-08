import type { HuntStallSnapshot } from "../alertTypes";
import type { HuntStallReading } from "../contracts/recognition/huntStallExperienceRecognition";
import { HuntStallOcrWorkerClient } from "../platform/runtime-workers/hunt-stall-experience/huntStallOcrWorkerClient";
import { readHuntStallReadingFromImageData } from "../recognition/hunt-stall/experience/huntStallExperienceRecognition";
import type {
  HuntStallExperienceProcessInput,
  HuntStallExperienceProcessResult,
} from "../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import { sampleExperienceFromVideo } from "./experienceOcrRegionSampling";
import { imageDataToUrl } from "./imageData";
import {
  buildCropCandidateSnapshots,
  buildPerformanceMetrics,
  buildSourceDetails,
  mergeCandidatePerformance,
  roundMs,
} from "./huntStallOcrDiagnostics";
import {
  captureFullFramePreview,
  prepareWorkerSample,
} from "./huntStallOcrSampling";

type ExperienceVideoSample = {
  imageData: ImageData;
  processedImageData: ImageData;
  reading: HuntStallReading;
  snapshot: HuntStallSnapshot;
};

export type HuntStallOcrEngine = {
  reset: () => void;
  processCrop: (input: HuntStallExperienceProcessInput) => Promise<HuntStallExperienceProcessResult>;
  sample: (
    video: HTMLVideoElement,
    includePreview: boolean,
    includeReportDiagnostics?: boolean,
  ) => Promise<ExperienceVideoSample>;
};

export function createHuntStallOcrEngine(): HuntStallOcrEngine {
  return new FixedYDirectHuntStallOcrEngine();
}

class FixedYDirectHuntStallOcrEngine implements HuntStallOcrEngine {
  private workerClient = new HuntStallOcrWorkerClient();
  private sampleIndex = 0;
  private sourceKey: string | null = null;

  reset(): void {
    this.workerClient.reset();
    this.sampleIndex = 0;
    this.sourceKey = null;
  }

  processCrop(input: HuntStallExperienceProcessInput): Promise<HuntStallExperienceProcessResult> {
    return this.workerClient.process(input);
  }

  async sample(
    video: HTMLVideoElement,
    includePreview: boolean,
    includeReportDiagnostics = false,
  ): Promise<ExperienceVideoSample> {
    const totalStartedAt = performance.now();
    this.resetIfSourceChanged(video.videoWidth, video.videoHeight);
    this.sampleIndex += 1;

    const prepared = prepareWorkerSample(
      video,
      video.videoWidth,
      video.videoHeight,
      this.sampleIndex,
      includePreview,
      includeReportDiagnostics,
    );
    if (!prepared) {
      return withFallbackPerformance(
        sampleExperienceFromVideo(video, includePreview, readHuntStallReadingFromImageData),
        totalStartedAt,
        includeReportDiagnostics,
        video,
      );
    }

    const response = await this.workerClient.process(prepared.request);
    const selected = response.candidates[response.selectedIndex] ?? response.candidates[0];
    const selectedMain = prepared.candidates[response.selectedIndex] ?? prepared.candidates[0];
    if (!selected || !selectedMain) {
      throw new Error("hunt-stall-worker-empty-result");
    }
    const processedImageData = selected.processedImageData ?? selectedMain.imageData;

    const fullFramePreview = captureFullFramePreview(
      video,
      video.videoWidth,
      video.videoHeight,
      includeReportDiagnostics,
    );
    const mergedCandidates = mergeCandidatePerformance(response.candidates, prepared.candidates);
    const performanceMetrics = buildPerformanceMetrics(
      response,
      mergedCandidates[response.selectedIndex] ?? mergedCandidates[0],
      prepared.barFrameReadMs,
      fullFramePreview.ms,
      totalStartedAt,
    );
    const selectedRawPreviewUrl = selectedMain.rawPreviewUrl;
    const selectedProcessedPreviewUrl =
      includePreview || includeReportDiagnostics ? imageDataToUrl(processedImageData) : null;
    const sourceDetails = buildSourceDetails(response, selected);

    return {
      imageData: selectedMain.imageData,
      processedImageData,
      reading: response.reading,
      snapshot: {
        sampledAt: Date.now(),
        rawPreviewUrl: selectedRawPreviewUrl,
        processedPreviewUrl: selectedProcessedPreviewUrl,
        fullFramePreviewUrl: fullFramePreview.url,
        cropCandidates: includeReportDiagnostics
          ? buildCropCandidateSnapshots(mergedCandidates, prepared.candidates, response.selectedIndex)
          : undefined,
        regionLabel: `${selected.regionPixels.x},${selected.regionPixels.y} ${selected.regionPixels.width}x${selected.regionPixels.height}`,
        recognizedText: response.reading.recognizedText,
        debugText: [response.reading.debugText, sourceDetails].filter(Boolean).join(" | "),
        confidence: response.reading.confidence,
        foregroundRatio: response.reading.foregroundRatio,
        changeScore: 0,
        performance: performanceMetrics,
      },
    };
  }

  private resetIfSourceChanged(width: number, height: number): void {
    const nextKey = `${width}x${height}`;
    if (this.sourceKey === nextKey) {
      return;
    }
    this.workerClient.reset();
    this.sampleIndex = 0;
    this.sourceKey = nextKey;
  }
}

function withFallbackPerformance(
  fallback: ExperienceVideoSample,
  totalStartedAt: number,
  includeReportDiagnostics: boolean,
  video: HTMLVideoElement,
): ExperienceVideoSample {
  const fullFramePreview = captureFullFramePreview(
    video,
    video.videoWidth,
    video.videoHeight,
    includeReportDiagnostics,
  );
  return {
    ...fallback,
    snapshot: {
      ...fallback.snapshot,
      fullFramePreviewUrl: fullFramePreview.url,
      cropCandidates: includeReportDiagnostics ? [] : undefined,
      performance: {
        totalMs: roundMs(performance.now() - totalStartedAt),
        barEstimateMs: null,
        candidateCount: 0,
        candidateMs: null,
        selectedCandidateMs: null,
        selectedFrameReadMs: null,
        selectedOcrMs: null,
        selectedPreviewMs: null,
        fullFramePreviewMs: fullFramePreview.ms,
        barFrameReadMs: null,
      },
    },
  };
}
