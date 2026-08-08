import { Activity, ChevronRight } from "lucide-react";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import {
  formatBuffExpiryAlertLeadSeconds,
  getBuffExpiryAlertLeadBounds,
  getBuffExpiryEffectiveAlertLeadSeconds,
} from "../../../domain/buff-expiry/alertLeadPolicy";
import { getBuffExpiryPrecisionAlertClusters } from "../../../domain/buff-expiry/precisionAlertClusters";
import type { BuffExpiryAlertConfig } from "../../../types";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import { FloatingTooltipButton } from "../../../shared/components/FloatingTooltip";
import { CompactAlertThresholdEditor } from "../shared/CompactAlertThresholdEditor";
import {
  AnimatedMetricText,
  CompactMetricCell,
  CountdownSecondsMetric,
  RelativeSecondsMetric,
} from "../../../shared/components/CompactMetricCell";
import { BuffExpiryPrecisionCollapsedTargetPreview } from "./BuffExpiryEditorRow";
import { getBuffExpiryStatusView } from "./buffExpiryUtils";

export function BuffExpiryPanelRow({
  editorId,
  config,
  state,
  snapshot,
  precisionEnginePreloadStatus,
  hasStream,
  isGameViewportReady,
  isExpanded,
  isGloballyDisabled,
  onChange,
  onToggleExpanded,
}: {
  editorId: string;
  config: BuffExpiryAlertConfig;
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot | null;
  precisionEnginePreloadStatus: BuffExpiryPrecisionPreloadStatus;
  hasStream: boolean;
  isGameViewportReady: boolean;
  isExpanded: boolean;
  isGloballyDisabled: boolean;
  onChange: (patch: Partial<BuffExpiryAlertConfig>) => void;
  onToggleExpanded: () => void;
}) {
  const statusView = getBuffExpiryStatusView(
    state,
    hasStream,
    config.enabled,
    isGameViewportReady,
  );
  const precisionEnginePreparation = getBuffExpiryPrecisionEnginePreparation({
    active: config.enabled && hasStream && isGameViewportReady,
    preloadStatus: precisionEnginePreloadStatus,
    state,
  });
  const now = state.lastSampledAt ?? Date.now();
  const latestAlertedAt = getLatestBuffAlertedAt(state);
  const nextAlertDueAt = getNextBuffExpiryAlertDueAt(state, config, now);
  const alertLeadBounds = getBuffExpiryAlertLeadBounds();
  const alertLeadSeconds = getBuffExpiryEffectiveAlertLeadSeconds(config);

  return (
    <tr
      aria-controls={editorId}
      aria-expanded={isExpanded}
      className={[
        "dashboard-row",
        "rune-alert-row",
        !config.enabled ? "is-disabled-row" : "",
        isExpanded ? "expanded-row" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggleExpanded}
      role="button"
      tabIndex={0}
    >
      <td>
        <MotionSwitch
          className="row-toggle hunt-row-toggle"
          checked={config.enabled}
          disabled={isGloballyDisabled}
          label={config.enabled ? "켜짐" : "꺼짐"}
          onClick={(event) => event.stopPropagation()}
          onChange={(checked) => onChange({ enabled: checked })}
        />
      </td>
      <td>
        <CompactMetricCell className="status-detail-metric-cell status-detail-description-cell">
          {precisionEnginePreparation ? (
            <BuffExpiryPrecisionPreparationMetric status={precisionEnginePreparation} />
          ) : !isExpanded ? (
            <BuffExpiryPrecisionCollapsedTargetPreview
              snapshot={snapshot}
              config={config}
              fallback={<span className="status-detail-metric-value">{statusView.detail ?? "--"}</span>}
            />
          ) : (
            <span className="status-detail-metric-value">{statusView.detail ?? "--"}</span>
          )}
        </CompactMetricCell>
      </td>
      <td>
        <CompactMetricCell label="감지 버프" className="buff-expiry-count-cell">
          <AnimatedMetricText value={`${state.boxCount}개`} />
        </CompactMetricCell>
      </td>
      <td>
        <CompactAlertThresholdEditor
          ariaLabel="버프 종료 알림 시점"
          disabled={isGloballyDisabled}
          label="알림 시점"
          max={alertLeadBounds.max}
          min={alertLeadBounds.min}
          rangeHint={`${alertLeadBounds.min}-${alertLeadBounds.max}초`}
          suffix="초 전"
          value={alertLeadSeconds}
          formatDisplayValue={formatBuffExpiryAlertLeadSeconds}
          onCommit={(value) => onChange({ alertLeadSeconds: value })}
        />
      </td>
      <td>
        <CompactMetricCell label="알림까지">
          <CountdownSecondsMetric dueAt={nextAlertDueAt} now={now} />
        </CompactMetricCell>
      </td>
      <td>
        <CompactMetricCell label="마지막 알림">
          <RelativeSecondsMetric timestamp={latestAlertedAt} now={now} />
        </CompactMetricCell>
      </td>
      <td>
        <div className="rune-status-cell">
          <span className={`rune-status-chip hunt-status-chip ${statusView.className}`}>
            <Activity size={15} />
            {statusView.label}
          </span>
        </div>
      </td>
      <td className="row-actions-cell">
        <div className="row-actions">
          <FloatingTooltipButton
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "버프 종료 알림 설정 접기" : "버프 종료 알림 설정 펼치기"}
            className="icon-button small expand-toggle-button"
            type="button"
            tooltip={isExpanded ? "설정 접기" : "설정 펼치기"}
            tooltipId="buff-expiry-row-expand-tooltip"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
          >
            <ChevronRight size={17} />
          </FloatingTooltipButton>
        </div>
      </td>
    </tr>
  );
}

