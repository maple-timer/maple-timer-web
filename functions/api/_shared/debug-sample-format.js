export const MAX_NOTIFICATION_LENGTH = 1900;

export const REPORT_KIND_LABELS = {
  "rune-false-positive": "룬 감지 제보",
  "skill-misread": "스킬 감지 제보",
  "rune-issue": "룬 감지 제보",
  "skill-issue": "스킬 감지 제보",
  "hunt-stall-issue": "사냥 멈춤 감지 제보",
  "buff-expiry-issue": "버프 종료 감지 제보",
  "booster-expiry-issue": "부스터 종료 감지 제보",
  "special-core-issue": "특수코어 감지 제보",
  "ultima-raid-equipment-issue": "울티마 스쿼드 장비 감지 제보",
  "ultima-raid-boss-issue": "울티마 스쿼드 보스 감지 제보",
};

export function truncate(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function formatNullable(value) {
  return value === null || value === undefined || value === "" ? "없음" : String(value);
}

export function formatConfidence(value) {
  if (value === null || value === undefined || value === "") {
    return "없음";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "없음";
  }
  return numeric <= 1 ? `${Math.round(numeric * 100)}%` : `${Math.round(numeric)}%`;
}

export function formatSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return "없음";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "없음";
  }
  return `${Math.max(0, Math.round(numeric))}초`;
}

