export type AppToastTone = "success" | "info" | "warning" | "error" | "loading";

export type AppToastPresentation = {
  tone: AppToastTone;
  title: string;
  description: string | null;
};

const SUCCESS_PATTERNS = [
  "보냈습니다",
  "저장했습니다",
  "수정했습니다",
  "삭제했습니다",
  "초기화했습니다",
  "적용했습니다",
  "내보냈습니다",
  "불러왔습니다",
  "복구했습니다",
  "비활성화했습니다",
  "변경했습니다",
  "갱신했습니다",
  "추가했습니다",
];

const ERROR_PATTERNS = [
  "실패",
  "저장하지 못했습니다",
  "삭제하지 못했습니다",
  "불러오지 못했습니다",
  "읽지 못했습니다",
  "열지 못했습니다",
  "준비하지 못했습니다",
  "시작하지 못했습니다",
  "만들지 못했습니다",
  "계산하지 못했습니다",
];

const WARNING_PATTERNS = [
  "먼저",
  "선택해야",
  "준비된 뒤",
  "없습니다",
  "찾지 못했습니다",
  "지원하지 않습니다",
  "업로드할 수 있습니다",
];

const LOADING_PATTERNS = ["중입니다", "분석하고 있습니다", "불러오고 있습니다"];

export function getAppToastPresentation(message: string): AppToastPresentation {
  const tone = inferAppToastTone(message);
  const title = getAppToastTitle(message);
  return {
    tone,
    title,
    description: getAppToastDescription(message, title, tone),
  };
}

export function inferAppToastTone(message: string): AppToastTone {
  if (matchesAny(message, SUCCESS_PATTERNS)) {
    return "success";
  }

  if (matchesAny(message, ERROR_PATTERNS)) {
    return "error";
  }

  if (matchesAny(message, WARNING_PATTERNS)) {
    return "warning";
  }

  if (matchesAny(message, LOADING_PATTERNS)) {
    return "loading";
  }

  return "info";
}

function getAppToastTitle(message: string): string {
  const technicalErrorStart = message.search(
    /\.\s+(Failed|The|Cannot|Document|NotAllowedError|AbortError|SecurityError)\b/,
  );

  if (technicalErrorStart > 0) {
    return message.slice(0, technicalErrorStart + 1);
  }

  return message;
}

function getAppToastDescription(
  message: string,
  title: string,
  tone: AppToastTone,
): string | null {
  if (message === "제보를 보냈습니다.") {
    return "문제가 재현되면 이 정보로 확인할 수 있습니다.";
  }

  if (message.includes("화면 공유가 준비된 뒤")) {
    return "게임 화면을 먼저 공유한 다음 다시 시도해주세요.";
  }

  if (message.includes("미니맵 영역을 먼저 선택")) {
    return "룬 알림 제보에는 현재 미니맵 Crop이 필요합니다.";
  }

  if (message.includes("지원하지 않습니다")) {
    return "Chromium 기반 브라우저에서 다시 시도해주세요.";
  }

  if (title !== message && tone === "error") {
    return "브라우저가 요청을 거부했습니다. 다시 시도해주세요.";
  }

  if (tone === "error") {
    return "잠시 후 다시 시도해주세요.";
  }

  return null;
}

function matchesAny(message: string, patterns: string[]): boolean {
  return patterns.some((pattern) => message.includes(pattern));
}
