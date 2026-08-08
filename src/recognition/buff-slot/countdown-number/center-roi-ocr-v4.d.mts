type CenterRoiOcrV4ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
};

export type CenterRoiOcrV4Route = {
  routeClass: "none" | "s1" | "s2" | "s3" | "m4" | string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type CenterRoiOcrV4Candidate = {
  text: string;
  totalSeconds: number;
  format: "seconds" | "minutes-seconds";
  textRegion: "center";
  score: number;
  confidence: number;
  margin: number;
};

export type CenterRoiOcrV4Result =
  | {
      kind: "exact";
      text: string;
      totalSeconds: number;
      format: "seconds" | "minutes-seconds";
      textRegion: "center";
      confidence: number;
      status: "high" | "medium" | "low";
      candidates: CenterRoiOcrV4Candidate[];
      route: CenterRoiOcrV4Route;
    }
  | {
      kind: "none";
      text: null;
      totalSeconds: null;
      format: "none";
      textRegion: "none" | "center";
      confidence: number;
      status: "missing" | "high" | "medium" | "low";
      bestGuess: CenterRoiOcrV4Candidate | null;
      candidates: CenterRoiOcrV4Candidate[];
      route: CenterRoiOcrV4Route;
    };

export function recognizeCenterRoiOcrV4(
  input: CenterRoiOcrV4ImageDataLike,
  model: unknown,
  options?: Record<string, unknown>,
): CenterRoiOcrV4Result;

export function scoreCenterRoiOcrV4Candidates(
  input: CenterRoiOcrV4ImageDataLike,
  model: unknown,
  options?: Record<string, unknown>,
): CenterRoiOcrV4Candidate[];
