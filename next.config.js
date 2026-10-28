const withNextIntl = require('next-intl/plugin')('./src/i18n.ts');
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath ? { basePath } : {}),
  output: 'standalone',
  skipTrailingSlashRedirect: true,
  experimental: {
    optimizePackageImports: ['drizzle-orm', 'jose', 'zod'],
    instrumentationHook: true
  },
  typescript: {
    ignoreBuildErrors: false
  },
  eslint: {
    dirs: ['src']
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

module.exports = withNextIntl(nextConfig);