function getLatestBuffAlertedAt(state: BuffExpiryRuntimeState): number | null {
  return [state.lastAlertedAt, ...state.tracks.map((track) => track.alertedAt)].reduce<number | null>(
    (latest, alertedAt) => {
      if (alertedAt === null) {
        return latest;
      }
      return latest === null ? alertedAt : Math.max(latest, alertedAt);
    },
    null,
  );
}

function getNextBuffExpiryAlertDueAt(
  state: BuffExpiryRuntimeState,
  config: BuffExpiryAlertConfig,
  now: number,
): number | null {
  if (!config.enabled) {
    return null;
  }
  const clusters = getBuffExpiryPrecisionAlertClusters({
    tracks: state.tracks,
    alertLeadSeconds: getBuffExpiryEffectiveAlertLeadSeconds(config),
    now,
  });
  return clusters.sort((left, right) => left.dueAt - right.dueAt)[0]?.dueAt ?? null;
}

function getBuffExpiryPrecisionEnginePreparation({
  active,
  preloadStatus,
  state,
}: {
  active: boolean;
  preloadStatus: BuffExpiryPrecisionPreloadStatus;
  state: BuffExpiryRuntimeState;
}): "loading" | "error" | null {
  if (!active) {
    return null;
  }

  if (preloadStatus === "error") {
    return "error";
  }

  const hasActiveSample =
    state.lastSampledAt !== null &&
    state.status !== "paused" &&
    state.status !== "no-stream";
  if (!hasActiveSample && (preloadStatus === "idle" || preloadStatus === "loading")) {
    return "loading";
  }

  return null;
}

function BuffExpiryPrecisionPreparationMetric({ status }: { status: "loading" | "error" }) {
  const isError = status === "error";
  return (
    <span
      className={["buff-expiry-precision-prep-metric", isError ? "error" : ""].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <span
        className={isError ? "buff-expiry-precision-prep-error-dot" : "buff-expiry-precision-prep-spinner"}
        aria-hidden="true"
      />
      <span>{isError ? "정밀 감지 오류" : "정밀 감지 준비 중"}</span>
      {!isError ? (
        <span className="buff-expiry-precision-prep-progress" aria-hidden="true">
          <span />
        </span>
      ) : null}
    </span>
  );
}
