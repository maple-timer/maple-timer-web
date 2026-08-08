import { describe, expect, it } from "vitest";
import {
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_BUFF_CATALOG,
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
  BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
  BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
  getBuffExpiryReferenceIdsForSelection,
  getBuffExpiryTrackingId,
  normalizeBuffExpirySelectedBuffIds,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "./catalog";

describe("buffExpiryCatalog", () => {
  it("tracks union wealth I/II/III as one group", () => {
    const unionWealthGroup = BUFF_EXPIRY_BUFF_CATALOG.find(
      (item) => item.id === BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
    );

    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).toContain(BUFF_EXPIRY_UNION_WEALTH_GROUP_ID);
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("union_wealth");
    expect(unionWealthGroup).toMatchObject({
      label: "유니온의 부",
      shortLabel: "유니온 부",
      iconSrcs: [
        "/buff-expiry/icons/union_wealth_i.png",
        "/buff-expiry/icons/union_wealth_ii.png",
        "/buff-expiry/icons/union_wealth.png",
      ],
      supported: true,
    });
    expect(getBuffExpiryTrackingId("union_wealth_i")).toBe(BUFF_EXPIRY_UNION_WEALTH_GROUP_ID);
    expect(getBuffExpiryTrackingId("union_wealth_ii")).toBe(BUFF_EXPIRY_UNION_WEALTH_GROUP_ID);
    expect(getBuffExpiryTrackingId("union_wealth")).toBe(BUFF_EXPIRY_UNION_WEALTH_GROUP_ID);
    expect([...getBuffExpiryReferenceIdsForSelection([BUFF_EXPIRY_UNION_WEALTH_GROUP_ID])]).toEqual([
      "union_wealth_i",
      "union_wealth_ii",
      "union_wealth",
    ]);
  });

  it("tracks union luck I/II/III as one group", () => {
    const unionLuckGroup = BUFF_EXPIRY_BUFF_CATALOG.find(
      (item) => item.id === BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
    );

    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).toContain(BUFF_EXPIRY_UNION_LUCK_GROUP_ID);
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("union_luck");
    expect(unionLuckGroup).toMatchObject({
      label: "유니온의 행운",
      shortLabel: "유니온 행운",
      iconSrcs: [
        "/buff-expiry/icons/union_luck_i.png",
        "/buff-expiry/icons/union_luck_ii.png",
        "/buff-expiry/icons/union_luck.png",
      ],
      supported: true,
    });
    expect(getBuffExpiryTrackingId("union_luck_i")).toBe(BUFF_EXPIRY_UNION_LUCK_GROUP_ID);
    expect(getBuffExpiryTrackingId("union_luck_ii")).toBe(BUFF_EXPIRY_UNION_LUCK_GROUP_ID);
    expect(getBuffExpiryTrackingId("union_luck")).toBe(BUFF_EXPIRY_UNION_LUCK_GROUP_ID);
    expect([...getBuffExpiryReferenceIdsForSelection([BUFF_EXPIRY_UNION_LUCK_GROUP_ID])]).toEqual([
      "union_luck_i",
      "union_luck_ii",
      "union_luck",
    ]);
  });

  it("tracks similar 3x and 4x coupons as one experience coupon group", () => {
    const expCouponGroup = BUFF_EXPIRY_BUFF_CATALOG.find(
      (item) => item.id === BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
    );

    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).toContain(BUFF_EXPIRY_EXP_COUPON_GROUP_ID);
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("mvp_exp_3x_coupon");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("mvp_exp_4x_coupon");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("exp_3x_coupon");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("exp_4x_coupon");
    expect(expCouponGroup).toMatchObject({
      label: "경험치 쿠폰",
      iconSrcs: [
        "/buff-expiry/icons/exp_3x_coupon.png",
        "/buff-expiry/icons/exp_4x_coupon.png",
        "/buff-expiry/icons/mvp_exp_4x_coupon.png",
      ],
      supported: true,
    });
  });

  it("maps individual 3x and 4x coupon ids to the shared experience coupon group", () => {
    expect(
      normalizeBuffExpirySelectedBuffIds([
        "mvp_exp_3x_coupon",
        "mvp_exp_4x_coupon",
        "exp_3x_coupon",
        "exp_4x_coupon",
      ]),
    ).toEqual([BUFF_EXPIRY_EXP_COUPON_GROUP_ID]);
    expect(getBuffExpiryTrackingId("mvp_exp_3x_coupon")).toBe(BUFF_EXPIRY_EXP_COUPON_GROUP_ID);
    expect(getBuffExpiryTrackingId("mvp_exp_4x_coupon")).toBe(BUFF_EXPIRY_EXP_COUPON_GROUP_ID);
    expect(getBuffExpiryTrackingId("exp_3x_coupon")).toBe(BUFF_EXPIRY_EXP_COUPON_GROUP_ID);
    expect(getBuffExpiryTrackingId("exp_4x_coupon")).toBe(BUFF_EXPIRY_EXP_COUPON_GROUP_ID);
    expect([...getBuffExpiryReferenceIdsForSelection([BUFF_EXPIRY_EXP_COUPON_GROUP_ID])]).toEqual([
      "mvp_exp_3x_coupon",
      "mvp_exp_4x_coupon",
      "exp_3x_coupon",
      "exp_4x_coupon",
    ]);
  });

  it("tracks similar bonus EXP coupons as one group", () => {
    const bonusExpCouponGroup = BUFF_EXPIRY_BUFF_CATALOG.find(
      (item) => item.id === BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
    );

    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).toContain(BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID);
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("bonus_exp_coupon_50");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("mvp_bonus_exp_coupon_50");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("mvp_exp_coupon_70");
    expect(bonusExpCouponGroup).toMatchObject({
      label: "추가 경험치 쿠폰",
      iconSrcs: [
        "/buff-expiry/icons/bonus_exp_coupon_50.png",
        "/buff-expiry/icons/mvp_bonus_exp_coupon_50.png",
        "/buff-expiry/icons/mvp_exp_coupon_70.png",
      ],
      supported: true,
    });
  });

  it("maps individual bonus EXP coupon ids to the shared bonus EXP group", () => {
    expect(
      normalizeBuffExpirySelectedBuffIds([
        "bonus_exp_coupon_50",
        "mvp_bonus_exp_coupon_50",
        "mvp_exp_coupon_70",
      ]),
    ).toEqual([BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID]);
    expect(getBuffExpiryTrackingId("bonus_exp_coupon_50")).toBe(BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID);
    expect(getBuffExpiryTrackingId("mvp_bonus_exp_coupon_50")).toBe(BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID);
    expect(getBuffExpiryTrackingId("mvp_exp_coupon_70")).toBe(BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID);
    expect([...getBuffExpiryReferenceIdsForSelection([BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID])]).toEqual([
      "bonus_exp_coupon_50",
      "mvp_bonus_exp_coupon_50",
      "mvp_exp_coupon_70",
    ]);
  });

  it("tracks the two small potions as one selectable group", () => {
    const smallPotionGroup = BUFF_EXPIRY_BUFF_CATALOG.find(
      (item) => item.id === BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
    );

    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).toContain(BUFF_EXPIRY_SMALL_POTION_GROUP_ID);
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("small_wealth_acquisition_potion");
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("small_exp_accumulation_potion");
    expect(smallPotionGroup).toMatchObject({
      label: "소형 재물/경험 비약",
      shortLabel: "소재비/경축비",
      iconSrcs: [
        "/buff-expiry/icons/small_wealth_acquisition_potion.png",
        "/buff-expiry/icons/small_exp_accumulation_potion.png",
      ],
      supported: true,
    });
  });

  it("maps legacy small potion selections and raw references to the shared tracking id", () => {
    expect(
      normalizeBuffExpirySelectedBuffIds([
        "small_wealth_acquisition_potion",
        "small_exp_accumulation_potion",
      ]),
    ).toEqual([BUFF_EXPIRY_SMALL_POTION_GROUP_ID]);
    expect(getBuffExpiryTrackingId("small_wealth_acquisition_potion")).toBe(
      BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
    );
    expect(getBuffExpiryTrackingId("small_exp_accumulation_potion")).toBe(
      BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
    );
    expect([...getBuffExpiryReferenceIdsForSelection([BUFF_EXPIRY_SMALL_POTION_GROUP_ID])]).toEqual([
      "small_wealth_acquisition_potion",
      "small_exp_accumulation_potion",
    ]);
  });

  it("does not include extreme gold in supported buff expiry ids", () => {
    expect(SUPPORTED_BUFF_EXPIRY_BUFF_IDS).not.toContain("extreme_gold");
    expect(BUFF_EXPIRY_BUFF_CATALOG.find((item) => item.id === "extreme_gold")).toBeUndefined();
  });

  it("ignores unsupported optional buff expiry ids", () => {
    expect(normalizeBuffExpirySelectedBuffIds(["unsupported_optional_exp_buff"])).toEqual([
      BUFF_EXPIRY_UNION_WEALTH_GROUP_ID,
      BUFF_EXPIRY_UNION_LUCK_GROUP_ID,
      BUFF_EXPIRY_SMALL_POTION_GROUP_ID,
      BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
      BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
    ]);
  });
});
