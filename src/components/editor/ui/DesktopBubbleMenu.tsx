import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Palette, Highlighter, Image as ImageIcon, Lock } from 'lucide-react';
import { Editor, BubbleMenu } from '@tiptap/react';

interface DesktopBubbleMenuProps {
  editor: Editor | null;
  onSealClick: () => void;
}

export function DesktopBubbleMenu({ editor, onSealClick }: DesktopBubbleMenuProps) {
  const { t } = useTranslation();
  const [showPalette, setShowPalette] = useState(false);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 100,
        maxWidth: '90vw',
        offset: [0, 12],
      }}
      className={`flex items-center p-1 space-x-1 bg-white border border-gray-200 shadow-md rounded-lg relative transition-opacity duration-150 opacity-100`}
      shouldShow={({ state, from, to }) => {
        // Tiptap native state checks

        if (typeof window !== 'undefined' && window.innerWidth < 768) return false;

        // Allow Tiptap state checking
        const { doc, selection } = state;
        const { empty } = selection;
        if (empty) return false;

        const text = doc.textBetween(from, to, ' ');
        if (text.trim() === '') return false;

        // Tiptap state already correctly models Prosemirror's logical selection.
        // DO NOT check window.getSelection() here natively because clicking the BubbleMenu buttons 
        // natively collapses the DOM selection, triggering a premature exact-frame unmount before clicks register!
        return true;
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onMouseUp={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={`p-1.5 rounded-md transition-colors ${editor.isActive('bold') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
        title={t('menu.bold')}
      >
        <Bold className="w-4 h-4" />
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onMouseUp={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={`p-1.5 rounded-md transition-colors ${editor.isActive('italic') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
        title={t('menu.italic')}
      >
        <Italic className="w-4 h-4" />
      </button>

      <div className="w-px h-4 bg-gray-200 mx-1"></div>

      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onMouseUp={(e) => { e.preventDefault(); setShowPalette(!showPalette); }}
          className="p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 rounded-md transition-colors"
          title={t('editor.textColor')}
        >
          <Palette className="w-4 h-4" />
        </button>
        {showPalette && (
          <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 shadow-lg rounded-lg p-2 flex gap-1 z-50">
            {['#000000', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#FFFFFF'].map(color => (
              <button
                key={color}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseUp={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(color).run();
                  setShowPalette(false);
                }}
                className="w-6 h-6 rounded-full border border-gray-200 transition-transform hover:scale-110"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onMouseUp={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}
        className={`p-1.5 rounded-md transition-colors ${editor.isActive('highlight') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
        title={t('editor.highlight')}
      >
        <Highlighter className="w-4 h-4" />
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onMouseUp={(e) => {
          e.preventDefault();
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.onchange = (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files[0]) {
              const reader = new FileReader();
              reader.onload = (e) => {
                const base64 = e.target?.result as string;
                editor.chain().focus().setImage({ src: base64 }).run();
              };
              reader.readAsDataURL(target.files[0]);
            }
          };
          fileInput.click();
        }}
        className="p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 rounded-md transition-colors"
        title={t('editor.insertImage')}
      >
        <ImageIcon className="w-4 h-4" />
      </button>

      <div className="w-px h-4 bg-gray-200 mx-1"></div>

      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); }}
        onMouseUp={(e) => {
          e.preventDefault();
          setTimeout(() => {
            onSealClick();
          }, 0);
        }}
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
      >
        <Lock className="w-3.5 h-3.5" />
        {t('menu.whisper')}
      </button>
    </BubbleMenu>
  );
}
