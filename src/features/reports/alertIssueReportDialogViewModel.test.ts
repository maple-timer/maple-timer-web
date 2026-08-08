import { describe, expect, it } from "vitest";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import {
  getAlertIssueReportCheckPanelClassName,
  getAlertIssueReportDialogCopy,
  getAlertIssueReportOtherCategoryOptions,
  getAlertIssueReportSelectedOption,
  getAlertIssueReportStepTitle,
  getAlertIssueReportSubmitLabel,
} from "./alertIssueReportDialogViewModel";

describe("alertIssueReportDialogViewModel", () => {
  it.each([
    [
      { kind: "rune" } satisfies AlertIssueReportTarget,
      "룬 감지 제보",
      "룬 감지가 다르게 동작한 상황을 알려주세요.",
      ["룬이 떴는데 감지가 안돼요", "다른 것을 룬으로 감지해요", "기타"],
      false,
    ],
    [
      { kind: "ultima-raid-equipment" } satisfies AlertIssueReportTarget,
      "울티마 스쿼드 장비 감지 제보",
      "장비 가방 알림이 다르게 동작한 상황을 알려주세요.",
      [
        "가방이 가득 찼는데 알림이 안 울려요",
        "가방이 가득 차지 않았는데 알림이 울려요",
        "가방을 비운 뒤 다음 알림이 안 울려요",
        "기타",
      ],
      false,
    ],
    [
      { kind: "skill", skillId: "skill-1", skillName: "솔 야누스 : 새벽" } satisfies AlertIssueReportTarget,
      "스킬 감지 제보",
      "솔 야누스 : 새벽 감지가 다르게 동작한 상황을 알려주세요.",
      ["감지가 안돼요", "알림 시점이나 반복이 이상해요", "기타"],
      false,
    ],
    [
      { kind: "hunt-stall" } satisfies AlertIssueReportTarget,
      "사냥 멈춤 감지 제보",
      "사냥 멈춤 알림이 다르게 동작한 상황을 알려주세요.",
      ["멈췄는데 알림이 안 울려요", "사냥 중인데 알림이 울려요", "경험치 판독이 이상해요", "기타"],
      false,
    ],
    [
      { kind: "buff-expiry" } satisfies AlertIssueReportTarget,
      "버프 종료 감지 제보",
      "버프 종료 알림이 다르게 동작한 상황을 알려주세요.",
      ["버프가 꺼졌는데 알림이 안 울려요", "버프 종료가 아닌데 알림이 울려요", "버프/시간 감지가 이상해요", "기타"],
      false,
    ],
    [
      { kind: "booster-expiry" } satisfies AlertIssueReportTarget,
      "부스터 종료 감지 제보",
      "부스터 종료 알림이 다르게 동작한 상황을 알려주세요.",
      [
        "부스터가 끝나는데 알림이 안 울려요",
        "부스터 종료가 아닌데 알림이 울려요",
        "부스터 시간이 이상하게 감지돼요",
        "기타",
      ],
      false,
    ],
    [
      { kind: "special-core" } satisfies AlertIssueReportTarget,
      "특수코어 감지 제보",
      "특수 코어 알림이 다르게 동작한 상황을 알려주세요.",
      ["발동했는데 감지가 안돼요", "발동이 아닌데 알림이 울려요", "쿨타임/알림 시간이 이상해요", "기타"],
      false,
    ],
  ])("builds copy and reason options for %s", (target, title, description, labels, isSingleStep) => {
    const copy = getAlertIssueReportDialogCopy(target);

    expect(copy.title).toBe(title);
    expect(copy.description).toBe(description);
    expect(copy.options.map((option) => option.label)).toEqual(labels);
    expect(copy.isSingleStep).toBe(isSingleStep);
  });

  it("falls back to the first option when the selected reason is stale", () => {
    const copy = getAlertIssueReportDialogCopy({ kind: "rune" });

    expect(
      getAlertIssueReportSelectedOption({
        options: copy.options,
        selectedReason: "removed-reason",
      }),
    ).toEqual(copy.options[0]);
  });

  it("provides stable categories for otherwise unstructured reports", () => {
    expect(
      getAlertIssueReportOtherCategoryOptions().map((option) => option.label),
    ).toEqual([
      "화면 표시나 상태 문구",
      "알림음이나 볼륨",
      "설정이나 프리셋",
      "속도 저하나 오류",
      "조작이나 사용성",
      "그 밖의 문제",
    ]);
  });

  it("builds stable step titles and submit labels", () => {
    expect(getAlertIssueReportStepTitle("preflight")).toBe("제보 전에 확인해주세요");
    expect(getAlertIssueReportStepTitle("issue")).toBe("어떤 문제가 있었나요?");
    expect(getAlertIssueReportStepTitle("check")).toBe("보내기 전에 확인해주세요");
    expect(
      getAlertIssueReportSubmitLabel({
        isSingleStep: false,
        isSubmitting: false,
        step: "preflight",
      }),
    ).toBe("문제 선택하기");
    expect(
      getAlertIssueReportSubmitLabel({
        isSingleStep: false,
        isSubmitting: false,
        step: "issue",
      }),
    ).toBe("다음");
    expect(
      getAlertIssueReportSubmitLabel({
        isSingleStep: false,
        isSubmitting: false,
        step: "check",
      }),
    ).toBe("보내기");
    expect(
      getAlertIssueReportSubmitLabel({
        isSingleStep: true,
        isSubmitting: false,
        step: "issue",
      }),
    ).toBe("보내기");
    expect(
      getAlertIssueReportSubmitLabel({
        isSingleStep: false,
        isSubmitting: true,
        step: "issue",
      }),
    ).toBe("전송 중");
  });

  it("keeps the skill review panel class isolated from single-step reports", () => {
    expect(
      getAlertIssueReportCheckPanelClassName({
        kind: "skill",
        skillId: "skill-1",
        skillName: "에르다 파운틴",
      }),
    ).toBe("issue-report-check-panel skill-issue-check-panel");
    expect(getAlertIssueReportCheckPanelClassName({ kind: "buff-expiry" })).toBe(
      "issue-report-check-panel",
    );
    expect(getAlertIssueReportCheckPanelClassName({ kind: "special-core" })).toBe(
      "issue-report-check-panel",
    );
    expect(
      getAlertIssueReportCheckPanelClassName({
        kind: "ultima-raid-equipment",
      }),
    ).toBe("issue-report-check-panel");
  });
});
