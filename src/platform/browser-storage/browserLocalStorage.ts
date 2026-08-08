import type { KeyValueStorage } from "../../contracts/persistence/keyValueStorage";

export function getBrowserLocalStorage(): KeyValueStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
