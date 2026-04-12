import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Only these explicit admin path prefixes require a session cookie.
// Everything else — public portals, fill flows, API proxy, Next.js internals — passes through untouched.
// Security is enforced at the API level (AdminSessionGuard). This middleware is UX only.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/groups',
  '/participants',
  '/programs',
  '/questionnaires',
  '/challenges',
  '/chats',
  '/settings',
  '/tasks',
  '/admin',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Is this path under a protected prefix?
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // Protected path — require admin_session cookie (presence check only; validity is API's job)
  const session = req.cookies.get('admin_session');
  if (!session?.value) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
