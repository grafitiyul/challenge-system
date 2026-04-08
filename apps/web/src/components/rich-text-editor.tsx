'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { useEffect, useState, useRef, useCallback } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

// ─── Color palettes (adapted from recruitment project) ────────────────────────

const TEXT_COLORS = [
  { hex: '#0f172a', label: 'שחור' },
  { hex: '#374151', label: 'כמעט שחור' },
  { hex: '#64748b', label: 'אפור' },
  { hex: '#2563eb', label: 'כחול' },
  { hex: '#16a34a', label: 'ירוק' },
  { hex: '#dc2626', label: 'אדום' },
  { hex: '#d97706', label: 'כתום' },
  { hex: '#7c3aed', label: 'סגול' },
];

const HIGHLIGHT_COLORS = [
  { hex: '#fef08a', label: 'צהוב' },
  { hex: '#bbf7d0', label: 'ירוק' },
  { hex: '#bae6fd', label: 'תכלת' },
  { hex: '#fecaca', label: 'ורוד' },
  { hex: '#fed7aa', label: 'כתום' },
  { hex: '#e9d5ff', label: 'סגול' },
];

// ─── Toolbar button ────────────────────────────────────────────────────────────

function TBtn({
  onClick,
  active,
  title,
  children,
  style: extraStyle,
}: {
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(e); }}
      style={{
        background: active ? '#e0e7ff' : 'transparent',
        color: active ? '#2563eb' : '#374151',
        border: active ? '1px solid #93c5fd' : '1px solid transparent',
        borderRadius: 5,
        padding: '3px 7px',
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        lineHeight: 1.4,
        minWidth: 28,
        minHeight: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...extraStyle,
      }}
    >
      {children}
    </button>
  );
}

const SEP: React.CSSProperties = { width: 1, height: 18, background: '#e2e8f0', margin: '0 3px', flexShrink: 0 };

