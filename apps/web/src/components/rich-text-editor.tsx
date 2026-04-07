'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        background: active ? '#e0e7ff' : 'transparent',
        color: active ? '#2563eb' : '#374151',
        border: '1px solid',
        borderColor: active ? '#93c5fd' : 'transparent',
        borderRadius: 5,
        padding: '4px 8px',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        lineHeight: 1.4,
        minWidth: 30,
        minHeight: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'הכניסי טקסט...',
  minHeight = 140,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Highlight,
      TextStyle,
    ],
    content: value || '',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // Treat empty editor as empty string
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        dir: 'rtl',
        style: `min-height:${minHeight}px;outline:none;padding:10px 12px;font-size:14px;line-height:1.6;color:#0f172a;`,
      },
    },
  });

  // Sync external value changes (e.g. on template load)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value && value !== undefined) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const url = window.prompt('הכניסי URL:');
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div
      style={{
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#ffffff',
        direction: 'rtl',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          padding: '6px 8px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          alignItems: 'center',
        }}
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="מודגש"
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="נטוי"
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="קו חוצה"
        >
          <s>S</s>
        </ToolbarButton>
        <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="רשימת נקודות"
        >
          ≡
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="רשימה ממוספרת"
        >
          1.
        </ToolbarButton>
        <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
        <ToolbarButton
          onClick={setLink}
          active={editor.isActive('link')}
          title="הוסף קישור"
        >
          🔗
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          title="הדגשת צבע"
        >
          🖍
        </ToolbarButton>
      </div>

      {/* Editor area */}
      <div style={{ position: 'relative' }}>
        {editor.isEmpty && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 12,
              left: 12,
              color: '#94a3b8',
              fontSize: 14,
              pointerEvents: 'none',
              direction: 'rtl',
            }}
          >
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
