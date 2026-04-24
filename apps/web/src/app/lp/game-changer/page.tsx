// Landing page for the "Game Changer — הרגלי אכילה" product.
//
// Design carried over 1:1 from game-changer-new.html. All styling lives
// inside a scoped <style> block keyed off the root id so we don't leak
// CSS into the admin app. Sidebar chrome is opted out via SidebarLayout's
// /lp/ prefix check.
//
// ─────────────────────────────────────────────────────────────────────
// FUTURE: Program → Landing Page tab
// Admin will be able to edit landing pages in-app (slug / headline /
// sections / CTA links / active-inactive) instead of editing this file.
// Not implemented yet — edit `landingContent` below for now.
// ─────────────────────────────────────────────────────────────────────

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

// Edit landing page text and links here.
// Structure is additive: new sections can be added by extending this
// object and adding matching JSX blocks below.

const landingContent = {
  // URLs are the source of truth for CTA behavior. Replace the payment
  // link if iCount issues a new one; the waitlist link points at the
  // public questionnaire fill route we already ship.
  paymentUrl: 'https://app.icount.co.il/m/5e143/c68ea9adp36u69eb5d6?utm_source=iCount&utm_medium=paypage&utm_campaign=54',
  waitlistUrl: 'https://challenge-systemweb-production.up.railway.app/fill/2j08wfox',

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    brand: 'Game Changer',
    title: 'אז מה זה המשחק הזה של ירידה במשקל?',
    tldrLabel: 'בקצרה',
    // <br> lines in the source HTML are preserved as explicit breaks so
    // the visual rhythm matches the original pixel-for-pixel.
    tldrParagraphs: [
      [
        'קבוצה קטנה ואינטימית של עד 10 נשים',
        ['מדרבנות אחת את השנייה לעמוד מול הפיתויים ולסגל אורח חיים ', { em: 'קצת' }, ' פחות פודי!'],
        ['עם דגש על ', { em: 'קצת' }, ' - לא עוד דיאטת כסאח שגורמת לסבל.'],
      ],
      ['והכי חשוב - לעשות את זה בכיף! במשחק!'],
    ],
    points: [
      'המאפים בעבודה מסתכלים עלייך? במקום לסבול מזה, את יכולה להרוויח נקודות.',
      'בחרת לעלות קומה במדרגות במקום במעלית? קיבלת נקודות.',
      'שתית מים? קיבלת נקודות.',
      'כזה פשוט.',
    ],
  },

  // ── Story ────────────────────────────────────────────────────────────
  story: {
    paragraphs: [
      [
        'אחרי 13 דיאטות כושלות',
        '\n',
        'לקחתי את כל ההרגלים שעזרו לי בסוף להצליח ',
        { text: 'לרדת 25 קילו ולשמור על זה', highlight: true },
        '\n',
        'וריכזתי אותם במשחק אחד חוויתי שהופך את הירידה במשקל למשהו כיף במקום טרחה וסבל.',
      ],
      [
        'אין נקודות על כמה קלוריות אכלת או על כמה קילוגרמים ירדת,',
        '\n',
        'אלא רק על פעולות קלות שהן 100% בשליטתך!',
      ],
      'הירידה במשקל זו רק תופעות לוואי כשאנחנו עושות את הפעולות הנכונות.',
      'למשחק קוראים Game Changer - כי זה מה שההרגלים הקטנים האלה היו בשבילי :)',
    ],
    imageCaption: 'כאן תהיה התמונה',
  },

  // ── Highlights ───────────────────────────────────────────────────────
  highlights: {
    title: 'דגשים',
    cards: [
      { emoji: '👀', text: 'זו לא קבוצה המונית שדחסו אליה מאות נשים ובתכל\'ס את לבד - אני רואה אותך, וכולן רואות אותך, כל יום!' },
      { emoji: '🔥', text: 'יש תחרות בריאה בין הבנות, עם מלא השראה ופרגונים בקבוצה כל הזמן.' },
      // Pizza card — line break after "ממנו" only. Text preserved.
      { emoji: '🍕', text: [
        'אין דבר כזה אסור! אכלת משהו "מיותר"? תהני ממנו.',
        'הצלחת להתאפק? תהני מהנקודות והפרגונים!',
      ] },
      // Sparkle card — line break after the first "קל!".
      { emoji: '✨', text: [
        'הדבר הכי חשוב - שיהיה קל!',
        'אם זה לא קל, זה לא יחזיק לאורך זמן.',
      ] },
    ],
    how: {
      question: 'איך זה מתבצע בפועל? מי מנצחת?',
      answer: 'את תביני הכל בהמשך תוך כדי תנועה :)',
    },
  },

  // ── Details ──────────────────────────────────────────────────────────
  details: {
    rows: [
      { icon: '💻', label: 'שיחת פתיחה בזום', value: 'יום ראשון הקרוב, 26/04 בשעה 20:00' },
      { icon: '🚀', label: 'מתחילות בפועל', value: 'למחרת, יום שני על הבוקר' },
      { icon: '📅', label: 'כמה זמן?', value: '11 ימים, עד יום חמישי 07/05' },
      { icon: '📋', label: 'דרישות נוספות', value: 'לפני ובמהלך הדרך יהיו כמה שאלונים שחובה למלא כחלק מההשתתפות.' },
    ],
    priceAmount: '197 ש"ח',
    priceSub: 'עלות',
  },

  // ── CTA ──────────────────────────────────────────────────────────────
  cta: {
    primary: 'אני בפנים - תרשמי אותי!',
    policy: 'אין החזר כספי (מלא או חלקי) לאחר ההרשמה.',
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
            {/* Each paragraph is an array of lines. A line is either a plain
                string or an array of segments (string | { em }) so we can
                emphasize specific words without breaking the sentence. */}
            {c.hero.tldrParagraphs.map((lines, i) => (
              <p key={i}>
                {(lines as ReadonlyArray<string | ReadonlyArray<string | { em: string }>>).map((line, j) => (
                  <span key={j}>
                    {typeof line === 'string'
                      ? line
                      : line.map((seg, k) =>
                          typeof seg === 'string'
                            ? <span key={k}>{seg}</span>
                            : <span key={k} className="tldr-em">{seg.em}</span>,
                        )}
                    {j < lines.length - 1 && <br />}
                  </span>
                ))}
              </p>
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
              // Mixed paragraph: each segment is either a plain string, a
              // literal '\n' (rendered as <br/>), or a highlight object
              // (rendered inside the gold highlight span). Mirrors the
              // original <br> + <span class="story-highlight"> markup.
              const segs = para as ReadonlyArray<string | { text: string; highlight: true }>;
              return (
                <p key={i}>
                  {segs.map((seg, j) => {
                    if (typeof seg === 'string') {
                      return seg === '\n'
                        ? <br key={j} />
                        : <span key={j}>{seg}</span>;
                    }
                    return <span key={j} className="story-highlight">{seg.text}</span>;
                  })}
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
          <h2 className="highlights-title">{c.highlights.title}</h2>
          <div className="highlights-grid">
            {c.highlights.cards.map((card, i) => (
              <div key={i} className="highlight-card">
                <div className="highlight-bullet">{card.emoji}</div>
                {/* Card text is either a single string or an array of lines
                    separated by <br/> — lets admins insert targeted breaks
                    (like the pizza/sparkle cards) without rewriting copy. */}
                {Array.isArray(card.text) ? (
                  <p>
                    {card.text.map((line, j) => (
                      <span key={j}>
                        {line}
                        {j < card.text.length - 1 && <br />}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p>{card.text}</p>
                )}
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
      /* Inline emphasis inside the bkitzra paragraph (the two "קצת"
         occurrences). Uses the gold accent to pop against white-70
         body text without shifting the line height. */
      #lp-game-changer .tldr-em {
        color: var(--gold-light);
        font-weight: 800;
      }
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
      /* Section title above the cards grid — sized and colored to match
         the hero/bkitzra headings for consistency. */
      #lp-game-changer .highlights-title {
        font-size: clamp(24px, 5vw, 36px);
        font-weight: 900;
        color: var(--gold);
        text-align: center;
        margin: 0 0 28px;
        letter-spacing: 1px;
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
