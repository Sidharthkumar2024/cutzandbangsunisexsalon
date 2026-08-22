import { getResolvedSiteContent } from '../../../lib/content-store';

export async function GET() {
  const content = await getResolvedSiteContent();
  return Response.json(content, { headers: { 'Cache-Control': 'no-store' } });
}
