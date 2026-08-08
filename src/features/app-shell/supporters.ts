export type SupporterWorldId =
  | "scania"
  | "bera"
  | "luna"
  | "zenith"
  | "croa"
  | "union"
  | "elysium"
  | "enosis"
  | "red"
  | "aurora"
  | "arcane"
  | "nova"
  | "eos"
  | "helios"
  | "burning"
  | "challengers";

export type MapleTimerSupporter = {
  worldId: SupporterWorldId;
  worldName: string;
  nickname: string;
};

export const MAPLE_TIMER_SUPPORTERS: MapleTimerSupporter[] = [
  { worldId: "scania", worldName: "스카니아", nickname: "흉폭션" },
  { worldId: "bera", worldName: "베라", nickname: "부둘" },
  { worldId: "scania", worldName: "스카니아", nickname: "허구르트" },
  { worldId: "eos", worldName: "에오스", nickname: "으공" },
  { worldId: "eos", worldName: "에오스", nickname: "블한당" },
  { worldId: "luna", worldName: "루나", nickname: "머랭반" },
  { worldId: "luna", worldName: "루나", nickname: "주접" },
  { worldId: "croa", worldName: "크로아", nickname: "아크Dip" },
  { worldId: "eos", worldName: "에오스", nickname: "렌스밥버거" },
];

export function isMapleTimerSupporter(value: unknown): value is MapleTimerSupporter {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const supporter = value as Partial<MapleTimerSupporter>;
  return (
    typeof supporter.worldId === "string" &&
    typeof supporter.worldName === "string" &&
    typeof supporter.nickname === "string" &&
    supporter.worldId.length > 0 &&
    supporter.worldName.length > 0 &&
    supporter.nickname.length > 0
  );
}
