import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cutz-bangs.sidharthkumar2028.chatgpt.site';
  return [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/book`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
