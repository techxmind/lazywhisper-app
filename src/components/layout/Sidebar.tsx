import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus, FileText, Trash2, Settings, Lock } from 'lucide-react';
import { VaultDocument } from '../../App';

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

  return (
    <motion.aside
      className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full
        shadow-2xl md:shadow-none md:relative pt-[max(env(safe-area-inset-top),1rem)]
      `}
      initial={false}
      animate={{ x: isMobile && !isMobileMenuOpen ? '-100%' : 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
    >
      {/* 顶部区域 Header */}
      <div className="p-6 pb-4">
        <h1 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="h-6 w-6" />
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

      {/* 中间文件列表区 Document List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1">
        {documents.map((file) => (
          <div key={file.id} className="group relative w-full flex items-center">
            <button
              type="button"
              onClick={() => onDocSelect(file.id)}
              className={`flex-1 flex flex-row items-center gap-3 text-left pl-3 pr-8 py-2 rounded-lg transition-colors text-sm ${
                file.id === activeDocId
                  ? 'bg-gray-100/80 font-medium text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate">{file.title || 'Untitled'}</span>
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
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* 底部控制区 Bottom Controls */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
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
