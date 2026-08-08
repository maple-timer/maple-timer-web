import { recordApiUsage } from "./_shared/api-usage-log.js";
import { saveReport } from "./_shared/report-store.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 900 * 1024;
const MAX_MESSAGE_LENGTH = 3000;
const KIND_LABELS = {
  bug: "버그",
  suggestion: "제안",
  other: "기타",
};
const PRECISION_PARSER_DIAGNOSTIC_SCHEMA =
  "maple-timer.precision-parser-diagnostic";
const PRECISION_PARSER_RUNTIME_REPORT_SCHEMA =
  "maple-timer.precision-parser-runtime";
const PRECISION_PARSER_STAGE_ORDER = [
  "analysis-worker",
  "webgpu-api",
  "gpu-adapter",
  "gpu-device",
  "onnx-runtime",
  "model-session",
  "first-inference",
];
const PRECISION_PARSER_STAGE_LABELS = {
  "analysis-worker": "분석 작업 시작",
  "webgpu-api": "브라우저 WebGPU 지원",
  "gpu-adapter": "그래픽 장치 연결",
  "gpu-device": "그래픽 연산 준비",
  "onnx-runtime": "정밀 감지 실행 엔진",
  "model-session": "정밀 감지 모델 준비",
  "first-inference": "실제 모델 분석",
};
const PRECISION_PARSER_STATUS_LABELS = {
  pending: "확인 전",
  checking: "확인 중",
  passed: "통과",
  failed: "실패",
};
const PRECISION_PARSER_FAILURE_LABELS = {
  "webgpu-unavailable": "WebGPU 사용 불가",
  "model-load-failed": "모델 로드 실패",
  "worker-failed": "분석 작업 오류",
  "runtime-failed": "정밀 감지 실행 오류",
};
const PRECISION_PARSER_CHROME_GPU_STATUS_LABELS = {
  "not-checked": "확인하지 못함",
  "not-found": "WebGPU 항목을 찾지 못함",
  "hardware-accelerated": "Hardware accelerated",
  "software-only": "Software only",
  disabled: "Disabled",
};
const PRECISION_PARSER_MAIN_THREAD_ADAPTER_STATUS_LABELS = {
  "not-run": "실행하지 않음",
  "api-unavailable": "메인 화면 WebGPU API 없음",
  available: "메인 화면 어댑터 연결 성공",
  unavailable: "메인 화면 어댑터 연결 실패",
  failed: "메인 화면 재검사 오류",
};
const PRECISION_PARSER_EXECUTION_PROVIDER_LABELS = {
  webgpu: "GPU (WebGPU)",
  wasm: "CPU (WASM)",
  remote: "원격 서버",
};
const PRECISION_PARSER_CPU_FALLBACK_STATUS_LABELS = {
  idle: "CPU 전환 안 함",
  benchmarking: "CPU 속도 측정 중",
  active: "CPU 사용 중",
  rejected: "CPU 성능 부족",
  failed: "CPU 실행 오류",
  overloaded: "CPU 과부하로 중지",
};
const REMOTE_RECOGNITION_CONTROL_PHASE_LABELS = {
  idle: "대기",
  checking: "상태 확인",
  reserving: "권한·자리 확인",
  probing: "실제 화면 분석",
  activating: "세션 준비",
  ready: "연결 준비됨",
  stopping: "연결 해제",
  failed: "실패",
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

function truncate(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isDiscordWebhookUrl(value) {
  return /discord(?:app)?\.com\/api\/webhooks/i.test(String(value ?? ""));
}

function isSlackWebhookUrl(value) {
  return /hooks\.slack\.com\/services\//i.test(String(value ?? ""));
}

function escapeSlackMrkdwn(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slackField(label, value) {
  return {
    type: "mrkdwn",
    text: `*${escapeSlackMrkdwn(label)}*\n${escapeSlackMrkdwn(value ?? "없음")}`,
  };
}

function getFeedbackSlackColor(kind) {
  const colors = {
    bug: "#ef4444",
    suggestion: "#10b981",
    other: "#64748b",
  };
  return colors[kind] ?? colors.other;
}

function normalizeKind(value) {
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, value) ? value : "other";
}

function normalizeAppBuild(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const shortCommit =
    typeof value.shortCommit === "string" && value.shortCommit
      ? value.shortCommit
      : typeof value.commitSha === "string" && value.commitSha
        ? value.commitSha.slice(0, 7)
        : "unknown";

  return {
    name: truncate(value.name || "maple-timer", 80),
    version: truncate(value.version || "unknown", 40),
    commitSha: truncate(value.commitSha || "unknown", 80),
    shortCommit: truncate(shortCommit, 16),
    branch: truncate(value.branch || "unknown", 80),
    deploymentUrl: truncate(value.deploymentUrl || "", 500) || null,
    buildTime: truncate(value.buildTime || "unknown", 80),
    channel: truncate(value.channel || "unknown", 40),
    runtimeOrigin: truncate(value.runtimeOrigin || "", 500) || null,
    runtimeHostname: truncate(value.runtimeHostname || "", 180) || null,
  };
}

function formatAppBuild(value) {
  if (!value) {
    return "없음";
  }

  const branch = value.branch || "unknown";
  const commit = value.shortCommit || "unknown";
  const channel = value.channel || "unknown";
  return `${channel} ${branch}@${commit}`;
}

function makeFeedbackId() {
  const random =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `feedback-${random}`;
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const name = truncate(attachment.name || "attachment.txt", 90).replace(/[^\w.-]/g, "-");
  const type = truncate(attachment.type || "application/octet-stream", 80);
  const dataUrl = typeof attachment.dataUrl === "string" ? attachment.dataUrl : "";
  if (!dataUrl.startsWith("data:") || dataUrl.length > MAX_ATTACHMENT_BYTES * 1.4) {
    return null;
  }

  return { name, type, dataUrl };
}

function normalizeFeedback(body) {
  const message = truncate(body?.message, MAX_MESSAGE_LENGTH);
  if (message.length < 3) {
    return { error: "내용을 3자 이상 입력해주세요." };
  }

  const attachments = Array.isArray(body?.attachments)
    ? body.attachments.map(normalizeAttachment).filter(Boolean).slice(0, MAX_ATTACHMENTS)
    : [];

  return {
    kind: normalizeKind(body?.kind),
    message,
    contact: truncate(body?.contact, 200) || null,
    submittedAt: truncate(body?.submittedAt, 80) || new Date().toISOString(),
    url: truncate(body?.url, 500),
    appBuild: normalizeAppBuild(body?.appBuild),
    diagnostics: body?.diagnostics && typeof body.diagnostics === "object" ? body.diagnostics : {},
    attachments,
  };
}

function buildSummary(feedback) {
  const capture = feedback.diagnostics?.capture ?? {};
  const precisionParserRuntime = getPrecisionParserRuntimeReport(feedback);
  const runeAlertTrigger = getRuneFeedbackAlertTrigger(feedback);
  const lines = [
    "새 Maple Timer 피드백",
    `ID: ${feedback.id}`,
    `유형: ${KIND_LABELS[feedback.kind] ?? KIND_LABELS.other}`,
    `버전: ${formatAppBuild(feedback.appBuild)}`,
    `연락처: ${feedback.contact ?? "없음"}`,
    `주소: ${feedback.url || "알 수 없음"}`,
    `화면 공유: ${capture.hasStream ? "있음" : "없음"}`,
  ];

  if (capture.size?.width && capture.size?.height) {
    lines.push(`캡처 크기: ${capture.size.width}x${capture.size.height}`);
  }
  const gameViewport = formatGameViewportDiagnostics(capture);
  if (gameViewport) {
    lines.push(`게임 영역: ${gameViewport}`);
  }

  if (feedback.attachments.length > 0) {
    lines.push(`첨부: ${feedback.attachments.length}개`);
  }

  if (precisionParserRuntime) {
    lines.push(`정밀 감지 실행: ${formatPrecisionParserRuntime(precisionParserRuntime)}`);
    const benchmark = formatPrecisionParserCpuBenchmark(precisionParserRuntime);
    if (benchmark) {
      lines.push(`CPU 속도 측정: ${benchmark}`);
    }
  }
  if (runeAlertTrigger) {
    lines.push(`룬 최근 알림: ${formatRuneAlertTrigger(runeAlertTrigger)}`);
  }

  lines.push("", feedback.message);

  return truncate(lines.join("\n"), 1900);
}

function dataUrlToBlob(attachment) {
  if (!attachment.dataUrl.startsWith("data:")) {
    return null;
  }

  const commaIndex = attachment.dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const metadata = attachment.dataUrl.slice(5, commaIndex);
  const encodedData = attachment.dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata.split(";").filter(Boolean);
  const mimeType = metadataParts[0]?.includes("/") ? metadataParts[0] : attachment.type;
  const isBase64 = metadataParts.includes("base64");

  let bytes;
  try {
    if (isBase64) {
      const binary = atob(encodedData.replace(/\s/g, ""));
      bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(encodedData));
    }
  } catch {
    return null;
  }

  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return null;
  }

  return new Blob([bytes], { type: mimeType });
}

