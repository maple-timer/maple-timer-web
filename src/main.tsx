import React from "react";
import ReactDOM from "react-dom/client";
import { LazyMotion, domAnimation } from "motion/react";
import App from "./App";
import { RuntimeAssetErrorBoundary } from "./features/app-shell/RuntimeAssetErrorBoundary";
import { initAnalytics } from "./lib/analytics";
import { installMemoryDiagnosticsHooks } from "./lib/memoryDiagnostics";
import { installRuntimeAssetHealthMonitoring } from "./platform/runtime-assets/browserRuntimeAssetHealth";
import { applyThemePreference, loadThemePreference } from "./lib/theme";
import "./styles.css";

applyThemePreference(loadThemePreference());
installMemoryDiagnosticsHooks(__APP_BUILD_INFO__);
installRuntimeAssetHealthMonitoring();
initAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LazyMotion features={domAnimation} strict>
      <RuntimeAssetErrorBoundary>
        <App />
      </RuntimeAssetErrorBoundary>
    </LazyMotion>
  </React.StrictMode>,
);
