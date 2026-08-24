import { afterEach, describe, expect, it, vi } from "vitest";
import { providers } from "@cutz/providers";

afterEach(() => vi.unstubAllGlobals());

describe("branch-scoped communication providers", () => {
  it("keeps concurrent WhatsApp credentials bound to their own branch context", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const branchA = providers.scoped({
      whatsappOfficial: { enabled: true, token: "token-a", phoneId: "phone-a", graphVersion: "v23.0" },
    });
    const branchB = providers.scoped({
      whatsappOfficial: { enabled: true, token: "token-b", phoneId: "phone-b", graphVersion: "v23.0" },
    });

    await Promise.all([
      branchA.whatsapp("WHATSAPP_OFFICIAL").send({ to: "+911111111111", body: "A" }),
      branchB.whatsapp("WHATSAPP_OFFICIAL").send({ to: "+912222222222", body: "B" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [urlA, initA] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [urlB, initB] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(urlA).toContain("/phone-a/messages");
    expect(initA.headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect(urlB).toContain("/phone-b/messages");
    expect(initB.headers).toMatchObject({ Authorization: "Bearer token-b" });
  });
});
