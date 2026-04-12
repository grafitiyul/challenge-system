// Standalone layout for auth pages — no sidebar, no admin chrome
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, padding: 0, fontFamily: 'Arial, Helvetica, sans-serif', background: '#f1f5f9' }}>
        {children}
      </body>
    </html>
  );
}
