import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { Editor } from '@tiptap/react';

interface SearchPanelProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SearchPanel({ editor, isOpen, onClose }: SearchPanelProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      // Clear search when closed
      setSearchTerm('');
      if (editor && !editor.isDestroyed) {
        editor.commands.setSearchTerm('');
      }
    }
  }, [isOpen, editor]);

  // Global ESC handler specifically for the search panel when open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="absolute top-3 right-3 z-50 flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg rounded-lg px-3 py-2"
        >
          <Search className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              const val = e.target.value;
              setSearchTerm(val);
              if (editor && !editor.isDestroyed) {
                editor.commands.setSearchTerm(val);
                editor.commands.resetIndex();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                  editor?.commands.previousSearchResult();
                } else {
                  editor?.commands.nextSearchResult();
                }
              }
            }}
            placeholder={t('editor.findPlaceholder')}
            className="w-36 md:w-44 text-sm bg-transparent text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none"
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
          />

          {/* Match counter */}
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums whitespace-nowrap min-w-[3ch] text-center select-none">
            {searchTerm && editor
              ? `${editor.storage.searchAndReplace.results.length > 0 ? editor.storage.searchAndReplace.resultIndex + 1 : 0}/${editor.storage.searchAndReplace.results.length}`
              : ''}
          </span>

          {/* Prev / Next */}
          <button
            type="button"
            onClick={() => editor?.commands.previousSearchResult()}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors disabled:opacity-30"
            disabled={!searchTerm || !editor?.storage.searchAndReplace.results.length}
            title={t('editor.findPrev')}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor?.commands.nextSearchResult()}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors disabled:opacity-30"
            disabled={!searchTerm || !editor?.storage.searchAndReplace.results.length}
            title={t('editor.findNext')}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
            title={t('editor.findClose')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