export function formatCount(value) {
  if (value === null || value === undefined || value === "") {
    return "없음";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.max(0, Math.round(numeric))}회` : "없음";
}

export function formatCountRange(min, max) {
  if (min === null || min === undefined || max === null || max === undefined) {
    return "없음";
  }
  const numericMin = Number(min);
  const numericMax = Number(max);
  if (!Number.isFinite(numericMin) || !Number.isFinite(numericMax)) {
    return "없음";
  }
  return `${Math.max(0, Math.round(numericMin))}~${Math.max(0, Math.round(numericMax))}회`;
}

const SKILL_PRESET_LABELS = {
  "erda-fountain": "에르다 파운틴",
  "sol-janus-dawn-2min": "솔 야누스: 새벽 (2분)",
  "sol-janus-dawn-80s": "솔 야누스: 새벽 (80초)",
  "sol-janus-dawn-70s": "솔 야누스: 새벽 (70초)",
  "sol-janus-dawn-1min": "솔 야누스: 새벽 (1분)",
  "sol-janus-dawn-deep-v2": "솔 야누스: 새벽 (정밀)",
  "hologram-graffiti-barrier-vi": "홀로그램 그래피티: 역장 VI",
  "erda-fountain-deep-v2": "에르다 파운틴 (정밀)",
  "maehwa-yein-vi": "매화검 3초식: 예인 VI",
  "class-install": "직업 설치기",
};

const PRECISION_SKILL_PRESETS = new Set([
  "sol-janus-dawn-deep-v2",
  "hologram-graffiti-barrier-vi",
  "erda-fountain-deep-v2",
  "maehwa-yein-vi",
]);

export function formatSkillPreset(config) {
  if (!config || typeof config !== "object") {
    return "없음";
  }

  const presetId = typeof config.presetId === "string" ? config.presetId : "";
  return SKILL_PRESET_LABELS[presetId] ?? config.name ?? presetId ?? "없음";
}

export function formatSkillDetectionSource(config) {
  return config?.detectionSource === "buff-duration" ? "버프칸" : "퀵슬롯";
}

export function isRemainingCountSkill(config, sample) {
  return (
    config?.presetId === "maehwa-yein-vi" ||
    sample?.buffDuration?.remainingCount?.format === "remaining-count"
  );
}

export function formatRemainingCountFlowDecision(value) {
  const labels = {
    "accepted-initial": "초기값 확정",
    "accepted-steady": "동일 횟수 유지",
    "accepted-decrease": "정상 감소",
    "increase-pending": "새 사이클 확인 중",
    "cycle-reset": "새 사이클 확정",
    "implausible-drop": "불가능한 감소 보류",
    "implausible-drop-held": "불가능한 감소 계속 보류",
    "implausible-drop-recovered": "정상 흐름 복구",
    "alert-threshold-pending": "알림 기준 재확인 중",
    "alert-threshold-confirmed": "알림 기준 확정",
    "missing-reading": "판독 없음",
  };
  return typeof value === "string" && value ? labels[value] ?? value : "없음";
}

export function formatSkillDetectionEngine(config, sample) {
  if (!config || typeof config !== "object" || config.detectionSource !== "buff-duration") {
    return null;
  }

  const buffDuration = sample?.buffDuration;
  const matches = Array.isArray(buffDuration?.candidateIcons)
    ? sample.buffDuration.candidateIcons
        .map((candidate) => candidate?.match)
        .filter((match) => match && typeof match === "object")
    : [];
  const topLevelBundle = buffDuration?.bundleId;
  if (buffDuration?.matcherEngine === "skill-bundle-v1" || topLevelBundle) {
    const details = [topLevelBundle, buffDuration?.modelVersion].filter(Boolean);
    return ["정밀 스킬 모델", ...details].join(" · ");
  }
  const bundleMatch = matches.find(
    (match) => match.matcherEngine === "skill-bundle-v1" || match.bundleId,
  );
  if (bundleMatch) {
    const details = [bundleMatch.bundleId, bundleMatch.modelVersion].filter(Boolean);
    return ["정밀 스킬 모델", ...details].join(" · ");
  }
  const deepV2Match = matches.find((match) => match.matcherEngine === "deep-v2");
  if (deepV2Match) {
    const modelVersion = deepV2Match?.modelVersion;
    return modelVersion ? `deep-v2 정밀 모델 · ${modelVersion}` : "deep-v2 정밀 모델";
  }

  if (PRECISION_SKILL_PRESETS.has(config.presetId)) {
    return "정밀 스킬 모델";
  }

  return null;
}

export function formatSkillMatcherDecision(sample) {
  const matches = Array.isArray(sample?.buffDuration?.candidateIcons)
    ? sample.buffDuration.candidateIcons
        .map((candidate) => candidate?.match)
        .filter((match) => match && typeof match === "object")
    : [];
  const reason = sample?.buffDuration?.decisionReason ?? matches[0]?.decisionReason;
  const labels = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    base_target_disabled: "비활성 대상 우선 판정",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
    other_skill_target: "다른 대상 판정",
    matched: "대상 일치",
    "below-threshold": "기준 미달",
  };
  return typeof reason === "string" && reason ? labels[reason] ?? reason : null;
}

export function formatSpecialCoreMatcherDecision(sample) {
  const candidate = Array.isArray(sample?.specialCore?.candidateIcons)
    ? sample.specialCore.candidateIcons[0]
    : null;
  const reason = sample?.result?.debug?.decisionReason ?? candidate?.match?.decisionReason;
  const labels = {
    base_and_positive_gate_passed: "1차 점수와 형태 검증 통과",
    near_exact_positive_prototype_rescue: "고유 형태 일치로 보정 통과",
    below_base_threshold: "1차 점수 기준 미달",
    below_positive_gate_threshold: "형태 검증 기준 미달",
    matched: "구형 모델 일치",
    below_threshold: "구형 모델 점수 기준 미달",
    prototype_gate: "구형 모델 형태 검증 기준 미달",
  };
  return typeof reason === "string" && reason ? labels[reason] ?? reason : null;
}

export function formatSkillCountdownSource(config) {
  if (config?.presetId === "maehwa-yein-vi") {
    return "남은 횟수 기준";
  }
  return config?.countdownSource === "cooldown" ? "쿨타임 기준" : "남은 시간 기준";
}

export function formatSkillReportSettings(config) {
  if (!config || typeof config !== "object") {
    return null;
  }

  const parts = [`${formatSkillDetectionSource(config)} ${formatSkillCountdownSource(config)}`];
  const duration = formatSeconds(config.durationSeconds);
  if (duration !== "없음") {
    parts.push(`지속 ${duration}`);
  }
  if (config.cooldownDurationSeconds !== null && config.cooldownDurationSeconds !== undefined) {
    parts.push(`쿨 ${formatSeconds(config.cooldownDurationSeconds)}`);
  }
  return parts.join(" · ");
}

export function formatSkillClassInstallSettings(config) {
  if (!config || typeof config !== "object" || config.presetId !== "class-install") {
    return null;
  }

  return formatSkillReportSettings(config);
}

export function formatVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "없음";
  }
  return `${Math.round(numeric * 100)}%`;
}

export function formatTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "없음";
  }
  try {
    return new Date(numeric).toISOString();
  } catch {
    return "없음";
  }
}

export function formatStatus(value) {
  const labels = {
    idle: "대기",
    detecting: "감지 대기",
    running: "감시 중",
    alerted: "알림 완료",
    lost: "감지 유실",
    paused: "중지",
    "no-stream": "화면 공유 필요",
    unsupported: "지원 해상도 아님",
    waiting: "감지 대기",
    confirming: "시간 확인 중",
    armed: "알림 대기",
    tracking: "추적 중",
    watching: "시작 대기",
    active: "사냥 중",
    stalled: "멈춤 감지",
    unavailable: "판독 불가",
    cooldown: "쿨타임 진행",
  };

  return labels[value] ?? formatNullable(value);
}

export function formatBuffExpiryStatus(value) {
  const labels = {
    idle: "대기",
    detecting: "감지 대기",
    running: "감시 중",
    alerted: "알림 완료",
    lost: "감지 유실",
    paused: "중지",
    "no-stream": "화면 공유 필요",
    unsupported: "지원 해상도 아님",
    waiting: "카운트다운 대기",
    tracking: "추적 중",
    watching: "시작 대기",
    active: "사냥 중",
    stalled: "멈춤 감지",
    unavailable: "판독 불가",
  };

  return labels[value] ?? formatNullable(value);
}

export function formatAppBuild(value) {
  if (!value || typeof value !== "object") {
    return "없음";
  }

  const shortCommit =
    typeof value.shortCommit === "string" && value.shortCommit
      ? value.shortCommit
      : typeof value.commitSha === "string" && value.commitSha
        ? value.commitSha.slice(0, 7)
        : "unknown";
  const branch =
    typeof value.branch === "string" && value.branch ? value.branch : "unknown";
  const channel =
    typeof value.channel === "string" && value.channel ? value.channel : "unknown";
  return `${channel} ${branch}@${shortCommit}`;
}

export function formatHuntStallMode(value) {
  return value === "cooldown-presence" ? "쿨타임 인식" : "경험치 인식";
}

export function summarizeBuffExpiryPrecisionGroups(groupSummary) {
  if (!Array.isArray(groupSummary) || groupSummary.length === 0) {
    return "없음";
  }

  return groupSummary
    .map((item) => `${item?.label ?? item?.group ?? "알 수 없음"} ${formatNullable(item?.targetCount)}개`)
    .join(" · ");
}

export function summarizeBuffExpiryPrecisionModules(moduleVersions) {
  if (!moduleVersions || typeof moduleVersions !== "object") {
    return "없음";
  }

  const base = ["parser", "matcher", "matcherModel", "countdown", "runtime"]
    .flatMap((key) => {
      const value = moduleVersions[key];
      return value === null || value === undefined || value === ""
        ? []
        : [`${key}:${value}`];
    })
    .slice(0, 4);
  const bundles = Array.isArray(moduleVersions.matcherBundles)
    ? moduleVersions.matcherBundles.slice(0, 4).map((bundle) => {
        const group = bundle?.group ?? "group";
        const bundleId = bundle?.bundleId ?? "bundle";
        const modelVersion = bundle?.modelVersion ?? "unknown";
        return `${group}:${bundleId}@${modelVersion}`;
      })
    : [];
  return [...base, ...bundles].join(" · ") || "없음";
}
