import { getResolvedSiteContent, replaceResolvedSiteContent } from '../../../../lib/content-store';
import type { MembershipPlan, SiteContent } from '../../../../lib/content-types';

function validText(value: unknown, max = 300) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isValid(content: unknown): content is SiteContent {
  if (!content || typeof content !== 'object') return false;
  const value = content as Partial<SiteContent>;
  if (!Array.isArray(value.services) || value.services.length < 1 || value.services.length > 12) return false;
  if (!Array.isArray(value.testimonials) || value.testimonials.length > 12) return false;
  if (!Array.isArray(value.membershipPlans) || value.membershipPlans.length < 1 || value.membershipPlans.length > 8) return false;
  return value.services.every(item => validText(item.id, 80) && validText(item.name, 80) && validText(item.category, 40) && validText(item.description, 180) && Number.isInteger(item.priceInr) && item.priceInr >= 0 && Number.isInteger(item.durationMinutes) && item.durationMinutes > 0)
    && value.testimonials.every(item => validText(item.id, 80) && validText(item.quote, 500) && validText(item.customerName, 80) && validText(item.customerDetail, 120) && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5)
    && value.membershipPlans.every(item => validText(item.id, 80) && validText(item.name, 80) && validText(item.tagline, 120) && validText(item.description, 220) && Number.isInteger(item.payAmount) && item.payAmount > 0 && Number.isInteger(item.creditAmount) && item.creditAmount >= item.payAmount && (item.validityMonths === null || (Number.isInteger(item.validityMonths) && item.validityMonths > 0)) && Array.isArray(item.perks) && item.perks.length <= 6 && item.perks.every(perk => validText(perk, 120)) && ['cream', 'wine', 'sage'].includes(item.theme as MembershipPlan['theme']));
}

export async function GET() {
  return Response.json(await getResolvedSiteContent(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  const content = await request.json();
  if (!isValid(content)) return Response.json({ error: 'Please check the content fields and try again.' }, { status: 400 });
  return Response.json(await replaceResolvedSiteContent(content));
}
