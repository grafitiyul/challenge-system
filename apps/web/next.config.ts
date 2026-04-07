import type { NextConfig } from 'next';

// API_URL is a server-side runtime env var — NOT NEXT_PUBLIC_.
// Set it in Railway service Variables (runtime, not build arg):
//   API_URL=https://your-api.up.railway.app
// or, if web + api are in the same Railway project:
//   API_URL=http://api.railway.internal:3001
// Locally it falls back to http://localhost:3001 automatically.
//
// All browser requests to /api-proxy/* are proxied here to the real API.
// This avoids the NEXT_PUBLIC_* build-time baking problem entirely.
const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
