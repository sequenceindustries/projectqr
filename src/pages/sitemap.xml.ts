import type { APIRoute } from 'astro';
import { tools } from '../data/tools';

export const GET: APIRoute = ({ site }) => {
  const base = site!.toString().replace(/\/$/, '');
  const urls = ['/', ...tools.map((t) => `/${t.slug}`), '/about', '/privacy'];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${base}${u === '/' ? '/' : u}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
