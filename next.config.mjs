/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '30mb' } },
  async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://*.bitrix24.ae https://*.bitrix24.com https://*.bitrix24.de https://*.bitrix24.eu" }] }] },
}
