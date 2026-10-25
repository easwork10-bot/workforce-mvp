const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
module.exports = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  experimental: {
    externalDir: true,
  },
  images: {
    unoptimized: true,
  },
};
