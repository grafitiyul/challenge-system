// Landing page for the "Game Changer — הרגלי אכילה" product.
//
// Design carried over from game-changer-new.html (standalone file). All
// styling lives inside a scoped <style> block keyed off a root id so we
// don't leak CSS into the admin app. Sidebar chrome is opted out via
// SidebarLayout's /lp/ prefix check.
//
// ⚠ Content note: the source HTML you shared arrived with corrupted
// Hebrew encoding (mojibake). I reconstructed the structure faithfully
// and seeded sensible Hebrew in `landingContent` — open your original
// .html file and copy the real Hebrew strings into this object. Every
// visible text lives here; no copy is buried in JSX.

import Link from 'next/link';
import { Heebo } from 'next/font/google';

// Load the Heebo font the original HTML expected. Scoped — only applied
// via the className on our root div, so the admin pages still use their
// system font stack.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

// ─── Content (edit here) ──────────────────────────────────────────────────

const landingContent = {
  // URLs are the source of truth for CTA behavior. Replace the payment
  // link if iCount issues a new one; the waitlist link points at the
  // public questionnaire fill route we already ship.
  paymentUrl: 'https://app.icount.co.il/m/5e143/c68ea9adp36u69eb5d6?utm_source=iCount&utm_medium=paypage&utm_campaign=54',
  waitlistUrl: 'https://challenge-systemweb-production.up.railway.app/fill/2j08wfox',

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    brand: 'Game Changer',
    title: 'מה זה עוד משחק כזה של לשנות הרגלים?',
    tldrLabel: 'בקיצור',
    tldrParagraphs: [
      'קבוצה קטנה וסגורה של עד 10 נשים, בוחרות את אחד משני העולמות של הרגלי אכילה ומתחייבות לבצע קצת פעולה פעיל!',
      'אם בוחרים קצת — אם על הרגלי התזונה שבחרת בעצמך.',
      'אחרי השבוע — מעבירות את זה הלאה, למשחק!',
    ],
    points: [
      'ההרגלים הישנים מסתדרים עליך? המקום הנכון הזה, את הולכת להרוויח הכי נקודות.',
      'הצלחת להפעיל יום מסודר מבוקר ועד ערב? קבלת נקודות.',
      'שתית מים? קבלת נקודות.',
      'זהו פשוט.',
    ],
  },

  // ── Story ────────────────────────────────────────────────────────────
  story: {
    paragraphs: [
      [
        'אחרי 13 שנות ניסיון מקצועי ',
        { text: 'וחקירת 25 הרגלים המשחזרים על חיי', highlight: true },
        ' פיתחתי את המשחק הזה מדרגה שיאפשר לך לבחור הרגלים חדשים ולחזק אותם כדרך חיים.',
      ],
      'אין כאן ספירת קלוריות או שקילות ולא אפילו יומן אכילה פרטי, רק פעולות פשוטות שכל אחת מסוגלת.',
      'ההרגלים שלנו הם לא תולדה של מזל — אנחנו מעצבות אותם יום אחרי יום.',
      'המשחק הזה — Game Changer — הוא הכוח שיעזור לך לקבוע אילו הרגלים יבנו את היום שלך :)',
    ],
    imageCaption: 'מקום לתמונה',
  },

  // ── Highlights ───────────────────────────────────────────────────────
  highlights: {
    cards: [
      { emoji: '🌟', text: 'זה לא רק בחירה של הרגל שאת מכירה כמה פעמים בשבוע — זה מעבר לסדר יום חדש, בחירה יומיומית חדשה, דרך חיים!' },
      { emoji: '🔥', text: 'יש תחרות ידידותית ותמיכה, כל אחת בקצב שלה אבל יחד עם הקבוצה שלה!' },
      { emoji: '🎯', text: 'אין מסלול אחד. בחרת לשתות יותר מים? תקבלי נקודות. החלטת להתאפק? תקבלי נקודות אם תצליחי!' },
      { emoji: '✨', text: 'יש לי דבר חשוב — שקופות קלה! לא קל, לא משאיר מקום לבלבול.' },
    ],
    how: {
      question: 'איך כל זה מבוצע בפועל? מה הקצב?',
      answer: 'אני אתן את כל המידע המלא ברגע שתצטרפי :)',
    },
  },

  // ── Details ──────────────────────────────────────────────────────────
  details: {
    rows: [
      { icon: '🕗', label: 'שיחת פתיחה חיה', value: 'יום ראשון הקרוב, 26/04 בשעה 20:00' },
      { icon: '📱', label: 'התקשורת בפועל', value: 'בווטסאפ, זום ועל המחשב' },
      { icon: '💰', label: 'מתי זה?', value: '11 ימים, עד יום ראשון 07/05' },
      { icon: '🔒', label: 'הרשמה נסגרת', value: 'לפני התחלת המחזור. אחרי זה אי אפשר להצטרף למחזור זה.' },
    ],
    priceAmount: '197 ש״ח',
    priceSub: 'סך הכל',
  },

  // ── CTA ──────────────────────────────────────────────────────────────
  cta: {
    primary: 'אני נכנסת — תרשמי אותי!',
    policy: 'לצפייה בהסכם (לא חיי דעת) באתר הרשמי.',
    waitlistNote: {
      line1: 'אם אתם אוהבות לעכשיו, אבל אוהבות להצטרף — הרשמה נסגרה בחזור זה הקרוב',
      line2: 'אפשר תמיד להצטרף לכל רשימת ההמתנה:',
    },
  },
} as const;

