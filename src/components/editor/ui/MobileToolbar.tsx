import { useTranslation } from 'react-i18next';
import { Bold, Italic, Highlighter, Palette, Image as ImageIcon, Lock } from 'lucide-react';
import { Editor } from '@tiptap/react';

interface MobileToolbarProps {
  editor: Editor | null;
  keyboardHeight: number;
  onSealClick: () => void;
}

export function MobileToolbar({ editor, keyboardHeight, onSealClick }: MobileToolbarProps) {
  const { t } = useTranslation();

  if (!editor) return null;

  return (
    <div
      className="md:hidden fixed z-[45] left-0 right-0 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_10px_rgba(0,0,0,0.2)] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      style={{ bottom: keyboardHeight > 0 ? keyboardHeight : 0, transition: 'bottom 0.1s ease-out' }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-2 rounded-md transition-colors shrink-0 ${editor.isActive('bold') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
      >
        <Bold className="w-5 h-5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-2 rounded-md transition-colors shrink-0 ${editor.isActive('italic') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
      >
        <Italic className="w-5 h-5" />
      </button>

      {/* Text Color Picker */}
      <div className="relative shrink-0 flex items-center justify-center p-2 rounded-md transition-colors text-zinc-500 hover:text-zinc-800">
        <Palette className="w-5 h-5 absolute pointer-events-none" />
        <input
          type="color"
          className="w-5 h-5 opacity-0 cursor-pointer"
          onChange={(e) => {
            editor.chain().focus().setColor(e.target.value).run();
          }}
        />
      </div>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={`p-2 rounded-md transition-colors shrink-0 ${editor.isActive('highlight') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
      >
        <Highlighter className="w-5 h-5" />
      </button>

      {/* Image Upload */}
      <div className="relative shrink-0 flex items-center justify-center p-2 rounded-md transition-colors text-zinc-500 hover:text-zinc-800">
        <ImageIcon className="w-5 h-5 absolute pointer-events-none" />
        <input
          type="file"
          accept="image/*"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (event) => {
                const base64 = event.target?.result as string;
                editor.chain().focus().setImage({ src: base64 }).run();
              };
              reader.readAsDataURL(file);
            }
            e.target.value = '';
          }}
        />
      </div>

      <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700 mx-2 shrink-0"></div>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSealClick}
        className="flex items-center justify-center gap-1.5 p-2 px-3 shrink-0 rounded-md transition-colors text-blue-600 dark:text-blue-500 bg-blue-50 dark:bg-blue-900/30 font-medium ml-auto"
      >
        <Lock className="w-5 h-5" />
        <span className="text-sm">{t('menu.whisper')}</span>
      </button>
    </div>
  );
}
