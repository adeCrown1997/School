/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is read at runtime from NEXT_PUBLIC_API_BASE_URL (browser calls
  // the NestJS API directly with credentials). No rewrites/proxy so cookies keep
  // their intended domain; CORS on the API is locked to WEB_ORIGIN.
  eslint: {
    // Lint is run explicitly in CI via `next lint`; don't fail production builds
    // on lint alone (type errors still fail the build).
    ignoreDuringBuilds: false,
  },
};

module.exports = nextConfig;
