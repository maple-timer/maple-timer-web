import { isCustomAlertSoundId } from "./customSoundIds";

export type AlertSound = {
  id: string;
  label: string;
  src: string;
  fallbackSrc?: string;
  randomSoundIds?: string[];
};

export const ADAM_RUNE_SOUND_ID = "떳어요 룬 떳어요";
export const ADAM_SOL_JANUS_SOUND_IDS = [
  "야누스 곧 꺼져요",
  "야누스 꺼져가요",
  "야누스 꺼질것 같애요",
] as const;
export const ADAM_ERDA_FOUNTAIN_SOUND_IDS = [
  "파운틴 곧 꺼져요",
  "파운틴 꺼져가요",
  "파운틴 꺼질것 같애요",
] as const;
export const ADAM_HUNT_STALL_SOUND_IDS = [
  "사냥 멈춘것 같애요 1",
  "사냥 멈춘것 같애요 2",
  "사냥 멈춘것 같애요 3",
] as const;
export const ADAM_BUFF_EXPIRY_SOUND_ID = "아담 버프 끝난것 같애요";
export const ADAM_BOOSTER_EXPIRY_SOUND_ID = "아담 부스터 끝나가요";
export const ADAM_RECALL_SOUND_ID = "아담 회수하세요";

export const FEMALE_RUNE_SOUND_ID = "여성 룬 떳어요";
export const FEMALE_SOL_JANUS_SOUND_IDS = [
  "여성 야누스 곧 꺼져요",
  "여성 야누스 꺼져가요",
  "여성 야누스 꺼질것 같애요",
] as const;
export const FEMALE_ERDA_FOUNTAIN_SOUND_IDS = [
  "여성 파운틴 곧 꺼져요",
  "여성 파운틴 꺼져가요",
  "여성 파운틴 꺼질것 같애요",
] as const;
export const FEMALE_HUNT_STALL_SOUND_IDS = [
  "여성 사냥 멈춘것 같아요 1",
  "여성 사냥 멈춘것 같아요 2",
  "여성 사냥 멈춘것 같아요 3",
] as const;
export const FEMALE_BOOSTER_EXPIRY_SOUND_ID = "여성 부스터 끝나가요";
export const FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID = "여성 카운트다운";
export const FEMALE2_RUNE_SOUND_ID = "여성2 룬 떳어요";
export const FEMALE2_SOL_JANUS_SOUND_ID = "여성2 야누스 꺼져가요";
export const FEMALE2_ERDA_FOUNTAIN_SOUND_ID = "여성2 파운틴 꺼져가요";
export const FEMALE2_HUNT_STALL_SOUND_ID = "여성2 사냥 멈춘것 같애요";
export const FEMALE2_BUFF_EXPIRY_SOUND_ID = "여성2 버프 끝난것 같애요";

export const ADAM_SOL_JANUS_RANDOM_SOUND_ID = "야누스 랜덤";
export const ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID = "파운틴 랜덤";
export const ADAM_HUNT_STALL_RANDOM_SOUND_ID = "사냥 멈춤 랜덤";
export const FEMALE_SOL_JANUS_RANDOM_SOUND_ID = "여성 야누스 랜덤";
export const FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID = "여성 파운틴 랜덤";
export const FEMALE_HUNT_STALL_RANDOM_SOUND_ID = "여성 사냥 멈춤 랜덤";

const CONTEXT_SOUND_IDS = new Set<string>([
  ADAM_RUNE_SOUND_ID,
  ADAM_SOL_JANUS_RANDOM_SOUND_ID,
  ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
  ADAM_HUNT_STALL_RANDOM_SOUND_ID,
  ADAM_BUFF_EXPIRY_SOUND_ID,
  ADAM_BOOSTER_EXPIRY_SOUND_ID,
  ...ADAM_SOL_JANUS_SOUND_IDS,
  ...ADAM_ERDA_FOUNTAIN_SOUND_IDS,
  ...ADAM_HUNT_STALL_SOUND_IDS,
  FEMALE_RUNE_SOUND_ID,
  FEMALE_SOL_JANUS_RANDOM_SOUND_ID,
  FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
  FEMALE_HUNT_STALL_RANDOM_SOUND_ID,
  ...FEMALE_SOL_JANUS_SOUND_IDS,
  ...FEMALE_ERDA_FOUNTAIN_SOUND_IDS,
  ...FEMALE_HUNT_STALL_SOUND_IDS,
  FEMALE_BOOSTER_EXPIRY_SOUND_ID,
  FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID,
  FEMALE2_RUNE_SOUND_ID,
  FEMALE2_SOL_JANUS_SOUND_ID,
  FEMALE2_ERDA_FOUNTAIN_SOUND_ID,
  FEMALE2_HUNT_STALL_SOUND_ID,
  FEMALE2_BUFF_EXPIRY_SOUND_ID,
]);