async function deliverToDiscord(webhookUrl, feedback) {
  const attachments = [...feedback.attachments];

  if (feedback.diagnostics?.settings) {
    attachments.push({
      name: "settings.json",
      type: "application/json",
      dataUrl: `data:application/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(feedback.diagnostics.settings, null, 2),
      )}`,
    });
  }

  const files = attachments
    .slice(0, MAX_ATTACHMENTS)
    .map((attachment) => ({
      attachment,
      blob: dataUrlToBlob(attachment),
    }))
    .filter((file) => file.blob);

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: buildSummary(feedback),
      attachments: files.map(({ attachment }, index) => ({
        id: String(index),
        filename: attachment.name,
      })),
      allowed_mentions: { parse: [] },
    }),
  );

  files.forEach(({ attachment, blob }, index) => {
    form.append(`files[${index}]`, blob, attachment.name);
  });

  const requestUrl = new URL(webhookUrl);
  requestUrl.searchParams.set("wait", "true");

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed with ${response.status}`);
  }

  const message = await response.json().catch(() => null);
  const discordAttachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const verifiedAttachmentCount = await verifyDiscordAttachments(discordAttachments);

  return {
    attachmentCount: discordAttachments.length || files.length,
    verifiedAttachmentCount,
  };
}

function buildSlackFeedbackPayload(feedback) {
  const precisionParserDiagnostic = getPrecisionParserDiagnostic(feedback);
  if (precisionParserDiagnostic) {
    return buildPrecisionParserSlackPayload(feedback, precisionParserDiagnostic);
  }

  const capture = feedback.diagnostics?.capture ?? {};
  const precisionParserRuntime = getPrecisionParserRuntimeReport(feedback);
  const runeAlertTrigger = getRuneFeedbackAlertTrigger(feedback);
  const fields = [
    slackField("ID", feedback.id),
    slackField("유형", KIND_LABELS[feedback.kind] ?? KIND_LABELS.other),
    slackField("버전", formatAppBuild(feedback.appBuild)),
    slackField("연락처", feedback.contact ?? "없음"),
    slackField("주소", feedback.url || "알 수 없음"),
    slackField("화면 공유", capture.hasStream ? "있음" : "없음"),
  ];

  if (capture.size?.width && capture.size?.height) {
    fields.push(slackField("캡처", `${capture.size.width}x${capture.size.height}`));
  }
  const gameViewport = formatGameViewportDiagnostics(capture);
  if (gameViewport) {
    fields.push(slackField("게임 영역", gameViewport));
  }

  fields.push(slackField("첨부", `${feedback.attachments.length}개`));
  if (precisionParserRuntime) {
    fields.push(
      slackField(
        "정밀 감지 실행",
        formatPrecisionParserRuntime(precisionParserRuntime),
      ),
    );
    const benchmark = formatPrecisionParserCpuBenchmark(precisionParserRuntime);
    if (benchmark) {
      fields.push(slackField("CPU 속도 측정", benchmark));
    }
  }

  return {
    text: truncate(
      `새 Maple Timer 피드백: ${KIND_LABELS[feedback.kind] ?? KIND_LABELS.other}`,
      1900,
    ),
    attachments: [
      {
        color: getFeedbackSlackColor(feedback.kind),
        fallback: truncate(
          `새 Maple Timer 피드백: ${KIND_LABELS[feedback.kind] ?? KIND_LABELS.other}`,
          1900,
        ),
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "새 Maple Timer 피드백",
            },
          },
          {
            type: "section",
            fields,
          },
          ...(runeAlertTrigger
            ? [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*룬 최근 알림*\n${escapeSlackMrkdwn(
                      formatRuneAlertTrigger(runeAlertTrigger),
                    )}`,
                  },
                },
              ]
            : []),
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: escapeSlackMrkdwn(truncate(feedback.message, 2800)),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: escapeSlackMrkdwn(
                  feedback.attachments.length > 0
                    ? "첨부 파일은 Maple Timer 제보 저장소에 보관됩니다."
                    : "첨부 파일 없음",
                ),
              },
            ],
          },
        ],
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

