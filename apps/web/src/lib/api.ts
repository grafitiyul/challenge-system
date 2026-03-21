export const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL != null
    ? `${process.env.NEXT_PUBLIC_API_URL}/api`
    : 'http://localhost:3001/api';
