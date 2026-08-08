import { TextArea } from "@astryxdesign/core/TextArea";
import { Image, MessageCircle, Monitor, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { DiscordBrandIcon } from "../../../shared/components/DiscordBrandIcon";
import { MotionSwitch } from "../../../shared/components/MotionSwitch";
import type { FeedbackKind } from "../../../contracts/reporting/feedback";
import { KIND_LABELS } from "../feedbackPayload";
import { FeedbackKindPicker } from "./FeedbackKindPicker";

export function FeedbackPrimaryFields({
  kind,
  message,
  onKindChange,
  onMessageChange,
}: {
  kind: FeedbackKind;
  message: string;
  onKindChange: (kind: FeedbackKind) => void;
  onMessageChange: (message: string) => void;
}) {
  return (
    <>
      <FeedbackKindPicker value={kind} onChange={onKindChange} />

      <div className="feedback-message-field">
        <span className="feedback-field-meta">
          <span>내용</span>
          <span>{message.length} / 3000</span>
        </span>
        <TextArea
          className="feedback-ghost-control feedback-message-textarea"
          label="내용"
          isLabelHidden
          value={message}
          onChange={(value) => onMessageChange(value.slice(0, 3000))}
          placeholder="문제 상황이나 개선 아이디어를 적어주세요."
          rows={6}
          width="100%"
        />
      </div>

      <p className="feedback-privacy-note">
        이 창으로 보낸 문의에는 개별 답장을 드리지 않아요. 답장이 필요하면
        아래 채널을 이용해주세요.
      </p>

      <div className="feedback-discord-callout">
        <span className="feedback-discord-icon" aria-hidden="true">
          <DiscordBrandIcon size={17} />
        </span>
        <span className="feedback-discord-copy">
          <strong>답장이 필요하면 디스코드로 문의해주세요.</strong>
          <small>운영자와 직접 대화하고 사진·동영상도 보낼 수 있어요.</small>
        </span>
        <a
          className="feedback-discord-link"
          href="https://discord.gg/ACXssjgs9g"
          target="_blank"
          rel="noreferrer"
        >
          디스코드 문의
        </a>
      </div>

      <div className="feedback-kakao-callout">
        <span className="feedback-kakao-icon" aria-hidden="true">
          <MessageCircle size={17} />
        </span>
        <span className="feedback-kakao-copy">
          <strong>휴대폰에서는 카카오톡이 편해요.</strong>
          <small>채팅으로 문의하고 답장도 받을 수 있어요.</small>
        </span>
        <a
          className="feedback-kakao-link"
          href="https://open.kakao.com/o/sjmV5jti"
          target="_blank"
          rel="noreferrer"
        >
          카카오톡 문의
        </a>
      </div>
    </>
  );
}

export function FeedbackDiagnosticsFields({
  includeFullScreenshot,
  includeCropImages,
  includeSettings,
  hasCapture,
  cropImageCount,
  onIncludeFullScreenshotChange,
  onIncludeCropImagesChange,
  onIncludeSettingsChange,
}: {
  includeFullScreenshot: boolean;
  includeCropImages: boolean;
  includeSettings: boolean;
  hasCapture: boolean;
  cropImageCount: number;
  onIncludeFullScreenshotChange: (include: boolean) => void;
  onIncludeCropImagesChange: (include: boolean) => void;
  onIncludeSettingsChange: (include: boolean) => void;
}) {
  return (
    <>
      <section className="feedback-diagnostics" aria-label="추가 진단 자료">
        <div className="feedback-diagnostics-head">
          <strong>추가 진단 자료</strong>
          <span>선택한 항목만 함께 전송됩니다.</span>
        </div>
        <div className="feedback-diagnostic-list">
          <DiagnosticToggle
            checked={includeFullScreenshot}
            description="화면 구성과 위치 문제를 볼 때 도움이 됩니다."
            disabled={!hasCapture}
            icon={<Monitor size={17} />}
            label="전체 공유 화면 첨부"
            onChange={onIncludeFullScreenshotChange}
          />
          <DiagnosticToggle
            checked={includeCropImages}
            description="스킬, 룬, 버프 감지 문제를 확인할 때 사용합니다."
            disabled={cropImageCount === 0}
            icon={<Image size={17} />}
            label="Crop 영역 이미지 첨부"
            onChange={onIncludeCropImagesChange}
          />
          <DiagnosticToggle
            checked={includeSettings}
            description="알림 기준, 볼륨, 선택한 기능 상태를 함께 보냅니다."
            icon={<Settings size={17} />}
            label="현재 설정값 첨부"
            onChange={onIncludeSettingsChange}
          />
        </div>
        <p className="feedback-privacy-note">
          공유 화면이나 Crop 이미지에는 게임 닉네임, 채팅, 화면에 보이는 개인정보가
          포함될 수 있습니다. 필요한 항목만 직접 선택해 주세요.
        </p>
      </section>
    </>
  );
}

export function FeedbackReviewFields({
  kind,
  message,
  includeFullScreenshot,
  includeCropImages,
  includeSettings,
  hasCapture,
  cropImageCount,
}: {
  kind: FeedbackKind;
  message: string;
  includeFullScreenshot: boolean;
  includeCropImages: boolean;
  includeSettings: boolean;
  hasCapture: boolean;
  cropImageCount: number;
}) {
  const diagnosticLabels = [
    includeFullScreenshot && hasCapture ? "전체 공유 화면" : null,
    includeCropImages && cropImageCount > 0 ? `Crop 이미지 ${cropImageCount}개` : null,
    includeSettings ? "현재 설정값" : null,
  ].filter(Boolean);

  return (
    <section className="feedback-review" aria-label="최종 검토">
      <div className="feedback-review-head">
        <strong>최종 검토</strong>
        <span>보낼 내용을 확인한 뒤 전송합니다.</span>
      </div>
      <dl className="feedback-review-list">
        <div className="feedback-review-row">
          <dt>유형</dt>
          <dd>{KIND_LABELS[kind]}</dd>
        </div>
        <div className="feedback-review-row">
          <dt>내용</dt>
          <dd className="feedback-review-message">{message.trim()}</dd>
        </div>
        <div className="feedback-review-row">
          <dt>추가 진단 자료</dt>
          <dd>{diagnosticLabels.length > 0 ? diagnosticLabels.join(" · ") : "없음"}</dd>
        </div>
      </dl>
      <p className="feedback-review-note">수정하려면 이전으로 돌아가 주세요.</p>
    </section>
  );
}

function DiagnosticToggle({
  checked,
  description,
  disabled = false,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={disabled ? "feedback-diagnostic-row disabled" : "feedback-diagnostic-row"}>
      <span className="feedback-diagnostic-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="feedback-diagnostic-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <MotionSwitch
        ariaLabel={label}
        checked={checked}
        className="row-toggle"
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
