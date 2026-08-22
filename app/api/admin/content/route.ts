import { getResolvedSiteContent, replaceResolvedSiteContent } from '../../../../lib/content-store';
import type { MembershipPlan, SiteContent } from '../../../../lib/content-types';

const backendBase = () => (process.env.BACKEND_API_URL ?? '').replace(/\/$/, '');

async function authorizeAdmin(request: Request) {
  const base = backendBase();
  const authorization = request.headers.get('authorization');
  if (!base) return { error: Response.json({ error: 'backend_not_configured' }, { status: 503 }) };
  if (!authorization?.startsWith('Bearer ')) return { error: Response.json({ error: 'authentication_required' }, { status: 401 }) };
  try {
    const response = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization }, cache: 'no-store' });
    if (!response.ok) return { error: Response.json({ error: 'invalid_session' }, { status: 401 }) };
    const user = await response.json() as { role?: string };
    if (!['OWNER', 'ADMIN'].includes(user.role ?? '')) return { error: Response.json({ error: 'forbidden' }, { status: 403 }) };
    return { base, authorization };
  } catch {
    return { error: Response.json({ error: 'backend_unavailable' }, { status: 502 }) };
  }
}

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
  const auth = await authorizeAdmin(request);
  if ('error' in auth) return auth.error;
  const content = await request.json();
  if (!isValid(content)) return Response.json({ error: 'Please check the content fields and try again.' }, { status: 400 });
  const saved = await replaceResolvedSiteContent(content);
  await fetch(`${auth.base}/api/v1/settings/main/siteContentRevision`, {
    method: 'PUT',
    headers: { authorization: auth.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      updatedAt: new Date().toISOString(),
      services: saved.services.length,
      testimonials: saved.testimonials.length,
      membershipPlans: saved.membershipPlans.length,
    }),
  }).catch(() => undefined);
  return Response.json(saved);
}
