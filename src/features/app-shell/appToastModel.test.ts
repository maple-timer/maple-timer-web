import { describe, expect, it } from "vitest";
import { getAppToastPresentation, inferAppToastTone } from "./appToastModel";

describe("app toast presentation", () => {
  it("classifies success messages", () => {
    expect(inferAppToastTone("제보를 보냈습니다.")).toBe("success");
    expect(inferAppToastTone("\"사냥\" 프리셋을 저장했습니다.")).toBe("success");
  });

  it("classifies recoverable warning messages", () => {
    expect(inferAppToastTone("미니맵 영역을 먼저 선택해주세요.")).toBe("warning");
    expect(inferAppToastTone("이 브라우저는 PiP 타이머를 지원하지 않습니다.")).toBe("warning");
  });

  it("classifies operation failures as errors", () => {
    expect(inferAppToastTone("버프 종료 감지 제보 전송에 실패했습니다.")).toBe("error");
    expect(inferAppToastTone("사용자 알림음을 저장하지 못했습니다.")).toBe("error");
  });

  it("adds descriptions for common report and setup messages", () => {
    expect(getAppToastPresentation("제보를 보냈습니다.")).toMatchObject({
      tone: "success",
      title: "제보를 보냈습니다.",
      description: "문제가 재현되면 이 정보로 확인할 수 있습니다.",
    });
    expect(getAppToastPresentation("화면 공유가 준비된 뒤 제보할 수 있습니다.")).toMatchObject({
      tone: "warning",
      title: "화면 공유가 준비된 뒤 제보할 수 있습니다.",
      description: "게임 화면을 먼저 공유한 다음 다시 시도해주세요.",
    });
  });

  it("keeps technical browser errors out of the toast title", () => {
    expect(
      getAppToastPresentation(
        "PiP 타이머를 열지 못했습니다. Failed to execute 'requestWindow' on 'DocumentPictureInPicture': Document PiP requires user activation",
      ),
    ).toMatchObject({
      tone: "error",
      title: "PiP 타이머를 열지 못했습니다.",
      description: "브라우저가 요청을 거부했습니다. 다시 시도해주세요.",
    });
  });
});
