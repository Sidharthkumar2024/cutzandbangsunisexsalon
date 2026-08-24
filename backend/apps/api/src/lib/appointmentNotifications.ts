import { prisma } from "@cutz/db";
import { appointmentEmail, appointmentWhatsAppText } from "@cutz/providers";
import { enqueueEmail } from "@cutz/queue";
import { applyProviderSettings } from "../modules/provider-config/config.js";

export type AppointmentNotificationKind = "confirmation" | "reminder" | "thank_you";

export async function notifyAppointment(appointmentId: string, kind: AppointmentNotificationKind) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: true, items: { include: { service: { select: { name: true } } } } },
  });
  if (!appointment) return { email: "skipped", whatsapp: "skipped" };
  const name = appointment.customer?.name ?? appointment.guestName ?? undefined;
  const email = appointment.customer?.email ?? appointment.guestEmail ?? undefined;
  const phone = appointment.customer?.phone ?? appointment.guestPhone ?? undefined;
  const services = appointment.items.map((item) => item.service.name);
  let emailStatus = "skipped";
  if (email) {
    await enqueueEmail({
      branchId: appointment.branchId,
      to: email,
      subject: kind === "confirmation" ? "Your Cutz & Bangs appointment is confirmed" : kind === "thank_you" ? "Thank you for visiting Cutz & Bangs" : "Reminder: your Cutz & Bangs appointment",
      html: appointmentEmail({ name, when: appointment.startAt, services, kind }),
      dedupeKey: `appointment:${kind}:${appointment.id}:email`,
    });
    emailStatus = "queued";
  }

  const waConsent = Boolean(appointment.customer?.waConsent || /WhatsApp consent:\s*yes/iu.test(appointment.notes ?? ""));
  if (!phone || !waConsent) return { email: emailStatus, whatsapp: "skipped" };
  try {
    const channels = await prisma.channel.findMany({ where: { type: { in: ["WHATSAPP_UNOFFICIAL", "WHATSAPP_OFFICIAL"] }, isActive: true } });
    const preferred = channels.find((channel) => channel.type === "WHATSAPP_UNOFFICIAL") ? "WHATSAPP_UNOFFICIAL" : channels.find((channel) => channel.type === "WHATSAPP_OFFICIAL") ? "WHATSAPP_OFFICIAL" : null;
    if (!preferred) return { email: emailStatus, whatsapp: "skipped" };
    const providerContext = await applyProviderSettings(appointment.branchId);
    const messaging = providerContext.whatsapp(preferred);
    const result = await messaging.send({ to: phone, body: appointmentWhatsAppText({ name, when: appointment.startAt, services, kind }) });
    return { email: emailStatus, whatsapp: result.status, channel: preferred };
  } catch {
    return { email: emailStatus, whatsapp: "failed" };
  }
}
