import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// All admin UI lives under /admin. Everything else passes through untouched.
// Security is enforced at the API level (AdminSessionGuard). This middleware is UX only.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  if (!isAdminPath) {
    return NextResponse.next();
  }

  // Admin path — require admin_session cookie (presence check only; validity is API's job)
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
