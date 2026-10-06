import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = site!.toString().replace(/\/$/, '');
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
