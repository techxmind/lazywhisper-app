import { useState, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { documentDir, join } from '@tauri-apps/api/path';
import { copyFile, remove, exists } from '@tauri-apps/plugin-fs';
import { isMobile } from '../../../utils/isMobile';

export interface VaultDocument {
  id: string;
  title: string;
  content: string;
  updatedAt?: number;
  whisperKeyHash?: string;
  revealLockoutEndTime?: number;
}

interface ExportModalProps {
  activeDoc: VaultDocument | null;
  documents: VaultDocument[];
}

export interface ExportModalRef {
  startExport: () => void;
}

export const ExportModal = forwardRef<ExportModalRef, ExportModalProps>(({ activeDoc, documents }, ref) => {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'note' | 'space'>('note');
  const [exportPassword, setExportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useImperativeHandle(ref, () => ({
    startExport: () => {
      setExportPassword('');
      setExportScope('note');
      setExportSuccess(false);
      setIsOpen(true);
    }
  }));

  const handleClose = () => {
    setIsOpen(false);
    setExportPassword('');
    setExportScope('note');
    setExportSuccess(false);
  };

  const handleExportSharedFile = async () => {
    if (!exportPassword.trim()) return;

    let mobileTempPath = '';
    let isSmuggled = false;

    try {
      setIsExporting(true);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultName = exportScope === 'note' && activeDoc
        ? `${activeDoc.title || 'LazyWhisper_Note'}_${timestamp}.wspace`
        : `LazyWhisper_Backup_${timestamp}.wspace`;

      const payloadToExport = exportScope === 'note' && activeDoc ? [activeDoc] : documents;
      const content = JSON.stringify(payloadToExport);
      let finalSavePath: string | null = null;

      if (isMobile()) {
        // 1. Mobile Physical Pre-generation (Anti 0-Byte Ghost File Strategy)
        mobileTempPath = await join(await documentDir(), defaultName);
        isSmuggled = true;

        // Write the real data to sandbox temp file FIRST
        await invoke('export_shared_file', {
          filePath: mobileTempPath,
          tempPassword: exportPassword,
          content
        });

        // 2. Feed physical file absolute path to native dialog.save() defaultPath
        finalSavePath = await save({
          defaultPath: mobileTempPath,
          filters: [{
            name: 'WhisperSpace Exported File',
            extensions: ['wspace']
          }]
        });

        if (finalSavePath) {
          // Manual transport to selected destination if paths differ
          if (finalSavePath !== mobileTempPath) {
            await copyFile(mobileTempPath, finalSavePath);
          }
        }
      } else {
        // 1. Desktop Strategy (string defaultPath)
        finalSavePath = await save({
          defaultPath: defaultName,
          filters: [{
            name: 'WhisperSpace Exported File',
            extensions: ['wspace']
          }]
        });

        if (finalSavePath) {
          await invoke('export_shared_file', {
            filePath: finalSavePath,
            tempPassword: exportPassword,
            content
          });
        }
      }

      // Check user cancellation
      if (!finalSavePath) {
        setIsExporting(false);
        return;
      }

      // Success
      setExportSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);

    } catch (e) {
      console.error('Failed to export', e);
    } finally {
      setIsExporting(false);

      // 3. Ultimate lifecycle cleanup loop
      if (isSmuggled && mobileTempPath) {
        setTimeout(async () => {
          try {
            if (await exists(mobileTempPath)) {
              await remove(mobileTempPath);
              console.log('✅ Temporary Export Sandbox File Cleaned Up Safely.');
            }
          } catch (cleanupErr) {
            console.error('❌ Failed to cleanup smuggler export temp file:', cleanupErr);
          }
        }, 500);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/20">
      <div className="bg-white border border-gray-200 rounded-md w-full max-w-[400px] p-6 flex flex-col gap-6 shadow-xl max-h-[70dvh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-light text-gray-900">{t('export.title')}</h3>
          {exportSuccess && (
            <p className="text-sm text-green-600 mt-1">{t('export.success')}</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* Segmented Control for Export Scope */}
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${exportScope === 'note' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setExportScope('note')}
              disabled={!activeDoc}
            >
              {t('export.scopeNote')}
            </button>
            <button
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${exportScope === 'space' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setExportScope('space')}
            >
              {t('export.scopeSpace')}
            </button>
          </div>

          <input
            type="password"
            placeholder={t('export.placeholder')}
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && exportPassword.trim()) {
                handleExportSharedFile();
              }
            }}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
            onClick={handleClose}
            disabled={isExporting}
          >
            {t('export.cancel')}
          </button>
          <button
            className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleExportSharedFile}
            disabled={!exportPassword.trim() || isExporting}
          >
            {isExporting ? <span className="animate-pulse">...</span> : t('export.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
});
