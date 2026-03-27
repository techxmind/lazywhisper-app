import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { hashKey } from '../../../utils/crypto';
import { VaultDocument } from '../../../App';

interface SealWhisperModalProps {
  activeDoc: VaultDocument;
  sessionWhisperKey: string | null;
  onSetSessionWhisperKey: (key: string | null) => void;
  onUpdateDocHash: (id: string, hash: string) => void;
  onSealSuccess: (coverText: string, encryptedSecret: string, pos: number | null) => void;
}

export interface SealWhisperModalRef {
  startSeal: (initialCoverText: string, pos?: number, initialSecret?: string) => void;
}

export const SealWhisperModal = forwardRef<SealWhisperModalRef, SealWhisperModalProps>(
  ({ activeDoc, sessionWhisperKey, onSetSessionWhisperKey, onUpdateDocHash, onSealSuccess }, ref) => {
    const { t } = useTranslation();

    const [isOpen, setIsOpen] = useState(false);
    const [currentCoverText, setCurrentCoverText] = useState('');
    const [whisperKey, setWhisperKey] = useState('');
    const [confirmWhisperKey, setConfirmWhisperKey] = useState('');
    const [realSecret, setRealSecret] = useState('');
    const [sealError, setSealError] = useState('');
    const [currentEditPos, setCurrentEditPos] = useState<number | null>(null);

    const createModalInputRef = useRef<HTMLInputElement>(null);
    const createModalTextareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      startSeal: (initialCoverText: string, pos?: number, initialSecret?: string) => {
        setSealError('');
        setRealSecret(initialSecret || '');
        setConfirmWhisperKey('');
        setCurrentCoverText(initialCoverText);
        setCurrentEditPos(pos !== undefined ? pos : null);

        if (sessionWhisperKey) {
          setWhisperKey(sessionWhisperKey);
        } else {
          setWhisperKey('');
        }

        setIsOpen(true);
      }
    }));

    useEffect(() => {
      if (isOpen) {
        const timer = setTimeout(() => {
          if (!sessionWhisperKey) {
            createModalInputRef.current?.focus();
          } else {
            createModalTextareaRef.current?.focus();
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [isOpen, sessionWhisperKey]);

    const handleSealWhisper = async () => {
      if (!whisperKey.trim() || !realSecret.trim()) return;

      if (!activeDoc.whisperKeyHash) {
        if (whisperKey !== confirmWhisperKey) {
          setSealError(t('whisper.keyMismatch'));
          return;
        }
        const newHash = await hashKey(whisperKey);
        onUpdateDocHash(activeDoc.id, newHash);
      } else {
        const inputHash = await hashKey(whisperKey);
        if (inputHash !== activeDoc.whisperKeyHash) {
          setSealError(t('whisper.keyIncorrect'));
          return;
        }
      }

      // Pass tests! Save session memory.
      onSetSessionWhisperKey(whisperKey);

      let encryptedSecret = "";
      try {
        encryptedSecret = await invoke<string>('encrypt_secret', {
          plaintext: realSecret,
          key: whisperKey
        });
      } catch {
        setSealError(t('whisper.encryptionFailed'));
        return;
      }

      // Bubble up the result so the parent can interact with Tiptap
      onSealSuccess(currentCoverText, encryptedSecret, currentEditPos);

      // Cleanup
      setIsOpen(false);
      setWhisperKey('');
      setConfirmWhisperKey('');
      setRealSecret('');
      setCurrentCoverText('');
      setCurrentEditPos(null);
    };

    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/20">
        <div className="bg-white border border-gray-200 rounded-md w-full max-w-[480px] p-6 flex flex-col gap-6 max-h-[70dvh] overflow-y-auto">
          <div>
            <h3 className="text-xl font-semibold text-gray-800 mb-6">{t('modal.title')}</h3>
            <div className="bg-gray-50 border border-gray-100 focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-300 transition-shadow rounded-lg p-3 mb-6 flex flex-col gap-1">
              <span className="text-xs text-gray-400 uppercase font-medium">{t('modal.coverText')}</span>
              <input
                type="text"
                value={currentCoverText}
                onChange={(e) => setCurrentCoverText(e.target.value)}
                className="w-full bg-transparent text-sm text-gray-800 focus:outline-none placeholder-gray-400"
                spellCheck="false"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {!sessionWhisperKey && (
              <div className="flex flex-col space-y-3">
                <div>
                  <input
                    ref={createModalInputRef}
                    type="password"
                    placeholder={!activeDoc.whisperKeyHash ? t('whisper.setKey') : t('modal.keyPlaceholder')}
                    value={whisperKey}
                    onChange={(e) => setWhisperKey(e.target.value)}
                    spellCheck="false"
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest"
                  />
                  {!activeDoc.whisperKeyHash ? (
                    <p className="text-xs text-gray-400 mt-1">{t('whisper.setKey')}</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">{t('whisper.verifyKey')}</p>
                  )}
                </div>
                {!activeDoc.whisperKeyHash && (
                  <input
                    type="password"
                    placeholder={t('whisper.confirmKey')}
                    value={confirmWhisperKey}
                    onChange={(e) => setConfirmWhisperKey(e.target.value)}
                    spellCheck="false"
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest"
                  />
                )}
                {sealError && <span className="text-xs text-red-500 mt-1">{sealError}</span>}
              </div>
            )}

            <div className="mt-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('modal.whisper')}</label>
              <textarea
                ref={createModalTextareaRef}
                placeholder={t('modal.secretPlaceholder')}
                value={realSecret}
                onChange={(e) => setRealSecret(e.target.value)}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow resize-none"
                rows={4}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button
              className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
              onClick={() => setIsOpen(false)}
            >
              {t('modal.cancel')}
            </button>
            <button
              className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSealWhisper}
              disabled={!realSecret.trim() || (!sessionWhisperKey && (!whisperKey.trim() || (!activeDoc.whisperKeyHash && !confirmWhisperKey.trim())))}
            >
              {t('modal.seal')}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
