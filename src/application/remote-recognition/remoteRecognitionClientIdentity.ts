import type { KeyValueStorage } from "../../contracts/persistence/keyValueStorage";
import { isValidRemoteRecognitionClientUuid } from "../../contracts/remote-recognition/remoteRecognitionControlContract";

export const REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY =
  "maple-timer.remote-recognition.client-instance.v1";

export type RemoteRecognitionClientIdentity = {
  getClientInstanceId(): string;
  createAdmissionAttemptId(): string;
};

export function createRemoteRecognitionClientIdentity({
  getStorage,
  createUuid,
}: {
  getStorage(): KeyValueStorage | null;
  createUuid(): string;
}): RemoteRecognitionClientIdentity {
  let pageClientInstanceId: string | null = null;

  const createVerifiedUuid = (): string => {
    const value = createUuid().toLowerCase();
    if (!isValidRemoteRecognitionClientUuid(value)) {
      throw new Error("remote-recognition-client-uuid-invalid");
    }
    return value;
  };

  return {
    getClientInstanceId() {
      if (pageClientInstanceId) {
        return pageClientInstanceId;
      }

      let storage: KeyValueStorage | null = null;
      try {
        storage = getStorage();
        const stored = storage?.getItem(
          REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY,
        );
        if (stored && isValidRemoteRecognitionClientUuid(stored)) {
          pageClientInstanceId = stored;
          return stored;
        }
      } catch {
        storage = null;
      }

      const created = createVerifiedUuid();
      pageClientInstanceId = created;
      try {
        storage?.setItem(
          REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY,
          created,
        );
      } catch {
        // The page-memory value still keeps reconnect attempts stable until reload.
      }
      return created;
    },

    createAdmissionAttemptId() {
      return createVerifiedUuid();
    },
  };
}
