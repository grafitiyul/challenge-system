import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SidebarLayout } from '@components/sidebar-layout';

export const metadata: Metadata = {
  title: 'Challenge System',
  description: 'פורטל משתתפים — תכנון, יעדים, ומשימות שבועיות',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Challenge',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

// Explicit viewport. `maximumScale=1` + `userScalable=false` are deliberately
// NOT used (would break pinch-to-zoom accessibility). Instead, every input
// in the participant task module uses font-size ≥16px so iOS Safari doesn't
// auto-zoom on focus. That's the real, non-hacky fix.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <meta name="theme-color" content="#2563eb" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Service worker hygiene.
            Prior deployments registered a SW for PWA installability. We no
            longer register one (PWA installability is not worth the risk of
            a browser serving a stale bundle after deploy). On every page
            load we actively unregister any SW that's still present and
            clear Cache Storage. This is the permanent fix: after one visit
            post-deploy, the user has zero SW and always gets fresh HTML. */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              regs.forEach(function(r) { r.unregister(); });
            }).catch(function(){});
          }
          if (typeof caches !== 'undefined' && caches.keys) {
            caches.keys().then(function(keys) {
              keys.forEach(function(k) { caches.delete(k); });
            }).catch(function(){});
          }
        ` }} />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body { font-family: Arial, Helvetica, sans-serif; background: #f8fafc; }
          a { text-decoration: none; color: inherit; }
          button { font-family: inherit; }
          .page-wrapper { padding: 20px 16px; }
          @media (min-width: 768px) {
            .sidebar-desktop { display: flex !important; }
            .mobile-header { display: none !important; }
            .main-content { margin-right: ${220}px; }
            .page-wrapper { padding: 28px 32px; }
          }
          @media (max-width: 767px) {
            .sidebar-desktop { display: none !important; }
            .mobile-header { display: flex !important; }
            .main-content { margin-right: 0; }
          }
        `}</style>
      </head>
      <body>
        <SidebarLayout>{children}</SidebarLayout>
      </body>
    </html>
  );
}
