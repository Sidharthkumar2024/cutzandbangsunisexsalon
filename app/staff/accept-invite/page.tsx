import type { Metadata } from "next";
import Link from "next/link";
import StaffInviteForm from "./staff-invite-form";

export const metadata: Metadata = {
  title: "Accept team invitation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function StaffInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <main className="portal-auth-shell">
      <Link className="wordmark" href="/"><span>CUTZ</span><i>&amp;</i><span>BANGS</span></Link>
      <StaffInviteForm token={token} />
    </main>
  );
}
