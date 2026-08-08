import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryRejectedMatch,
} from "./buffExpiryTypes";

export function findBuffExpiryMatchForBox<
  T extends BuffExpiryAcceptedMatch | BuffExpiryRejectedMatch,
>(matches: T[], box: T["box"]): T | null {
  const boxKey = getBuffExpiryBoxKey(box);
  return (
    matches.find((match) => getBuffExpiryBoxKey(match.box) === boxKey) ?? null
  );
}

export function getBuffExpiryBoxKey(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
