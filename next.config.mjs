/** @type {import('next').NextConfig} */
const nextConfig = {
  // instrumentation.ts starts the processing workers on the processing service.
  experimental: { cpus: 1 },
};

export default nextConfig;
