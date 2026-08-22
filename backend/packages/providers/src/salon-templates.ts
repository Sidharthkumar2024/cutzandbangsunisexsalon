const escapeHtml = (value: string | number | null | undefined) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const appUrl = () => (process.env.PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/u, "");

export function salonEmailLayout(input: {
  eyebrow: string;
  title: string;
  greeting?: string;
  bodyHtml: string;
  action?: { label: string; url: string };
  footnote?: string;
}) {
  const action = input.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#6b3032;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">${escapeHtml(input.action.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f1eb;color:#28231f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:30px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#fff;border:1px solid #e4ddd4;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 30px;background:#211d1a;color:#fff"><div style="font-family:Georgia,serif;font-size:25px;letter-spacing:3px">CUTZ <span style="color:#df785d">&amp;</span> BANGS</div><div style="font-size:11px;letter-spacing:4px;margin-top:5px;color:#d8cec4">UNISEX SALON · SECTOR 15 DWARKA</div></td></tr><tr><td style="padding:34px 30px"><div style="font-size:11px;font-weight:800;letter-spacing:3px;color:#df785d;text-transform:uppercase">${escapeHtml(input.eyebrow)}</div><h1 style="font:700 30px/1.2 Georgia,serif;margin:12px 0 18px;color:#4f2527">${escapeHtml(input.title)}</h1>${input.greeting ? `<p style="font-size:16px;line-height:1.65">Hi ${escapeHtml(input.greeting)},</p>` : ""}<div style="font-size:15px;line-height:1.75;color:#4c4540">${input.bodyHtml}</div>${action}${input.footnote ? `<p style="font-size:12px;color:#80766d;margin-top:26px">${escapeHtml(input.footnote)}</p>` : ""}</td></tr><tr><td style="padding:22px 30px;background:#f8f3ed;font-size:12px;line-height:1.6;color:#746a61">First Floor, Plot No. 118, Main Kakrola Rd, Patel Garden, Sector 15 Dwarka, New Delhi 110059<br/>Cutz &amp; Bangs Unisex Salon · <a href="${appUrl()}/contact" style="color:#6b3032">Contact &amp; directions</a></td></tr></table></td></tr></table></body></html>`;
}

export function passwordResetEmail(name: string | undefined, resetUrl: string) {
  return salonEmailLayout({
    eyebrow: "Secure account",
    title: "Reset your password",
    greeting: name,
    bodyHtml: "<p>We received a request to reset your Cutz &amp; Bangs account password. Use the secure button below within 30 minutes.</p>",
    action: { label: "Reset password", url: resetUrl },
    footnote: "If you did not request this change, you can safely ignore this email.",
  });
}

export function staffInvitationEmail(input: { name: string; role: string; acceptUrl: string; expiresAt: Date }) {
  return salonEmailLayout({
    eyebrow: "Team access",
    title: "Your salon workspace invitation",
    greeting: input.name,
    bodyHtml: `<p>You have been invited with <strong>${escapeHtml(input.role)}</strong> access. Create your own password to activate the account; no password is shared over email.</p>`,
    action: { label: "Create password & sign in", url: input.acceptUrl },
    footnote: `This one-time invitation expires ${input.expiresAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
  });
}

export function appointmentEmail(input: { name?: string; when: Date; services: string[]; kind: "confirmation" | "reminder" | "thank_you" }) {
  const titles = { confirmation: "Your appointment is confirmed", reminder: "A friendly appointment reminder", thank_you: "Thank you for visiting us" } as const;
  const body = input.kind === "thank_you"
    ? `<p>It was lovely having you at the salon. We hope you enjoyed your ${escapeHtml(input.services.join(", ") || "service")}.</p>`
    : `<p>Your appointment is scheduled for <strong>${escapeHtml(input.when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" }))}</strong>.</p><p>Services: ${escapeHtml(input.services.join(", ") || "Salon service")}</p>`;
  return salonEmailLayout({ eyebrow: "Appointment", title: titles[input.kind], greeting: input.name, bodyHtml: body, action: input.kind === "thank_you" ? { label: "Book your next visit", url: `${appUrl()}/book` } : undefined });
}

export function invoiceEmail(input: { name?: string; invoiceNumber: string; totalMinor: number }) {
  return salonEmailLayout({
    eyebrow: "Visit receipt",
    title: `Invoice ${input.invoiceNumber}`,
    greeting: input.name,
    bodyHtml: `<p>Thank you for visiting Cutz &amp; Bangs. Your invoice is attached.</p><p style="font-size:20px"><strong>Total: ₹${escapeHtml((input.totalMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }))}</strong></p>`,
    action: { label: "Book again", url: `${appUrl()}/book` },
  });
}

export function appointmentWhatsAppText(input: { name?: string; when: Date; services: string[]; kind: "confirmation" | "reminder" | "thank_you" }) {
  const name = input.name ? ` ${input.name}` : "";
  if (input.kind === "thank_you") return `Thank you${name} for visiting Cutz & Bangs Unisex Salon. We hope you loved your ${input.services.join(", ") || "service"}. Book again: ${appUrl()}/book`;
  const lead = input.kind === "confirmation" ? "Your appointment is confirmed" : "Appointment reminder";
  return `${lead}${name}: ${input.when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}. Services: ${input.services.join(", ") || "Salon service"}.`;
}
