import { describe, expect, it } from "vitest";
import { canAccessBranch, resolveBranchScope } from "./branch-scope.js";

describe("branch scope", () => {
  it("pins managers to their session branch and rejects a cross-branch request", () => {
    expect(resolveBranchScope({ role: "MANAGER", branchId: "dwarka" }, "dwarka")).toEqual({ ok: true, branchId: "dwarka" });
    expect(resolveBranchScope({ role: "MANAGER", branchId: "dwarka" }, "gurugram")).toEqual({ ok: false, statusCode: 403, error: "forbidden" });
    expect(canAccessBranch({ role: "MANAGER", branchId: "dwarka" }, "gurugram")).toBe(false);
  });

  it("lets owners choose one branch while defaulting legacy owner sessions to main", () => {
    expect(resolveBranchScope({ role: "OWNER", branchId: null }, "gurugram")).toEqual({ ok: true, branchId: "gurugram" });
    expect(resolveBranchScope({ role: "OWNER", branchId: null })).toEqual({ ok: true, branchId: "main" });
    expect(canAccessBranch({ role: "OWNER", branchId: null }, "gurugram")).toBe(true);
  });

  it("fails closed when a branch-bound role has no branch", () => {
    expect(resolveBranchScope({ role: "RECEPTION", branchId: null })).toEqual({ ok: false, statusCode: 400, error: "branch_required" });
  });
});
