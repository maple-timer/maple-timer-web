export type BuffExpiryBuffCatalogItem = {
  id: string;
  label: string;
  shortLabel: string;
  iconSrcs: string[];
  supported: boolean;
};

export const BUFF_EXPIRY_UNION_WEALTH_GROUP_ID = "union_wealth_group";
export const BUFF_EXPIRY_UNION_LUCK_GROUP_ID = "union_luck_group";
export const BUFF_EXPIRY_SMALL_POTION_GROUP_ID = "small_wealth_exp_potion_group";
export const BUFF_EXPIRY_EXP_COUPON_GROUP_ID = "exp_multiplier_coupon_group";
export const BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID = "bonus_exp_coupon_group";
export const BUFF_EXPIRY_UNION_WEALTH_MEMBER_IDS = [
  "union_wealth_i",
  "union_wealth_ii",
  "union_wealth",
] as const;
export const BUFF_EXPIRY_UNION_LUCK_MEMBER_IDS = [
  "union_luck_i",
  "union_luck_ii",
  "union_luck",
] as const;
export const BUFF_EXPIRY_SMALL_POTION_MEMBER_IDS = [
  "small_wealth_acquisition_potion",
  "small_exp_accumulation_potion",
] as const;
export const BUFF_EXPIRY_EXP_COUPON_MEMBER_IDS = [
  "mvp_exp_3x_coupon",
  "mvp_exp_4x_coupon",
  "exp_3x_coupon",
  "exp_4x_coupon",
] as const;
export const BUFF_EXPIRY_BONUS_EXP_COUPON_MEMBER_IDS = [
  "bonus_exp_coupon_50",
  "mvp_bonus_exp_coupon_50",
  "mvp_exp_coupon_70",
] as const;

const BUFF_EXPIRY_SMALL_POTION_MEMBER_ID_SET = new Set<string>(
  BUFF_EXPIRY_SMALL_POTION_MEMBER_IDS,
);
const BUFF_EXPIRY_EXP_COUPON_MEMBER_ID_SET = new Set<string>(
  BUFF_EXPIRY_EXP_COUPON_MEMBER_IDS,
);
const BUFF_EXPIRY_BONUS_EXP_COUPON_MEMBER_ID_SET = new Set<string>(
  BUFF_EXPIRY_BONUS_EXP_COUPON_MEMBER_IDS,
);
const BUFF_EXPIRY_UNION_WEALTH_MEMBER_ID_SET = new Set<string>(
  BUFF_EXPIRY_UNION_WEALTH_MEMBER_IDS,
);
const BUFF_EXPIRY_UNION_LUCK_MEMBER_ID_SET = new Set<string>(
  BUFF_EXPIRY_UNION_LUCK_MEMBER_IDS,
);

export const SUPPORTED_BUFF_EXPIRY_BUFF_IDS = [
  BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
  BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
] as const;

const LEGACY_BUFF_EXPIRY_BUFF_ID_ALIASES: Record<string, string> = {
  union_wealth_i: BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
  union_wealth_ii: BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
  union_wealth: BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
  union_luck_i: BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
  union_luck_ii: BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
  union_luck: BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
  small_wealth_acquisition_potion: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  small_exp_accumulation_potion: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  mvp_exp_3x_coupon: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  mvp_exp_4x_coupon: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  exp_3x_coupon: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  exp_4x_coupon: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  bonus_exp_coupon_50: BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  mvp_bonus_exp_coupon_50: BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  mvp_exp_coupon_70: BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
};

export const BUFF_EXPIRY_BUFF_CATALOG: BuffExpiryBuffCatalogItem[] = [
  {
    id: BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
    label: "유니온의 부",
    shortLabel: "유니온 부",
    iconSrcs: [
      "/buff-expiry/icons/union_wealth_i.png",
      "/buff-expiry/icons/union_wealth_ii.png",
      "/buff-expiry/icons/union_wealth.png",
    ],
    supported: true,
  },
  {
    id: BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
    label: "유니온의 행운",
    shortLabel: "유니온 행운",
    iconSrcs: [
      "/buff-expiry/icons/union_luck_i.png",
      "/buff-expiry/icons/union_luck_ii.png",
      "/buff-expiry/icons/union_luck.png",
    ],
    supported: true,
  },
  {
    id: BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
    label: "소형 재물/경험 비약",
    shortLabel: "소재비/경축비",
    iconSrcs: [
      "/buff-expiry/icons/small_wealth_acquisition_potion.png",
      "/buff-expiry/icons/small_exp_accumulation_potion.png",
    ],
    supported: true,
  },
  {
    id: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
    label: "경험치 쿠폰",
    shortLabel: "경험치 쿠폰",
    iconSrcs: [
      "/buff-expiry/icons/exp_3x_coupon.png",
      "/buff-expiry/icons/exp_4x_coupon.png",
      "/buff-expiry/icons/mvp_exp_4x_coupon.png",
    ],
    supported: true,
  },
  {
    id: BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
    label: "추가 경험치 쿠폰",
    shortLabel: "추가 경험치",
    iconSrcs: [
      "/buff-expiry/icons/bonus_exp_coupon_50.png",
      "/buff-expiry/icons/mvp_bonus_exp_coupon_50.png",
      "/buff-expiry/icons/mvp_exp_coupon_70.png",
    ],
    supported: true,
  },
];

export function normalizeBuffExpirySelectedBuffIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS];
  }

  const supportedIds = new Set<string>(SUPPORTED_BUFF_EXPIRY_BUFF_IDS);
  const selected = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => LEGACY_BUFF_EXPIRY_BUFF_ID_ALIASES[item] ?? item)
    .filter((item, index, array) => array.indexOf(item) === index)
    .filter((item) => supportedIds.has(item));

  return selected.length ? selected : [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS];
}

export function isSmallPotionBuffExpiryReference(buffId: string): boolean {
  return BUFF_EXPIRY_SMALL_POTION_MEMBER_ID_SET.has(buffId);
}

export function getBuffExpiryTrackingId(buffId: string): string {
  if (BUFF_EXPIRY_UNION_WEALTH_MEMBER_ID_SET.has(buffId)) {
    return BUFF_EXPIRY_UNION_WEALTH_GROUP_ID;
  }
  if (BUFF_EXPIRY_UNION_LUCK_MEMBER_ID_SET.has(buffId)) {
    return BUFF_EXPIRY_UNION_LUCK_GROUP_ID;
  }
  if (isSmallPotionBuffExpiryReference(buffId)) {
    return BUFF_EXPIRY_SMALL_POTION_GROUP_ID;
  }
  if (BUFF_EXPIRY_EXP_COUPON_MEMBER_ID_SET.has(buffId)) {
    return BUFF_EXPIRY_EXP_COUPON_GROUP_ID;
  }
  if (BUFF_EXPIRY_BONUS_EXP_COUPON_MEMBER_ID_SET.has(buffId)) {
    return BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID;
  }
  return LEGACY_BUFF_EXPIRY_BUFF_ID_ALIASES[buffId] ?? buffId;
}

export function getBuffExpiryReferenceIdsForSelection(selectedBuffIds: string[]): Set<string> {
  const referenceIds = new Set<string>();
  for (const selectedBuffId of selectedBuffIds) {
    const trackingId = getBuffExpiryTrackingId(selectedBuffId);
    if (trackingId === BUFF_EXPIRY_UNION_WEALTH_GROUP_ID) {
      BUFF_EXPIRY_UNION_WEALTH_MEMBER_IDS.forEach((memberId) => referenceIds.add(memberId));
    } else if (trackingId === BUFF_EXPIRY_UNION_LUCK_GROUP_ID) {
      BUFF_EXPIRY_UNION_LUCK_MEMBER_IDS.forEach((memberId) => referenceIds.add(memberId));
    } else if (trackingId === BUFF_EXPIRY_SMALL_POTION_GROUP_ID) {
      BUFF_EXPIRY_SMALL_POTION_MEMBER_IDS.forEach((memberId) => referenceIds.add(memberId));
    } else if (trackingId === BUFF_EXPIRY_EXP_COUPON_GROUP_ID) {
      BUFF_EXPIRY_EXP_COUPON_MEMBER_IDS.forEach((memberId) => referenceIds.add(memberId));
    } else if (trackingId === BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID) {
      BUFF_EXPIRY_BONUS_EXP_COUPON_MEMBER_IDS.forEach((memberId) => referenceIds.add(memberId));
    } else {
      referenceIds.add(trackingId);
    }
  }
  return referenceIds;
}

export function getBuffExpiryCatalogItem(buffId: string): BuffExpiryBuffCatalogItem | null {
  const trackingId = getBuffExpiryTrackingId(buffId);
  return BUFF_EXPIRY_BUFF_CATALOG.find((item) => item.id === trackingId) ?? null;
}