export const ALERT_SOUNDS: AlertSound[] = [
  {
    id: ADAM_RUNE_SOUND_ID,
    label: "[아담] 떳어요 룬 떳어요",
    src: "/sounds/떳어요 룬 떳어요.m4a",
  },
  {
    id: ADAM_SOL_JANUS_RANDOM_SOUND_ID,
    label: "[아담] 야누스 랜덤",
    src: "",
    randomSoundIds: [...ADAM_SOL_JANUS_SOUND_IDS],
  },
  {
    id: "야누스 곧 꺼져요",
    label: "[아담] 야누스 곧 꺼져요",
    src: "/sounds/야누스 곧 꺼져요.m4a",
  },
  {
    id: "야누스 꺼져가요",
    label: "[아담] 야누스 꺼져가요",
    src: "/sounds/야누스 꺼져가요.m4a",
  },
  {
    id: "야누스 꺼질것 같애요",
    label: "[아담] 야누스 꺼질것 같애요",
    src: "/sounds/야누스 꺼질것 같애요.m4a",
  },
  {
    id: ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
    label: "[아담] 파운틴 랜덤",
    src: "",
    randomSoundIds: [...ADAM_ERDA_FOUNTAIN_SOUND_IDS],
  },
  {
    id: "파운틴 곧 꺼져요",
    label: "[아담] 파운틴 곧 꺼져요",
    src: "/sounds/파운틴 곧 꺼져요.m4a",
  },
  {
    id: "파운틴 꺼져가요",
    label: "[아담] 파운틴 꺼져가요",
    src: "/sounds/파운틴 꺼져가요.m4a",
  },
  {
    id: "파운틴 꺼질것 같애요",
    label: "[아담] 파운틴 꺼질것 같애요",
    src: "/sounds/파운틴 꺼질것 같애요.m4a",
  },
  {
    id: ADAM_HUNT_STALL_RANDOM_SOUND_ID,
    label: "[아담] 사냥 멈춤 랜덤",
    src: "",
    randomSoundIds: [...ADAM_HUNT_STALL_SOUND_IDS],
  },
  {
    id: "사냥 멈춘것 같애요 1",
    label: "[아담] 사냥 멈춘것 같애요 1",
    src: "/sounds/hunt-stall-adam-1.m4a",
  },
  {
    id: "사냥 멈춘것 같애요 2",
    label: "[아담] 사냥 멈춘것 같애요 2",
    src: "/sounds/hunt-stall-adam-2.m4a",
  },
  {
    id: "사냥 멈춘것 같애요 3",
    label: "[아담] 사냥 멈춘것 같애요 3",
    src: "/sounds/hunt-stall-adam-3.m4a",
  },
  {
    id: ADAM_BUFF_EXPIRY_SOUND_ID,
    label: "[아담] 버프 끝난것 같애요",
    src: "/sounds/adam-buff-expiry.m4a",
    fallbackSrc: "/sounds/adam-buff-expiry.mp3",
  },
  {
    id: ADAM_BOOSTER_EXPIRY_SOUND_ID,
    label: "[아담] 부스터 끝나가요",
    src: "/sounds/adam-booster-expiry.m4a",
    fallbackSrc: "/sounds/adam-booster-expiry.mp3",
  },
  {
    id: ADAM_RECALL_SOUND_ID,
    label: "[아담] 회수하세요",
    src: "/sounds/adam-recall.m4a",
    fallbackSrc: "/sounds/adam-recall.mp3",
  },
  {
    id: FEMALE_RUNE_SOUND_ID,
    label: "[여성] 룬 떳어요",
    src: "/sounds/female-rune.m4a",
  },
  {
    id: FEMALE_SOL_JANUS_RANDOM_SOUND_ID,
    label: "[여성] 야누스 랜덤",
    src: "",
    randomSoundIds: [...FEMALE_SOL_JANUS_SOUND_IDS],
  },
  {
    id: "여성 야누스 곧 꺼져요",
    label: "[여성] 야누스 곧 꺼져요",
    src: "/sounds/female-sol-janus-soon.m4a",
  },
  {
    id: "여성 야누스 꺼져가요",
    label: "[여성] 야누스 꺼져가요",
    src: "/sounds/female-sol-janus-fading.m4a",
  },
  {
    id: "여성 야누스 꺼질것 같애요",
    label: "[여성] 야누스 꺼질것 같애요",
    src: "/sounds/female-sol-janus-about-out.m4a",
  },
  {
    id: FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
    label: "[여성] 파운틴 랜덤",
    src: "",
    randomSoundIds: [...FEMALE_ERDA_FOUNTAIN_SOUND_IDS],
  },
  {
    id: "여성 파운틴 곧 꺼져요",
    label: "[여성] 파운틴 곧 꺼져요",
    src: "/sounds/female-erda-fountain-soon.m4a",
  },
  {
    id: "여성 파운틴 꺼져가요",
    label: "[여성] 파운틴 꺼져가요",
    src: "/sounds/female-erda-fountain-fading.m4a",
  },
  {
    id: "여성 파운틴 꺼질것 같애요",
    label: "[여성] 파운틴 꺼질것 같애요",
    src: "/sounds/female-erda-fountain-about-out.m4a",
  },
  {
    id: FEMALE_HUNT_STALL_RANDOM_SOUND_ID,
    label: "[여성] 사냥 멈춤 랜덤",
    src: "",
    randomSoundIds: [...FEMALE_HUNT_STALL_SOUND_IDS],
  },
  {
    id: "여성 사냥 멈춘것 같아요 1",
    label: "[여성] 사냥 멈춘것 같아요 1",
    src: "/sounds/female-hunt-stall-1.m4a",
  },
  {
    id: "여성 사냥 멈춘것 같아요 2",
    label: "[여성] 사냥 멈춘것 같아요 2",
    src: "/sounds/female-hunt-stall-2.m4a",
  },
  {
    id: "여성 사냥 멈춘것 같아요 3",
    label: "[여성] 사냥 멈춘것 같아요 3",
    src: "/sounds/female-hunt-stall-3.m4a",
  },
  {
    id: FEMALE2_RUNE_SOUND_ID,
    label: "[여성2] 룬 떳어요",
    src: "/sounds/female2-rune.m4a",
    fallbackSrc: "/sounds/female2-rune.mp3",
  },
  {
    id: FEMALE2_SOL_JANUS_SOUND_ID,
    label: "[여성2] 야누스 꺼져가요",
    src: "/sounds/female2-sol-janus-fading.m4a",
    fallbackSrc: "/sounds/female2-sol-janus-fading.mp3",
  },
  {
    id: FEMALE2_ERDA_FOUNTAIN_SOUND_ID,
    label: "[여성2] 파운틴 꺼져가요",
    src: "/sounds/female2-erda-fountain-fading.m4a",
    fallbackSrc: "/sounds/female2-erda-fountain-fading.mp3",
  },
  {
    id: FEMALE2_HUNT_STALL_SOUND_ID,
    label: "[여성2] 사냥 멈춘것 같애요",
    src: "/sounds/female2-hunt-stall.m4a",
    fallbackSrc: "/sounds/female2-hunt-stall.mp3",
  },
  {
    id: FEMALE_BOOSTER_EXPIRY_SOUND_ID,
    label: "[여성] 부스터 끝나가요",
    src: "/sounds/female-booster-expiry.m4a",
    fallbackSrc: "/sounds/female-booster-expiry.mp3",
  },
  {
    id: FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID,
    label: "[여성] 카운트다운",
    src: "/sounds/special-core-countdown-female.m4a",
    fallbackSrc: "/sounds/special-core-countdown-female.mp3",
  },
  {
    id: FEMALE2_BUFF_EXPIRY_SOUND_ID,
    label: "[여성2] 버프 끝난것 같애요",
    src: "/sounds/female2-buff-expiry.m4a",
    fallbackSrc: "/sounds/female2-buff-expiry.mp3",
  },
  { id: "예", label: "[기타] 예", src: "/sounds/예.m4a", fallbackSrc: "/sounds/예.mp3" },
  {
    id: "미스터리",
    label: "[기타] 미스터리",
    src: "/sounds/미스터리.m4a",
    fallbackSrc: "/sounds/미스터리.mp3",
  },
  {
    id: "이건너무한거아니냐고",
    label: "[기타] 이건너무한거아니냐고",
    src: "/sounds/이건너무한거아니냐고.m4a",
    fallbackSrc: "/sounds/이건너무한거아니냐고.mp3",
  },
  { id: "시키야", label: "[기타] 시키야", src: "/sounds/시키야.m4a", fallbackSrc: "/sounds/시키야.mp3" },
  { id: "두둥탁", label: "[기타] 두둥탁", src: "/sounds/두둥탁.m4a", fallbackSrc: "/sounds/두둥탁.mp3" },
  {
    id: "띵동띵동",
    label: "[기타] 띵동띵동",
    src: "/sounds/띵동띵동.m4a",
    fallbackSrc: "/sounds/띵동띵동.mp3",
  },
  {
    id: "깊은 띵동",
    label: "[기타] 깊은 띵동",
    src: "/sounds/doorbell-deep-ding.m4a",
  },
  {
    id: "낮은 도어벨",
    label: "[기타] 낮은 도어벨",
    src: "/sounds/doorbell-low.m4a",
  },
  {
    id: "낮은 알림음",
    label: "[기타] 낮은 알림음",
    src: "/sounds/doorbell-low-alert.m4a",
  },
  {
    id: "단음 알림",
    label: "[기타] 단음 알림",
    src: "/sounds/doorbell-single-alert.m4a",
  },
  {
    id: "더블 동",
    label: "[기타] 더블 동",
    src: "/sounds/doorbell-double-dong.m4a",
  },
  {
    id: "따뜻한 띵동",
    label: "[기타] 따뜻한 띵동",
    src: "/sounds/doorbell-warm-ding.m4a",
  },
  {
    id: "부드러운 띵동",
    label: "[기타] 부드러운 띵동",
    src: "/sounds/doorbell-soft-ding.m4a",
  },
  {
    id: "짧은 띵동",
    label: "[기타] 짧은 띵동",
    src: "/sounds/doorbell-short-ding.m4a",
  },
  {
    id: "차분한 차임",
    label: "[기타] 차분한 차임",
    src: "/sounds/doorbell-calm-chime.m4a",
  },
  {
    id: "투톤 알림",
    label: "[기타] 투톤 알림",
    src: "/sounds/doorbell-two-tone-alert.m4a",
  },
  { id: "강아지", label: "[동물] 강아지", src: "/sounds/강아지.m4a", fallbackSrc: "/sounds/강아지.mp3" },
  {
    id: "강아지2",
    label: "[동물] 강아지2",
    src: "/sounds/강아지2.m4a",
    fallbackSrc: "/sounds/강아지2.mp3",
  },
  { id: "고양이", label: "[동물] 고양이", src: "/sounds/고양이.m4a", fallbackSrc: "/sounds/고양이.mp3" },
  {
    id: "고양이2",
    label: "[동물] 고양이2",
    src: "/sounds/고양이2.m4a",
    fallbackSrc: "/sounds/고양이2.mp3",
  },
  { id: "까마귀", label: "[동물] 까마귀", src: "/sounds/까마귀.m4a", fallbackSrc: "/sounds/까마귀.mp3" },
  { id: "꼬끼오", label: "[동물] 꼬끼오", src: "/sounds/꼬끼오.m4a", fallbackSrc: "/sounds/꼬끼오.mp3" },
  { id: "띵동", label: "[기타] 띵동", src: "/sounds/띵동.m4a", fallbackSrc: "/sounds/띵동.mp3" },
  { id: "말", label: "[동물] 말", src: "/sounds/말.m4a", fallbackSrc: "/sounds/말.mp3" },
  { id: "번개", label: "[자연] 번개", src: "/sounds/번개.m4a", fallbackSrc: "/sounds/번개.mp3" },
];

