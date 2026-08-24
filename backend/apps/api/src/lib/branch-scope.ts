export type BranchScopedUser = { role: string; branchId: string | null };

export type BranchScope =
  | { ok: true; branchId: string }
  | { ok: false; statusCode: 400 | 403; error: "branch_required" | "forbidden" };

const canChooseBranch = (role: string) => role === "OWNER" || role === "ADMIN";

/** Resolve a request to exactly one branch; this helper never returns a global scope. */
export function resolveBranchScope(user: BranchScopedUser, requested?: string | null): BranchScope {
  const requestedBranch = requested?.trim() || undefined;
  if (canChooseBranch(user.role)) {
    return { ok: true, branchId: requestedBranch ?? user.branchId ?? "main" };
  }
  if (!user.branchId) return { ok: false, statusCode: 400, error: "branch_required" };
  if (requestedBranch && requestedBranch !== user.branchId) {
    return { ok: false, statusCode: 403, error: "forbidden" };
  }
  return { ok: true, branchId: user.branchId };
}

export function canAccessBranch(user: BranchScopedUser, entityBranchId: string): boolean {
  return canChooseBranch(user.role) || user.branchId === entityBranchId;
}
