import { RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRuntimeAssetFailure } from "../../platform/runtime-assets/browserRuntimeAssetHealth";

export class RuntimeAssetErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    reportRuntimeAssetFailure({
      source: "render",
      feature: "app-shell",
      code: "app-render-failed",
      message: error.message || "app render failed",
    });
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-shell runtime-asset-fatal-shell">
        <section className="operational-notice-panel" aria-label="화면 불러오기 오류">
          <article className="operational-notice-card level-critical">
            <div className="operational-notice-icon" aria-hidden="true">
              <TriangleAlert size={18} strokeWidth={2.2} />
            </div>
            <div className="operational-notice-content">
              <div className="operational-notice-title-row">
                <strong>화면을 불러오지 못했습니다</strong>
              </div>
              <p>새로고침 후 다시 시도해주세요.</p>
            </div>
            <div className="operational-notice-actions">
              <button
                className="operational-notice-link runtime-asset-refresh-button"
                type="button"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                새로고침
              </button>
            </div>
          </article>
        </section>
      </main>
    );
  }
}