function getPrecisionParserDiagnostic(feedback) {
  const value = feedback.diagnostics?.precisionParser;
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== PRECISION_PARSER_DIAGNOSTIC_SCHEMA ||
    value.version !== 1
  ) {
    return null;
  }
  return value;
}

function getPrecisionParserRuntimeReport(feedback) {
  const value = feedback.diagnostics?.precisionParserRuntime;
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== PRECISION_PARSER_RUNTIME_REPORT_SCHEMA ||
    value.version !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      PRECISION_PARSER_EXECUTION_PROVIDER_LABELS,
      value.executionProvider,
    )
  ) {
    return null;
  }
  return value;
}

function getRuneFeedbackAlertTrigger(feedback) {
  const value = feedback.diagnostics?.settings?.runeRuntime?.latestAlertTrigger;
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== "rune-alert-trigger-v1" ||
    !Number.isFinite(Number(value.triggeredAt))
  ) {
    return null;
  }
  return value;
}

function formatRuneAlertTrigger(trigger) {
  const decision = trigger.decision === "repeat" ? "반복" : "최초";
  const frameCount = Number.isFinite(Number(trigger.frameCount))
    ? Math.max(0, Math.round(Number(trigger.frameCount)))
    : 0;
  const detectorVersion = truncate(trigger.detectorVersion || "감지기 미기록", 120);
  const triggeredDate = new Date(Number(trigger.triggeredAt));
  const triggeredAt = Number.isFinite(triggeredDate.getTime())
    ? triggeredDate.toISOString()
    : "시각 미기록";
  return `${decision} · ${frameCount}프레임 · ${detectorVersion} · ${triggeredAt}`;
}

