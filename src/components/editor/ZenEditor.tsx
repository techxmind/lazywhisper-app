import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Share, Save, Bold, Italic, Lock, Highlighter, Palette, Image as ImageIcon, AlertCircle, X, Copy, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { hashKey } from '../../utils/crypto';
import { VaultDocument } from '../../App';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { WhisperNode } from '../../core/tiptap/WhisperExtension';

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
interface ZenEditorProps {
  activeDoc: VaultDocument;
  documents: VaultDocument[];
  vaultPassword?: string;
  sessionWhisperKey: string | null;
  onSetSessionWhisperKey: (key: string | null) => void;
  onUpdateDocHash: (id: string, hash: string) => void;
  onContentChange: (id: string, content: string, title?: string, isDirty?: boolean) => void;
  onSave: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isSaved: boolean;
  lastSavedTimestamp: number;
}

export function ZenEditor({ activeDoc, documents, vaultPassword = '', sessionWhisperKey, onSetSessionWhisperKey, onUpdateDocHash, onContentChange, onSave, hasUnsavedChanges, isSaving, isSaved, lastSavedTimestamp }: ZenEditorProps) {
  const { t, i18n } = useTranslation();
  
  const [mobileHeaderNode, setMobileHeaderNode] = useState<Element | null>(null);

  useEffect(() => {
    // Attempt to grab the mobile header actions container created in App.tsx
    const node = document.getElementById('mobile-header-actions');
    if (node) {
      setMobileHeaderNode(node);
    }
  }, []);

  const baselineContentRef = useRef<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentCoverText, setCurrentCoverText] = useState('');
  const [whisperKey, setWhisperKey] = useState('');
  const [confirmWhisperKey, setConfirmWhisperKey] = useState('');
  const [realSecret, setRealSecret] = useState('');
  const [sealError, setSealError] = useState('');

  // Bubble Menu Palette State
  const [showPalette, setShowPalette] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'note' | 'space'>('note');
  const [exportPassword, setExportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Reveal State
  const [isRevealModalOpen, setIsRevealModalOpen] = useState(false);
  const [activeRevealData, setActiveRevealData] = useState<{ coverText: string, encryptedSecret: string } | null>(null);
  const [revealKey, setRevealKey] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealError, setRevealError] = useState('');
  const [revealNewerVersion, setRevealNewerVersion] = useState(false);

  // Popover State (UX Upgrade)
  const [activePopoverData, setActivePopoverData] = useState<{ coverText: string, encryptedSecret: string, rect: DOMRect } | null>(null);
  const [popoverDecryptedSecret, setPopoverDecryptedSecret] = useState<string | null>(null);
  const [isPopoverDecrypting, setIsPopoverDecrypting] = useState(false);
  const [popoverError, setPopoverError] = useState('');
  const [popoverCopied, setPopoverCopied] = useState(false);

  // Fix: Track session key in a mutable ref to escape useEditor's stale closure
  const sessionKeyRef = useRef(sessionWhisperKey);
  useEffect(() => {
    sessionKeyRef.current = sessionWhisperKey;
  }, [sessionWhisperKey]);

  // Brute-force local lockouts for Reveal Modal
  const [failedRevealAttempts, setFailedRevealAttempts] = useState(0);
  const [revealLockoutEndTime, setRevealLockoutEndTime] = useState<number | null>(null);
  const [remainingRevealLockout, setRemainingRevealLockout] = useState(0);

  // Performance Enhancement: Decouple high-frequency typing from Global State
  const [localContent, setLocalContent] = useState(activeDoc.content);
  const localContentRef = useRef(activeDoc.content); // For instant sync logic bypassing stale closures
  const localTitleRef = useRef(activeDoc.title || t('sidebar.untitled'));

  useEffect(() => {
    const handler = setTimeout(() => {
      // Only push up to App.tsx if the local content has actually drifted from the baseline
      if (localContentRef.current !== baselineContentRef.current) {
        onContentChange(activeDoc.id, localContentRef.current, localTitleRef.current, true);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [localContent, activeDoc.id]); // trigger debounce countdown whenever user types

  const editor = useEditor({
    extensions: [
      StarterKit,
      WhisperNode,
      TextStyle,
      Color,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Placeholder.configure({
        placeholder: t('editor.placeholder'),
        emptyEditorClass: 'is-editor-empty',
        emptyNodeClass: 'is-empty',
      }),
    ],
    content: activeDoc.content,
    onUpdate: ({ editor: currentEditor }) => {
      const firstLineText = currentEditor.state.doc.firstChild?.textContent;
      localTitleRef.current = firstLineText ? firstLineText.trim() : t('sidebar.untitled');

      const currentHTML = currentEditor.getHTML();
      localContentRef.current = currentHTML;
      setLocalContent(currentHTML); // triggers the debounce effect
    },
    editorProps: {
      attributes: {
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        class: 'prose prose-slate max-w-none pt-2 ' +
          'prose-h1:text-4xl prose-h1:font-bold prose-h1:mb-6 prose-h1:mt-8 ' +
          'prose-h2:text-2xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-4 ' +
          'prose-p:leading-relaxed ' +
          'prose-a:text-brand prose-a:no-underline hover:prose-a:underline ' +
          'prose-blockquote:border-l-2 prose-blockquote:border-gray-200 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-500 ' +
          'outline-none border-none ring-0 focus:outline-none focus:ring-0 min-h-[500px] tiptap-editor-root',
      },
      handleClick(view, pos, event) {
        const target = event.target as HTMLElement | null;
        if (!target) return false;

        // Verify the physical DOM click land target
        const isClickOnWhisperDOM = target.closest('span[data-type="whisperNode"]');
        if (!isClickOnWhisperDOM) {
          return false;
        }

        const { state } = view;
        const resolvedPos = state.doc.resolve(pos);

        let isWhisper = false;
        let whisperAttrs = null;

        // Ensure resolution bounds check up to root depth.
        // It's possible the click sits directly on an inline node pos or inside its text chunk.
        for (let depth = resolvedPos.depth; depth >= 0; depth--) {
          const node = resolvedPos.node(depth);
          if (node.type.name === 'whisperNode') {
            isWhisper = true;
            whisperAttrs = node.attrs;
            break;
          }
        }

        // Specifically check the node directly AT the resolved pos horizontally if the depth check missed
        const nodeAfter = resolvedPos.nodeAfter;
        if (!isWhisper && nodeAfter && nodeAfter.type.name === 'whisperNode') {
          isWhisper = true;
          whisperAttrs = nodeAfter.attrs;
        }

        const nodeBefore = resolvedPos.nodeBefore;
        if (!isWhisper && nodeBefore && nodeBefore.type.name === 'whisperNode') {
          isWhisper = true;
          whisperAttrs = nodeBefore.attrs;
        }

        if (isWhisper && whisperAttrs) {
          event.preventDefault();
          event.stopPropagation();
          window.getSelection()?.removeAllRanges();
          
          if (sessionKeyRef.current) {
            // Authorized state: Route to lightweight Popover
            const rect = target.getBoundingClientRect();
            setActivePopoverData({
              coverText: whisperAttrs.coverText,
              encryptedSecret: whisperAttrs.encryptedSecret,
              rect
            });
            setIsRevealModalOpen(false); // Ensure modal is closed
          } else {
            // Unauthorized state: Route to global Reveal Modal for password input
            setActiveRevealData({
              coverText: whisperAttrs.coverText,
              encryptedSecret: whisperAttrs.encryptedSecret
            });
            setIsRevealModalOpen(true);
            setActivePopoverData(null); // Ensure popover is closed
          }
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') === 0) {
            const file = items[i].getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = (e) => {
                const base64 = e.target?.result as string;
                // Insert picture
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({ src: base64 })
                  )
                );
              };
              reader.readAsDataURL(file);
              return true; // We handled it
            }
          }
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          const files = event.dataTransfer.files;
          let handled = false;

          for (let i = 0; i < files.length; i++) {
            if (files[i].type.indexOf('image') === 0) {
              handled = true;
              const file = files[i];
              const reader = new FileReader();
              reader.onload = (e) => {
                const base64 = e.target?.result as string;
                // We find the pos where the user dropped the file
                const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (coordinates) {
                  view.dispatch(
                    view.state.tr.insert(
                      coordinates.pos,
                      view.state.schema.nodes.image.create({ src: base64 })
                    )
                  );
                }
              };
              reader.readAsDataURL(file);
            }
          }
          if (handled) return true;
        }
        return false;
      }
    },
  }, [i18n.language]);

  // Sync editor content with activeDoc.content when activeDoc.id changes
  useEffect(() => {
    if (editor) {
      if (activeDoc.content !== editor.getHTML()) {
        editor.commands.setContent(activeDoc.content);
        localContentRef.current = activeDoc.content;
        setLocalContent(activeDoc.content);
      }
      baselineContentRef.current = editor.getHTML();
      localTitleRef.current = activeDoc.title || t('sidebar.untitled');
    }
  }, [activeDoc.id, editor, activeDoc.content, activeDoc.title, t]); // rely on doc ID swap

  // Force baseline diff synchronization on global saves
  useEffect(() => {
    if (editor) {
      baselineContentRef.current = editor.getHTML();
    }
  }, [lastSavedTimestamp, editor]);

  // Cache hit verification hook. This bounds to the hot `sessionWhisperKey` prop.
  useEffect(() => {
    if (isRevealModalOpen && activeRevealData) {
      if (sessionWhisperKey) {
        // Auto-decrypt using true backend Rust AES-GCM
        invoke<string>('decrypt_secret', {
          ciphertext: activeRevealData.encryptedSecret,
          key: sessionWhisperKey
        }).then((extracted) => {
          setRevealKey(sessionWhisperKey);
          setRevealedSecret(extracted);
          setRevealError('');
        }).catch(() => {
          onSetSessionWhisperKey(null);
          setRevealKey('');
          setRevealedSecret(null);
        });
      } else {
        setRevealKey('');
        setRevealedSecret(null);
      }
    }
  }, [isRevealModalOpen, activeRevealData, sessionWhisperKey]);

  // Extracted reveal lock countdown timer
  useEffect(() => {
    if (!revealLockoutEndTime) return;

    const interval = setInterval(() => {
      const left = Math.ceil((revealLockoutEndTime - Date.now()) / 1000);
      if (left <= 0) {
        setRevealLockoutEndTime(null);
        setRemainingRevealLockout(0);
      } else {
        setRemainingRevealLockout(left);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [revealLockoutEndTime]);

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
        setPopoverError(typeof err === 'string' ? err : 'Decryption failed');
        setPopoverDecryptedSecret(null);
      }).finally(() => {
        setIsPopoverDecrypting(false);
      });
    } else {
      setPopoverDecryptedSecret(null);
    }
  }, [activePopoverData, sessionWhisperKey]);

  // Popover Dismissal (Outside Click)
  useEffect(() => {
    if (!activePopoverData) return;
    
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // If click is inside popover or inside a whisper node, don't close here
      // (Whisper node clicks are handled by handleClick which will swap the popover data)
      if (target.closest('.whisper-popover-container') || target.closest('span[data-type="whisperNode"]')) {
        return;
      }
      setActivePopoverData(null);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [activePopoverData]);

  // Click detection for Whisper Reveal is now handled natively via `handleClick` editorProps
  // Removed old DOM listener hook entirely to avoid propagation conflicts.

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global ESC
      if (e.key === 'Escape') {
        if (isRevealModalOpen) {
          handleCloseRevealModal();
        } else if (activePopoverData) {
          setActivePopoverData(null);
        } else if (isExportModalOpen) {
          setIsExportModalOpen(false);
        } else if (isModalOpen) {
          setIsModalOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRevealModalOpen, isExportModalOpen, isModalOpen, activePopoverData]);

  if (!editor) {
    return null;
  }

  const handleExportSharedFile = async () => {
    if (!exportPassword.trim()) return;

    try {
      setIsExporting(true);
      const filePath = await save({
        filters: [{
          name: 'WhisperSpace Shared File',
          extensions: ['wspace']
        }]
      });

      if (filePath) {
        const payloadToExport = exportScope === 'note' ? [activeDoc] : documents;
        const content = JSON.stringify(payloadToExport);

        await invoke('export_shared_file', {
          filePath,
          tempPassword: exportPassword,
          content
        });

        setExportSuccess(true);
        setTimeout(() => {
          setExportSuccess(false);
          setIsExportModalOpen(false);
          setExportPassword('');
          setExportScope('note'); // Reset
        }, 1500);
      } else {
        setIsExportModalOpen(false);
      }
    } catch (e) {
      console.error('Failed to export', e);
    } finally {
      setIsExporting(false);
    }
  };

  const openSealModal = (text: string) => {
    setCurrentCoverText(text);
    setRealSecret(text); // Default real secret to the selected text so they can edit it
    setSealError('');
    setConfirmWhisperKey('');

    if (sessionWhisperKey) {
      // Scenario C: Session hit, silent seal directly?
      // Wait, user still needs to see Seal Modal to type the actual 'hidden' secret.
      // But we inject the session key so they don't have to type the password.
      setWhisperKey(sessionWhisperKey);
    } else {
      setWhisperKey('');
    }

    setIsModalOpen(true);
  };

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
    } catch (err) {
      setSealError(t('whisper.encryptionFailed') || 'Encryption failed');
      return;
    }

    editor.chain().focus().setWhisperNode({
      coverText: currentCoverText,
      encryptedSecret: encryptedSecret,
    }).run();

    setIsModalOpen(false);
  };

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
        const extracted = await invoke<string>('decrypt_secret', {
          ciphertext: activeRevealData.encryptedSecret,
          key: revealKey
        });
        setRevealedSecret(extracted);
        onSetSessionWhisperKey(revealKey);
        setRevealError('');
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

  const handleCloseRevealModal = () => {
    setIsRevealModalOpen(false);
    setActiveRevealData(null);
    setRevealKey('');
    setRevealedSecret(null);
    setRevealError('');
    setRevealNewerVersion(false);
  };

  const ActionButtons = () => (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 md:text-xs text-sm font-medium text-blue-500 hover:text-blue-600 md:text-gray-500 md:hover:text-gray-900 cursor-pointer transition-colors px-2 py-2 min-h-[44px] md:min-h-0 md:px-0 md:py-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsExportModalOpen(true);
        }}
      >
        <Share className="w-4 h-4 md:w-3.5 md:h-3.5" />
        <span className="hidden md:inline">{t('export.button')}</span>
      </button>
      <button
        type="button"
        className={`flex items-center gap-1.5 md:text-xs text-sm font-medium cursor-pointer transition-colors px-3 py-2 min-h-[44px] md:min-h-0 md:px-3 md:py-1.5 rounded-md disabled:opacity-50 ${
          hasUnsavedChanges 
            ? 'text-blue-600 md:bg-gray-800 md:text-white md:shadow-sm md:hover:bg-gray-900' 
            : 'text-gray-400 md:text-gray-500 md:hover:text-gray-900 md:hover:bg-gray-100'
        }`}
        onClick={(e) => { e.preventDefault(); onSave(); }}
        disabled={isSaving || !vaultPassword}
      >
        <span className="md:hidden">{isSaved ? t('editor.saved') : t('editor.save')}</span>
        <Save className="w-4 h-4 md:w-3.5 md:h-3.5 hidden md:block" />
        <span className="hidden md:inline">{isSaved ? t('editor.saved') : t('editor.save')}</span>
      </button>
    </>
  );

  return (
    <div className="relative w-full px-0 py-0 md:max-w-[800px] md:mx-auto md:px-8 md:py-12 sm:px-16 sm:py-24 prose prose-slate max-w-none focus:outline-none [&_.ProseMirror]:outline-none flex flex-col h-full bg-white dark:bg-zinc-950">

      {/* 桌面端定位在右上边距外；移动端通过 Portal 渲染到 Header */}
      <div className="hidden md:flex z-10 items-center justify-end gap-2 md:gap-4 w-full md:w-auto md:absolute md:top-10 md:right-10 pt-2 md:pt-0">
        <ActionButtons />
      </div>
      
      {/* 移动端通过 React Portal 将按钮传送到顶部 Header */}
      {mobileHeaderNode && createPortal(
        <div className="flex items-center justify-end gap-1">
          <ActionButtons />
        </div>,
        mobileHeaderNode
      )}

      {/* 必须先判断 editor 是否存在，再渲染 BubbleMenu */}
      {editor && (
        <BubbleMenu 
          editor={editor} 
          tippyOptions={{ duration: 100 }} 
          className="flex items-center p-1 space-x-1 bg-white border border-gray-200 shadow-md rounded-lg relative"
          shouldShow={({ state, from, to }) => {
            if (isRevealModalOpen) return false;
            
            // Allow Tiptap state checking
            const { doc, selection } = state;
            const { empty } = selection;
            if (empty) return false;
            
            const text = doc.textBetween(from, to, ' ');
            if (text.trim() === '') return false;
            
            // Extra strictly check DOM selection
            const domSelection = window.getSelection();
            if (!domSelection || domSelection.isCollapsed || domSelection.toString().trim() === '') return false;
            
            return true;
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('bold') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title={t('menu.bold')}
          >
            <Bold className="w-4 h-4" />
          </button>

          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('italic') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title={t('menu.italic')}
          >
            <Italic className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1"></div>

          <div className="relative">
            <button
              onClick={() => setShowPalette(!showPalette)}
              className="p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 rounded-md transition-colors"
              title="Text Color"
            >
              <Palette className="w-4 h-4" />
            </button>
            {showPalette && (
              <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 shadow-lg rounded-lg p-2 flex gap-1 z-50">
                {['#000000', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#FFFFFF'].map(color => (
                  <button
                    key={color}
                    onClick={() => {
                      editor.chain().focus().setColor(color).run();
                      setShowPalette(false);
                    }}
                    className="w-6 h-6 rounded-full border border-gray-200 transition-transform hover:scale-110"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('highlight') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title="Highlight"
          >
            <Highlighter className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = 'image/*';
              fileInput.onchange = (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files[0]) {
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    const base64 = e.target?.result as string;
                    editor.chain().focus().setImage({ src: base64 }).run();
                  };
                  reader.readAsDataURL(target.files[0]);
                }
              };
              fileInput.click();
            }}
            className="p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 rounded-md transition-colors"
            title="Insert Image"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1"></div>

          <button
            onClick={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, ' ');
              if (text) {
                openSealModal(text);
              }
            }}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            {t('menu.whisper')}
          </button>
        </BubbleMenu>
      )}

      {/* Editor Content Area */}
      <div className="w-full relative flex-1 h-full md:min-h-[500px] flex flex-col mt-4 md:mt-0 px-4 md:px-0 bg-transparent">
        <EditorContent 
          editor={editor} 
          className="w-full flex-1 focus:outline-none border-none outline-none ring-0 h-full" 
          onClick={() => editor?.commands.focus()} 
        />
        
        {/* Update timestamp */}
        <div className="text-right text-xs md:text-[10px] text-gray-400 mt-12 md:mt-8 pb-12 opacity-50 select-none">
          {t('editor.lastUpdate')} {formatTime(lastSavedTimestamp)}
        </div>
      </div>

      {/* 密语封存弹窗 Seal Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20">
          <div className="bg-white border border-gray-200 rounded-md w-full max-w-[480px] p-6 flex flex-col gap-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-800 mb-6">{t('modal.title')}</h3>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-6 flex flex-col gap-1">
                <span className="text-xs text-gray-400 uppercase">{t('modal.coverText')}</span>
                <p className="text-sm text-gray-700">{currentCoverText}</p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {!sessionWhisperKey && (
                <div className="flex flex-col space-y-3">
                  <div>
                    <input
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
                  placeholder={t('modal.secretPlaceholder')}
                  value={realSecret}
                  onChange={(e) => setRealSecret(e.target.value)}
                  spellCheck="false"
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow resize-none"
                  rows={4}
                  autoFocus
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button
                className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
                onClick={() => setIsModalOpen(false)}
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
      )}

      {/* 导出分享弹窗 Export Modal */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20">
          <div className="bg-white border border-gray-200 rounded-md w-full max-w-[400px] p-6 flex flex-col gap-6 shadow-xl">
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
                onClick={() => {
                  setIsExportModalOpen(false);
                  setExportPassword('');
                  setExportScope('note');
                }}
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
      )}

      {/* 密语阅读弹窗 Reveal Modal */}
      {isRevealModalOpen && activeRevealData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/5 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 w-full max-w-[500px] rounded p-8 flex flex-col gap-6 font-sans">
            <div>
              <h3 className="text-xl font-semibold text-gray-800 mb-6">{t('reveal.title')}</h3>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 mb-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('modal.coverText')}</div>
              <div className="text-sm text-gray-700">{activeRevealData.coverText}</div>
            </div>

            {revealedSecret ? (
              <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-5">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">{t('modal.decryptedText')}</div>
                <div className="text-base text-gray-800 leading-relaxed break-words">{revealedSecret}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 mt-4">
                <input
                  type="password"
                  placeholder={t('reveal.placeholder')}
                  value={revealKey}
                  onChange={(e) => setRevealKey(e.target.value)}
                  spellCheck="false"
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest disabled:opacity-50 disabled:bg-gray-50"
                  autoFocus
                  disabled={!!revealLockoutEndTime || revealNewerVersion}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && revealKey.trim() && !revealLockoutEndTime && !revealNewerVersion) {
                      handleRevealWhisper();
                    }
                  }}
                />
                {revealError && !revealLockoutEndTime && !revealNewerVersion && <span className="text-xs text-red-500 px-1">{revealError}</span>}
                {revealLockoutEndTime && remainingRevealLockout > 0 && !revealNewerVersion && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-lg mt-1 w-full text-left">
                    <Lock size={14} className="shrink-0" />
                    <span>尝试次数过多，请在 {remainingRevealLockout} 秒后重试。</span>
                  </div>
                )}
                {revealNewerVersion && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-600 text-xs px-3 py-2 rounded-lg mt-1 w-full text-left">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>此密语由更高版本的加密算法生成，请升级软件。</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-8">
              <button
                className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
                onClick={handleCloseRevealModal}
              >
                {t('reveal.close')}
              </button>
              {!revealedSecret && (
                <button
                  className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:cursor-not-allowed disabled:shadow-none"
                  onClick={handleRevealWhisper}
                  disabled={!revealKey.trim() || !!revealLockoutEndTime || revealNewerVersion}
                >
                  {t('reveal.reveal')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 密语轻量级解密浮层 Popover (Authorized State) */}
      {activePopoverData && (
        <div
          className="whisper-popover-container fixed z-[60] animate-in fade-in zoom-in-95 duration-150 ease-out"
          style={{
            // Try to place above, if < 200px space, place below
            top: activePopoverData.rect.top > 200 
              ? activePopoverData.rect.top - 12 
              : activePopoverData.rect.bottom + 12,
            left: Math.min(
              Math.max(activePopoverData.rect.left + (activePopoverData.rect.width / 2) - 170, 16), 
              window.innerWidth - 356
            ), // Center above target, prevent overflowing edges
            transform: activePopoverData.rect.top > 200 ? 'translateY(-100%)' : 'none',
          }}
        >
          {/* Arrow Caret */}
          <div 
            className="absolute w-4 h-4 bg-white transform rotate-45 border-r border-b border-gray-100 shadow-[2px_2px_4px_rgba(0,0,0,0.02)]"
            style={{
              left: Math.max(
                16, 
                activePopoverData.rect.left - Math.max(activePopoverData.rect.left + (activePopoverData.rect.width / 2) - 170, 16) + (activePopoverData.rect.width / 2) - 8
              ) + 'px',
              ...(activePopoverData.rect.top > 200 
                ? { bottom: '-8px' } // Pointing down
                : { top: '-8px', borderRight: 'none', borderBottom: 'none', borderLeft: '1px solid #f3f4f6', borderTop: '1px solid #f3f4f6', boxShadow: '-2px -2px 4px rgba(0,0,0,0.02)' } // Pointing up
              )
            }}
          />

          <div className="bg-white border border-gray-100/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl p-6 w-[340px] max-h-64 flex flex-col gap-3 relative z-10">
            <button
              className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors"
              onClick={() => {
                setActivePopoverData(null);
                setPopoverCopied(false);
              }}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider pr-6">
              {activePopoverData.coverText}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1">
              {isPopoverDecrypting ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                  <span className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin"></span>
                  {t('reveal.decrypting') || 'Decrypting...'}
                </div>
              ) : popoverError ? (
                <div className="text-sm text-red-500 py-1 bg-red-50 px-2 rounded-md border border-red-100">
                  {popoverError}
                </div>
              ) : popoverDecryptedSecret ? (
                <div className="relative group/secret">
                  <div className="text-xl font-bold text-zinc-950 leading-relaxed break-words pr-8">
                    {popoverDecryptedSecret}
                  </div>
                  <button
                    className="absolute top-0 right-0 p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors opacity-0 group-hover/secret:opacity-100 focus:opacity-100 flex items-center justify-center bg-white/50"
                    onClick={() => {
                      navigator.clipboard.writeText(popoverDecryptedSecret);
                      setPopoverCopied(true);
                      setTimeout(() => setPopoverCopied(false), 2000);
                    }}
                    title="Copy secret"
                  >
                    {popoverCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
