/// <reference types="vite/client" />

declare const __APP_BUILD_INFO__: import("./contracts/deployment/appBuildInfo").AppBuildInfo;
declare const __REMOTE_RECOGNITION_V1_TEST_ARM__: boolean;
declare const __REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__: string;
declare const __REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__: string;
declare const __REMOTE_RECOGNITION_V1_SEMANTIC_LAB__: boolean;

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_MAPLE_TIMER_API_BASE_URL?: string;
  readonly VITE_REMOTE_RECOGNITION_CONTROL_ENABLED?: string;
}
