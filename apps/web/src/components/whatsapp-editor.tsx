'use client';

/**
 * WhatsAppEditor — WYSIWYG editor for WhatsApp messages.
 *
 * Architecture ported from grafitiyul-recruitment WhatsAppEditor.tsx.
 * Converted from Tailwind CSS to inline React.CSSProperties.
 *
 * Supports: bold (*text*), italic (_text_), strikethrough (~text~), bullets, emoji.
 * Preview toggle shows the raw WA markdown that will be sent.
 * Variables support removed (recruitment-specific, not needed here).
 */

import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';

// Imperative handle exposed via ref — lets callers programmatically
// insert a variable at the cursor position without re-implementing the
// editor. Kept minimal on purpose; add methods here only when a feature
// genuinely needs direct editor control.
export interface WhatsAppEditorHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

// ─── Emoji categories ─────────────────────────────────────────────────────────

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: '😊 סמיילים',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','😘','😋','😛','😜','🤩','😎','🤔','😐','😑','😏','🙄','😬','😔','😢','😭','😱','😤','😡','🤬','🥱','😴','🤗','🤭','🫢','🫣','🤫','😶'],
  },
  {
    label: '👋 אנשים',
    emojis: ['👋','🤚','✋','👌','✌️','👍','👎','✊','👊','👏','🙌','🙏','💪','💅','🤝','👶','👧','👦','👩','👨','🧑','👴','👵','💃','🕺','🏃','🚶','🧘'],
  },
  {
    label: '🌸 טבע',
    emojis: ['🌵','🎄','🌲','🌳','🌴','🌱','🌿','🍀','🍂','🍁','💐','🌷','🌹','🌺','🌸','🌼','🌻','🌞','☀️','🌤','⛅','🌧','⛈','❄️','🌊','🔥','🌈','⭐','🌟','💫','✨'],
  },
  {
    label: '💪 ספורט',
    emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🥊','🥋','🎽','🏋️','🤸','⛹️','🚴','🏄','🏊','🧗','🏆','🥇','🥈','🥉','🎯'],
  },
  {
    label: '❤️ לבבות',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','❤️‍🔥','🌹','💌','💋','💯','🎉','🎊','🏅','👑','🌟','✨','💎'],
  },
];

// ─── WA markdown ↔ HTML conversion ────────────────────────────────────────────

function applyInlineMarkdown(line: string): string {
  return line
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<del>$1</del>');
}

function waMarkdownToHtml(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const parts: string[] = [];
  let inList = false;
  for (const line of lines) {
    const bulletMatch = line.match(/^-\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) { parts.push('<ul>'); inList = true; }
      parts.push(`<li>${applyInlineMarkdown(bulletMatch[1])}</li>`);
    } else {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<div>${applyInlineMarkdown(line) || '<br>'}</div>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('');
}

function htmlToWaMarkdown(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    const el = node as Element;
    let inner = '';
    for (const child of el.childNodes) inner += walk(child);
    switch (el.nodeName) {
      case 'STRONG': case 'B': return `*${inner}*`;
      case 'EM': case 'I': return `_${inner}_`;
      case 'DEL': case 'S': return `~${inner}~`;
      case 'BR': return '\n';
      case 'LI': return `- ${inner}${inner.endsWith('\n') ? '' : '\n'}`;
      case 'UL': case 'OL': return inner;
      case 'DIV': case 'P': return inner + (inner.endsWith('\n') ? '' : '\n');
      default: return inner;
    }
  }

  let result = '';
  const topChildren = Array.from(div.childNodes);
  for (let i = 0; i < topChildren.length; i++) {
    const child = topChildren[i];
    const part = walk(child);
    result += part;
    if (child.nodeType === Node.TEXT_NODE && part.trim() && !result.endsWith('\n')) {
      const next = topChildren[i + 1];
      const BLOCK = new Set(['DIV', 'P', 'UL', 'OL']);
      if (next && next.nodeType === Node.ELEMENT_NODE && BLOCK.has((next as Element).nodeName)) {
        result += '\n';
      }
    }
  }
  return result.replace(/\n+$/, '');
}

