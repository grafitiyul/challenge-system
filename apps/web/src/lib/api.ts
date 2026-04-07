// NEXT_PUBLIC_API_URL must be set at build time (baked into the client bundle).
// In Railway: set NEXT_PUBLIC_API_URL=https://<your-api-service>.up.railway.app in the web service Variables.
// Locally: add NEXT_PUBLIC_API_URL=http://localhost:3001 to apps/web/.env.local
// Fallback to localhost only for local development convenience.
export const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL != null && process.env.NEXT_PUBLIC_API_URL !== ''
    ? `${process.env.NEXT_PUBLIC_API_URL}/api`
    : 'http://localhost:3001/api';
