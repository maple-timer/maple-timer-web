import { StatusDot } from "@astryxdesign/core/StatusDot";
import { ChevronRight } from "lucide-react";
import type { PipelineStage, PipelineStageStatus } from "./model";

export function PipelineView({
  stages,
  focusedStageId,
  onSelect,
}: {
  stages: PipelineStage[];
  focusedStageId: string | null;
  onSelect(stageId: string): void;
}) {
  return (
    <section className="pipeline-section" aria-labelledby="pipeline-title">
      <header className="section-heading-row">
        <span>
          <strong id="pipeline-title">재현 파이프라인</strong>
          <small>저장된 증거와 실행 기록을 해석해 실제 알림 흐름을 보여줍니다.</small>
        </span>
      </header>
      <ol className="pipeline-list">
        {stages.map((item, index) => (
          <li key={item.id}>
            <button
              className="pipeline-row"
              type="button"
              data-selected={focusedStageId === item.id ? "true" : "false"}
              onClick={() => onSelect(item.id)}
            >
              <span className="pipeline-order">{String(index + 1).padStart(2, "0")}</span>
              <span className="pipeline-status">
                <StatusDot
                  variant={statusDotVariant(item.status)}
                  label={statusLabel(item.status)}
                />
                {statusLabel(item.status)}
              </span>
              <span className="pipeline-copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="pipeline-summary">{item.summary}</span>
              <ChevronRight className="pipeline-chevron" size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function statusDotVariant(status: PipelineStageStatus) {
  if (status === "complete") return "success" as const;
  if (status === "blocked") return "error" as const;
  if (status === "warning") return "warning" as const;
  if (status === "pending") return "accent" as const;
  return "neutral" as const;
}

export function statusLabel(status: PipelineStageStatus) {
  if (status === "complete") return "완료";
  if (status === "blocked") return "중단";
  if (status === "warning") return "확인 필요";
  if (status === "pending") return "대기";
  return "자료 없음";
}