// ─── Component ────────────────────────────────────────────────────────────────

interface WhatsAppEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

const WhatsAppEditor = forwardRef<WhatsAppEditorHandle, WhatsAppEditorProps>(function WhatsAppEditor({
  value,
  onChange,
  placeholder = 'הקלידי הודעה...',
  minHeight = 120,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [focused, setFocused] = useState(false);
  const lastEmittedRef = useRef(value);

  // Sync external value into editor
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastEmittedRef.current && el.innerHTML !== '') return;
    const html = waMarkdownToHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [value]);

  function syncValue() {
    const el = editorRef.current;
    if (!el) return;
    const raw = el.innerHTML;
    if (!raw || raw === '<br>' || raw === '<div><br></div>') {
      lastEmittedRef.current = '';
      onChange('');
      return;
    }
    const md = htmlToWaMarkdown(raw);
    lastEmittedRef.current = md;
    onChange(md);
  }

  function execFormat(command: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, undefined);
    syncValue();
  }

  function insertBullet() {
    editorRef.current?.focus();
    document.execCommand('insertUnorderedList', false, undefined);
    syncValue();
  }

  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    // If the selection isn't inside the editor (e.g. the user clicked a
    // variable button which stole focus), fall back to appending.
    const inside = sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
    if (inside) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.appendChild(document.createTextNode(text));
      // Move caret to end so a subsequent insert chains naturally.
      const newRange = document.createRange();
      newRange.selectNodeContents(el);
      newRange.collapse(false);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(newRange);
    }
    syncValue();
  }

  useImperativeHandle(ref, () => ({
    insertAtCursor,
    focus: () => editorRef.current?.focus(),
  }));

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    syncValue();
  }

  const isEmpty = !value;

  const tbtnStyle: React.CSSProperties = {
    fontSize: 12, padding: '3px 8px', border: '1px solid #e2e8f0',
    borderRadius: 5, background: '#ffffff', cursor: 'pointer',
    color: '#374151', flexShrink: 0, lineHeight: 1.4,
    display: 'flex', alignItems: 'center',
  };

  return (
    <>
      {/* Inject editor-specific styles once */}
      <style>{`
        .wa-editor strong, .wa-editor b { font-weight: 700; }
        .wa-editor em, .wa-editor i { font-style: italic; }
        .wa-editor del, .wa-editor s { text-decoration: line-through; }
        .wa-editor ul { list-style: disc; padding-inline-start: 20px; margin: 4px 0; }
        .wa-editor li { margin: 2px 0; }
      `}</style>

      <div style={{
        border: `1.5px solid ${focused ? '#22c55e' : '#d1d5db'}`,
        borderRadius: 10, overflow: 'visible',
        transition: 'border-color 0.15s',
      }}>
        {/* ── Toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '6px 10px', borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb', borderRadius: '8px 8px 0 0',
        }}>
          {!showPreview && (
            <>
              <button type="button" title="מודגש (*טקסט*)"
                onMouseDown={(e) => { e.preventDefault(); execFormat('bold'); }}
                style={{ ...tbtnStyle, fontWeight: 700 }}>B</button>
              <button type="button" title="נטוי (_טקסט_)"
                onMouseDown={(e) => { e.preventDefault(); execFormat('italic'); }}
                style={{ ...tbtnStyle, fontStyle: 'italic' }}>I</button>
              <button type="button" title="קו חוצה (~טקסט~)"
                onMouseDown={(e) => { e.preventDefault(); execFormat('strikeThrough'); }}
                style={{ ...tbtnStyle, textDecoration: 'line-through' }}>S</button>
              <button type="button" title="רשימה"
                onMouseDown={(e) => { e.preventDefault(); insertBullet(); }}
                style={tbtnStyle}>•</button>

              <div style={{ width: 1, height: 16, background: '#e2e8f0', margin: '0 2px', flexShrink: 0 }} />

              {/* Emoji picker */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button type="button" title="אימוג׳י"
                  onMouseDown={(e) => { e.preventDefault(); setShowEmoji((v) => !v); }}
                  style={tbtnStyle}>😊</button>
                {showEmoji && (
                  <div
                    style={{
                      position: 'absolute', top: '100%', right: 0, zIndex: 200,
                      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.15)', width: 280,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {/* Category tabs */}
                    <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #f1f5f9', padding: '4px 4px 0' }}>
                      {EMOJI_CATEGORIES.map((cat, i) => (
                        <button key={i} type="button"
                          onMouseDown={(e) => { e.preventDefault(); setEmojiCategory(i); }}
                          style={{
                            background: emojiCategory === i ? '#dcfce7' : 'none',
                            color: emojiCategory === i ? '#16a34a' : '#9ca3af',
                            border: 'none', borderRadius: '6px 6px 0 0',
                            padding: '4px 8px', fontSize: 15, cursor: 'pointer', flexShrink: 0,
                          }}
                          title={cat.label}
                        >{cat.emojis[0]}</button>
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: '#9ca3af', padding: '4px 10px', margin: 0, borderBottom: '1px solid #f1f5f9' }}>
                      {EMOJI_CATEGORIES[emojiCategory].label}
                    </p>
                    <div style={{ padding: 8, maxHeight: 160, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                        {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji, idx) => (
                          <button key={idx} type="button"
                            onMouseDown={(e) => { e.preventDefault(); insertAtCursor(emoji); setShowEmoji(false); }}
                            style={{
                              width: 32, height: 32, fontSize: 18, background: 'none', border: 'none',
                              borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >{emoji}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Preview toggle */}
          <button type="button"
            onClick={() => { setShowPreview((v) => !v); setShowEmoji(false); }}
            style={{
              marginRight: 'auto', fontSize: 12, color: showPreview ? '#16a34a' : '#9ca3af',
              background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '3px 6px',
            }}
            title={showPreview ? 'חזור לעריכה' : 'תצוגת פורמט WA שישלח'}
          >
            {showPreview ? '← עריכה' : 'תצוגת WA'}
          </button>
        </div>

        {/* ── Preview pane ── */}
        {showPreview && (
          <div dir="rtl" style={{
            padding: '10px 14px', fontSize: 14, fontFamily: 'monospace',
            color: '#374151', whiteSpace: 'pre-wrap', minHeight,
            lineHeight: 1.6,
          }}>
            {value || <span style={{ color: '#d1d5db' }}>{placeholder}</span>}
          </div>
        )}

        {/* ── Editor ── */}
        <div style={{ display: showPreview ? 'none' : 'block', position: 'relative' }}>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="wa-editor"
            dir="rtl"
            onInput={syncValue}
            onPaste={handlePaste}
            onFocus={() => { setFocused(true); }}
            onBlur={() => { setFocused(false); setShowEmoji(false); }}
            style={{
              padding: '10px 14px', fontSize: 14, color: '#111827',
              outline: 'none', minHeight, direction: 'rtl', lineHeight: 1.6,
              wordBreak: 'break-word', borderRadius: '0 0 8px 8px',
            }}
          />
          {isEmpty && (
            <div style={{
              position: 'absolute', top: 0, right: 0, left: 0,
              padding: '10px 14px', fontSize: 14, color: '#d1d5db',
              pointerEvents: 'none', direction: 'rtl',
            }}>
              {placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Hint */}
      <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>
        <strong>B</strong> = מודגש &nbsp;·&nbsp; <em>I</em> = נטוי &nbsp;·&nbsp;
        <span style={{ textDecoration: 'line-through' }}>S</span> = קו חוצה &nbsp;·&nbsp;
        תצוגת WA = הפורמט שישלח
      </p>
    </>
  );
});

export default WhatsAppEditor;
