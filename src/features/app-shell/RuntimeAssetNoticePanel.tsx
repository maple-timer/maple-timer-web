import { RefreshCw, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { runtimeAssetHealthController } from "../../platform/runtime-assets/browserRuntimeAssetHealth";

export function RuntimeAssetNoticePanel() {
  const snapshot = useSyncExternalStore(
    runtimeAssetHealthController.subscribe,
    runtimeAssetHealthController.getSnapshot,
    runtimeAssetHealthController.getSnapshot,
  );

  if (snapshot.status === "current") {
    return null;
  }

  const isRequired = snapshot.status === "update-required";

  return (
    <section
      className="operational-notice-panel runtime-asset-notice-panel"
      aria-label="새 버전 안내"
      aria-live="polite"
    >
      <article className={`operational-notice-card level-${isRequired ? "critical" : "warning"}`}>
        <div className="operational-notice-icon" aria-hidden="true">
          <TriangleAlert size={18} strokeWidth={2.2} />
        </div>
        <div className="operational-notice-content">
          <div className="operational-notice-title-row">
            <strong>{isRequired ? "새 버전 적용 필요" : "새 버전이 준비되었습니다"}</strong>
          </div>
          <p>
            {isRequired
              ? "감지 기능을 계속 사용하려면 새 버전을 적용해주세요."
              : "화면 공유를 다시 시작하기 전에 새 버전을 적용해주세요."}
          </p>
        </div>
        <div className="operational-notice-actions">
          <button
            className="operational-notice-link runtime-asset-refresh-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            새 버전 적용
          </button>
        </div>
      </article>
    </section>
  );
}
