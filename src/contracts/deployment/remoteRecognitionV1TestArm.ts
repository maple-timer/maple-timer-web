const MAX_REVIEWED_BRANCH_LENGTH = 128;
const REVIEWED_BRANCH_CHARACTERS = /^[A-Za-z0-9._/-]+$/;

export function isValidRemoteRecognitionV1ReviewedBranch(
  value: string,
): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_REVIEWED_BRANCH_LENGTH ||
    !REVIEWED_BRANCH_CHARACTERS.test(value) ||
    value === "@" ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}
