import { useTranslation } from "react-i18next";
import { nativeStore } from '../../store';
import { useAppStore } from '../../store';
import { FileQuestion, RefreshCw, FolderOpen, TriangleAlert } from 'lucide-react';
import { type } from '@tauri-apps/plugin-os';
import { confirm } from '@tauri-apps/plugin-dialog';

interface GhostPathScreenProps {
  vaultPath: string;
  onFindBackup: () => void;
  onResetToOnboarding: () => void;
  onForceRecreate: () => void;
}

export function GhostPathScreen({ vaultPath, onFindBackup, onResetToOnboarding, onForceRecreate }: GhostPathScreenProps) {
  const { t } = useTranslation();

  const handleReset = async () => {
    // 1. Physically wipe the ghost pointer from Native Store
    await nativeStore.delete('lazywhisper-vault-path');
    await nativeStore.save();
    
    // 2. Wipe memory state
    useAppStore.getState().setVaultPath(null);
    
    // 3. Trigger app routing callback
    onResetToOnboarding();
  };

  const handleForceRecreate = async () => {
    const isConfirmed = await confirm(t('ghost.forceConfirmDesc'), {
      title: t('ghost.forceConfirmTitle'),
      kind: 'warning'
    });
    if (isConfirmed) {
      onForceRecreate();
    }
  };

  const isMobile = type() === 'ios' || type() === 'android';
  const displayPath = isMobile ? t('ghost.mobilePath') : vaultPath;

  return (
    <div className="fixed inset-0 w-full h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 font-sans overflow-hidden z-50">
      {/* Visual Ambiance */}
      <div className="absolute w-96 h-96 top-[-10%] left-[-10%] rounded-full bg-red-300/20 dark:bg-red-900/20 blur-[120px] mix-blend-multiply dark:mix-blend-screen pointer-events-none" />
      <div className="absolute w-[30rem] h-[30rem] bottom-[-20%] right-[-10%] rounded-full bg-orange-300/20 dark:bg-orange-900/20 blur-[120px] mix-blend-multiply dark:mix-blend-screen pointer-events-none" />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center gap-8">
        
        {/* Warning Iconography */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-3xl shadow-xl shadow-amber-500/10 flex items-center justify-center flex-shrink-0">
            <FileQuestion className="w-10 h-10 stroke-[2]" />
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('ghost.title')}
            </h1>
            <div className="bg-white/50 backdrop-blur-md dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-zinc-800/50 border-l-4 border-l-amber-400 dark:border-l-amber-500 rounded-xl p-4 text-left shadow-sm">
              <p className="text-[14px] text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {t('ghost.desc', { path: displayPath })}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 w-full px-2">
          {/* Main Action: Find Backup */}
          <button
            onClick={onFindBackup}
            className="group relative w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 active:scale-[0.98] shadow-md shadow-blue-600/20"
          >
            <div className="flex-shrink-0 flex items-center justify-center p-2 rounded-xl bg-white/20 text-white">
              <FolderOpen className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="flex flex-col text-left">
              <div className="font-semibold text-[15px]">
                {t('ghost.btnFind')}
              </div>
            </div>
          </button>

          {/* Secondary Action: Reset Config */}
          <button
            onClick={handleReset}
            className="group relative w-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 active:scale-[0.98]"
          >
            <div className="flex-shrink-0 flex items-center justify-center p-2 rounded-xl bg-zinc-200/50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400">
              <RefreshCw className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="flex flex-col text-left">
              <div className="font-semibold text-[15px] text-zinc-800 dark:text-zinc-200">
                {t('ghost.btnReset')}
              </div>
            </div>
          </button>

          {/* Danger Zone: Force Recreate */}
          <button
            onClick={handleForceRecreate}
            className="group mt-4 flex items-center justify-center gap-2 text-[13px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-2"
          >
            <TriangleAlert className="w-4 h-4" />
            <span>{t('ghost.btnForce')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
