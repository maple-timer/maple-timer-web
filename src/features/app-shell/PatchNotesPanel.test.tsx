import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PatchNotesPanel } from "./PatchNotesPanel";

describe("PatchNotesPanel", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("toggles patch notes open and closed", () => {
    render(<PatchNotesPanel />);

    const toggleButton = screen.getByRole("button", { name: "최근 업데이트 접기" });
    const content = screen.getByText("최근 업데이트").closest("section")?.querySelector("#patch-notes-content");

    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(content).not.toHaveClass("is-collapsed");
    expect(screen.queryByText("룬 감지 정확도를 개선했습니다.")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "일반 타이머에 이름을 설정할 수 있습니다. 설정한 이름은 PIP 타이머에도 표시됩니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "문의/피드백의 연락처 입력을 없앴습니다. 답장이 필요한 문의는 디스코드나 카카오톡을 이용해주세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "원격 처리 기능(베타)을 추가했습니다. 초대된 테스터에게 순차적으로 제공됩니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "전체 비활성화로 멈췄던 일반 타이머가 비활성화를 해제하면 남은 시간부터 다시 시작됩니다. 직접 멈춰둔 타이머는 그대로 유지됩니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Discord 커뮤니티와 1:1 문의 채널을 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "PIP 타이머의 알림 깜빡임이 10초 뒤 멈추고 강조 색상만 남습니다. 쿨타임이 길어 알림이 오래 유지되는 스킬에서도 화면이 계속 깜빡이지 않습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "룬 알림의 오작동을 줄이기 위해 확인 시간을 늘렸습니다. 알림은 이전보다 약 1초 늦게 울릴 수 있습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "전투 효과를 가득 찬 장비 가방으로 잘못 판단하거나, 시작부터 보스가 보일 때 알림이 울리지 않던 문제를 수정했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "화면 오른쪽 위에 버프 즐겨찾기 창이 있을 때 버프 종료 알림이 정상적으로 작동하지 않던 문제를 수정했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "확장 UI에서도 알림을 사용할 수 있도록 게임 영역 설정을 추가했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("울티마 스쿼드 장비 가방 감지 정확도를 개선했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("울티마 스쿼드 알림에 반복 설정을 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("울티마 스쿼드 보스 등장 알림을 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "울티마 스쿼드 장비 알림이 실제보다 일찍 울릴 수 있던 문제를 수정했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 분홍색 미니맵 표식을 룬으로 잘못 감지하던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 미니맵 표시를 룬으로 잘못 감지하던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("감지 제보에서 문제 상황을 더 정확히 선택할 수 있도록 개선했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "울티마 스쿼드 장비 가방이 가득 차면 알려주는 기능을 추가했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "일부 그래픽 환경에서 정밀 감지를 시작하지 못하던 문제를 수정했습니다.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("그래픽 가속을 사용할 수 없는 환경에서도 기기 성능에 따라 정밀 감지를 사용할 수 있습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("정밀 감지가 준비 중에 멈출 수 있던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("정밀 감지에 필요한 그래픽 설정을 확인할 수 있도록 안내를 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("사냥 멈춤 알림이 설정한 간격보다 빠르게 반복되던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("예인 남은 횟수가 갑자기 잘못 읽혔을 때 알림이 너무 일찍 울릴 수 있던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("역장 정밀 감지 정확도를 개선했습니다.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 화면과 맵 이동 후 새 룬을 놓칠 수 있던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 맵 장식을 룬으로 잘못 감지하던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("사이트를 오래 켜둔 뒤 일부 감지가 시작되지 않던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("PIP에서도 모든 알림과 마스터 볼륨을 조절할 수 있습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("회수하세요 아담 음성이 추가되었습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("일부 환경에서 버프칸 정밀 감지가 제대로 준비되지 않을 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("특수 코어 알림의 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프 종료 알림의 버프 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("정밀 스킬 알림의 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프칸을 읽는 정밀 감지 방식을 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프 종료 알림이 준비 중에 머물 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("메모리 사용량이 필요 이상으로 유지되던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("사이트 곳곳의 디자인을 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 편집줄 배치와 마스터 볼륨\/설치기 시간 팝오버/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("스킬 알림에 매화검 3초식 : 예인 VI를 남은 횟수 기준으로 감지하는 항목을 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("밝은 배경의 룬을 놓치던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("일부 작은 룬을 놓치던 감지 조건을 보강했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("룬 반복 알림이 중간에 멈출 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/어두운 배경의 작은 룬/)).not.toBeInTheDocument();
    expect(screen.queryByText(/밝은 지형 위의 작은 룬/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 감지 후 알림이 울리지 않는 상황/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 감지 판정을 휴리스틱 중심에서 CNN 기반/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 알림의 색상\/형태 검증을 강화하고 같은 감지 주기의 반복 알림 판정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사용 가이드를 최신 알림 기능과 정밀 감지 흐름/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 사용자의 야누스\/파운틴 기본 알림을 정밀 감지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사이트 여기저기 소소한 디자인 작업/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 구형 버프칸 모드를 정리하고 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 최초 알림만 0.5초 단위로 최대 2초/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PIP 타이머에서 특수코어 쿨타임을 보스용 화면/)).not.toBeInTheDocument();
    expect(screen.queryByText(/특수 코어 발동을 감지해 재사용 대기시간 기준/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 에르다 파운틴 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 솔 야누스: 새벽 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 에르다 파운틴을 버프칸 남은 시간 기준/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 이미지를 경험치 쿠폰으로 인식하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/에르다 파운틴 알림이 알림 완료 후 다시 감지되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림이 알림 완료 후 일부 설치기를 다시 감지하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 일부 첫 줄 버프가 잘못 감지되어 알림/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림이 재사용 가능 전 다시 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/수동 경험치 인식에서 영역 선택 후 경험치 바가 잠시 표시되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/직업 설치기 알림 시점을 스킬 종료 후 최대 20초까지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림 버프칸 모드에서 같은 알림이 짧은 간격으로 다시 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림 버프칸 모드에서 남은 시간이 잠깐 사라져도 알림/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머 자동 재시작이 시간이 지날수록 조금씩 밀리던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 경험치 인식 방식을 직접 경험치바 높이/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머에 현재 공유 중인 화면을 함께 볼 수 있는 옵션/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머에서 수동 경험치 인식 상태가 표시되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 홀로그램 그래피티: 역장 VI 버프칸 감지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 반복 알림이 짧은 간격으로 겹쳐 울리던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머를 한 번에 시작, 일시정지, 초기화할 수 있는 버튼/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머에 완료 후 같은 시간으로 다시 시작하는 자동 재시작 옵션/)).not.toBeInTheDocument();
    expect(screen.queryByText(/종료된 이벤트 전용 스킬 알림 항목을 정리/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림과 룬 알림의 반복 횟수를 1회, 2회, 3회, 5회/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 솔 야누스: 새벽을 퀵슬롯 대신 버프칸/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 알림 시점을 버프 종료 전뿐 아니라 종료 후까지 설정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 알림 시점을 스킬 종료 전뿐 아니라 종료 후까지 설정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림에 전용 알림음을 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 영역을 조금 넓게 선택했을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 감지할 대상 그룹을 선택/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 기본 감지 모드를 제거하고 정밀 감지로 통합/)).not.toBeInTheDocument();
    expect(screen.queryByText(/다크 모드의 색감과 모달 가시성을 개선/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에 정밀 감지 모드를 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬을 감지한 뒤에도 마지막 감지 시간이 계속 유지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림이 같은 시점에 겹쳐 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 순간적인 감지 지연에도 알림을 놓치지 않도록/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 일부 정상 카운트다운을 놓치던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 경험치와 쿨타임 인식 상태/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 후 새 쿨타임을 다시 감지하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 창 메이커를 추가해 표시 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머가 사용자가 설정한 알림 시점에 맞춰/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머의 크기, 알림 색, 강조 방식/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림이 잘못된 시간 인식으로/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 쿨타임 인식이 한 번 울린 뒤/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VIP 부스터, HEXA 부스터 종료 알림 기능을 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림에 쿨타임 숫자가 사라졌을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 룬 쿨타임처럼 비슷하게 보이는 아이콘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 소재비를 인식하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사용자 알림음 파일을 직접 업로드/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 지원하지 않는 버프 아이콘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림음이 더 안정적으로 재생/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머 하단에서 사냥 경험치와 퍼센트/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 지원 버프를 보강/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 여성 음성 알림음과 버프 종료 전용 음성 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림 판독 로직을 백그라운드 처리/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림 베타 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/설정 프리셋 저장과 JSON/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림 경험치 판독 엔진/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 여성 음성 알림음 10개/)).not.toBeInTheDocument();
    expect(screen.queryByText(/설명 아이콘 툴팁/)).not.toBeInTheDocument();

    fireEvent.click(toggleButton);

    expect(screen.getByRole("button", { name: "최근 업데이트 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(content).toHaveClass("is-collapsed");
    expect(localStorage.getItem("maple-timer.patch-notes.collapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "최근 업데이트 펼치기" }));

    expect(screen.getByRole("button", { name: "최근 업데이트 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(content).not.toHaveClass("is-collapsed");
    expect(localStorage.getItem("maple-timer.patch-notes.collapsed")).toBe("false");
  });

  it("toggles patch notes from the heading surface", () => {
    render(<PatchNotesPanel />);

    const heading = screen.getByText("최근 업데이트").closest(".patch-notes-heading");
    const content = screen.getByText("최근 업데이트").closest("section")?.querySelector("#patch-notes-content");

    expect(heading).not.toBeNull();
    fireEvent.click(heading as Element);

    expect(screen.getByRole("button", { name: "최근 업데이트 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(content).toHaveClass("is-collapsed");
  });

  it("groups visible patch notes by date", () => {
    render(<PatchNotesPanel />);

    expect(screen.getAllByText("2026.08.07")).toHaveLength(1);
    expect(screen.getAllByText("2026.08.06")).toHaveLength(1);
    expect(screen.queryByText("2026.07.31")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.29")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.28")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.27")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.26")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.20")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.18")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.17")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.15")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.12")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.11")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.10")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.07")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.06")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.05")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.04")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.03")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.02")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.07.01")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.30")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.29")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.23")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.22")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.20")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.19")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.18")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.17")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.15")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.14")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.13")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.12")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.09")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.03")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.02")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.06.01")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.31")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.29")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.26")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.25")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.23")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.22")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.16")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.14")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.13")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.12")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.11")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.05.10")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-05-12")).not.toBeInTheDocument();
    expect(
      screen.queryByText("사냥 멈춤 알림이 설정한 간격보다 빠르게 반복되던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("예인 남은 횟수가 갑자기 잘못 읽혔을 때 알림이 너무 일찍 울릴 수 있던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("역장 정밀 감지 정확도를 개선했습니다.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 화면과 맵 이동 후 새 룬을 놓칠 수 있던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("PIP에서도 모든 알림과 마스터 볼륨을 조절할 수 있습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("일부 맵 장식을 룬으로 잘못 감지하던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("사이트를 오래 켜둔 뒤 일부 감지가 시작되지 않던 문제를 수정했습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("회수하세요 아담 음성이 추가되었습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("일부 환경에서 버프칸 정밀 감지가 제대로 준비되지 않을 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("특수 코어 알림의 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프 종료 알림의 버프 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("정밀 스킬 알림의 아이콘 감지를 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프칸을 읽는 정밀 감지 방식을 개선했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("버프 종료 알림이 준비 중에 머물 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("메모리 사용량이 필요 이상으로 유지되던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("사이트 곳곳의 디자인을 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 편집줄 배치와 마스터 볼륨\/설치기 시간 팝오버/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("스킬 알림에 매화검 3초식 : 예인 VI를 남은 횟수 기준으로 감지하는 항목을 추가했습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("밝은 배경의 룬을 놓치던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("일부 작은 룬을 놓치던 감지 조건을 보강했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("룬 반복 알림이 중간에 멈출 수 있던 문제를 수정했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/어두운 배경의 작은 룬/)).not.toBeInTheDocument();
    expect(screen.queryByText(/밝은 지형 위의 작은 룬/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 감지 후 알림이 울리지 않는 상황/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 감지 판정을 휴리스틱 중심에서 CNN 기반/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 알림의 색상\/형태 검증을 강화하고 같은 감지 주기의 반복 알림 판정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 사용자의 야누스\/파운틴 기본 알림을 정밀 감지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사이트 여기저기 소소한 디자인 작업/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 구형 버프칸 모드를 정리하고 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 최초 알림만 0.5초 단위로 최대 2초/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PIP 타이머에서 특수코어 쿨타임을 보스용 화면/)).not.toBeInTheDocument();
    expect(screen.queryByText(/특수 코어 발동을 감지해 재사용 대기시간 기준/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 에르다 파운틴 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 솔 야누스: 새벽 정밀 감지 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 에르다 파운틴을 버프칸 남은 시간 기준/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬 이미지를 경험치 쿠폰으로 인식하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/에르다 파운틴 알림이 알림 완료 후 다시 감지되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림이 알림 완료 후 일부 설치기를 다시 감지하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 일부 첫 줄 버프가 잘못 감지되어 알림/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림이 재사용 가능 전 다시 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/수동 경험치 인식에서 영역 선택 후 경험치 바가 잠시 표시되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/직업 설치기 알림 시점을 스킬 종료 후 최대 20초까지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림 버프칸 모드에서 같은 알림이 짧은 간격으로 다시 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림 버프칸 모드에서 남은 시간이 잠깐 사라져도 알림/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머 자동 재시작이 시간이 지날수록 조금씩 밀리던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 경험치 인식 방식을 직접 경험치바 높이/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머에 현재 공유 중인 화면을 함께 볼 수 있는 옵션/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머에서 수동 경험치 인식 상태가 표시되지 않던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에 홀로그램 그래피티: 역장 VI 버프칸 감지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 반복 알림이 짧은 간격으로 겹쳐 울리던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머를 한 번에 시작, 일시정지, 초기화할 수 있는 버튼/)).not.toBeInTheDocument();
    expect(screen.queryByText(/일반 타이머에 완료 후 같은 시간으로 다시 시작하는 자동 재시작 옵션/)).not.toBeInTheDocument();
    expect(screen.queryByText(/종료된 이벤트 전용 스킬 알림 항목을 정리/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림과 룬 알림의 반복 횟수를 1회, 2회, 3회, 5회/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 솔 야누스: 새벽을 퀵슬롯 대신 버프칸/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 알림 시점을 버프 종료 전뿐 아니라 종료 후까지 설정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림의 알림 시점을 스킬 종료 전뿐 아니라 종료 후까지 설정/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림에 전용 알림음을 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림에서 영역을 조금 넓게 선택했을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 감지할 대상 그룹을 선택/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 기본 감지 모드를 제거하고 정밀 감지로 통합/)).not.toBeInTheDocument();
    expect(screen.queryByText(/다크 모드의 색감과 모달 가시성을 개선/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에 정밀 감지 모드를 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/룬을 감지한 뒤에도 마지막 감지 시간이 계속 유지/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림이 같은 시점에 겹쳐 울릴 수 있던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 순간적인 감지 지연에도 알림을 놓치지 않도록/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 일부 정상 카운트다운을 놓치던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 경험치와 쿨타임 인식 상태/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 후 새 쿨타임을 다시 감지하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 창 메이커를 추가해 표시 항목/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머가 사용자가 설정한 알림 시점에 맞춰/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머의 크기, 알림 색, 강조 방식/)).not.toBeInTheDocument();
    expect(screen.queryByText(/부스터 종료 알림이 잘못된 시간 인식으로/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VIP 부스터, HEXA 부스터 종료 알림 기능을 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 쿨타임 인식이 한 번 울린 뒤/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림에 쿨타임 숫자가 사라졌을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 룬 쿨타임처럼 비슷하게 보이는 아이콘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림에서 소재비를 인식하지 못하던 문제/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사용자 알림음 파일을 직접 업로드/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림이 지원하지 않는 버프 아이콘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림음이 더 안정적으로 재생/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 여성 음성 알림음과 버프 종료 전용 음성 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림 판독 로직을 백그라운드 처리/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림 베타 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/설정 프리셋 저장과 JSON/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머 하단에서 사냥 경험치와 퍼센트/)).not.toBeInTheDocument();
    expect(screen.queryByText(/버프 종료 알림의 지원 버프를 보강/)).not.toBeInTheDocument();
    expect(screen.queryByText(/작게 표시되는 룬 아이콘을 놓치는 문제 개선/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림 경험치 판독 엔진/)).not.toBeInTheDocument();
    expect(screen.queryByText(/신규 여성 음성 알림음 10개/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 패널 접기와 반복 알림 표시 UI 정리/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림과 룬 알림을 놓쳤을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PiP 타이머에서 일반 타이머 남은 시간도 함께/)).not.toBeInTheDocument();
    expect(screen.queryByText(/짧고 낮은 띵동\/도어벨 계열/)).not.toBeInTheDocument();
    expect(screen.queryByText(/스킬 알림을 놓쳤을 때/)).not.toBeInTheDocument();
    expect(screen.queryByText(/도핑과 재획비를 직접 맞출 수 있는 일반 타이머 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알림 소리를 한 번에 줄일 수 있는 마스터 볼륨 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/솔 야누스 : 새벽 70초\/80초 종류 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사냥 멈춤 알림의 시작 대기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/미니맵이나 퀵슬롯이 아닌 위치/)).not.toBeInTheDocument();
    expect(screen.queryByText(/알람음 볼륨을 최대 200%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/사용 가이드 모달과 가이드 페이지 추가/)).not.toBeInTheDocument();
    expect(screen.queryByText(/패치 기록 패널을 접고 다시 열어도/)).not.toBeInTheDocument();
  });

  it("opens the full patch history in a dialog", () => {
    render(<PatchNotesPanel />);

    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));

    expect(screen.getByRole("dialog", { name: "전체 패치 기록" })).toBeInTheDocument();
    expect(screen.getByText(/사용 가이드 모달과 가이드 페이지를 추가했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/룬 오감지와 사냥 멈춤 알림 진단 정보를 개선/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "전체 패치 기록" })).not.toBeInTheDocument();
  });

  it("restores a collapsed panel when the latest patch has not changed", () => {
    render(<PatchNotesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "최근 업데이트 접기" }));
    cleanup();

    render(<PatchNotesPanel />);

    expect(screen.getByRole("button", { name: "최근 업데이트 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("reopens the panel when the stored latest patch key is stale", () => {
    localStorage.setItem("maple-timer.patch-notes.collapsed", "true");
    localStorage.setItem("maple-timer.patch-notes.latest", "old-patch");

    render(<PatchNotesPanel />);

    expect(screen.getByRole("button", { name: "최근 업데이트 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(localStorage.getItem("maple-timer.patch-notes.collapsed")).toBe("false");
  });
});
