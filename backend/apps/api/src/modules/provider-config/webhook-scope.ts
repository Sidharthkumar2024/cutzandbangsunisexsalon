export type WebhookProviderBranch = {
  branchId: string;
  whatsappOfficial?: {
    enabled: boolean;
    phoneId: string;
    wabaId: string;
    verifyToken?: string;
  };
  whatsappUnofficial?: {
    enabled: boolean;
    session: string;
  };
};

function uniqueBranch(matches: WebhookProviderBranch[]) {
  const branchIds = [...new Set(matches.map((candidate) => candidate.branchId))];
  return branchIds.length === 1 ? branchIds[0] : undefined;
}

export function matchOfficialWebhookBranch(
  candidates: WebhookProviderBranch[],
  identity: { phoneId?: string; wabaId?: string },
) {
  const phoneId = identity.phoneId?.trim();
  const wabaId = identity.wabaId?.trim();
  if (!phoneId && !wabaId) return undefined;
  return uniqueBranch(candidates.filter((candidate) => {
    const config = candidate.whatsappOfficial;
    if (!config?.enabled) return false;
    if (phoneId && config.phoneId !== phoneId) return false;
    if (wabaId && config.wabaId !== wabaId) return false;
    return true;
  }));
}

export function matchOfficialVerificationBranch(candidates: WebhookProviderBranch[], verifyToken: string) {
  if (!verifyToken) return undefined;
  return uniqueBranch(candidates.filter((candidate) => candidate.whatsappOfficial?.enabled && candidate.whatsappOfficial.verifyToken === verifyToken));
}

export function matchUnofficialWebhookBranch(candidates: WebhookProviderBranch[], session: string) {
  const normalized = session.trim();
  if (!normalized) return undefined;
  return uniqueBranch(candidates.filter((candidate) => candidate.whatsappUnofficial?.enabled && candidate.whatsappUnofficial.session === normalized));
}

export function whatsappConversationId(provider: "official" | "unofficial", branchId: string, phone: string) {
  const safeBranch = encodeURIComponent(branchId);
  const digits = phone.replace(/\D/gu, "");
  return `wa-${provider}:${safeBranch}:${digits}`;
}