export const DEFAULT_ALERT_SOUND_ID = "띵동띵동";
export const DEFAULT_RUNE_ALERT_SOUND_ID = "떳어요 룬 떳어요";
export const DEFAULT_SOL_JANUS_ALERT_SOUND_ID = ADAM_SOL_JANUS_RANDOM_SOUND_ID;
export const DEFAULT_ERDA_FOUNTAIN_ALERT_SOUND_ID = ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID;
export const DEFAULT_HUNT_STALL_ALERT_SOUND_ID = "사냥 멈춘것 같애요 1";
export const DEFAULT_SPECIAL_CORE_ALERT_SOUND_ID = FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID;

const DEFAULT_PICKER_EXCLUDED_SOUND_IDS = new Set<string>([
  ADAM_BOOSTER_EXPIRY_SOUND_ID,
  FEMALE_BOOSTER_EXPIRY_SOUND_ID,
  FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID,
]);

export const DEFAULT_PICKER_ALERT_SOUNDS = ALERT_SOUNDS.filter(
  (sound) => !DEFAULT_PICKER_EXCLUDED_SOUND_IDS.has(sound.id),
);

export function getAlertSound(soundId: string | null | undefined): AlertSound {
  if (isCustomAlertSoundId(soundId)) {
    return getAlertSound(DEFAULT_ALERT_SOUND_ID);
  }

  return (
    ALERT_SOUNDS.find((sound) => sound.id === soundId) ??
    ALERT_SOUNDS.find((sound) => sound.id === DEFAULT_ALERT_SOUND_ID) ??
    ALERT_SOUNDS[0]
  );
}

