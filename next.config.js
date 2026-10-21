const withNextIntl = require('next-intl/plugin')('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['drizzle-orm', 'jose', 'zod']
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