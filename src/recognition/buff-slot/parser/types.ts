/** RGBA image buffer returned by the extractor and accepted as normalized icon output. */
export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** Axis-aligned rectangle in source image coordinates. */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Detected buff slot box in source image coordinates before normalized resizing. */
export type BuffIconBox = {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
};

export type BuffSlotParserInputMode =
  | "fullFrame"
  | "topRightQuadrant"
  | "croppedRoi";

/** Options for top-right MapleStory buff icon extraction. */
export type ExtractBuffIconsOptions = {
  /**
   * Input coordinate mode.
   *
   * - `fullFrame`: the image is a full game/screen-share frame; the detector
   *   searches the top-right buff area and keeps the full-frame left guard.
   * - `topRightQuadrant`: the image is the already-cropped top-right quadrant
   *   that the DL parser normally selects from a full frame.
   * - `croppedRoi`: the image/roi is already a generic buff search region; the
   *   detector may trace rows to the left edge of that region.
   *
   * Defaults to `fullFrame`.
   */
  inputMode?: BuffSlotParserInputMode;
  /** Normalized icon output size in pixels. Defaults to 32. */
  outputSize?: number;
  /** Search region override. Defaults to the detected game viewport's top-right quadrant. */
  roi?: Rect;
  /** Include coarse detector candidates and ROI debug data. Slower and intended for tooling only. */
  includeDebug?: boolean;
  /** Minimum buff slot size to scan in source pixels. Usually leave unset. */
  minSlotSize?: number;
  /** Maximum buff slot size to scan in source pixels. Usually leave unset. */
  maxSlotSize?: number;
  /** Maximum number of buff icons returned. Defaults to 96. */
  maxIcons?: number;
  /** Search height as a ratio of source image height. Usually leave unset. */
  topSearchRatio?: number;
  /** Absolute search height cap in source pixels. Usually leave unset. */
  maxSearchHeight?: number;
  /** Detector score cutoff for accepted boxes. Defaults to 190. */
  minBoxScore?: number;
};

/**
 * Extraction result.
 *
 * `icons[index]` is the normalized crop for `boxes[index]`. Results are ordered
 * top-to-bottom and then left-to-right inside each row, matching the review page
 * numbering convention.
 */
export type ExtractBuffIconsResult = {
  icons: RgbaImage[];
  boxes: BuffIconBox[];
  debug?: {
    roi: Rect;
    slotSize?: number;
    pitch?: number;
    candidates: Candidate[];
    supportedCandidates: Candidate[];
  };
};

/** Input image shape. Browser `ImageData` is compatible with this type. */
export type ImageLike = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type Candidate = {
  x: number;
  y: number;
  size: number;
  score: number;
  confidence: number;
  support: number;
};

export type FeatureMaps = {
  width: number;
  height: number;
  edge: Float32Array;
  gradX: Float32Array;
  gradY: Float32Array;
  sat: Float32Array;
  dark: Float32Array;
  bright: Float32Array;
  edgeI: Float32Array;
  gradXI: Float32Array;
  gradYI: Float32Array;
  satI: Float32Array;
  darkI: Float32Array;
  brightI: Float32Array;
};

export type Score = {
  score: number;
  confidence: number;
};

export type GridHint = {
  pitch: number;
  anchor: number;
  size: number;
  verticalPitch?: number;
  verticalAnchor?: number;
};

export type GameViewport = Rect;

export type RowCandidate = {
  x: number;
  y: number;
  size: number;
  count: number;
  score: number;
  cellScores: number[];
};

export type GridRowInfo = {
  row: BuffIconBox[];
  sorted: BuffIconBox[];
  baseSize: number;
  rowY: number;
  rowSize: number;
  maxSlot: number;
  slots: number[];
  snapRatio: number;
};