export function normalizeAlertSoundId(soundId: string | null | undefined): string {
  if (isCustomAlertSoundId(soundId)) {
    return soundId;
  }

  return getAlertSound(soundId).id;
}

export function normalizeAlertSoundIdForList(
  soundId: string | null | undefined,
  sounds: AlertSound[],
  fallbackSoundId = DEFAULT_ALERT_SOUND_ID,
): string {
  if (isCustomAlertSoundId(soundId)) {
    return soundId;
  }

  const normalized = normalizeAlertSoundId(soundId);
  if (sounds.some((sound) => sound.id === normalized)) {
    return normalized;
  }

  return normalizeAlertSoundId(fallbackSoundId);
}

export function getConcreteAlertSound(soundId: string | null | undefined): AlertSound {
  const sound = getAlertSound(soundId);
  if (!sound.randomSoundIds?.length) {
    return sound;
  }

  const index = Math.floor(Math.random() * sound.randomSoundIds.length);
  return getAlertSound(sound.randomSoundIds[index]);
}

export function getSolJanusAlertSounds(): AlertSound[] {
  return getSoundsWithContext([
    ADAM_SOL_JANUS_RANDOM_SOUND_ID,
    ...ADAM_SOL_JANUS_SOUND_IDS,
    FEMALE_SOL_JANUS_RANDOM_SOUND_ID,
    ...FEMALE_SOL_JANUS_SOUND_IDS,
    FEMALE2_SOL_JANUS_SOUND_ID,
  ]);
}

