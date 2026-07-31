/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enables instrumentation.ts's register() — used to start the Auto-Clipping
  // background worker (lib/vod-poll.ts) once per server boot on the
  // processing service. Required in Next 14.2; stable without this flag in Next 15+.
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
