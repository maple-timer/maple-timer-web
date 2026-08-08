import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyNoticeModal, PrivacyNoticePage } from "./PrivacyNotice";

describe("PrivacyNotice", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains local screen analysis and browser-only settings storage on the standalone page", () => {
    render(<PrivacyNoticePage />);

    expect(screen.getByRole("heading", { name: "개인정보 및 데이터 안내" })).toBeInTheDocument();
    expect(screen.queryByText(/화면 분석과 설정 저장이 어디에서 처리되는지/)).not.toBeInTheDocument();
    expect(screen.getByText(/게임 화면 이미지나 영상은 서버로 전송되거나 저장되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/현재 기기의 이 브라우저에만 저장됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/사용자 알림음 파일은 서버로 전송되지 않고 현재 브라우저의 IndexedDB/)).toBeInTheDocument();
    expect(screen.getByText(/백업 파일에는 사용자 알림음 파일 자체가 포함되지 않으며/)).toBeInTheDocument();
    expect(screen.getByText(/Discord 1:1 문의의 대화와 첨부 파일은 Discord에 보관/)).toBeInTheDocument();
    expect(screen.getByText(/카카오톡의 개인정보 및 보관 정책/)).toBeInTheDocument();
    expect(screen.getByText(/우상단 1\/4 영역을 1초 간격으로 5회/)).toBeInTheDocument();
    expect(screen.getByText(/실사용 원격 처리에 별도로 동의하고 켠 경우/)).toBeInTheDocument();
    expect(screen.getAllByText(/Cloudflare Web Analytics/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Google Analytics/).length).toBeGreaterThan(0);
  });

  it("opens the same notice in a dismissible modal", () => {
    const onClose = vi.fn();
    render(<PrivacyNoticeModal onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "개인정보 및 데이터 안내" })).toBeInTheDocument();
    expect(screen.getAllByText(/현재 브라우저에서만 실시간으로 분석합니다/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
