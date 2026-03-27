import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, remove } from '@tauri-apps/plugin-fs';
import { documentDir, join } from '@tauri-apps/api/path';
import { isMobile } from '../../../utils/isMobile';

export interface VaultDocument {
  id: string;
  title: string;
  content: string;
  updatedAt?: number;
  whisperKeyHash?: string;
  revealLockoutEndTime?: number;
}

interface ImportModalProps {
  currentVaultPath: string | null;
  onImportSuccess: (docs: VaultDocument[]) => void;
}

export interface ImportModalRef {
  startImport: () => Promise<void>;
}

export const ImportModal = forwardRef<ImportModalRef, ImportModalProps>(({ currentVaultPath, onImportSuccess }, ref) => {
  const { t } = useTranslation();

  const [isImportPasswordOpen, setIsImportPasswordOpen] = useState(false);
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [importFilePath, setImportFilePath] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importError, setImportError] = useState('');
  const [importedDocs, setImportedDocs] = useState<VaultDocument[]>([]);
  const [isImportDecrypting, setIsImportDecrypting] = useState(false);

  const importPasswordRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    startImport: async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'WhisperSpace', extensions: ['wspace'] }],
        });

        if (!selected) return; // User cancelled

        const filePath = typeof selected === 'string' ? selected : selected[0];

        // Guard: cannot import the currently open file
        if (currentVaultPath && filePath === currentVaultPath) {
          alert(t('import.sameFile'));
          return;
        }

        setImportFilePath(filePath);
        setImportPassword('');
        setImportError('');
        setIsImportPasswordOpen(true);

        // AutoFocus password input
        setTimeout(() => importPasswordRef.current?.focus(), 100);
      } catch (e) {
        console.error('Failed to open file picker', e);
      }
    }
  }));

  const closeImport = () => {
    setIsImportPasswordOpen(false);
    setIsImportConfirmOpen(false);
    setImportPassword('');
    setImportError('');
    setImportFilePath('');
    setImportedDocs([]);
    setIsImportDecrypting(false);
  };

  const handleImportDecrypt = async () => {
    if (!importPassword.trim()) return;
    setImportError('');
    setIsImportDecrypting(true);

    let smugglerPath = importFilePath;
    let isSmuggled = false;

    try {
      if (isMobile()) {
        smugglerPath = await join(await documentDir(), `import_temp_${Date.now()}.wspace`);
        await copyFile(importFilePath, smugglerPath);
        isSmuggled = true;
      }

      const rawContent = await invoke<string>('import_vault', {
        filename: smugglerPath,
        password: importPassword,
      });

      // SECURITY: wipe import password from React state immediately
      setImportPassword('');

      let parsedDocs: VaultDocument[] = [];
      if (rawContent && rawContent.trim()) {
        try {
          const parsed = JSON.parse(rawContent);
          if (Array.isArray(parsed)) {
            parsedDocs = parsed;
          } else if (parsed && typeof parsed === 'object') {
            parsedDocs = parsed.documents || [];
          }
        } catch {
          setImportError(t('import.passwordError'));
          return;
        }
      }

      if (parsedDocs.length === 0) {
        alert(t('import.emptyVault'));
        closeImport();
        return;
      }

      // Success: move to confirmation
      setImportedDocs(parsedDocs);
      setIsImportPasswordOpen(false);
      setIsImportConfirmOpen(true);
    } catch {
      setImportPassword('');
      setImportError(t('import.passwordError'));
    } finally {
      if (isSmuggled) {
        setTimeout(async () => {
          try {
            await remove(smugglerPath);
          } catch (e) {
            console.error('Smuggler path cleanup failed', e);
          }
        }, 300);
      }
      setIsImportDecrypting(false);
    }
  };

  const handleImportConfirm = () => {
    // Re-ID all notes to prevent collisions
    const reIdDocs = importedDocs.map((doc) => ({
      ...doc,
      id: crypto.randomUUID(),
    }));

    onImportSuccess(reIdDocs);
    closeImport();
  };

  return (
    <>
      {/* ═══════ Import Password Modal ═══════ */}
      {isImportPasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/20">
          <div className="bg-white border border-gray-200 rounded-md w-full max-w-[400px] p-6 flex flex-col gap-6 shadow-xl max-h-[70dvh] overflow-y-auto">
            <h3 className="text-lg font-light text-gray-900">{t('import.passwordTitle')}</h3>

            <div className="flex flex-col gap-3">
              <input
                ref={importPasswordRef}
                type="password"
                placeholder={t('import.passwordPlaceholder')}
                value={importPassword}
                onChange={(e) => { setImportPassword(e.target.value); setImportError(''); }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && importPassword.trim()) {
                    handleImportDecrypt();
                  }
                }}
              />
              {importError && (
                <p className="text-red-500 text-sm animate-pulse">{importError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none"
                onClick={closeImport}
                disabled={isImportDecrypting}
              >
                {t('import.cancel')}
              </button>
              <button
                className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleImportDecrypt}
                disabled={!importPassword.trim() || isImportDecrypting}
              >
                {isImportDecrypting ? <span className="animate-pulse">{t('import.decrypting')}</span> : t('import.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Import Confirmation Modal ═══════ */}
      {isImportConfirmOpen && importedDocs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/20">
          <div className="bg-white border border-gray-200 rounded-md w-full max-w-[400px] p-6 flex flex-col gap-6 shadow-xl max-h-[70dvh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-light text-gray-900">{t('import.confirm')}</h3>
              <p className="text-sm text-gray-500 mt-2">
                {importedDocs.length === 1
                  ? t('import.confirmSingle', { title: (importedDocs[0].title || t('sidebar.untitled')).slice(0, 30) })
                  : t('import.confirmMessage', {
                    title: (importedDocs[0].title || t('sidebar.untitled')).slice(0, 30),
                    count: importedDocs.length - 1,
                  })
                }
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none"
                onClick={closeImport}
              >
                {t('import.cancel')}
              </button>
              <button
                className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none"
                onClick={handleImportConfirm}
              >
                {t('import.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