function formatGameViewportDiagnostics(capture) {
  const frameSource = capture?.frameSource;
  const gameViewport = frameSource?.gameViewport;
  if (!frameSource || !gameViewport || typeof gameViewport !== "object") {
    return null;
  }

  const verificationLabel =
    gameViewport.verification === "known-capture"
      ? "알려진 화면 자동 확인"
      : gameViewport.verification === "user-confirmed"
        ? "전체 화면 사용자 확인"
        : gameViewport.verification === "calibrated"
          ? "게임 영역 사용자 설정"
          : gameViewport.verification === "unverified"
            ? "게임 화면 미확인"
            : gameViewport.verification === "stale"
              ? "다시 설정 필요"
              : gameViewport.verification === "unavailable"
                ? "사용 불가"
                : null;
  const stateLabel =
    verificationLabel ??
    (gameViewport.state === "calibrated"
      ? "설정됨"
      : gameViewport.state === "stale"
        ? "다시 설정 필요"
        : gameViewport.state === "legacy-passthrough"
          ? "전체 화면 사용"
          : "상태 미기록");
  const resolution =
    gameViewport.gameResolution?.width && gameViewport.gameResolution?.height
      ? `${gameViewport.gameResolution.width}x${gameViewport.gameResolution.height}`
      : "해상도 미기록";
  const region =
    Number.isFinite(gameViewport.region?.x) &&
    Number.isFinite(gameViewport.region?.y) &&
    Number.isFinite(gameViewport.region?.width) &&
    Number.isFinite(gameViewport.region?.height)
      ? `${gameViewport.region.x},${gameViewport.region.y} ${gameViewport.region.width}x${gameViewport.region.height}`
      : "영역 미기록";

  return `${stateLabel} · ${resolution} · ${region}`;
}

function formatPrecisionParserRuntime(runtime) {
  const provider =
    PRECISION_PARSER_EXECUTION_PROVIDER_LABELS[runtime.executionProvider] ||
    runtime.executionProvider ||
    "기록 없음";
  const fallback =
    PRECISION_PARSER_CPU_FALLBACK_STATUS_LABELS[runtime.cpuFallbackStatus] ||
    runtime.cpuFallbackStatus ||
    "CPU 상태 미기록";
  const remote = runtime.remoteProvider;
  if (!remote || typeof remote !== "object") {
    return `${provider} · ${fallback}`;
  }
  const remoteStatus =
    remote.status === "active"
      ? "원격 활성"
      : remote.status === "failed"
        ? "원격 실패"
        : "원격 비활성";
  const remotePhase =
    REMOTE_RECOGNITION_CONTROL_PHASE_LABELS[remote.controlPhase] ||
    remote.controlPhase ||
    "단계 미기록";
  const failure = remote.failure;
  const failureLabel =
    failure && typeof failure === "object"
      ? ` · ${truncate(failure.phase || "단계 미기록", 60)}/${truncate(failure.code || "코드 미기록", 80)}`
      : "";
  return `${provider} · ${fallback} · ${remoteStatus} (${truncate(remotePhase, 60)})${failureLabel}`;
}

