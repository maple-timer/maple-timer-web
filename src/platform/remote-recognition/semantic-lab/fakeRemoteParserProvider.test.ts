import { describe, expect, it, vi } from "vitest";
import type { SemanticLabResourceScope } from "./browserResourceLedger";
import { createSemanticLabFakeRemoteParserProvider } from "./fakeRemoteParserProvider";

describe("semantic lab fake remote parser provider", () => {
  it("accepts only ordered independent VP8 keyframes and drains every request", async () => {
    const release = vi.fn();
    const resources = {
      register: vi.fn(() => release),
    };
    const provider = createSemanticLabFakeRemoteParserProvider(
      resources as unknown as SemanticLabResourceScope,
    );
    const first = await provider.analyze(request(1_000));
    expect(first).toMatchObject({
      e2eMs: 1,
      response: {
        sessionId: "semantic-lab-fake-session",
        frame: {
          sequence: 1,
          sampledAt: 1_000,
          parser: { boxCount: 1 },
        },
      },
    });
    expect(provider.snapshot()).toMatchObject({
      disposed: false,
      requestCount: 1,
      pendingRequestCount: 0,
      lastSampledAt: 1_000,
    });
    expect(resources.register).toHaveBeenCalledWith("providerRequest");
    expect(release).toHaveBeenCalledTimes(1);
    await provider.dispose();
    expect(provider.snapshot().disposed).toBe(true);
    await expect(provider.analyze(request(2_000))).rejects.toThrow(
      "semantic-lab-fake-provider-disposed",
    );
  });

  it("rejects malformed or repeated-clock payloads", async () => {
    const resources = { register: () => () => undefined };
    const provider = createSemanticLabFakeRemoteParserProvider(
      resources as unknown as SemanticLabResourceScope,
    );
    const malformed = request(1_000);
    new Uint8Array(malformed.encodedVp8)[3] = 0;
    await expect(provider.analyze(malformed)).rejects.toThrow(
      "semantic-lab-fake-provider-vp8-keyframe",
    );
    await provider.analyze(request(1_000));
    await expect(provider.analyze(request(1_000))).rejects.toThrow(
      "semantic-lab-fake-provider-clock-order",
    );
    await provider.dispose();
  });
});

function request(sampledAt: number) {
  const bytes = new Uint8Array(10);
  bytes[3] = 0x9d;
  bytes[4] = 0x01;
  bytes[5] = 0x2a;
  return {
    sampledAt,
    width: 320,
    height: 180,
    encodedVp8: bytes.buffer,
    encodeMs: 1,
  };
}
