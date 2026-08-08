import { Fragment, type ReactNode } from "react";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import type { BuffExpiryAlertConfig } from "../../../types";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { MotionCollapse } from "../../../shared/components/MotionCollapse";
import { useExpandableRowController } from "../shared/useExpandableRowController";
import { BuffExpiryEditorRow } from "./BuffExpiryEditorRow";
import { BuffExpiryPanelHeader } from "./BuffExpiryPanelHeader";
import { BuffExpiryPanelRow } from "./BuffExpiryPanelRow";

export function BuffExpiryPanel({
  config,
  state,
  snapshot,
  precisionEnginePreloadStatus = "idle",
  hasStream,
  isGameViewportReady = true,
  showDebug,
  isGloballyDisabled = false,
  onChange,
  onPreviewSound,
  onSubmitIssueReport,
  isSubmittingIssueReport,
  embedded = false,
  headerAction,
  isSectionCollapsed = false,
}: {
  config: BuffExpiryAlertConfig;
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot | null;
  precisionEnginePreloadStatus?: BuffExpiryPrecisionPreloadStatus;
  hasStream: boolean;
  isGameViewportReady?: boolean;
  showDebug: boolean;
  isGloballyDisabled?: boolean;
  onChange: (patch: Partial<BuffExpiryAlertConfig>) => void;
  onResetDetection: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitIssueReport: () => void;
  isSubmittingIssueReport: boolean;
  embedded?: boolean;
  headerAction?: ReactNode;
  isSectionCollapsed?: boolean;
}) {
  const { isExpanded, toggleExpanded } = useExpandableRowController();
  const editorId = "buff-expiry-alert-editor";
  const isBuffExpiryPanelActive =
    config.enabled && hasStream && isGameViewportReady && !isGloballyDisabled;

  return (
    <section
      className={embedded ? "rune-alert-panel embedded-rune-alert-panel" : "rune-alert-panel"}
    >
      <div className="panel-heading rune-heading">
        <div>
          <BuffExpiryPanelHeader
            isActive={isBuffExpiryPanelActive}
            isEnabled={config.enabled}
          />
        </div>
        {headerAction}
      </div>

      <MotionCollapse
        className="alert-section-body"
        isCollapsed={isSectionCollapsed}
        aria-hidden={isSectionCollapsed}
      >
        <div className="rune-table-wrap">
          <table className="rune-table buff-expiry-table">
            <colgroup>
              <col className="col-buff-enabled" />
              <col className="col-buff-detail" />
              <col className="col-buff-count" />
              <col className="col-buff-threshold" />
              <col className="col-buff-alert-countdown" />
              <col className="col-buff-last-alert" />
              <col className="col-buff-status" />
              <col className="col-buff-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>활성</th>
                <th>상태 설명</th>
                <th>
                  <span className="column-help-label">
                    감지
                    <InfoTooltip
                      id="buff-detected-count-tooltip"
                      label="버프 감지 수 안내"
                      className="column-info-button"
                      iconSize={14}
                      content={
                        <TooltipHelpContent
                          title="우상단에서 인식한 전체 버프 수입니다."
                          items={[
                            "지원 대상이 아닌 버프칸도 감지 수에는 포함될 수 있습니다.",
                          ]}
                        />
                      }
                      width={360}
                      fitContent
                    />
                  </span>
                </th>
                <th>알림 시점</th>
                <th>알림까지</th>
                <th>마지막 알림</th>
                <th>상태</th>
                <th aria-label="버프 종료 알림 조작" />
              </tr>
            </thead>
            <tbody>
              <Fragment>
                <BuffExpiryPanelRow
                  editorId={editorId}
                  config={config}
                  state={state}
                  snapshot={snapshot}
                  precisionEnginePreloadStatus={precisionEnginePreloadStatus}
                  hasStream={hasStream}
                  isGameViewportReady={isGameViewportReady}
                  isExpanded={isExpanded}
                  isGloballyDisabled={isGloballyDisabled}
                  onChange={onChange}
                  onToggleExpanded={toggleExpanded}
                />
                <BuffExpiryEditorRow
                  editorId={editorId}
                  isExpanded={isExpanded}
                  config={config}
                  state={state}
                  snapshot={snapshot}
                  showDebug={showDebug}
                  hasIssueReportPayload={hasStream}
                  isGloballyDisabled={isGloballyDisabled}
                  isSubmittingIssueReport={isSubmittingIssueReport}
                  onChange={onChange}
                  onPreviewSound={onPreviewSound}
                  onSubmitIssueReport={onSubmitIssueReport}
                />
              </Fragment>
            </tbody>
          </table>
        </div>
      </MotionCollapse>
    </section>
  );
}