function formatPrecisionParserCpuBenchmark(runtime) {
  const benchmark = runtime.cpuBenchmark;
  if (!benchmark || typeof benchmark !== "object") {
    return null;
  }
  const requestAverageMs = Number(benchmark.requestAverageMs);
  const requestP95Ms = Number(benchmark.requestP95Ms);
  const parserAverageMs = Number(benchmark.parserAverageMs);
  const parserP95Ms = Number(benchmark.parserP95Ms);
  const sampleCount = Number(benchmark.requestSampleCount);
  if (
    !Number.isFinite(requestAverageMs) ||
    !Number.isFinite(requestP95Ms) ||
    !Number.isFinite(parserAverageMs) ||
    !Number.isFinite(parserP95Ms)
  ) {
    return null;
  }
  return [
    `전체 평균 ${Math.round(requestAverageMs)}ms · P95 ${Math.round(requestP95Ms)}ms`,
    `parser 평균 ${Math.round(parserAverageMs)}ms · P95 ${Math.round(parserP95Ms)}ms`,
    Number.isFinite(sampleCount) ? `${Math.max(0, Math.round(sampleCount))}회` : null,
  ].filter(Boolean).join(" · ");
}

function buildPrecisionParserSlackPayload(feedback, diagnostic) {
  const precisionParserRuntime = getPrecisionParserRuntimeReport(feedback);
  const environment =
    diagnostic.environment && typeof diagnostic.environment === "object"
      ? diagnostic.environment
      : {};
  const failedStage =
    typeof diagnostic.failedStage === "string"
      ? diagnostic.failedStage
      : null;
  const userChecks =
    diagnostic.userChecks && typeof diagnostic.userChecks === "object"
      ? diagnostic.userChecks
      : {};
  const mainThreadAdapterProbe =
    environment.mainThreadWebGpuAdapterProbe &&
    typeof environment.mainThreadWebGpuAdapterProbe === "object"
      ? environment.mainThreadWebGpuAdapterProbe
      : {};
  const mainThreadAdapterProbeStatus =
    PRECISION_PARSER_MAIN_THREAD_ADAPTER_STATUS_LABELS[
      mainThreadAdapterProbe.status
    ] || "기록 없음";
  const chromeGpuWebGpuStatus =
    PRECISION_PARSER_CHROME_GPU_STATUS_LABELS[
      userChecks.chromeGpuWebGpuStatus
    ] || "확인하지 않음";
  const fields = [
    slackField("ID", feedback.id),
    slackField("버전", formatAppBuild(feedback.appBuild)),
    slackField("주소", feedback.url || "알 수 없음"),
    slackField("브라우저", truncate(feedback.diagnostics?.userAgent || "없음", 500)),
    slackField("보안 연결", environment.secureContext ? "예" : "아니요"),
    slackField("메인 화면 WebGPU", environment.mainThreadWebGpu ? "있음" : "없음"),
    slackField(
      "분류",
      PRECISION_PARSER_FAILURE_LABELS[diagnostic.failureReason] ||
        diagnostic.failureReason ||
        "알 수 없음",
    ),
    slackField(
      "실패 단계",
      PRECISION_PARSER_STAGE_LABELS[failedStage] || failedStage || "확인되지 않음",
    ),
    slackField("오류 코드", diagnostic.errorCode || "기록 없음"),
  ];
  if (
    userChecks.chromeGpuWebGpuStatus &&
    userChecks.chromeGpuWebGpuStatus !== "not-checked"
  ) {
    fields.splice(
      6,
      0,
      slackField("브라우저 WebGPU (사용자 확인)", chromeGpuWebGpuStatus),
    );
  }

  return {
    text: "새 Maple Timer 정밀 감지 진단",
    attachments: [
      {
        color: getFeedbackSlackColor("bug"),
        fallback: "새 Maple Timer 정밀 감지 진단",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "새 Maple Timer 정밀 감지 진단",
            },
          },
          {
            type: "section",
            fields,
          },
          ...(precisionParserRuntime
            ? [
                {
                  type: "section",
                  fields: [
                    slackField(
                      "정밀 감지 실행",
                      formatPrecisionParserRuntime(precisionParserRuntime),
                    ),
                    ...(formatPrecisionParserCpuBenchmark(precisionParserRuntime)
                      ? [
                          slackField(
                            "CPU 속도 측정",
                            formatPrecisionParserCpuBenchmark(precisionParserRuntime),
                          ),
                        ]
                      : []),
                  ],
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*메인 화면 어댑터 재검사*\n${escapeSlackMrkdwn(
                  mainThreadAdapterProbeStatus,
                )}`,
                mainThreadAdapterProbe.technicalMessage
                  ? escapeSlackMrkdwn(
                      truncate(mainThreadAdapterProbe.technicalMessage, 500),
                    )
                  : null,
                `*기술 오류*\n${escapeSlackMrkdwn(
                  truncate(diagnostic.technicalMessage || "기록 없음", 900),
                )}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: escapeSlackMrkdwn(
                truncate(formatPrecisionParserStageSummary(diagnostic.report), 2800),
              ),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text:
                  "화면, 게임 정보, 사용자 설정은 전송되지 않았습니다. 어댑터 재검사는 자동 측정이고 브라우저 WebGPU 상태는 사용자가 직접 선택한 값입니다.",
              },
            ],
          },
        ],
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}

