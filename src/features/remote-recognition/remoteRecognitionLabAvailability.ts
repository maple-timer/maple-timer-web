import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";

export function isRemoteRecognitionLabAvailable(_options: {
  buildInfo: AppBuildInfo;
  search: string;
  environmentEnabled: boolean;
}): boolean {
  // The connection panel is visible on every channel without a query flag:
  // a valid invite code is the real gate, and without one the setup dialog
  // cannot admit anyone.
  return true;
}
