'use client';

/**
 * RichContentEditor — a contentEditable rich text editor using inline CSS only.
 * Adapted from the grafitiyul-recruitment RichTextEditor (Tailwind → inline styles).
 * Stores content as HTML. RTL/Hebrew ready.
 *
 * Supported: headings, bold/italic/underline/strikethrough, lists, links,
 *            text color, highlight, emoji, clear formatting.
 */

import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';

// Imperative handle exposed via ref — mirrors WhatsAppEditorHandle so
// callers can plug the same variable-button bar into either editor.
export interface RichContentEditorHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

// ── Emoji categories ──────────────────────────────────────────────────────────
const EMOJI_CATS: { label: string; emojis: string[] }[] = [
  { label: '😊', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','☺️','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤫','🤔','😐','😑','😏','😒','🙄','😬','😔','😪','😴','😷','🤒','🤕','😵','🤯','😎','🤓','😕','🙁','😮','😲','😳','🥺','😦','😧','😨','😰','😢','😭','😤','😡','😠','🤬','😈','👿'] },
  { label: '👋', emojis: ['👋','🤚','🖐️','✋','👌','✌️','🤞','👍','👎','✊','👊','👏','🙌','🙏','💪','👀','🫂','💁','🙅','🙆','🤷','🤦','🙋','💃','🕺','🧘','🏃','🚶','👶','👧','👦','👩','👨','🧓','👴','👵','👮','💂','🕵️','👷','👸','🧙','🧝','🧛','🧟','🧞','🧜','🧚','👼','🤰','🤱'] },
  { label: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦅','🦆','🦉','🦇','🐺','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🐙','🦑','🦀','🐬','🐳','🦈','🐘','🦒','🦘','🐕','🐈','🐿️'] },
  { label: '🌸', emojis: ['🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🍃','🍂','🍁','🌾','💐','🌷','🌹','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌙','⭐','🌟','☀️','🌤️','⛅','☁️','🌧️','⛈️','🌨️','❄️','🌈','💧','💦','🔥'] },
  { label: '⚽', emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🥊','🥋','🎽','🛹','⛸️','🥅','⛳','🎯','🎰','🎳','🏆','🥇','🥈','🥉','🏅','🎖️'] },
  { label: '🎉', emojis: ['🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎷','🎸','🎹','🥁','🎮','🕹️','🎲','🎟️','🎫','🎈','🎉','🎊','🎁','🎀','🎄','🎆','🎇','✨','💥','🔥','🌟','🎓','🧩'] },
  { label: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','❤️‍🔥','💌','💋','💯','💢','💬','💭','💤','💫','✨','🌈','🎵','🎊','🎉','🎁','🏆','🥇','🎯','💎','👑','🌺','🌸','🌹','🍀','☘️','🦋'] },
];

const TEXT_COLORS = [
  { hex: '#000000', label: 'שחור' },
  { hex: '#374151', label: 'כמעט שחור' },
  { hex: '#6b7280', label: 'אפור' },
  { hex: '#9ca3af', label: 'אפור בהיר' },
  { hex: '#1B2B5E', label: 'כחול כהה' },
  { hex: '#2563eb', label: 'כחול' },
  { hex: '#2BBCD4', label: 'ציאן' },
  { hex: '#F5A623', label: 'כתום' },
  { hex: '#dc2626', label: 'אדום' },
  { hex: '#16a34a', label: 'ירוק' },
  { hex: '#7c3aed', label: 'סגול' },
  { hex: '#ffffff', label: 'לבן' },
];
const HIGHLIGHT_COLORS = [
  { hex: '#fef08a', label: 'צהוב' },
  { hex: '#bbf7d0', label: 'ירוק' },
  { hex: '#bae6fd', label: 'תכלת' },
  { hex: '#fecaca', label: 'ורוד' },
  { hex: '#fed7aa', label: 'כתום' },
  { hex: '#e9d5ff', label: 'סגול' },
  { hex: 'transparent', label: 'נקה' },
];

const ALLOWED_TAGS = new Set(['b','strong','i','em','u','s','del','br','p','div','h1','h2','h3','ul','ol','li','a','img','iframe']);

function sanitizeHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    const el = node as HTMLElement;
    const tag = el.tagName?.toLowerCase() ?? '';
    let inner = '';
    for (const child of el.childNodes) inner += walk(child);
    if (tag === 'br') return '<br>';
    if (tag === 'span' || tag === 'font') return inner;
    if (!ALLOWED_TAGS.has(tag)) return inner;
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        return `<a href="${href}" target="_blank" rel="noopener">${inner}</a>`;
      }
      return inner;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      if (/^https?:\/\//i.test(src)) {
        return `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;border-radius:6px;" />`;
      }
      return '';
    }
    if (tag === 'iframe') {
      const src = el.getAttribute('src') ?? '';
      const allowed = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i;
      if (allowed.test(src)) {
        return `<iframe src="${src}" width="100%" height="315" frameborder="0" allowfullscreen style="border-radius:8px;display:block;"></iframe>`;
      }
      return '';
    }
    return `<${tag}>${inner}</${tag}>`;
  }
  let result = '';
  for (const child of tmp.childNodes) result += walk(child);
  return result;
}

