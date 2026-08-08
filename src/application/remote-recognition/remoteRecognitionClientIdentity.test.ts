import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../../contracts/persistence/keyValueStorage";
import {
  REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY,
  createRemoteRecognitionClientIdentity,
} from "./remoteRecognitionClientIdentity";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";

describe("remoteRecognitionClientIdentity", () => {
  it("stores only one stable client instance id under the dedicated key", () => {
    const values = new Map<string, string>();
    const storage = createStorage(values);
    const createUuid = vi
      .fn()
      .mockReturnValueOnce(CLIENT_ID)
      .mockReturnValueOnce(ATTEMPT_ID);
    const identity = createRemoteRecognitionClientIdentity({
      getStorage: () => storage,
      createUuid,
    });

    expect(identity.getClientInstanceId()).toBe(CLIENT_ID);
    expect(identity.getClientInstanceId()).toBe(CLIENT_ID);
    expect(identity.createAdmissionAttemptId()).toBe(ATTEMPT_ID);
    expect([...values.entries()]).toEqual([
      [REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY, CLIENT_ID],
    ]);
  });

  it("reuses a valid stored client instance without generating a replacement", () => {
    const values = new Map([
      [REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY, CLIENT_ID],
    ]);
    const createUuid = vi.fn(() => REPLACEMENT_ID);
    const identity = createRemoteRecognitionClientIdentity({
      getStorage: () => createStorage(values),
      createUuid,
    });

    expect(identity.getClientInstanceId()).toBe(CLIENT_ID);
    expect(createUuid).not.toHaveBeenCalled();
  });

  it("replaces a malformed stored value", () => {
    const values = new Map([
      [REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY, "not-a-uuid"],
    ]);
    const identity = createRemoteRecognitionClientIdentity({
      getStorage: () => createStorage(values),
      createUuid: () => REPLACEMENT_ID,
    });

    expect(identity.getClientInstanceId()).toBe(REPLACEMENT_ID);
    expect(values.get(REMOTE_RECOGNITION_CLIENT_INSTANCE_STORAGE_KEY)).toBe(
      REPLACEMENT_ID,
    );
  });

  it("keeps a page-memory fallback stable when browser storage fails", () => {
    const setItem = vi.fn(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const identity = createRemoteRecognitionClientIdentity({
      getStorage: () => ({
        getItem: () => null,
        setItem,
        removeItem: vi.fn(),
      }),
      createUuid: () => CLIENT_ID,
    });

    expect(identity.getClientInstanceId()).toBe(CLIENT_ID);
    expect(identity.getClientInstanceId()).toBe(CLIENT_ID);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it("rejects non-CSPRNG-compatible generator output instead of weakening identity", () => {
    const identity = createRemoteRecognitionClientIdentity({
      getStorage: () => null,
      createUuid: () => "fallback-from-math-random",
    });

    expect(() => identity.getClientInstanceId()).toThrow(
      "remote-recognition-client-uuid-invalid",
    );
  });
});

function createStorage(values: Map<string, string>): KeyValueStorage {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
