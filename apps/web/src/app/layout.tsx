import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Challenge System — Admin',
  description: 'Admin panel for managing habit challenges',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen w-full bg-gray-50">{children}</body>
    </html>
  );
}
