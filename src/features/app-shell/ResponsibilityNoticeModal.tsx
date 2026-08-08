import { FileWarning, MonitorCheck, ShieldAlert } from "lucide-react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

const NOTICE_ITEMS = [
  {
    icon: ShieldAlert,
    title: "비공식 보조 도구",
    body: "Maple Timer는 메이플스토리 공식 서비스가 아니며, 넥슨 또는 게임 운영사의 공식 허가를 받은 도구가 아닙니다.",
  },
  {
    icon: MonitorCheck,
    title: "화면 공유 기반 분석",
    body: "기본 알림은 공유한 화면에서 선택한 영역만 현재 브라우저 안에서 분석합니다. 별도로 동의한 원격 처리 시험은 안내된 게임 화면의 우상단 영역만 전송하며, 게임 클라이언트 파일, 메모리, 패킷, 키보드/마우스 입력에는 접근하지 않습니다.",
  },
  {
    icon: FileWarning,
    title: "사용자 책임",
    body: "사이트 사용으로 발생할 수 있는 계정, 게임 이용, 기타 문제의 책임은 사용자 본인에게 있습니다.",
  },
];

export function ResponsibilityNoticeModal({
  onConfirm,
  onDismissPermanently,
}: {
  onConfirm: () => void;
  onDismissPermanently: () => void;
}) {
  return (
    <MotionDialogFrame
      backdropClassName="onboarding-backdrop"
      dialogClassName="onboarding-dialog responsibility-dialog"
      labelledBy="responsibility-notice-title"
    >
        <header className="onboarding-header responsibility-header">
          <div>
            <p className="eyebrow">Notice</p>
            <h2 id="responsibility-notice-title">사용 전 확인해주세요</h2>
          </div>
        </header>

        <div className="responsibility-summary">
          <strong>본인 책임하에 사용하는 비공식 보조 도구입니다.</strong>
          <p>
            Maple Timer는 기본적으로 화면을 브라우저 안에서 분석하는 보조 도구이며,
            게임 클라이언트나 입력 장치에는 접근하지 않습니다.
          </p>
        </div>

        <ul className="responsibility-list" aria-label="사용 전 확인 사항">
          {NOTICE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title}>
                <span className="responsibility-list-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="responsibility-confirm-text">
          위 내용을 확인했으며, 서비스 사용에 따른 책임이 사용자 본인에게 있음을 이해했습니다.
        </p>

        <div className="onboarding-actions responsibility-actions">
          <a className="secondary-button" href="/privacy">
            자세히 보기
          </a>
          <button className="secondary-button" type="button" onClick={onDismissPermanently}>
            다시 보지 않기
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            확인하고 시작
          </button>
        </div>
    </MotionDialogFrame>
  );
}