export function getErdaFountainAlertSounds(): AlertSound[] {
  return getSoundsWithContext([
    ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
    ...ADAM_ERDA_FOUNTAIN_SOUND_IDS,
    FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
    ...FEMALE_ERDA_FOUNTAIN_SOUND_IDS,
    FEMALE2_ERDA_FOUNTAIN_SOUND_ID,
  ]);
}

export function getRuneAlertSounds(): AlertSound[] {
  return getSoundsWithContext([ADAM_RUNE_SOUND_ID, FEMALE_RUNE_SOUND_ID, FEMALE2_RUNE_SOUND_ID]);
}

export function getHuntStallAlertSounds(): AlertSound[] {
  return getSoundsWithContext([
    ADAM_HUNT_STALL_RANDOM_SOUND_ID,
    ...ADAM_HUNT_STALL_SOUND_IDS,
    FEMALE_HUNT_STALL_RANDOM_SOUND_ID,
    ...FEMALE_HUNT_STALL_SOUND_IDS,
    FEMALE2_HUNT_STALL_SOUND_ID,
  ]);
}

export function getBuffExpiryAlertSounds(): AlertSound[] {
  return getSoundsWithContext([ADAM_BUFF_EXPIRY_SOUND_ID, FEMALE2_BUFF_EXPIRY_SOUND_ID]);
}

export function getBoosterExpiryAlertSounds(): AlertSound[] {
  return getSoundsWithContext([
    ADAM_BOOSTER_EXPIRY_SOUND_ID,
    FEMALE_BOOSTER_EXPIRY_SOUND_ID,
    ADAM_BUFF_EXPIRY_SOUND_ID,
    FEMALE2_BUFF_EXPIRY_SOUND_ID,
  ]);
}

export function getSpecialCoreAlertSounds(): AlertSound[] {
  return ALERT_SOUNDS.filter((sound) => sound.id === FEMALE_SPECIAL_CORE_COUNTDOWN_SOUND_ID);
}

function getSoundsWithContext(allowedContextSoundIds: readonly string[]): AlertSound[] {
  const allowed = new Set<string>(allowedContextSoundIds);
  return ALERT_SOUNDS.filter(
    (sound) => !CONTEXT_SOUND_IDS.has(sound.id) || allowed.has(sound.id),
  );
}
