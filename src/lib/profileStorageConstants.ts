import { LEGACY_PROFILE_STORAGE_KEY } from "../contracts/persistence/profileStorageContract";
export {
  DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
  MAX_BUFF_EXPIRY_PRECISION_ALERT_LEAD_SECONDS,
  MIN_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
} from "../domain/buff-expiry/alertLeadPolicy";

export const STORAGE_KEY = LEGACY_PROFILE_STORAGE_KEY;
export const DEFAULT_ALERT_THRESHOLD_SECONDS = 10;
export const DEFAULT_HUNT_STALL_THRESHOLD_SECONDS = 7;
export const DEFAULT_HUNT_STALL_COOLDOWN_MISSING_THRESHOLD_SECONDS = 5;
export const MAX_BUFF_EXPIRY_ALERT_LEAD_SECONDS = 30;
export const MIN_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS = 1;
export const MAX_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS = 20;
export const DEFAULT_BOOSTER_EXPIRY_ALERT_LEAD_SECONDS = 10;
export const DEFAULT_ALERT_VOLUME = 1;

export const PREVIOUS_SOL_JANUS_ALERT_SOUND_IDS = new Set([
  "야누스 꺼졌어요 기본",
  "야누스 꺼졌어요. 잔잔",
  "야누스 꺼졌어요. 빨리 다시 설치해주세요 잔잔",
  "야누스 꺼졌어요. 빨리 다시 설치해주세요 신남",
]);
