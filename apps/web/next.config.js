/** @type {import('next').NextConfig} */
// The API base is read at runtime from NEXT_PUBLIC_API_BASE_URL (browser calls
// the NestJS API directly with credentials). No rewrites/proxy so cookies keep
// their intended domain; CORS on the API is locked to WEB_ORIGIN.
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
