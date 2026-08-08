import { Camera, Clipboard, Heart, Landmark, Send, Smartphone, X } from "lucide-react";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

const DONATION_STEPS = [
  {
    icon: Camera,
    title: "QR 스캔",
    body: "스마트폰 카메라로 QR을 비춘 뒤, 링크가 뜨면 눌러주세요.",
  },
  {
    icon: Smartphone,
    title: "뱅킹앱 선택",
    body: "AQR 화면에서 사용하는 뱅킹앱을 고르면 계좌번호가 복사됩니다.",
  },
  {
    icon: Landmark,
    title: "은행 확인",
    body: "카카오뱅크로 표시되는지 확인한 뒤, 송금하기를 눌러 은행앱으로 이동해 주세요.",
  },
  {
    icon: Clipboard,
    title: "계좌번호 붙여넣기",
    body: "은행앱에서 붙여넣기 허용을 선택하고 계좌번호 입력란에 붙여넣어 주세요.",
  },
  {
    icon: Send,
    title: "금액 입력 후 이체",
    body: "후원 금액을 입력한 뒤 은행앱 안내에 따라 이체를 완료해 주세요.",
  },
];

export function DonationModal({ onClose }: { onClose: () => void }) {
  return (
    <MotionDialogFrame
      backdropClassName="donation-backdrop"
      dialogClassName="donation-dialog"
      labelledBy="donation-modal-title"
      describedBy="donation-modal-description"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
      <header className="donation-header">
        <div className="donation-title">
          <h2 id="donation-modal-title">Maple Timer 후원</h2>
        </div>
        <p className="donation-title-note">운영과 개선에 큰 힘이 됩니다.</p>
        <button className="icon-button small" type="button" aria-label="닫기" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="donation-main" id="donation-modal-description">
        <section className="donation-hero">
          <p className="donation-qr-title">QR 코드</p>
          <section className="donation-message">
            <span className="donation-icon" aria-hidden="true">
              <Heart size={18} />
            </span>
            <p>
              후원은 선택이며 서비스 이용에는 영향을 주지 않습니다. 보내주신 응원은
              기능 개선과 운영 비용에 사용합니다.
            </p>
          </section>
          <figure className="donation-qr-frame">
            <img src="/donation/aqr-donation.png" alt="Maple Timer 후원 AQR QR 코드" />
            <figcaption>휴대폰 카메라로 QR을 스캔해 주세요.</figcaption>
          </figure>
        </section>

        <div className="donation-info-column">
          <section className="donation-guide" aria-label="후원 방법">
            <p className="donation-guide-title">송금 방법</p>
            <ol className="donation-steps">
              {DONATION_STEPS.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.title}>
                    <span className="donation-step-icon" aria-hidden="true">
                      <Icon size={15} />
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>

      <section className="donation-recognition-note">
        <Heart size={16} aria-hidden="true" />
        <p>
          송금하실 때 <strong>받는 분에게 표기</strong> 항목에{" "}
          <strong>서버와 닉네임</strong>을 적어주시면 감사 인사를 전하는 데 도움이 됩니다.
        </p>
        <button className="primary-button" type="button" onClick={onClose}>
          확인
        </button>
      </section>
    </MotionDialogFrame>
  );
}
