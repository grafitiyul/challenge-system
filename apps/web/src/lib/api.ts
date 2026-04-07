// All browser API calls go through Next.js server-side proxy at /api-proxy.
// next.config.ts rewrites /api-proxy/:path* → ${API_URL}/:path* at runtime.
// No NEXT_PUBLIC_* variable needed — no build-time baking — works on all devices.
// To configure production: set API_URL in Railway service Variables (runtime env).
export const BASE_URL = '/api-proxy/api';

export { apiFetch } from './apiFetch';
