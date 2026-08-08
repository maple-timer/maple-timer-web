export type RuneCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelCount: number;
  confidence: number;
  heuristicConfidence?: number;
  cnnScore?: number;
  source?: RuneCandidateSource;
};

export type RuneDetectionResult = {
  detected: boolean;
  confidence: number;
  candidates: RuneCandidate[];
  debug: {
    purplePixelRatio?: number;
    componentCount?: number;
    proposalCount?: number;
    classifier?: string;
    detectorKind?: "legacy-candidate-cnn" | "onnx-full-frame" | "onnx-cascade";
    proposalScore?: number;
    selectedProposalRank?: number;
    shapeScore?: number;
    shapeThreshold?: number;
    shapePass?: boolean;
    appearanceScore?: number;
    appearanceThreshold?: number;
    appearancePass?: boolean;
    modelScore?: number;
    modelThreshold?: number;
    modelCandidate?: RuneCandidate;
    proposalInferenceMs?: number;
    gateInferenceMs?: number;
    inferenceMs?: number;
    reason?: string;
  };
};

export type RuneCandidateSource =
  | "component"
  | "line-rescue"
  | "tall-attached"
  | "diamond-scan"
  | "raw-purple-component"
  | "onnx-full-frame"
  | "onnx-cascade";

export type RuneComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  rows: Map<number, { minX: number; maxX: number; count: number }>;
};