function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractVimeoId(url: string): string | null {
  const m = url.match(/(?:vimeo\.com\/)(\d+)/);
  return m ? m[1] : null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface RichContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const RichContentEditor = forwardRef<RichContentEditorHandle, RichContentEditorProps>(function RichContentEditor(
  { value, onChange, placeholder, minHeight = 160 },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedRef = useRef(value);

  const [focused, setFocused] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCat, setEmojiCat] = useState(0);
  const [showColorPicker, setShowColorPicker] = useState<'text' | 'highlight' | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('https://');
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  // Sync external value → DOM
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastEmittedRef.current && el.innerHTML !== '') return;
    if (el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  function syncValue() {
    const el = editorRef.current;
    if (!el) return;
    const raw = el.innerHTML;
    const html = (raw === '<br>' || raw === '<div><br></div>' || raw === '<p><br></p>') ? '' : raw;
    lastEmittedRef.current = html;
    onChange(html);
  }

  function exec(cmd: string, val?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncValue();
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
  }

  // Imperative insertion. If the saved selection isn't inside the editor
  // (user clicked an external button that took focus away), append to
  // the end so the variable still lands in the body.
  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    if (savedRangeRef.current && el.contains(savedRangeRef.current.startContainer)) {
      restoreSelection();
      document.execCommand('insertText', false, text);
    } else {
      // Move caret to end, then insert
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('insertText', false, text);
    }
    savedRangeRef.current = null;
    syncValue();
  }

  useImperativeHandle(ref, () => ({
    insertAtCursor,
    focus: () => editorRef.current?.focus(),
  }));

  function getAnchorAtCursor(): HTMLAnchorElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    while (node && node !== editorRef.current) {
      if ((node as HTMLElement).tagName === 'A') return node as HTMLAnchorElement;
      node = node.parentNode;
    }
    return null;
  }


  function handleLinkInsert(e: React.FormEvent) {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url || (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url))) return;
    setShowLinkInput(false);
    setLinkUrl('https://');
    editorRef.current?.focus();
    restoreSelection();
    savedRangeRef.current = null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
      document.execCommand('unlink', false);
      const updSel = window.getSelection();
      if (!updSel || updSel.rangeCount === 0) return;
      const updRange = updSel.getRangeAt(0);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      try { updRange.surroundContents(a); } catch {
        document.execCommand('createLink', false, url);
        editorRef.current?.querySelectorAll<HTMLAnchorElement>(`a[href="${url}"]`).forEach(el => { el.target = '_blank'; el.rel = 'noopener noreferrer'; });
      }
    } else {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
      range.insertNode(a);
      range.setStartAfter(a); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    }
    syncValue();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : text);
    syncValue();
  }

  function insertImageAtCursor(url: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.style.cssText = 'max-width:100%;height:auto;border-radius:6px;';
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    } else {
      el.appendChild(img);
    }
    syncValue();
  }

  function insertVideoAtCursor(url: string) {
    const el = editorRef.current;
    if (!el) return;
    let embedSrc = '';
    const ytId = extractYoutubeId(url);
    const viId = extractVimeoId(url);
    if (ytId) embedSrc = `https://www.youtube-nocookie.com/embed/${ytId}`;
    else if (viId) embedSrc = `https://player.vimeo.com/video/${viId}`;
    if (!embedSrc) return;
    el.focus();
    const iframe = document.createElement('iframe');
    iframe.src = embedSrc; iframe.width = '100%'; iframe.height = '315';
    iframe.setAttribute('frameborder', '0'); iframe.setAttribute('allowfullscreen', '');
    iframe.style.cssText = 'border-radius:8px;display:block;';
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(iframe);
      range.setStartAfter(iframe); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    } else {
      el.appendChild(iframe);
    }
    syncValue();
  }

  function handleImageInsert(e: React.FormEvent) {
    e.preventDefault();
    const url = imageUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    setShowImageInput(false); setImageUrl('https://');
    insertImageAtCursor(url);
  }

  function handleVideoInsert(e: React.FormEvent) {
    e.preventDefault();
    const url = videoUrl.trim();
    if (!url) return;
    setShowVideoInput(false); setVideoUrl('');
    insertVideoAtCursor(url);
  }

  function closeAll() { setShowEmoji(false); setShowColorPicker(null); setShowImageInput(false); setShowVideoInput(false); }

  const isEmpty = !value || value === '<br>' || value === '<div><br></div>' || value === '<p><br></p>';

  // ── Styles ──────────────────────────────────────────────────────────────────
  const border = focused ? '1px solid #2563eb' : '1px solid #d1d5db';
  const btnBase: React.CSSProperties = {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, color: '#374151', flexShrink: 0,
  };
  const sep: React.CSSProperties = { width: 1, height: 16, background: '#e2e8f0', margin: '0 2px', flexShrink: 0 };

  return (
    <div
      style={{ border, borderRadius: 8, overflow: 'visible', transition: 'border-color 0.15s' }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          closeAll();
          setShowLinkInput(false);
          setFocused(false);
        }
      }}
      onFocus={() => setFocused(true)}
    >
      {/* ── Toolbar ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 1, padding: '6px 8px',
        borderBottom: '1px solid #e5e7eb', background: '#f8fafc',
        borderRadius: '8px 8px 0 0', flexWrap: 'wrap',
      }}>

        {/* Heading */}
        <select
          title="סגנון כותרת"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => { exec('formatBlock', e.target.value); e.target.value = ''; }}
          defaultValue=""
          style={{ height: 26, fontSize: 11, color: '#374151', border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff', cursor: 'pointer', padding: '0 2px', maxWidth: 70, flexShrink: 0 }}
        >
          <option value="" disabled>סגנון</option>
          <option value="div">רגיל</option>
          <option value="h1">כותרת 1</option>
          <option value="h2">כותרת 2</option>
          <option value="h3">כותרת 3</option>
        </select>

        <span style={sep} />

        {/* Bold / Italic / Underline / Strike */}
        {[
          { title: 'מודגש (Ctrl+B)', cmd: 'bold', label: <strong>B</strong> },
          { title: 'נטוי (Ctrl+I)', cmd: 'italic', label: <em>I</em> },
          { title: 'קו תחתון (Ctrl+U)', cmd: 'underline', label: <u>U</u> },
          { title: 'קו חוצה', cmd: 'strikeThrough', label: <s>S</s> },
        ].map((item) => (
          <button key={item.cmd} type="button" title={item.title}
            onMouseDown={(e) => { e.preventDefault(); exec(item.cmd); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >{item.label}</button>
        ))}

        <span style={sep} />

        {/* Alignment */}
        {[
          { title: 'יישור ימין', cmd: 'justifyRight', label: '⇒' },
          { title: 'מרכז', cmd: 'justifyCenter', label: '≡' },
          { title: 'יישור שמאל', cmd: 'justifyLeft', label: '⇐' },
        ].map((item) => (
          <button key={item.cmd} type="button" title={item.title}
            onMouseDown={(e) => { e.preventDefault(); exec(item.cmd); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >{item.label}</button>
        ))}

        <span style={sep} />

        {/* Lists */}
        <button type="button" title="רשימת נקודות" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} style={btnBase}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}>•</button>
        <button type="button" title="רשימה ממוספרת" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }} style={btnBase}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}>1.</button>

        <span style={sep} />

        {/* Text color */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="צבע טקסט"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setShowColorPicker(v => v === 'text' ? null : 'text'); setShowEmoji(false); setShowLinkInput(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12, lineHeight: 1 }}>A</span>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: '#2563eb', marginTop: 1 }} />
            </span>
          </button>
          {showColorPicker === 'text' && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 136 }} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, textAlign: 'right' }}>צבע טקסט</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                {TEXT_COLORS.map(c => (
                  <button key={c.hex} type="button" title={c.label}
                    onMouseDown={(e) => { e.preventDefault(); restoreSelection(); exec('foreColor', c.hex); setShowColorPicker(null); }}
                    style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #e2e8f0', background: c.hex, cursor: 'pointer' }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Highlight */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="צבע רקע"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setShowColorPicker(v => v === 'highlight' ? null : 'highlight'); setShowEmoji(false); setShowLinkInput(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >
            <span style={{ fontWeight: 500, fontSize: 11, background: '#fef08a', padding: '1px 3px', borderRadius: 2 }}>H</span>
          </button>
          {showColorPicker === 'highlight' && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 136 }} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, textAlign: 'right' }}>צבע רקע</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c.hex} type="button" title={c.label}
                    onMouseDown={(e) => {
                      e.preventDefault(); restoreSelection();
                      exec('hiliteColor', c.hex === 'transparent' ? 'transparent' : c.hex);
                      setShowColorPicker(null);
                    }}
                    style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #e2e8f0', background: c.hex === 'transparent' ? undefined : c.hex, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {c.hex === 'transparent' && <span style={{ fontSize: 9, color: '#6b7280' }}>✕</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <span style={sep} />

        {/* Link */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="הוסף / ערוך קישור"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); const existing = getAnchorAtCursor(); setLinkUrl(existing?.href ?? 'https://'); setShowLinkInput(v => !v); setShowColorPicker(null); setShowEmoji(false); setShowImageInput(false); setShowVideoInput(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >🔗</button>
          {showLinkInput && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 240 }} onMouseDown={(e) => e.preventDefault()}>
              <form onSubmit={handleLinkInsert}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    ref={linkInputRef} autoFocus type="url" value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 5, outline: 'none' }}
                  />
                  <button type="submit" style={{ fontSize: 12, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {getAnchorAtCursor() ? 'עדכן' : 'הוסף'}
                  </button>
                </div>
                {getAnchorAtCursor() && (
                  <button type="button"
                    onMouseDown={(e) => { e.preventDefault(); setShowLinkInput(false); editorRef.current?.focus(); restoreSelection(); savedRangeRef.current = null; document.execCommand('unlink', false); syncValue(); }}
                    style={{ width: '100%', fontSize: 12, padding: '4px 8px', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, background: 'none', cursor: 'pointer' }}
                  >הסר קישור</button>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Image */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="הוסף תמונה (URL)"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setShowImageInput(v => !v); setShowVideoInput(false); setShowLinkInput(false); setShowColorPicker(null); setShowEmoji(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >🖼</button>
          {showImageInput && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 260 }} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5 }}>כתובת תמונה (URL)</div>
              <form onSubmit={handleImageInsert}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input autoFocus type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." dir="ltr"
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 5, outline: 'none' }}
                  />
                  <button type="submit" style={{ fontSize: 12, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>הוסף</button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Video embed */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="הטמע סרטון (YouTube / Vimeo)"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setShowVideoInput(v => !v); setShowImageInput(false); setShowLinkInput(false); setShowColorPicker(null); setShowEmoji(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >▶</button>
          {showVideoInput && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 280 }} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5 }}>קישור YouTube / Vimeo</div>
              <form onSubmit={handleVideoInsert}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input autoFocus type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/... או vimeo.com/..." dir="ltr"
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 5, outline: 'none' }}
                  />
                  <button type="submit" style={{ fontSize: 12, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>הטמע</button>
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>YouTube, YouTube Shorts, Vimeo</div>
              </form>
            </div>
          )}
        </div>

        {/* Clear formatting */}
        <button type="button" title="נקה עיצוב" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} style={btnBase}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}>✕</button>

        <span style={sep} />

        {/* Emoji */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" title="הוסף אימוג'י"
            onMouseDown={(e) => { e.preventDefault(); setShowEmoji(v => !v); setShowColorPicker(null); setShowLinkInput(false); }}
            style={btnBase}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >😊</button>
          {showEmoji && (
            <div style={{ position: 'absolute', top: '100%', marginTop: 4, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', width: 280 }} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #f1f5f9', padding: '4px 4px 0' }}>
                {EMOJI_CATS.map((cat, i) => (
                  <button key={i} type="button" onMouseDown={(e) => { e.preventDefault(); setEmojiCat(i); }}
                    style={{ fontSize: 14, padding: '4px 6px', borderRadius: '4px 4px 0 0', background: emojiCat === i ? '#eff6ff' : 'none', border: 'none', cursor: 'pointer', flexShrink: 0, color: emojiCat === i ? '#2563eb' : '#9ca3af' }}
                    title={cat.label}
                  >{cat.label}</button>
                ))}
              </div>
              <div style={{ padding: 6, maxHeight: 160, overflowY: 'auto' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {EMOJI_CATS[emojiCat].emojis.map((emoji, i) => (
                    <button key={i} type="button"
                      onMouseDown={(e) => { e.preventDefault(); insertAtCursor(emoji); setShowEmoji(false); }}
                      style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                    >{emoji}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Editor area ── */}
      <div style={{ position: 'relative', maxHeight: 500, overflowY: 'auto' }}>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          dir="rtl"
          onInput={syncValue}
          onPaste={handlePaste}
          style={{
            minHeight,
            padding: '10px 14px',
            outline: 'none',
            fontSize: 14,
            lineHeight: 1.7,
            color: '#0f172a',
            direction: 'rtl',
            wordBreak: 'break-word',
            borderRadius: '0 0 8px 8px',
          }}
        />
        {isEmpty && placeholder && (
          <div style={{ position: 'absolute', top: 0, right: 0, left: 0, padding: '10px 14px', fontSize: 14, color: '#9ca3af', pointerEvents: 'none', userSelect: 'none' }}>
            {placeholder}
          </div>
        )}
      </div>

      {/* Inline styles for rendered content — injected once at mount */}
      <style>{`
        [contenteditable] ul { list-style: disc; padding-right: 20px; }
        [contenteditable] ol { list-style: decimal; padding-right: 20px; }
        [contenteditable] li { margin: 2px 0; }
        [contenteditable] h1 { font-size: 1.5em; font-weight: 700; margin: 6px 0; }
        [contenteditable] h2 { font-size: 1.25em; font-weight: 700; margin: 5px 0; }
        [contenteditable] h3 { font-size: 1.1em; font-weight: 600; margin: 4px 0; }
        [contenteditable] a { color: #2563eb; text-decoration: underline; }
      `}</style>
    </div>
  );
});

export default RichContentEditor;
