import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus, FileText, Trash2, Settings, Lock, Search, X } from 'lucide-react';
import { VaultDocument } from '../../App';

/**
 * Progressive UI Threshold:
 * Only show the search box when there are at least this many notes.
 * Keeps the sidebar minimal for small vaults.
 */
const MIN_NOTES_FOR_SEARCH = 5;

interface SidebarProps {
  isMobileMenuOpen: boolean;
  onLock: () => void;
  onOpenSettings: () => void;
  documents: VaultDocument[];
  activeDocId: string | null;
  onDocSelect: (id: string) => void;
  onNewDoc: () => void;
  onDeleteDoc: (id: string) => void;
  unsavedDocIds: Set<string>;
}

export function Sidebar({ isMobileMenuOpen, onLock, onOpenSettings, documents, activeDocId, onDocSelect, onNewDoc, onDeleteDoc, unsavedDocIds }: SidebarProps) {
  const { t } = useTranslation();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // --- Search state ---
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showSearch = documents.length >= MIN_NOTES_FOR_SEARCH;

  // Reset search when dropping below threshold
  useEffect(() => {
    if (!showSearch) {
      setSearchQuery('');
    }
  }, [showSearch]);

  // Filtered document list (case-insensitive title match)
  const filteredDocs = searchQuery
    ? documents.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : documents;

  // --- Global Cmd/Ctrl+P hotkey ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'p' &&
        documents.length >= MIN_NOTES_FOR_SEARCH
      ) {
        e.preventDefault();
        e.stopPropagation();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [documents.length]);

  // Detect Mac for placeholder hint
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  return (
    <motion.aside
      className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col
        shadow-2xl md:shadow-none md:rounded-none rounded-r-2xl md:relative pt-[max(env(safe-area-inset-top),1rem)]
      `}
      initial={false}
      animate={{ x: isMobile && !isMobileMenuOpen ? '-100%' : 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
    >
      {/* 顶部区域 Header */}
      <div className="p-6 pb-4">
        <h1 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <img src="/logo.png" alt={t('sidebar.logoAlt')} className="h-6 w-6" />
          {t('sidebar.brand')}
        </h1>
        <button
          type="button"
          onClick={onNewDoc}
          className="w-full bg-gray-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-900 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('sidebar.new')}
        </button>
      </div>

      {/* 搜索栏 Search (progressive: only shows when >= threshold) */}
      {showSearch && (
        <div className="px-4 pb-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              spellCheck="false"
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sidebar.searchPlaceholder', { shortcut: isMac ? '⌘P' : 'Ctrl+P' })}
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800/50 text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-600 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                className="absolute right-2 p-0.5 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 中间文件列表区 Document List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1">
        {filteredDocs.map((file) => (
          <div key={file.id} className="group relative w-full flex items-center">
            <button
              type="button"
              onClick={() => onDocSelect(file.id)}
              title={file.title || t('sidebar.untitled')}
              className={`flex-1 min-w-0 flex flex-row items-center gap-3 text-left pl-3 pr-10 py-2 rounded-lg transition-colors text-sm ${file.id === activeDocId
                  ? 'bg-gray-100/80 font-medium text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
                }`}
            >
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate block min-w-0 flex-1 text-left">{file.title || t('sidebar.untitled')}</span>
              {unsavedDocIds.has(file.id) && (
                <div className="w-2 h-2 rounded-full bg-blue-500 ml-auto shrink-0 transition-opacity"></div>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDeleteDoc(file.id);
              }}
              className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
              title={t('sidebar.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* Empty search results hint */}
        {showSearch && searchQuery && filteredDocs.length === 0 && (
          <div className="text-center text-xs text-gray-400 dark:text-zinc-500 py-4">
            {t('sidebar.noResults')}
          </div>
        )}
      </div>

      {/* 底部控制区 Bottom Controls */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <button
          type="button"
          className="flex items-center gap-3 w-full text-left px-3 py-2 min-h-[48px] text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={onOpenSettings}
        >
          <Settings className="w-4 h-4" />
          <span>{t('sidebar.settings')}</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-3 w-full text-left px-3 py-2 min-h-[48px] text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={onLock}
        >
          <Lock className="w-4 h-4" />
          <span>{t('sidebar.lock')}</span>
        </button>
      </div>
    </motion.aside>
  );
}
