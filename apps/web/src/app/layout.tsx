import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SidebarLayout } from '@components/sidebar-layout';

export const metadata: Metadata = {
  title: 'Challenge System — Admin',
  description: 'Admin panel for managing habit challenges',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
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
