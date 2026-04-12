// Single entry point for all client-side API calls.
// ALL requests go through /api-proxy/... — never directly to an external domain.
// next.config.ts rewrites /api-proxy/:path* → ${API_URL}/:path* at build time.

export interface ApiError {
  status: number;
  message: string;
}

export async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  if (path.startsWith('http')) {
    throw new Error(
      `apiFetch: path must be relative, got "${path}". Use /api-proxy/... paths only.`,
    );
  }

  const isFormData = options?.body instanceof FormData;

  const headers: HeadersInit = {
    // Don't set Content-Type for FormData — the browser sets it with the correct boundary.
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options?.headers ?? {}),
  };

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (!res.ok) {
    // 401 on an admin page = session expired — redirect to login
    if (res.status === 401 && typeof window !== 'undefined') {
      const current = window.location.pathname;
      // Don't redirect if we're already on a public/portal route
      const isPublic =
        current.startsWith('/t/') ||
        current.startsWith('/tg/') ||
        current.startsWith('/fill/') ||
        current.startsWith('/login') ||
        current.startsWith('/reset-password');
      if (!isPublic) {
        window.location.href = `/login?from=${encodeURIComponent(current)}`;
      }
    }
    let message = 'Request failed';
    try {
      const body = await res.json() as Record<string, unknown>;
      const m = body['message'] ?? body['error'];
      message = typeof m === 'string' ? m : JSON.stringify(body);
    } catch {
      try {
        const text = await res.text();
        if (text) message = text;
      } catch { /* ignore */ }
    }
    const err: ApiError = { status: res.status, message };
    throw err;
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as T;
}
