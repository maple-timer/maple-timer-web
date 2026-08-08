import type { RuneSnapshot } from "../../alertTypes";
import { sampleVideoRegion } from "../../lib/capture";
import { cropRuneCandidateToUrl, imageDataToUrl } from "../../lib/imageData";
import {
  createRuneMaskPreview,
} from "../../lib/runeDetection";
import type { RuneDetectionResult } from "../../recognition/rune/runeDetectionTypes";
import { createRuneDetectionWorkerClient } from "../../platform/runtime-workers/rune/runeDetectionWorkerClient";
import { getRuneDetectionEvidenceCandidate } from "../../recognition/rune/runeOnnxContract";
import { buildRuneIssueSnapshot } from "../../lib/runeIssueSnapshot";
import type { RelativeRegion } from "../../types";

export type RuneReportFrameSample = {
  sample: ReturnType<typeof sampleVideoRegion>;
  detection: RuneDetectionResult;
  maskPreviewUrl: string | null;
  candidatePreviewUrl: string | null;
};

export type RuneReportDetector = {
  detect: (imageData: ImageData) => Promise<RuneDetectionResult>;
  reset?: () => void;
};

export async function createRuneReportFrameSample(
  video: HTMLVideoElement,
  region: RelativeRegion,
  detector?: RuneReportDetector,
): Promise<RuneReportFrameSample> {
  const sample = sampleVideoRegion(video, region, true, 420);
  const ownsDetector = !detector;
  const activeDetector = detector ?? createRuneDetectionWorkerClient();
  let detection: RuneDetectionResult;
  try {
    detection = await activeDetector.detect(sample.imageData);
  } finally {
    if (ownsDetector) {
      activeDetector.reset?.();
    }
  }
  const evidenceCandidate = getRuneDetectionEvidenceCandidate(detection);
  const maskPreviewUrl = imageDataToUrl(
    createRuneMaskPreview(
      sample.imageData,
      evidenceCandidate ? [evidenceCandidate] : [],
    ),
  );
  const candidatePreviewUrl = cropRuneCandidateToUrl(
    sample.imageData,
    evidenceCandidate,
  );

  return {
    sample,
    detection,
    maskPreviewUrl,
    candidatePreviewUrl,
  };
}

export async function createRuneIssueReportSnapshot({
  existingSnapshot,
  video,
  region,
  issueReason,
  sampledAt = Date.now(),
  detector,
}: {
  existingSnapshot: RuneSnapshot | null;
  video: HTMLVideoElement | null;
  region: RelativeRegion | null;
  issueReason: string;
  sampledAt?: number;
  detector?: RuneReportDetector;
}): Promise<RuneSnapshot | null> {
  if (
    !region ||
    !video ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return existingSnapshot;
  }

  const frame = await createRuneReportFrameSample(video, region, detector);
  return buildRuneIssueSnapshot({
    previousSnapshot: existingSnapshot,
    sample: frame.sample,
    maskPreviewUrl: frame.maskPreviewUrl,
    detection: frame.detection,
    currentCandidatePreviewUrl: frame.candidatePreviewUrl,
    sampledAt,
    issueReason,
  });
}
