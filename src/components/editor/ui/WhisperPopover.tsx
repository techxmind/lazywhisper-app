import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit2, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

export interface PopoverData {
  coverText: string;
  encryptedSecret: string;
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>;
  pos?: number;
}

interface WhisperPopoverProps {
  activePopoverData: PopoverData | null;
  sessionWhisperKey: string | null;
  onClose: () => void;
  onEditWhisper: (coverText: string, pos: number | undefined, decryptedSecret: string) => void;
}

export function WhisperPopover({
  activePopoverData,
  sessionWhisperKey,
  onClose,
  onEditWhisper
}: WhisperPopoverProps) {
  const { t } = useTranslation();
  const [isPopoverDecrypting, setIsPopoverDecrypting] = useState(false);
  const [popoverError, setPopoverError] = useState('');
  const [popoverDecryptedSecret, setPopoverDecryptedSecret] = useState<string | null>(null);
  const [popoverCopied, setPopoverCopied] = useState(false);

  // Dismiss Whispering Popover on ANY global scrolling/resize to prevent floating detachment
  useEffect(() => {
    if (!activePopoverData) return;
    const handleScrollOrResize = (e: Event) => {
      // Don't dismiss if scrolling INSIDE the popover itself (e.g. reading a long secret)
      if ((e.target as HTMLElement)?.closest?.('.whisper-popover-container')) return;
      onClose();
    };

    window.addEventListener('scroll', handleScrollOrResize, true); // true = capture phase
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [activePopoverData, onClose]);

  // Popover Decryption Effect
  useEffect(() => {
    if (activePopoverData && sessionWhisperKey) {
      setIsPopoverDecrypting(true);
      setPopoverError('');
      invoke<string>('decrypt_secret', {
        ciphertext: activePopoverData.encryptedSecret,
        key: sessionWhisperKey
      }).then((extracted) => {
        setPopoverDecryptedSecret(extracted);
      }).catch((err) => {
        setPopoverError(typeof err === 'string' ? err : t('reveal.decryptFailed'));
        setPopoverDecryptedSecret(null);
      }).finally(() => {
        setIsPopoverDecrypting(false);
      });
    } else {
      setPopoverDecryptedSecret(null);
    }
  }, [activePopoverData, sessionWhisperKey, t]);

  // Popover Dismissal (Outside Click & Lock)
  useEffect(() => {
    if (!activePopoverData) return;

    // Auto-dismiss if lock state triggers
    if (!sessionWhisperKey) {
      onClose();
      return;
    }

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // If click is inside popover or inside a whisper node, don't close here
      // (Whisper node clicks are handled by handleClick which will swap the popover data)
      if (target.closest('.whisper-popover-container') || target.closest('span[data-type="whisperNode"]')) {
        return;
      }
      onClose();
    };

    // Use capturing phase to ensure we beat React's synthetic event bubbling
    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true, capture: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, { capture: true });
    };
  }, [activePopoverData, sessionWhisperKey, onClose]);

  // If no data, render nothing (but keep the structure for AnimatePresence to work)
  // AnimatePresence handles unmount animations based on activePopoverData null check below
  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {activePopoverData && (
        <div
          className="whisper-popover-container fixed z-[9999]"
          style={{
            top: activePopoverData.rect.top > 200
              ? activePopoverData.rect.top - 12
              : activePopoverData.rect.bottom + 12,
            left: Math.min(
              Math.max(activePopoverData.rect.left + (activePopoverData.rect.width / 2) - 170, 16),
              window.innerWidth - 356
            ),
            transform: activePopoverData.rect.top > 200 ? 'translateY(-100%)' : 'none',
          }}
          onClick={(e) => { e.stopPropagation(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
          onTouchEnd={(e) => { e.stopPropagation(); }}
          onMouseDown={(e) => { e.stopPropagation(); }}
        >
          <motion.div
            key="whisper-popover"
            initial={{ opacity: 0, scale: 0.95, y: activePopoverData.rect.top > 200 ? 5 : -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 5 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
          >
            {/* Arrow Caret */}
            {(() => {
              const isDark = document.documentElement.classList.contains('dark');
              const borderColor = isDark ? '#27272a' : '#e4e4e7';
              const isAbove = activePopoverData.rect.top > 200;
              return (
                <div
                  className="absolute w-[14px] h-[14px] bg-white dark:bg-zinc-900 transform rotate-45"
                  style={{
                    zIndex: 30,
                    left: Math.max(
                      16,
                      activePopoverData.rect.left - Math.max(activePopoverData.rect.left + (activePopoverData.rect.width / 2) - 170, 16) + (activePopoverData.rect.width / 2) - 7
                    ) + 'px',
                    ...(isAbove
                      ? {
                        bottom: '-7px',
                        borderRight: `1px solid ${borderColor}`,
                        borderBottom: `1px solid ${borderColor}`,
                        borderTop: 'none',
                        borderLeft: 'none',
                      }
                      : {
                        top: '-7px',
                        borderLeft: `1px solid ${borderColor}`,
                        borderTop: `1px solid ${borderColor}`,
                        borderRight: 'none',
                        borderBottom: 'none',
                      }
                    )
                  }}
                />
              );
            })()}

            <div className="bg-white dark:bg-zinc-900/95 dark:backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-2 md:p-3 w-[calc(100vw-32px)] md:w-[340px] max-w-[340px] max-h-64 flex flex-col relative z-10">
              <div className="flex-1 overflow-y-auto pr-1 pb-1 pt-1">
                {isPopoverDecrypting ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                    <span className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin"></span>
                    {t('reveal.decrypting')}
                  </div>
                ) : popoverError ? (
                  <div className="text-sm text-red-500 dark:text-red-400 py-1 bg-red-50 dark:bg-red-950/30 px-2 rounded-md border border-red-100 dark:border-red-900/50">
                    {popoverError}
                  </div>
                ) : popoverDecryptedSecret ? (
                  <div className="group/secret flex flex-col gap-4">
                    <div className="font-medium tracking-wide leading-relaxed break-words pr-10">
                      <span className="bg-[#4A7AD2] px-[6px] py-[2px] rounded-[2px] shadow-[0_2px_4px_rgba(74,122,210,0.2)] decoration-clone text-white leading-loose">
                        {popoverDecryptedSecret}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-2 md:gap-1.5 pt-3 border-t border-[#f3f4f6] dark:border-[#27272a]">
                      <button
                        className="p-2 md:p-1.5 min-w-[36px] min-h-[36px] md:min-w-[28px] md:min-h-[28px] text-zinc-500 md:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-[10px] md:rounded-md transition-colors flex items-center justify-center bg-zinc-100 md:bg-white/50 dark:bg-zinc-800 md:dark:bg-zinc-900/50"
                        onClick={() => {
                          onEditWhisper(
                            activePopoverData.coverText,
                            activePopoverData.pos,
                            popoverDecryptedSecret
                          );
                          onClose();
                        }}
                        title={t('reveal.editWhisper')}
                      >
                        <Edit2 className="w-5 h-5 md:w-4 md:h-4" />
                      </button>
                      <button
                        className="p-2 md:p-1.5 min-w-[36px] min-h-[36px] md:min-w-[28px] md:min-h-[28px] text-zinc-500 md:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-[10px] md:rounded-md transition-colors flex items-center justify-center bg-zinc-100 md:bg-white/50 dark:bg-zinc-800 md:dark:bg-zinc-900/50"
                        onClick={() => {
                          navigator.clipboard.writeText(popoverDecryptedSecret);
                          setPopoverCopied(true);
                          setTimeout(() => setPopoverCopied(false), 2000);
                        }}
                        title={t('reveal.copySecret')}
                      >
                        {popoverCopied ? <Check className="w-5 h-5 md:w-4 md:h-4 text-green-500" /> : <Copy className="w-5 h-5 md:w-4 md:h-4" />}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
