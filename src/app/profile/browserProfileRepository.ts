import { createProfileRepository } from "../../application/profile/profileRepository";
import { getBrowserLocalStorage } from "../../platform/browser-storage/browserLocalStorage";

export const browserProfileRepository = createProfileRepository({
  getStorage: getBrowserLocalStorage,
});
