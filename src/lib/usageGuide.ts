import {
  Bell,
  Crosshair,
  HelpCircle,
  Map,
  MousePointer2,
  MonitorUp,
  SearchCheck,
  Settings2,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type UsageGuideSection = {
  id: string;
  eyebrow: string;
  title: string;
  modalTabLabel: string;
  summary: string;
  icon: LucideIcon;
  layout?: "intro" | "standard" | "checklist" | "settings";
  media?: {
    src: string;
    label: string;
    type?: "video" | "image";
    variant?: "wide" | "strip" | "app-screen" | "rune-screen" | "settings-screen";
  };
  points: string[];
  cautions: string[];
};

export const USAGE_GUIDE_SECTIONS: UsageGuideSection[] = [
  {
    id: "start",
    eyebrow: "Start",
    title: "기본 사용 순서",
    modalTabLabel: "기본 사용 순서",
    summary: "브라우저에서 게임 화면을 분석하고 조건에 맞춰 알림을 울립니다.",
    icon: MonitorUp,
    layout: "intro",
    media: {
      src: "/media/getting-started-guide.mp4",
      label: "Maple Timer 빠른 시작 영상",
      variant: "app-screen",
    },
    points: [
      "**메이플스토리가 보이는 창이나 화면**을 선택합니다.",
      "사용할 기능을 확인하고 필요한 기능을 켭니다.",
      "영역 선택이 필요한 기능은 영역 선택 버튼을 클릭해 가이드에 맞춰 영역을 선택합니다.",
      "알림 시점, 반복 알림, 랜덤 지연, 알림음을 필요한 만큼 조정합니다.",
      "보스에서는 **특수 코어 알림**과 **특수 코어 PIP**를 따로 사용할 수 있습니다.",
      "제대로 동작하지 않는다면 각 패널의 **제보하기**로 알려주세요.",
    ],
    cautions: [],
  },
  {
    id: "settings",
    eyebrow: "Game UI",
    title: "설정은 이렇게 맞춰주세요",
    modalTabLabel: "설정은 이렇게",
    summary: "알림을 잘 보낼 수 있도록 인게임 설정을 해주세요.",
    icon: Settings2,
    layout: "intro",
    media: {
      src: "/media/ingame-ui-settings-guide.png",
      label: "인게임 UI 권장 설정 예시",
      type: "image",
      variant: "app-screen",
    },
    points: [
      "UI > **UI 크기 옵션**은 **[최적 비율]**로 설정해주세요.",
      "UI > **퀵슬롯&버프 시간표시**는 **[중앙, 크게]**로 사용해주세요.",
      "UI > **퀵슬롯&버프표시방식**은 **[분 + 초]**로 사용해주세요.",
      "UI > **버프 정렬 옵션**을 모두 켜주세요.",
      "정밀 감지 대상은 **버프 즐겨찾기에서 빼서** 우상단 버프칸에 보이게 해주세요.",
      "확장 UI를 사용한다면 화면 공유 메뉴에서 **게임 영역**을 설정해주세요.",
    ],
    cautions: [],
  },
  {
    id: "quickslot",
    eyebrow: "Auto Skill",
    title: "스킬 알림은 자동/정밀 감지를 먼저 사용합니다",
    modalTabLabel: "정밀 감지",
    summary: "야누스와 파운틴은 퀵슬롯보다 우상단 버프칸의 남은 시간을 직접 읽는 정밀 감지를 먼저 권장합니다.",
    icon: Bell,
    points: [
      "**솔 야누스: 새벽(정밀)**, **에르다 파운틴(정밀)**은 화면 공유 후 자동으로 버프칸을 찾습니다.",
      "정밀 감지는 스킬이 갱신되어 남은 시간이 늘어나도 흐름을 다시 잡도록 보정합니다.",
      "알림 시점은 종료 전뿐 아니라 **음수**로 입력해 종료 후에도 울리게 할 수 있습니다.",
      "**랜덤 지연**은 첫 알림을 늦추고, **반복 알림**은 놓친 알림을 다시 울립니다.",
    ],
    cautions: [
      "정밀 감지 대상은 **버프 즐겨찾기에서 제외**해 우상단 버프칸에 보이게 해야 합니다.",
      "자동 감지가 맞지 않으면 해당 스킬을 **퀵슬롯 방식**으로 바꿔 쓸 수 있습니다.",
      "자석펫으로 야누스 시간이 자동 연장되는 경우도 남은 시간 흐름을 다시 확인합니다.",
    ],
  },
  {
    id: "skill-alert",
    eyebrow: "Quick Slot",
    title: "퀵슬롯 방식은 자동 감지가 맞지 않을 때 사용합니다",
    modalTabLabel: "퀵슬롯 보조",
    summary: "직업 설치기나 정밀 감지가 없는 스킬은 사용자가 퀵슬롯 아이콘 영역을 직접 잡아 알림을 사용할 수 있습니다.",
    icon: MousePointer2,
    media: {
      src: "/media/quickslot-crop-guide.mp4",
      label: "퀵슬롯 스킬 아이콘 영역 선택 영상",
      variant: "strip",
    },
    points: [
      "**우하단 퀵슬롯**의 움직이지 않는 스킬 아이콘을 선택합니다.",
      "숫자만 자르지 말고 **아이콘과 쿨타임 숫자**가 함께 들어가게 선택합니다.",
      "스킬 지속시간과 쿨타임을 입력하면 퀵슬롯 숫자로 다음 알림 시점을 계산합니다.",
    ],
    cautions: [
      "해상도를 바꿨다면 현재 해상도에서 영역을 다시 선택해야 합니다.",
      "인게임 설정 > UI > **퀵슬롯&버프 시간표시**는 **[중앙, 크게]**를 권장합니다.",
      "**노란색 스킬 아이콘**은 숫자 인식이 불안정할 수 있습니다.",
    ],
  },
  {
    id: "rune",
    eyebrow: "Rune",
    title: "룬 감지는 미니맵 내부 지도 영역을 잡습니다",
    modalTabLabel: "룬 감지",
    summary: "룬 주기를 입력하지 않고 미니맵에 나타나는 룬 아이콘 후보를 감지합니다.",
    icon: Map,
    media: {
      src: "/media/rune-minimap-crop-guide-tight.mp4",
      label: "룬 미니맵 영역 선택 영상",
      variant: "rune-screen",
    },
    points: [
      "**미니맵의 헤더, 버튼, 필터 창은 빼고** 내부 지도 영역만 선택합니다.",
      "룬을 놓쳤을 때는 반복 알림 간격과 횟수를 조정할 수 있습니다.",
      "오감지나 미감지가 반복되면 룬 알림 패널의 **제보하기**로 알려주세요.",
    ],
    cautions: [
      "캐릭터와 룬이 겹쳐 있거나 맵 구조물이 많으면 감지가 흔들릴 수 있습니다.",
      "맵마다 미니맵 UI 크기가 다르므로 **마을에서 미리 영역을 지정하지 말고** 실제 사냥터에서 잡아주세요.",
      "**보라색 배경이나 특수 구조물**이 많으면 감지 결과가 흔들릴 수 있습니다.",
    ],
  },
  {
    id: "ultima-raid-equipment",
    eyebrow: "Ultima Squad",
    title: "울티마 스쿼드 화면 전체를 선택하세요",
    modalTabLabel: "울티마 스쿼드",
    summary:
      "울티마 스쿼드 장비 가방이 가득 찬 상태를 확인해 한 번 알리고, 가방을 비우면 다음 알림을 준비합니다.",
    icon: ShoppingBag,
    media: {
      src: "/media/ultima-raid-equipment-crop-guide.mp4",
      label: "울티마 스쿼드 화면 영역 선택 예시 영상",
      variant: "wide",
    },
    points: [
      "**울티마 스쿼드 화면 전체**가 들어오도록 바깥 테두리를 따라 영역을 선택합니다.",
      "**왼쪽 장비 가방의 수량 표시**와 **상단 가득 참 안내**를 함께 확인합니다.",
      "가방이 가득 찬 동안에는 한 번만 알리고, 가방을 비우면 다음 가득 참 알림을 다시 기다립니다.",
    ],
    cautions: [
      "가방 부분만 선택하면 화면 전체 비율을 확인할 수 없어 감지가 시작되지 않습니다.",
      "해상도나 화면 크기를 바꿨다면 현재 화면에서 영역을 다시 선택해주세요.",
    ],
  },
  {
    id: "recognition",
    eyebrow: "Recognition",
    title: "기능마다 보는 기준이 다릅니다",
    modalTabLabel: "기능별 기준",
    summary:
      "스킬, 룬, 울티마 스쿼드 장비, 사냥 멈춤, 버프 종료, 특수 코어는 서로 다른 화면 단서를 보므로 패널별 기준을 확인해야 합니다.",
    icon: SearchCheck,
    points: [
      "**사냥 멈춤 알림**은 경험치바 변화 또는 쿨타임 숫자 변화 없음으로 멈춤 상태를 봅니다.",
      "**울티마 스쿼드 장비 알림**은 선택한 레이드 화면에서 장비 가방의 가득 참 상태를 확인합니다.",
      "**버프 종료 알림**은 우상단 버프칸에서 지원 버프 그룹과 남은 시간을 함께 추적합니다.",
      "**부스터 종료 알림**은 화면 상단 부스터 타이머 숫자를 읽습니다.",
      "**특수 코어 알림**은 특수 코어가 우상단 버프칸에 뜬 시점부터 쿨타임을 계산합니다.",
    ],
    cautions: [
      "사냥 멈춤 경험치 인식은 실제 사냥터에서 **경험치바 높이**를 선택해야 합니다.",
      "버프 종료 알림은 감지 대상 그룹을 고르고, 필요 없는 그룹은 끄는 편이 안정적입니다.",
      "게임 화면 이미지나 영상은 제보를 보낼 때만 동의한 정보가 서버로 전송됩니다.",
    ],
  },
  {
    id: "troubleshooting",
    eyebrow: "Checklist",
    title: "문제가 생기면 이 순서로 봅니다",
    modalTabLabel: "문제 해결",
    summary: "대부분의 문제는 공유 화면, 해상도별 영역, 소리 권한 중 하나에서 발생합니다.",
    icon: HelpCircle,
    layout: "checklist",
    points: [
      "**Chrome이나 네이버 웨일**에서 다시 시도해 주세요.",
      "화면을 잘못 공유했다면 우상단 **화면 공유 칩**에서 다시 선택합니다.",
      "영역 상태가 비어 있으면 **현재 해상도**에서 영역을 다시 선택합니다.",
      "알림이 늦거나 빠르면 **알림 시점, 반복 알림, 랜덤 지연** 설정을 먼저 확인합니다.",
      "**브라우저 소리 권한, 탭 음소거, 시스템 볼륨**을 함께 확인합니다.",
      "Windows 10에서 입력이 느려지면 **Windows 탐색기**를 다시 시작합니다.",
      "감지 문제가 계속되면 **문의/피드백**으로 진단 자료를 보내고, 일반 문의는 **Discord** 또는 **카카오톡**을 이용해 주세요.",
    ],
    cautions: [
      "계속 재현되면 문의/피드백에서 **설정값과 Crop 영역**을 함께 보내주세요.",
    ],
  },
];

export const USAGE_GUIDE_HIGHLIGHTS = [
  {
    icon: SearchCheck,
    title: "자동 감지 우선",
    body: "야누스와 파운틴은 정밀 감지를 먼저 사용하고, 필요할 때 퀵슬롯을 보조로 씁니다.",
  },
  {
    icon: Crosshair,
    title: "기능별 기준",
    body: "룬, 울티마 스쿼드 장비 화면, 경험치바, 버프칸, 부스터 타이머는 각 패널에서 보는 영역이 다릅니다.",
  },
  {
    icon: TriangleAlert,
    title: "제보로 보정",
    body: "오감지나 미감지가 반복되면 각 패널의 제보하기로 샘플을 보내주세요.",
  },
];
