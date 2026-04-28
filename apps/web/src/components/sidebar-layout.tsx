'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SIDEBAR_WIDTH = 220;

interface NavItemDef {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function IconGrid() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconCheckSquare() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconFileText() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}


function IconMessageCircle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

const NAV_MAIN: NavItemDef[] = [
  { href: '/admin/dashboard', label: 'דשבורד', icon: <IconGrid /> },
  { href: '/admin/programs', label: 'תוכניות', icon: <IconZap /> },
  { href: '/admin/groups', label: 'קבוצות', icon: <IconUsers /> },
  { href: '/admin/participants', label: 'משתתפות', icon: <IconUser /> },
  { href: '/admin/chats', label: "צ'אטים", icon: <IconMessageCircle /> },
  { href: '/admin/tasks', label: 'משימות', icon: <IconCheckSquare /> },
  { href: '/admin/questionnaires', label: 'שאלונים', icon: <IconFileText /> },
  { href: '/admin/icount-webhook', label: 'iCount', icon: <IconCreditCard /> },
  { href: '/admin/feed', label: 'מבזק', icon: <IconZap /> },
];

const NAV_BOTTOM: NavItemDef[] = [
  { href: '/admin/admins', label: 'מנהלים', icon: <IconShield /> },
  { href: '/admin/settings', label: 'הגדרות', icon: <IconSettings /> },
];

interface NavItemProps extends NavItemDef {
  isActive: boolean;
  onClick: () => void;
}

function NavItem({ href, label, icon, isActive, onClick }: NavItemProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        margin: '1px 8px',
        borderRadius: 7,
        color: isActive ? '#ffffff' : '#94a3b8',
        background: isActive ? '#1d4ed8' : 'transparent',
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        textDecoration: 'none',
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Public pages (fill flow, game portal, task portal, landing pages) must
  // render without admin chrome. Add new public prefixes here rather than
  // fragmenting the router with route groups.
  if (
    pathname === '/login' ||
    pathname === '/reset-password' ||
    pathname === '/setup' ||
    pathname.startsWith('/fill/') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/tg/') ||
    pathname.startsWith('/lp/')
  ) {
    return <>{children}</>;
  }

  function isActive(href: string): boolean {
    return pathname === href || (href.length > 1 && pathname.startsWith(href + '/'));
  }

  const sidebarContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111827' }}>
      <div style={{ padding: '20px 16px 18px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 16 }}>⚡ Challenge</div>
        <div style={{ color: '#6b7280', fontSize: 12, marginTop: 3 }}>מערכת ניהול אתגרים</div>
      </div>

      <nav style={{ flex: 1, paddingTop: 10, paddingBottom: 10, overflowY: 'auto' }}>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            isActive={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      <div style={{ borderTop: '1px solid #1f2937', paddingTop: 8, paddingBottom: 8, flexShrink: 0 }}>
        {NAV_BOTTOM.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            isActive={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — shown via CSS at 768px+ */}
      <div
        className="sidebar-desktop"
        style={{ position: 'fixed', right: 0, top: 0, width: SIDEBAR_WIDTH, height: '100vh', zIndex: 40, display: 'none' }}
      >
        {sidebarContent}
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 45 }}
        />
      )}

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div style={{ position: 'fixed', right: 0, top: 0, width: SIDEBAR_WIDTH, height: '100vh', zIndex: 50 }}>
          {sidebarContent}
        </div>
      )}

      {/* Main content */}
      <div className="main-content" style={{ minHeight: '100vh', background: '#f8fafc' }}>
        {/* Mobile header — shown via CSS on mobile */}
        <div
          className="mobile-header"
          style={{
            display: 'none',
            alignItems: 'center',
            gap: 14,
            padding: '12px 16px',
            background: '#111827',
            position: 'sticky',
            top: 0,
            zIndex: 30,
          }}
        >
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            aria-label="פתח תפריט"
          >
            <IconMenu />
          </button>
          <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 15 }}>⚡ Challenge</span>
        </div>

        {children}
      </div>
    </>
  );
}
