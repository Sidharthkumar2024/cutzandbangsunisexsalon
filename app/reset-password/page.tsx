import type { Metadata } from "next";
import Link from "next/link";
import ResetPasswordForm from "./reset-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="portal-auth-shell">
      <Link className="wordmark" href="/"><span>CUTZ</span><i>&</i><span>BANGS</span></Link>
      <ResetPasswordForm token={token} />
    </main>
  );
}
