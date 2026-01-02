/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Use separate directory for dev to avoid conflicts with production builds
  distDir: process.env.NODE_ENV === 'development' ? '.dev-next' : '.next',
};

export default nextConfig;
