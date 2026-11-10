const withNextIntl = require('next-intl/plugin')('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  experimental: {
    cpus: 1,
    optimizePackageImports: ['drizzle-orm', 'jose', 'zod']
  },
  typescript: {
    ignoreBuildErrors: false
  },
  eslint: {
    dirs: ['src']
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false
  }
};

module.exports = withNextIntl(nextConfig);
