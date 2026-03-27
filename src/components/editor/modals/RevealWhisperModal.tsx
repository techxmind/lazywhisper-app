import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { hashKey } from '../../../utils/crypto';
import { VaultDocument } from '../../../App';
import { Lock, AlertCircle } from 'lucide-react';

export interface PopoverData {
  coverText: string;
  encryptedSecret: string;
  rect: DOMRect;
  pos?: number;
}

interface RevealWhisperModalProps {
  activeDoc: VaultDocument;
  editor: import('@tiptap/react').Editor | null;
  onUpdateDocHash: (id: string, hash: string) => void;
  onRevealSuccess: (key: string, data: PopoverData) => void;
}

export interface RevealWhisperModalRef {
  startReveal: (data: PopoverData) => void;
}

export const RevealWhisperModal = forwardRef<RevealWhisperModalRef, RevealWhisperModalProps>(
  ({ activeDoc, editor, onUpdateDocHash, onRevealSuccess }, ref) => {
    const { t } = useTranslation();

    const [isOpen, setIsOpen] = useState(false);
    const [activeRevealData, setActiveRevealData] = useState<PopoverData | null>(null);
    const [revealKey, setRevealKey] = useState('');
    const [revealError, setRevealError] = useState('');
    const [revealNewerVersion, setRevealNewerVersion] = useState(false);

    // Lockout State
    const [failedRevealAttempts, setFailedRevealAttempts] = useState(0);
    const [revealLockoutEndTime, setRevealLockoutEndTime] = useState<number | null>(null);
    const [remainingRevealLockout, setRemainingRevealLockout] = useState(0);

    const revealModalInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      startReveal: (data: PopoverData) => {
        setActiveRevealData(data);
        setRevealKey('');
        setRevealError('');
        setRevealNewerVersion(false);
        setIsOpen(true);
      }
    }));

    useEffect(() => {
      if (isOpen && activeRevealData) {
        const timer = setTimeout(() => {
          revealModalInputRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [isOpen, activeRevealData]);

    useEffect(() => {
      if (!revealLockoutEndTime) {
        setRemainingRevealLockout(0);
        return;
      }

      const timer = setInterval(() => {
        const remaining = Math.max(0, revealLockoutEndTime - Date.now());
        setRemainingRevealLockout(Math.ceil(remaining / 1000));
        if (remaining === 0) {
          setRevealLockoutEndTime(null);
        }
      }, 100);

      return () => clearInterval(timer);
    }, [revealLockoutEndTime]);

    const handleRevealWhisper = async () => {
      if (revealLockoutEndTime && Date.now() < revealLockoutEndTime) return;
      if (!activeRevealData || !revealKey.trim()) return;

      const triggerRevealLockout = () => {
        const currentFailures = failedRevealAttempts + 1;
        setFailedRevealAttempts(currentFailures);

        let lockMs = 0;
        if (currentFailures >= 10) lockMs = 5 * 60 * 1000;
        else if (currentFailures >= 5) lockMs = 60 * 1000;
        else if (currentFailures >= 3) lockMs = 30 * 1000;

        if (lockMs > 0) {
          setRevealLockoutEndTime(Date.now() + lockMs);
        }
      };

      setRevealNewerVersion(false);

      if (activeDoc.whisperKeyHash) {
        const inputHash = await hashKey(revealKey);
        if (inputHash !== activeDoc.whisperKeyHash) {
          setRevealError(t('whisper.keyIncorrect'));
          triggerRevealLockout();
          return;
        }
      } else {
        const newHash = await hashKey(revealKey);
        onUpdateDocHash(activeDoc.id, newHash);
      }

      // Accepted password!
      if (activeRevealData.encryptedSecret) {
        try {
          await invoke<string>('decrypt_secret', {
            ciphertext: activeRevealData.encryptedSecret,
            key: revealKey
          });

          // RE-CALCULATE RECT! Modal keyboard/layout likely mutated scroll space
          let freshRect = activeRevealData.rect;
          if (editor && activeRevealData.pos !== undefined) {
            try {
              const nodeDom = editor.view.nodeDOM(activeRevealData.pos);
              if (nodeDom instanceof HTMLElement) {
                freshRect = nodeDom.getBoundingClientRect();
              }
            } catch (e) {
              console.error("Failed to dynamically fetch fresh bounds:", e);
            }
          }

          // Zero-click Handoff to Parent
          onRevealSuccess(revealKey, {
            coverText: activeRevealData.coverText,
            encryptedSecret: activeRevealData.encryptedSecret,
            rect: freshRect,
            pos: activeRevealData.pos
          });

          handleClose();
        } catch (err: any) {
          const errMsg = typeof err === 'string' ? err : '';
          if (errMsg.includes("ERROR_NEWER_VERSION")) {
            setRevealNewerVersion(true);
          } else {
            setRevealError(t('whisper.keyIncorrect'));
            triggerRevealLockout();
          }
        }
      }
    };

    const handleClose = () => {
      setIsOpen(false);
      setActiveRevealData(null);
      setRevealKey('');
      setRevealError('');
      setRevealNewerVersion(false);
    };

    if (!isOpen || !activeRevealData) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/5 backdrop-blur-sm">
        <div className="bg-white border border-gray-200 w-full max-w-[500px] rounded p-8 flex flex-col gap-6 font-sans max-h-[70dvh] overflow-y-auto">
          <div>
            <h3 className="text-xl font-semibold text-gray-800 mb-6">{t('reveal.title')}</h3>
          </div>

          <div className="flex flex-col gap-4 mt-4">
            <div className="flex flex-col gap-1">
              <input
                ref={revealModalInputRef}
                type="password"
                placeholder={t('reveal.placeholder')}
                value={revealKey}
                onChange={(e) => setRevealKey(e.target.value)}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest disabled:opacity-50 disabled:bg-gray-50"
                disabled={!!revealLockoutEndTime || revealNewerVersion}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && revealKey.trim() && !revealLockoutEndTime && !revealNewerVersion) {
                    handleRevealWhisper();
                  }
                }}
              />
              <p className="text-[13px] text-zinc-500 mt-1 px-1">
                {t('reveal.sessionHint')}
              </p>
            </div>
            {revealError && !revealLockoutEndTime && !revealNewerVersion && <span className="text-xs text-red-500 px-1">{revealError}</span>}
            {revealLockoutEndTime && remainingRevealLockout > 0 && !revealNewerVersion && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-lg mt-1 w-full text-left">
                <Lock size={14} className="shrink-0" />
                <span>{t('reveal.lockout', { time: remainingRevealLockout })}</span>
              </div>
            )}
            {revealNewerVersion && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-600 text-xs px-3 py-2 rounded-lg mt-1 w-full text-left">
                <AlertCircle size={14} className="shrink-0" />
                <span>{t('reveal.newerVersion')}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button
              className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
              onClick={handleClose}
            >
              {t('reveal.close')}
            </button>
            <button
              className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:cursor-not-allowed disabled:shadow-none"
              onClick={handleRevealWhisper}
              disabled={!revealKey.trim() || !!revealLockoutEndTime || revealNewerVersion}
            >
              {t('reveal.reveal')}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
