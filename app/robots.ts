import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cutz-bangs.sidharthkumar2028.chatgpt.site';
  return { rules: { userAgent: '*', allow: '/', disallow: ['/admin/', '/staff', '/customer', '/forgot-password', '/reset-password', '/api/'] }, sitemap: `${base}/sitemap.xml`, host: base };
}