// ─── Page ─────────────────────────────────────────────────────────────────

export default function GameChangerLandingPage() {
  const c = landingContent;
  return (
    <div id="lp-game-changer" dir="rtl" lang="he" className={heebo.className}>
      <ScopedStyles />

      {/* ── HERO ── */}
      <section id="hero">
        <div className="container">
          <span className="hero-brand">{c.hero.brand}</span>
          <h1 className="hero-title">{c.hero.title}</h1>
          <div className="hero-content-card">
            <div className="bkitzra">{c.hero.tldrLabel}</div>
            {c.hero.tldrParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <ul className="points-list">
              {c.hero.points.map((pt, i) => (
                <li key={i}>{pt}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── STORY ── */}
      <section id="story">
        <div className="container">
          <div className="story-card">
            {c.story.paragraphs.map((para, i) => {
              if (typeof para === 'string') {
                return <p key={i}>{para}</p>;
              }
              // Mixed paragraph — string segments rendered as-is, object
              // segments wrapped with the highlight span.
              const segs = para as ReadonlyArray<string | { text: string; highlight: true }>;
              return (
                <p key={i}>
                  {segs.map((seg, j) =>
                    typeof seg === 'string'
                      ? <span key={j}>{seg}</span>
                      : <span key={j} className="story-highlight">{seg.text}</span>,
                  )}
                </p>
              );
            })}
          </div>
          <div className="img-placeholder mid-img-placeholder">{c.story.imageCaption}</div>
        </div>
      </section>

      {/* ── HIGHLIGHTS ── */}
      <section id="highlights">
        <div className="container">
          <div className="highlights-grid">
            {c.highlights.cards.map((card, i) => (
              <div key={i} className="highlight-card">
                <div className="highlight-bullet">{card.emoji}</div>
                <p>{card.text}</p>
              </div>
            ))}
          </div>
          <div className="how-card">
            <div className="how-q">{c.highlights.how.question}</div>
            <div className="how-a">{c.highlights.how.answer}</div>
          </div>
        </div>
      </section>

      {/* ── DETAILS ── */}
      <section id="details">
        <div className="container">
          <div className="details-card">
            {c.details.rows.map((row, i) => (
              <div key={i} className="details-row">
                <div className="details-icon">{row.icon}</div>
                <div>
                  <div className="details-label">{row.label}</div>
                  <div className="details-value">{row.value}</div>
                </div>
              </div>
            ))}
            <div className="price-block">
              <div className="price-big">{c.details.priceAmount}</div>
              <div className="price-sub">{c.details.priceSub}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="cta-section">
        <div className="container">
          <div className="cta-card">
            <div className="cta-wrap">
              <Link href={c.paymentUrl} className="cta-btn" target="_blank" rel="noopener noreferrer">
                {c.cta.primary}
              </Link>
            </div>
            <p className="policy-note">{c.cta.policy}</p>
            <p className="waitlist-note">
              {c.cta.waitlistNote.line1}
              <br />
              {c.cta.waitlistNote.line2}
              <br />
              <Link href={c.waitlistUrl} target="_blank" rel="noopener noreferrer">
                {c.waitlistUrl}
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── Sticky mobile CTA ── */}
      <div className="sticky-cta">
        <Link href={c.paymentUrl} className="cta-btn" target="_blank" rel="noopener noreferrer">
          {c.cta.primary}
        </Link>
      </div>
    </div>
  );
}

// ─── Scoped styles ────────────────────────────────────────────────────────
// Single <style> tag scoped under `#lp-game-changer`. No globals, no
// layout.tsx changes beyond the sidebar opt-out.
function ScopedStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      #lp-game-changer {
        --bg-primary: #1A0A2E;
        --bg-secondary: #2A1245;
        --card-grad-start: #321655;
        --card-grad-end: #3D1D66;
        --gold: #D4A843;
        --gold-light: #F0C96A;
        --cta-orange: #FF7A00;
        --cta-orange-hover: #E66900;
        --white: #ffffff;
        --white-70: rgba(255,255,255,0.7);
        --white-45: rgba(255,255,255,0.45);
        --radius: 10px;
        --radius-lg: 20px;
        --max-w: 900px;

        font-family: 'Heebo', Arial, Helvetica, sans-serif;
        background: var(--bg-primary);
        color: var(--white);
        line-height: 1.7;
        text-align: center;
        min-height: 100vh;
      }

      #lp-game-changer *,
      #lp-game-changer *::before,
      #lp-game-changer *::after { box-sizing: border-box; }

      #lp-game-changer .container {
        max-width: var(--max-w);
        margin: 0 auto;
        padding: 0 20px;
      }

      #lp-game-changer .cta-btn {
        display: inline-block;
        background: var(--cta-orange);
        color: var(--white);
        font-family: inherit;
        font-size: 17px;
        font-weight: 700;
        padding: 16px 32px;
        border-radius: var(--radius);
        border: none;
        cursor: pointer;
        text-decoration: none;
        text-align: center;
        transition: background 0.2s, transform 0.15s;
        width: 100%;
        max-width: 480px;
      }
      #lp-game-changer .cta-btn:hover {
        background: var(--cta-orange-hover);
        transform: translateY(-1px);
      }
      #lp-game-changer .cta-wrap { text-align: center; margin-top: 32px; }

      #lp-game-changer .img-placeholder {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border: 2px dashed rgba(212,168,67,0.4);
        border-radius: var(--radius-lg);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--gold);
        font-size: 14px;
        font-weight: 600;
        text-align: center;
        padding: 20px;
      }

      /* HERO */
      #lp-game-changer #hero {
        background: linear-gradient(160deg, #1A0A2E 0%, #2A1245 60%, #321655 100%);
        padding: 70px 0 60px;
        position: relative;
        overflow: hidden;
      }
      #lp-game-changer #hero::before {
        content: '';
        position: absolute;
        top: -120px; left: 50%;
        transform: translateX(-50%);
        width: 600px; height: 600px;
        background: radial-gradient(circle, rgba(212,168,67,0.12) 0%, transparent 70%);
        pointer-events: none;
      }
      #lp-game-changer .hero-brand {
        font-size: clamp(30px, 7vw, 52px);
        font-weight: 900;
        color: var(--gold);
        letter-spacing: 2px;
        margin-bottom: 16px;
        display: block;
      }
      #lp-game-changer .hero-title {
        font-size: clamp(28px, 6vw, 48px);
        font-weight: 900;
        line-height: 1.2;
        margin-bottom: 36px;
        background: linear-gradient(135deg, var(--white) 0%, var(--gold-light) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      #lp-game-changer .hero-content-card {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 36px;
        border: 1px solid rgba(212,168,67,0.2);
        text-align: right;
      }
      #lp-game-changer .bkitzra {
        font-size: clamp(20px, 4vw, 28px);
        font-weight: 800;
        color: var(--gold);
        margin-bottom: 20px;
      }
      #lp-game-changer .hero-content-card p {
        color: var(--white-70);
        font-size: 17px;
        line-height: 1.9;
        margin: 0 0 16px;
      }
      #lp-game-changer .hero-content-card p:last-of-type { margin-bottom: 0; }
      #lp-game-changer .points-list {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #lp-game-changer .points-list li {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        color: var(--white);
        font-size: 16px;
        line-height: 1.7;
      }
      #lp-game-changer .points-list li::before {
        content: '✓';
        color: var(--gold);
        font-weight: 800;
        margin-top: 2px;
        flex-shrink: 0;
      }

      /* STORY */
      #lp-game-changer #story {
        background: var(--bg-secondary);
        padding: 60px 0;
      }
      #lp-game-changer .story-card {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 36px;
        border: 1px solid rgba(212,168,67,0.2);
        text-align: right;
      }
      #lp-game-changer .story-card p {
        color: var(--white-70);
        font-size: 17px;
        line-height: 1.9;
        margin: 0 0 16px;
      }
      #lp-game-changer .story-card p:last-of-type { margin-bottom: 0; }
      #lp-game-changer .story-highlight {
        color: var(--gold-light);
        font-weight: 700;
      }
      #lp-game-changer .mid-img-placeholder { height: 280px; margin-top: 32px; }

      /* HIGHLIGHTS */
      #lp-game-changer #highlights {
        background: var(--bg-primary);
        padding: 60px 0;
      }
      #lp-game-changer .highlights-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
      #lp-game-changer .highlight-card {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 28px 24px;
        border: 1px solid rgba(212,168,67,0.2);
        text-align: right;
      }
      #lp-game-changer .highlight-bullet { font-size: 28px; margin-bottom: 10px; }
      #lp-game-changer .highlight-card p {
        color: var(--white-70);
        font-size: 15px;
        line-height: 1.75;
        margin: 0;
      }
      @media (max-width: 600px) {
        #lp-game-changer .highlights-grid { grid-template-columns: 1fr; }
      }
      #lp-game-changer .how-card {
        margin-top: 20px;
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 24px 28px;
        border: 1px solid rgba(212,168,67,0.2);
        text-align: right;
      }
      #lp-game-changer .how-q { color: var(--gold); font-weight: 700; font-size: 17px; margin-bottom: 8px; }
      #lp-game-changer .how-a { color: var(--white-70); font-size: 16px; }

      /* DETAILS */
      #lp-game-changer #details {
        background: var(--bg-secondary);
        padding: 60px 0;
      }
      #lp-game-changer .details-card {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 36px;
        border: 1px solid rgba(212,168,67,0.25);
      }
      #lp-game-changer .details-row {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 16px 0;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        text-align: right;
      }
      #lp-game-changer .details-row:last-of-type { border-bottom: none; padding-bottom: 0; }
      #lp-game-changer .details-row:first-of-type { padding-top: 0; }
      #lp-game-changer .details-icon { font-size: 22px; flex-shrink: 0; margin-top: 2px; }
      #lp-game-changer .details-label {
        font-size: 13px;
        font-weight: 700;
        color: var(--gold);
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      #lp-game-changer .details-value { font-size: 16px; color: var(--white); font-weight: 500; line-height: 1.6; }
      #lp-game-changer .price-block {
        text-align: center;
        padding-top: 28px;
        border-top: 1px solid rgba(255,255,255,0.08);
        margin-top: 8px;
      }
      #lp-game-changer .price-big {
        font-size: clamp(42px, 9vw, 64px);
        font-weight: 900;
        color: var(--gold-light);
        line-height: 1;
        margin: 0 0 6px;
      }
      #lp-game-changer .price-sub { font-size: 16px; color: var(--white-45); }

      /* CTA */
      #lp-game-changer #cta-section {
        background: var(--bg-primary);
        padding: 60px 0;
      }
      #lp-game-changer .cta-card {
        background: linear-gradient(135deg, var(--card-grad-start), var(--card-grad-end));
        border-radius: var(--radius-lg);
        padding: 48px 36px;
        border: 1px solid rgba(212,168,67,0.25);
      }
      #lp-game-changer .waitlist-note {
        margin-top: 28px;
        color: var(--white-45);
        font-size: 14px;
        line-height: 1.7;
      }
      #lp-game-changer .waitlist-note a { color: var(--gold); text-decoration: underline; word-break: break-all; }
      #lp-game-changer .policy-note { margin-top: 20px; color: var(--white-45); font-size: 13px; line-height: 1.7; }

      /* Sticky mobile CTA */
      #lp-game-changer .sticky-cta {
        display: none;
        position: fixed;
        bottom: 0; left: 0; right: 0;
        background: var(--bg-primary);
        padding: 12px 20px 20px;
        border-top: 1px solid rgba(212,168,67,0.2);
        z-index: 999;
        text-align: center;
      }
      @media (max-width: 640px) {
        #lp-game-changer .sticky-cta { display: block; }
        #lp-game-changer { padding-bottom: 80px; }
      }
    `}} />
  );
}
