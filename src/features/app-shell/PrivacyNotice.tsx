import { ArrowLeft, CheckCircle2, X } from "lucide-react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

const PRIVACY_SECTIONS = [
  {
    title: "화면 분석",
    items: [
      "기본 알림은 선택한 화면 영역을 현재 브라우저에서만 실시간으로 분석합니다.",
      "원격 처리 시험의 준비 확인에 직접 동의한 경우에만 보정된 게임 화면의 우상단 1/4 영역을 1초 간격으로 5회 Maple Timer API를 거쳐 전용 원격 macOS 서버로 보내며, 일반 프레임은 저장하지 않습니다.",
      "준비 확인 뒤 실사용 원격 처리에 별도로 동의하고 켠 경우에는 정밀 스킬·버프 종료·특수 코어가 사용하는 같은 영역을 1초마다 전송합니다. 서버는 버프 칸 위치와 처리 정보만 반환하며 일반 프레임은 저장하지 않습니다.",
      "실사용 원격 처리를 끄거나 연결에 실패하면 해당 세 기능의 감지 상태를 초기화하고 로컬 처리로 돌아갑니다.",
      "스킬 남은 시간 계산은 현재 브라우저에서 처리되며, OCR 결과 히스토리 로그를 서버에 남기지 않습니다.",
    ],
  },
  {
    title: "설정 저장",
    items: [
      "스킬 목록, 해상도별 Crop 영역, 알람 설정은 현재 기기의 이 브라우저에만 저장됩니다.",
      "로그인 없이 사용되며, 설정은 서버에 저장되지 않고 다른 기기와 공유되지 않습니다.",
      "상단의 설정 초기화를 누르면 이 브라우저에 저장된 설정을 초기화할 수 있습니다.",
    ],
  },
  {
    title: "사용자 알림음",
    items: [
      "직접 업로드한 사용자 알림음 파일은 서버로 전송되지 않고 현재 브라우저의 IndexedDB에만 저장됩니다.",
      "설정 프리셋과 백업 파일에는 사용자 알림음 파일 자체가 포함되지 않으며, 알림음 선택 정보만 저장됩니다.",
      "다른 브라우저나 기기에서 같은 프리셋을 쓰려면 사용자 알림음 파일을 다시 업로드해야 합니다.",
      "사용자 알림음 파일은 문의/피드백이나 제보에 자동으로 첨부되지 않습니다.",
    ],
  },
  {
    title: "문의/피드백과 외부 문의",
    items: [
      "문의/피드백을 보낼 때 입력한 내용과 직접 체크한 첨부 자료만 전송됩니다.",
      "전체 공유 화면이나 Crop 이미지를 첨부하면 게임 닉네임, 채팅 등 화면에 보이는 정보가 포함될 수 있습니다.",
      "문의별 확인을 위해 UUID가 함께 생성됩니다.",
      "Discord 1:1 문의의 대화와 첨부 파일은 Discord에 보관되며 Maple Timer 제보 저장소, Slack 또는 관리자 페이지로 자동 복사되지 않습니다.",
      "카카오톡 문의에는 카카오톡의 개인정보 및 보관 정책이 적용됩니다.",
    ],
  },
  {
    title: "제보 및 디버그 샘플",
    items: [
      "스킬 감지 제보를 직접 보낸 경우에만 해당 스킬 Crop 이미지, 전처리 이미지, 현재 인식값과 계산 상태가 서버에 임시 저장됩니다.",
      "룬 감지 제보를 직접 보낸 경우에만 최근 룬 후보 이미지와 미니맵 Crop 이미지, 감지 상태가 서버에 임시 저장됩니다.",
      "룬 알림 Beta의 디버그 전송을 직접 누른 경우에만 현재 미니맵 Crop 이미지, 감지 마스크, 감지 상태가 서버에 임시 저장됩니다.",
      "제보 및 디버그 샘플은 감지 실패 사례 분석 목적으로만 사용하며, 7일 뒤 자동 만료되도록 저장됩니다.",
      "일반 감시 중에는 제보 및 디버그 샘플이 자동으로 전송되지 않습니다.",
    ],
  },
  {
    title: "방문 통계",
    items: [
      "사이트 운영을 위해 Cloudflare Web Analytics로 페이지뷰, 방문수, 성능 지표 같은 집계 정보를 확인할 수 있습니다.",
      "Google Analytics로 페이지뷰와 화면공유 시작, Crop 선택 완료, 제보 전송 성공 여부 같은 기능 사용 이벤트를 확인할 수 있습니다.",
      "방문 통계는 게임 화면, Crop 이미지, OCR 결과, 경험치 숫자, 사용자 설정 세부값과 연결하지 않습니다.",
      "Cloudflare Web Analytics는 분석 목적으로 쿠키, localStorage, sessionStorage, IndexedDB 같은 브라우저 저장소를 사용하지 않습니다.",
    ],
  },
];

export function PrivacyNoticeContent() {
  return (
    <>
      <section className="privacy-summary">
        <h2>일반 사용 중 화면 자료는 저장하지 않습니다.</h2>
        <p>
          Maple Timer의 기본 알림은 선택한 화면 영역을 현재 브라우저에서 분석합니다.
          문의/피드백 첨부 또는 원격 처리 시험의 준비 확인과 실사용 전송에 사용자가 각각
          직접 동의한 경우를 제외하면, 게임 화면 이미지나 영상은 서버로 전송되거나
          저장되지 않습니다.
        </p>
      </section>

      <div className="privacy-section-list">
        {PRIVACY_SECTIONS.map((section) => (
          <section className="privacy-section" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export function PrivacyNoticePage() {
  return (
    <main className="app-shell privacy-page">
      <header className="app-header privacy-header">
        <div>
          <p className="eyebrow">Privacy</p>
          <h1>개인정보 및 데이터 안내</h1>
        </div>
        <a className="secondary-button header-link" href="/">
          <ArrowLeft size={16} />
          타이머로 돌아가기
        </a>
      </header>

      <PrivacyNoticeContent />
    </main>
  );
}

export function PrivacyNoticeModal({ onClose }: { onClose: () => void }) {
  return (
    <MotionDialogFrame
      backdropClassName="privacy-backdrop"
      dialogClassName="privacy-dialog"
      labelledBy="privacy-modal-title"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="privacy-modal-header">
          <div>
            <p className="eyebrow">Privacy</p>
            <h2 id="privacy-modal-title">개인정보 및 데이터 안내</h2>
          </div>
          <button
            className="icon-button small"
            type="button"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <PrivacyNoticeContent />
    </MotionDialogFrame>
  );
}
