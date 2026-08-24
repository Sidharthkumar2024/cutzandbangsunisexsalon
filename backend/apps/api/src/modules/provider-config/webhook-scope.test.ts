import { describe, expect, it } from "vitest";
import {
  matchOfficialVerificationBranch,
  matchOfficialWebhookBranch,
  matchUnofficialWebhookBranch,
  whatsappConversationId,
  type WebhookProviderBranch,
} from "./webhook-scope.js";

const candidates: WebhookProviderBranch[] = [
  {
    branchId: "dwarka",
    whatsappOfficial: { enabled: true, phoneId: "phone-dwarka", wabaId: "waba-dwarka", verifyToken: "verify-dwarka" },
    whatsappUnofficial: { enabled: true, session: "session-dwarka" },
  },
  {
    branchId: "gurugram",
    whatsappOfficial: { enabled: true, phoneId: "phone-gurugram", wabaId: "waba-gurugram", verifyToken: "verify-gurugram" },
    whatsappUnofficial: { enabled: true, session: "session-gurugram" },
  },
];

describe("WhatsApp webhook branch scope", () => {
  it("matches official messages only when their configured identifiers agree", () => {
    expect(matchOfficialWebhookBranch(candidates, { phoneId: "phone-dwarka", wabaId: "waba-dwarka" })).toBe("dwarka");
    expect(matchOfficialWebhookBranch(candidates, { phoneId: "phone-dwarka", wabaId: "waba-gurugram" })).toBeUndefined();
    expect(matchOfficialWebhookBranch(candidates, {})).toBeUndefined();
  });

  it("derives verification and unofficial webhook branches from unique secrets/sessions", () => {
    expect(matchOfficialVerificationBranch(candidates, "verify-gurugram")).toBe("gurugram");
    expect(matchUnofficialWebhookBranch(candidates, "session-dwarka")).toBe("dwarka");
    expect(matchUnofficialWebhookBranch(candidates, "missing-session")).toBeUndefined();
  });

  it("fails closed when a credential is duplicated across branches", () => {
    const duplicate = [{ ...candidates[0]!, branchId: "another" }, ...candidates];
    expect(matchUnofficialWebhookBranch(duplicate, "session-dwarka")).toBeUndefined();
    expect(matchOfficialVerificationBranch(duplicate, "verify-dwarka")).toBeUndefined();
  });

  it("uses branch-specific conversation ids for the same phone number", () => {
    expect(whatsappConversationId("unofficial", "dwarka", "+91 98765 43210"))
      .not.toBe(whatsappConversationId("unofficial", "gurugram", "+91 98765 43210"));
  });
});
