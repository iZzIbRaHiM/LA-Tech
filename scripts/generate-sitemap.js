import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOMAIN = 'https://latechs.org';

// Define all crawlable pages here. /portal/* is excluded — it's an
// authenticated internal tool, not a public marketing page.
const ROUTES = [
  '/',
  '/portfolio',
];

const generateSitemap = () => {
  const today = new Date().toISOString().split('T')[0];
  
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map(route => `  <url>
    <loc>${DOMAIN}${route}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;

  const publicPath = path.resolve(__dirname, '../public/sitemap.xml');
  const distPath = path.resolve(__dirname, '../dist/sitemap.xml');
  
  // Ensure the public directory exists and write sitemap
  const publicDir = path.dirname(publicPath);
  if (!fs.existsSync(publicDir)){
    fs.mkdirSync(publicDir, { recursive: true });
  }
  fs.writeFileSync(publicPath, sitemapXml, 'utf8');
  console.log(`[SEO] Sitemap successfully generated in source: ${publicPath}`);

  // Ensure the dist directory exists and write sitemap (for production hosting)
  const distDir = path.dirname(distPath);
  if (fs.existsSync(distDir)){
    fs.writeFileSync(distPath, sitemapXml, 'utf8');
    console.log(`[SEO] Sitemap successfully copied to build output: ${distPath}`);
  }
};

generateSitemap();
