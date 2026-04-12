import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that are ALWAYS public — no session required
const PUBLIC_PREFIXES = [
  '/t/',        // participant game portal
  '/tg/',       // participant task portal
  '/fill/',     // public questionnaire fill
  '/login',
  '/reset-password',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always pass through Next.js internals, static files and the API proxy
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api-proxy/')  // Next.js rewrite target — never a page
  ) {
    return NextResponse.next();
  }

  // Pass through all explicitly public pages/routes
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname === prefix.replace(/\/$/, '')) {
      return NextResponse.next();
    }
  }

  // Check for admin session cookie
  const session = req.cookies.get('admin_session');
  if (!session?.value) {
    const loginUrl = new URL('/login', req.url);
    // Preserve the intended destination so we can redirect back after login
    if (pathname !== '/') loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all non-static, non-api routes
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