function formatPrecisionParserStageSummary(report) {
  const steps = report?.steps && typeof report.steps === "object" ? report.steps : {};
  const lines = ["*단계별 결과*"];
  for (const stage of PRECISION_PARSER_STAGE_ORDER) {
    const step = steps[stage] && typeof steps[stage] === "object" ? steps[stage] : {};
    const status = PRECISION_PARSER_STATUS_LABELS[step.status] || step.status || "확인 전";
    lines.push(`• ${PRECISION_PARSER_STAGE_LABELS[stage]}: ${status}`);
    if (step.code) {
      lines.push(`  코드: ${truncate(step.code, 160)}`);
    }
    if (step.details && typeof step.details === "object") {
      for (const [key, value] of Object.entries(step.details).slice(0, 12)) {
        lines.push(`  ${truncate(key, 80)}: ${truncate(value, 240)}`);
      }
    }
  }
  return lines.join("\n");
}

async function deliverToSlack(webhookUrl, feedback) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackFeedbackPayload(feedback)),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed with ${response.status}`);
  }

  return {
    attachmentCount: feedback.attachments.length,
    verifiedAttachmentCount: null,
  };
}

async function verifyDiscordAttachments(attachments) {
  if (attachments.length === 0) {
    return 0;
  }

  const checks = await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment?.url) {
        return false;
      }

      try {
        const response = await fetch(attachment.url, {
          headers: {
            Range: "bytes=0-0",
          },
        });
        return response.ok || response.status === 206;
      } catch {
        return false;
      }
    }),
  );

  return checks.filter(Boolean).length;
}

async function deliverGenericWebhook(webhookUrl, feedback) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: buildSummary(feedback),
      feedback,
    }),
  });

  if (!response.ok) {
    throw new Error(`Feedback webhook failed with ${response.status}`);
  }
}

async function deliverFeedback(webhookUrl, feedback) {
  if (isSlackWebhookUrl(webhookUrl)) {
    const result = await deliverToSlack(webhookUrl, feedback);
    return { channel: "slack", ...result };
  }

  if (isDiscordWebhookUrl(webhookUrl)) {
    const result = await deliverToDiscord(webhookUrl, feedback);
    return { channel: "discord", ...result };
  }

  await deliverGenericWebhook(webhookUrl, feedback);
  return {
    channel: "generic",
    attachmentCount: feedback.attachments.length,
    verifiedAttachmentCount: null,
  };
}

async function saveFeedbackReport(env, feedback) {
  try {
    return await saveReport(env, {
      id: feedback.id,
      source: "feedback",
      kind: feedback.kind,
      status: "unresolved",
      message: feedback.message,
      contact: feedback.contact,
      url: feedback.url,
      createdAt: feedback.submittedAt,
      metadata: {
        attachmentCount: feedback.attachments.length,
        capture: feedback.diagnostics?.capture ?? null,
        userAgent: feedback.diagnostics?.userAgent ?? null,
        appBuild: feedback.appBuild,
        precisionParser: getPrecisionParserDiagnostic(feedback)
          ? {
              schema: feedback.diagnostics.precisionParser.schema,
              version: feedback.diagnostics.precisionParser.version,
              failureReason: feedback.diagnostics.precisionParser.failureReason ?? null,
              failedStage: feedback.diagnostics.precisionParser.failedStage ?? null,
              errorCode: feedback.diagnostics.precisionParser.errorCode ?? null,
              mainThreadAdapterProbeStatus:
                feedback.diagnostics.precisionParser.environment
                  ?.mainThreadWebGpuAdapterProbe?.status ?? null,
            }
          : null,
        precisionParserRuntime: getPrecisionParserRuntimeReport(feedback)
          ? {
              executionProvider:
                feedback.diagnostics.precisionParserRuntime.executionProvider,
              selectionSource:
                feedback.diagnostics.precisionParserRuntime.selectionSource ?? null,
              cpuFallbackStatus:
                feedback.diagnostics.precisionParserRuntime.cpuFallbackStatus ?? null,
              cpuFallbackPhase:
                feedback.diagnostics.precisionParserRuntime.cpuFallbackPhase ?? null,
              cpuBenchmark:
                feedback.diagnostics.precisionParserRuntime.cpuBenchmark ?? null,
              remoteProvider:
                feedback.diagnostics.precisionParserRuntime.remoteProvider ?? null,
            }
          : null,
        runeAlertTrigger: getRuneFeedbackAlertTrigger(feedback)
          ? {
              decision:
                feedback.diagnostics.settings.runeRuntime.latestAlertTrigger
                  .decision ?? null,
              triggeredAt:
                feedback.diagnostics.settings.runeRuntime.latestAlertTrigger
                  .triggeredAt,
              detectorVersion:
                feedback.diagnostics.settings.runeRuntime.latestAlertTrigger
                  .detectorVersion ?? null,
              frameCount:
                feedback.diagnostics.settings.runeRuntime.latestAlertTrigger
                  .frameCount ?? null,
            }
          : null,
      },
      payload: feedback,
      assets: feedback.attachments,
    });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : "feedback report storage failed");
    return { skipped: true, error: "storage failed" };
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestPost({ request, env }) {
  recordApiUsage(request, "/api/feedback");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "피드백 크기가 너무 큽니다." }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const feedback = normalizeFeedback(body);
  if (feedback.error) {
    return json({ error: feedback.error }, { status: 400 });
  }
  feedback.id = makeFeedbackId();

  const storage = await saveFeedbackReport(env, feedback);

  if (!env.FEEDBACK_WEBHOOK_URL) {
    if (!storage.skipped) {
      return json({
        ok: true,
        id: feedback.id,
        deliveredTo: null,
        stored: true,
        attachmentCount: feedback.attachments.length,
        verifiedAttachmentCount: null,
      });
    }

    return json(
      {
        error:
          "수신 채널이 아직 설정되지 않았습니다. Cloudflare 환경변수 FEEDBACK_WEBHOOK_URL을 설정해주세요.",
      },
      { status: 503 },
    );
  }

  try {
    const delivery = await deliverFeedback(env.FEEDBACK_WEBHOOK_URL, feedback);
    return json({
      ok: true,
      id: feedback.id,
      deliveredTo: delivery.channel,
      stored: !storage.skipped,
      attachmentCount: delivery.attachmentCount,
      verifiedAttachmentCount: delivery.verifiedAttachmentCount,
    });
  } catch (error) {
    const notificationError =
      error instanceof Error ? error.message : "피드백 수신 채널로 전달하지 못했습니다.";
    console.warn(notificationError);
    if (!storage.skipped) {
      return json({
        ok: true,
        id: feedback.id,
        deliveredTo: null,
        stored: true,
        notificationError,
        attachmentCount: feedback.attachments.length,
        verifiedAttachmentCount: null,
      });
    }

    return json(
      {
        error: notificationError,
      },
      { status: 502 },
    );
  }
}

export function onRequestGet({ request } = {}) {
  recordApiUsage(request, "/api/feedback");
  return json({ ok: true, endpoint: "feedback" });
}
