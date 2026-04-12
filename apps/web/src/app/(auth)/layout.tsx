// Standalone layout for auth pages — no sidebar, no admin chrome.
// Root layout owns <html> and <body>; this just provides the page background.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {children}
    </div>
  );
}