// ─── Main component ────────────────────────────────────────────────────────────

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'הכניסי טקסט...',
  minHeight = 140,
}: RichTextEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState<'text' | 'highlight' | null>(null);
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
    ],
    content: value || '',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        dir: 'rtl',
        style: `min-height:${minHeight}px;outline:none;padding:12px 14px;font-size:14px;line-height:1.7;color:#0f172a;`,
      },
    },
  });

  // Sync external value changes
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value && value !== undefined) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  // Close popovers when clicking outside the editor container
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowColorPicker(null);
        setShowLinkPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openLinkPopover = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href ?? '';
    setLinkUrl(existing || 'https://');
    setShowLinkPopover(true);
    setShowColorPicker(null);
    setTimeout(() => linkInputRef.current?.focus(), 50);
  }, [editor]);

  function applyLink(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setShowLinkPopover(false);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setShowLinkPopover(false);
  }

  if (!editor) return null;

  const isEmpty = editor.isEmpty;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        style={{
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          overflow: 'visible',
          background: '#ffffff',
          direction: 'rtl',
        }}
      >
        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            padding: '5px 8px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            borderRadius: '8px 8px 0 0',
            alignItems: 'center',
          }}
        >
          {/* Heading dropdown */}
          <select
            title="סגנון"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'p') {
                editor.chain().focus().setParagraph().run();
              } else {
                editor.chain().focus().toggleHeading({ level: Number(val) as 1 | 2 | 3 }).run();
              }
              e.target.value = '';
            }}
            defaultValue=""
            style={{
              height: 26,
              fontSize: 12,
              color: '#374151',
              border: '1px solid #e2e8f0',
              borderRadius: 5,
              background: '#fff',
              cursor: 'pointer',
              padding: '0 4px',
              flexShrink: 0,
              maxWidth: 70,
              outline: 'none',
            }}
          >
            <option value="" disabled>סגנון</option>
            <option value="p">רגיל</option>
            <option value="1">כותרת 1</option>
            <option value="2">כותרת 2</option>
            <option value="3">כותרת 3</option>
          </select>

          <div style={SEP} />

          {/* Bold / Italic / Strike */}
          <TBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="מודגש (Ctrl+B)">
            <strong style={{ fontSize: 14 }}>B</strong>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="נטוי (Ctrl+I)">
            <em style={{ fontSize: 14 }}>I</em>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="קו חוצה">
            <s style={{ fontSize: 13 }}>S</s>
          </TBtn>

          <div style={SEP} />

          {/* Lists */}
          <TBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="רשימת נקודות">
            •≡
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="רשימה ממוספרת">
            1.
          </TBtn>

          <div style={SEP} />

          {/* Text color */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <TBtn
              onClick={() => { setShowColorPicker(v => v === 'text' ? null : 'text'); setShowLinkPopover(false); }}
              active={showColorPicker === 'text'}
              title="צבע טקסט"
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>A</span>
                <span style={{ width: 14, height: 3, borderRadius: 2, background: editor.getAttributes('textStyle').color ?? '#0f172a' }} />
              </span>
            </TBtn>
            {showColorPicker === 'text' && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px', display: 'flex', gap: 5, flexWrap: 'wrap', width: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 300 }}>
                <div style={{ width: '100%', fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>צבע טקסט</div>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.label}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c.hex).run(); setShowColorPicker(null); }}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c.hex, border: '2px solid rgba(0,0,0,0.12)', cursor: 'pointer', flexShrink: 0 }}
                  />
                ))}
                <button
                  type="button"
                  title="נקה צבע"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColorPicker(null); }}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #e2e8f0', cursor: 'pointer', background: '#fff', fontSize: 10, color: '#94a3b8', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Highlight color */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <TBtn
              onClick={() => { setShowColorPicker(v => v === 'highlight' ? null : 'highlight'); setShowLinkPopover(false); }}
              active={showColorPicker === 'highlight'}
              title="צבע רקע"
            >
              <span style={{ fontSize: 12, fontWeight: 700, background: '#fef08a', borderRadius: 3, padding: '1px 3px', color: '#0f172a' }}>H</span>
            </TBtn>
            {showColorPicker === 'highlight' && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px', display: 'flex', gap: 5, flexWrap: 'wrap', width: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 300 }}>
                <div style={{ width: '100%', fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>צבע רקע</div>
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.label}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHighlight({ color: c.hex }).run(); setShowColorPicker(null); }}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c.hex, border: '2px solid rgba(0,0,0,0.1)', cursor: 'pointer', flexShrink: 0 }}
                  />
                ))}
                <button
                  type="button"
                  title="נקה הדגשה"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); setShowColorPicker(null); }}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #e2e8f0', cursor: 'pointer', background: '#fff', fontSize: 10, color: '#94a3b8', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <div style={SEP} />

          {/* Link */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <TBtn onClick={openLinkPopover} active={editor.isActive('link') || showLinkPopover} title="הוסף / ערוך קישור">
              🔗
            </TBtn>
            {showLinkPopover && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', width: 260, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 300 }}>
                <form onSubmit={applyLink}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input
                      ref={linkInputRef}
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://..."
                      dir="ltr"
                      style={{ flex: 1, fontSize: 12, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none' }}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <button
                      type="submit"
                      style={{ fontSize: 12, padding: '6px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {editor.isActive('link') ? 'עדכן' : 'הוסף'}
                    </button>
                  </div>
                  {editor.isActive('link') && (
                    <button
                      type="button"
                      onClick={removeLink}
                      style={{ width: '100%', fontSize: 12, padding: '5px 0', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}
                    >
                      הסר קישור
                    </button>
                  )}
                </form>
              </div>
            )}
          </div>

          {/* Clear formatting */}
          <TBtn
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            title="נקה עיצוב"
            style={{ color: '#94a3b8', fontSize: 12 }}
          >
            ✕
          </TBtn>
        </div>

        {/* ── Editor area ───────────────────────────────────────────────── */}
        <div style={{ position: 'relative' }}>
          {isEmpty && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 14,
                left: 14,
                color: '#94a3b8',
                fontSize: 14,
                pointerEvents: 'none',
                direction: 'rtl',
              }}
            >
              {placeholder}
            </div>
          )}
          <style>{`
            .ProseMirror ul { list-style-type: disc; padding-right: 1.4em; }
            .ProseMirror ol { list-style-type: decimal; padding-right: 1.4em; }
            .ProseMirror li { margin: 2px 0; }
            .ProseMirror h1 { font-size: 1.6em; font-weight: 700; margin: 8px 0 4px; }
            .ProseMirror h2 { font-size: 1.3em; font-weight: 700; margin: 6px 0 4px; }
            .ProseMirror h3 { font-size: 1.1em; font-weight: 600; margin: 4px 0 4px; }
            .ProseMirror a { color: #2563eb; text-decoration: underline; }
            .ProseMirror p { margin: 0 0 4px; }
          `}</style>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
