import { MessageCircle, ShieldCheck } from "lucide-react";
import { DiscordBrandIcon } from "../../shared/components/DiscordBrandIcon";

export function AppFooter({
  onOpenPrivacy,
}: {
  onOpenPrivacy: () => void;
}) {
  return (
    <footer className="app-footer">
      <p>
        Maple Timer는 비공식 보조 도구이며, 사이트 사용으로 인한 게임 이용 결과 및
        손해에 대해 책임지지 않습니다.
      </p>
      <p>
        각 게임과 상표의 권리는 해당 권리자에게 있습니다.
        <span className="footer-credit">에오스@새벽빈차</span>
      </p>
      <nav className="footer-links" aria-label="서비스 안내">
        <button type="button" onClick={onOpenPrivacy}>
          <ShieldCheck size={14} />
          개인정보
        </button>
        <a
          href="https://discord.gg/ACXssjgs9g"
          target="_blank"
          rel="noreferrer"
        >
          <DiscordBrandIcon size={14} tone="currentColor" />
          디스코드
        </a>
        <a
          href="https://open.kakao.com/o/sjmV5jti"
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle size={14} />
          카카오톡
        </a>
      </nav>
    </footer>
  );
}
