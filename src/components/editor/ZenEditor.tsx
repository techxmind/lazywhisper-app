import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Share, Save, Bold, Italic, Lock, Highlighter, Palette, Image as ImageIcon, AlertCircle, X, Copy, Check, ChevronUp, ChevronDown, Search, Download, Edit2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { hashKey } from '../../utils/crypto';
import { VaultDocument } from '../../App';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Slice, Fragment, DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { WhisperNode } from '../../core/tiptap/WhisperExtension';
import { SearchAndReplace } from '../../core/tiptap/SearchAndReplace';

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
interface ZenEditorProps {
  activeDoc: VaultDocument;
  documents: VaultDocument[];
  hasActiveSession?: boolean;
  sessionWhisperKey: string | null;
  onSetSessionWhisperKey: (key: string | null) => void;
  onUpdateDocHash: (id: string, hash: string) => void;
  onContentChange: (id: string, content: string, title?: string, isDirty?: boolean) => void;
  onSave: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isSaved: boolean;
  lastSavedTimestamp: number;
  editorFocusTrigger?: number;
  editorInstanceRef?: React.MutableRefObject<{ destroy: () => void; commands: { clearContent: (emitUpdate?: boolean) => boolean } } | null>;
  onImportDocs?: (docs: VaultDocument[]) => Promise<void>;
  currentVaultPath?: string;
}

export function ZenEditor({ activeDoc, documents, hasActiveSession = false, sessionWhisperKey, onSetSessionWhisperKey, onUpdateDocHash, onContentChange, onSave, hasUnsavedChanges, isSaving, isSaved, lastSavedTimestamp, editorFocusTrigger, editorInstanceRef, onImportDocs, currentVaultPath }: ZenEditorProps) {
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

  // --- Find in Page State ---
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTermState] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  // --- Import State ---
  const [isImportPasswordOpen, setIsImportPasswordOpen] = useState(false);
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [importFilePath, setImportFilePath] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importError, setImportError] = useState('');
  const [importedDocs, setImportedDocs] = useState<VaultDocument[]>([]);
  const [isImportDecrypting, setIsImportDecrypting] = useState(false);
  const importPasswordRef = useRef<HTMLInputElement>(null);

  // Modal AutoFocus Refs
  const createModalInputRef = useRef<HTMLInputElement>(null);
  const createModalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const revealModalInputRef = useRef<HTMLInputElement>(null);

  // Reveal State
  const [isRevealModalOpen, setIsRevealModalOpen] = useState(false);
  const [activeRevealData, setActiveRevealData] = useState<{ coverText: string, encryptedSecret: string, rect: DOMRect, pos?: number } | null>(null);
  const [revealKey, setRevealKey] = useState('');
  const [revealError, setRevealError] = useState('');
  const [revealNewerVersion, setRevealNewerVersion] = useState(false);

  // Robust AutoFocus for Create Modal
  useEffect(() => {
    if (isModalOpen) {
      const timer = setTimeout(() => {
        if (!sessionWhisperKey) {
          createModalInputRef.current?.focus();
        } else {
          createModalTextareaRef.current?.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isModalOpen, sessionWhisperKey]);

  // Robust AutoFocus for Reveal Modal
  useEffect(() => {
    if (isRevealModalOpen && activeRevealData) {
      const timer = setTimeout(() => {
        revealModalInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isRevealModalOpen, activeRevealData]);

  // Popover State (UX Upgrade)
  const [activePopoverData, setActivePopoverData] = useState<{ coverText: string, encryptedSecret: string, rect: DOMRect, pos?: number } | null>(null);

  // For editing existing whisper block
  const [currentEditPos, setCurrentEditPos] = useState<number | null>(null);
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

  const wasDirtyRef = useRef(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      const isDirty = localContentRef.current !== baselineContentRef.current;
      // Only notify App.tsx when dirty state actually changes, or content drifted
      if (isDirty) {
        onContentChange(activeDoc.id, localContentRef.current, localTitleRef.current, true);
        wasDirtyRef.current = true;
      } else if (wasDirtyRef.current) {
        // Transition: dirty → clean (e.g. after Ctrl+Z) — signal App.tsx to clear dirty flag
        onContentChange(activeDoc.id, localContentRef.current, localTitleRef.current, false);
        wasDirtyRef.current = false;
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [localContent, activeDoc.id]); // trigger debounce countdown whenever user types

  // HIGH-3: Wire editor ref to parent for forceLock destruction
  // + MEDIUM-5: Zeroize all sensitive state on unmount
  useEffect(() => {
    return () => {
      // Unmount cleanup: scrub all sensitive data from component state
      setWhisperKey('');
      setConfirmWhisperKey('');
      setRealSecret('');
      setRevealKey('');
      setPopoverDecryptedSecret(null);
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      SearchAndReplace.configure({
        searchResultClass: 'search-result',
        disableRegex: true,
      }),
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
    autofocus: false,
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
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null;
        if (target && target.closest('span[data-type="whisperNode"]')) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const whisperSpan = target?.closest('span[data-type="whisperNode"]');
          if (whisperSpan) {
            event.preventDefault(); // Stop iOS keyboard/focus
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();

            const coverText = whisperSpan.getAttribute('data-cover');
            const encryptedSecret = whisperSpan.getAttribute('data-secret');

            if (coverText && encryptedSecret) {
              const rect = whisperSpan.getBoundingClientRect();

              // Safely attempt to get node position (ProseMirror requires exact positions, not DOM nodes)
              let pos: number | undefined;
              try { pos = _view.posAtDOM(whisperSpan, 0) - 1; } catch (e) { }

              if (sessionKeyRef.current) {
                setActivePopoverData({ coverText, encryptedSecret, rect, pos });
                setIsRevealModalOpen(false);
              } else {
                setActiveRevealData({ coverText, encryptedSecret, rect, pos });
                setIsRevealModalOpen(true);
                setActivePopoverData(null);
              }
            }
            return true;
          }
          return false;
        },
        touchstart: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const whisperSpan = target?.closest('span[data-type="whisperNode"]');
          if (whisperSpan) {
            event.preventDefault(); // Stop iOS keyboard/focus PRE-click
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();

            const coverText = whisperSpan.getAttribute('data-cover');
            const encryptedSecret = whisperSpan.getAttribute('data-secret');

            if (coverText && encryptedSecret) {
              const rect = whisperSpan.getBoundingClientRect();

              let pos: number | undefined;
              try { pos = _view.posAtDOM(whisperSpan, 0) - 1; } catch (e) { }

              if (sessionKeyRef.current) {
                setActivePopoverData({ coverText, encryptedSecret, rect, pos });
                setIsRevealModalOpen(false);
              } else {
                setActiveRevealData({ coverText, encryptedSecret, rect, pos });
                setIsRevealModalOpen(true);
                setActivePopoverData(null);
              }
            }
            return true;
          }
          return false;
        },
        touchend: (_view, event) => {
          const target = event.target as HTMLElement | null;
          if (target && target.closest('span[data-type="whisperNode"]')) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          return false;
        }
      },
      transformPasted: (slice) => {
        const currentNoteId = activeDoc.id;
        let isCorrupted = false;

        const unwrapNodes = (fragment: Fragment): Fragment => {
          const nodes: any[] = [];
          fragment.forEach((node) => {
            if (node.type.name === 'whisperNode') {
              if (node.attrs.originNoteId !== currentNoteId) {
                isCorrupted = true;
                if (node.attrs.coverText) {
                  nodes.push(node.type.schema.text(node.attrs.coverText));
                }
              } else {
                nodes.push(node);
              }
            } else if (node.isText) {
              nodes.push(node);
            } else {
              nodes.push(node.copy(unwrapNodes(node.content)));
            }
          });
          return Fragment.from(nodes);
        };

        const newFragment = unwrapNodes(slice.content);
        return isCorrupted ? new Slice(newFragment, slice.openStart, slice.openEnd) : slice;
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

  // HIGH-3: Expose editor instance to parent for forceLock destruction
  useEffect(() => {
    if (editorInstanceRef && editor) {
      editorInstanceRef.current = editor;
    }
    return () => {
      if (editorInstanceRef) {
        editorInstanceRef.current = null;
      }
    };
  }, [editor, editorInstanceRef]);

  const prevDocIdRef = useRef(activeDoc.id);

  // Sync editor content with activeDoc.content when activeDoc.id changes
  useEffect(() => {
    if (editor) {
      if (activeDoc.content !== editor.getHTML()) {
        // Use raw ProseMirror transaction with addToHistory:false
        // to prevent Ctrl+Z from loading previous document content
        const div = document.createElement('div');
        div.innerHTML = activeDoc.content;
        const parser = PMDOMParser.fromSchema(editor.schema);
        const parsed = parser.parse(div);
        const tr = editor.state.tr
          .replaceWith(0, editor.state.doc.content.size, parsed.content)
          .setMeta('addToHistory', false);
        editor.view.dispatch(tr);

        const normalizedHTML = editor.getHTML();
        localContentRef.current = normalizedHTML;
        setLocalContent(normalizedHTML);
        baselineContentRef.current = normalizedHTML;
      }
      localTitleRef.current = activeDoc.title || t('sidebar.untitled');

      // Content-aware AutoFocus: only focus empty (new) documents
      if (prevDocIdRef.current !== activeDoc.id) {
        prevDocIdRef.current = activeDoc.id;
        const contentIsEmpty = !activeDoc.content || activeDoc.content === '<p></p>' || activeDoc.content === '';
        if (contentIsEmpty) {
          const timer = setTimeout(() => {
            if (!editor.isDestroyed) {
              editor.commands.focus('end');
            }
          }, 50);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [activeDoc.id, editor, activeDoc.content, activeDoc.title, t]); // rely on doc ID swap

  // Global UX AutoFocus for New Note creation
  useEffect(() => {
    if (editorFocusTrigger && editorFocusTrigger > 0 && editor && !editor.isDestroyed) {
      // Small buffer to let React state flush the new activeDoc
      const timer = setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.commands.focus('end');
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editorFocusTrigger, editor]);

  // ═══════ iOS Keyboard: focus-based padding + delayed scrollIntoView ═══════
  const keyboardHeight = useKeyboardHeight();
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const prevKeyboardHeightRef = useRef(0);

  // Track editor focus state for dynamic padding
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onFocus = () => {
      setIsEditorFocused(true);
      // Fix 3: 300ms delayed scrollIntoView — wait for iOS keyboard animation
      setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.commands.scrollIntoView();
        }
      }, 300);
    };
    const onBlur = () => setIsEditorFocused(false);
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);
    return () => {
      editor.off('focus', onFocus);
      editor.off('blur', onBlur);
    };
  }, [editor]);

  // Also scrollIntoView when keyboard height changes while focused
  useEffect(() => {
    if (keyboardHeight > 0 && prevKeyboardHeightRef.current === 0) {
      if (editor && !editor.isDestroyed && editor.isFocused) {
        setTimeout(() => {
          editor.commands.scrollIntoView();
        }, 300);
      }
    }
    prevKeyboardHeightRef.current = keyboardHeight;
  }, [keyboardHeight, editor]);

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
        }).then((_extracted) => {
          setRevealKey(sessionWhisperKey);
          setRevealError('');
          // Zero-click Instant Handoff
          setActivePopoverData({
            coverText: activeRevealData.coverText,
            encryptedSecret: activeRevealData.encryptedSecret,
            rect: activeRevealData.rect
          });
          setIsRevealModalOpen(false);
          setActiveRevealData(null);
          setRevealKey('');
        }).catch(() => {
          onSetSessionWhisperKey(null);
          setRevealError(t('whisper.keyIncorrect'));
        });
      } else {
        setRevealKey('');
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
        setPopoverError(typeof err === 'string' ? err : t('reveal.decryptFailed'));
        setPopoverDecryptedSecret(null);
      }).finally(() => {
        setIsPopoverDecrypting(false);
      });
    } else {
      setPopoverDecryptedSecret(null);
    }
  }, [activePopoverData, sessionWhisperKey]);

  // Popover Dismissal (Outside Click & Lock)
  useEffect(() => {
    if (!activePopoverData) return;

    // Auto-dismiss if lock state triggers
    if (!sessionWhisperKey) {
      setActivePopoverData(null);
      return;
    }

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // If click is inside popover or inside a whisper node, don't close here
      // (Whisper node clicks are handled by handleClick which will swap the popover data)
      if (target.closest('.whisper-popover-container') || target.closest('span[data-type="whisperNode"]')) {
        return;
      }
      setActivePopoverData(null);
    };

    // Use capturing phase to ensure we beat React's synthetic event bubbling
    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true, capture: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, { capture: true });
    };
  }, [activePopoverData, sessionWhisperKey]);

  // Click detection for Whisper Reveal is now handled natively via `handleClick` editorProps
  // Removed old DOM listener hook entirely to avoid propagation conflicts.

  // --- Find in Page: close handler ---
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchTermState('');
    if (editor && !editor.isDestroyed) {
      editor.commands.setSearchTerm('');
    }
  }, [editor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F → Open Find in Page
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 50);
        return;
      }

      // Global ESC
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          closeSearch();
        } else if (isImportPasswordOpen || isImportConfirmOpen) {
          closeImport();
        } else if (isRevealModalOpen) {
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

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRevealModalOpen, isExportModalOpen, isImportPasswordOpen, isImportConfirmOpen, isModalOpen, activePopoverData, isSearchOpen, closeSearch]);

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

  // ═══════ Import Workflow Handlers ═══════

  const closeImport = () => {
    setIsImportPasswordOpen(false);
    setIsImportConfirmOpen(false);
    setImportFilePath('');
    setImportPassword('');
    setImportError('');
    setImportedDocs([]);
    setIsImportDecrypting(false);
  };

  const handleImportClick = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'WhisperSpace', extensions: ['wspace'] }],
      });

      if (!selected) return; // User cancelled

      const filePath = typeof selected === 'string' ? selected : selected;

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
  };

  const handleImportDecrypt = async () => {
    if (!importPassword.trim()) return;
    setImportError('');
    setIsImportDecrypting(true);

    try {
      const rawContent = await invoke<string>('import_vault', {
        filename: importFilePath,
        password: importPassword,
      });

      // SECURITY: wipe import password from React state immediately after IPC call
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
      setImportPassword(''); // SECURITY: wipe on failure too
      setImportError(t('import.passwordError'));
    } finally {
      setIsImportDecrypting(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!onImportDocs || importedDocs.length === 0) return;

    // Re-ID all notes to prevent collisions
    const reIdDocs = importedDocs.map((doc) => ({
      ...doc,
      id: crypto.randomUUID(),
    }));

    await onImportDocs(reIdDocs);
    closeImport();
  };

  const handleWhisperToolClick = () => {
    if (!editor) return;

    let { from, to, empty } = editor.state.selection;

    if (empty) {
      const { $head } = editor.state.selection;
      if ($head.parent.isTextblock) {
        let targetNode = null;
        let childStart = 0;
        let currentOffset = 0;

        for (let i = 0; i < $head.parent.childCount; i++) {
          const child = $head.parent.child(i);
          const childEnd = currentOffset + child.nodeSize;

          if ($head.parentOffset >= currentOffset && $head.parentOffset <= childEnd) {
            if (child.isText) {
              targetNode = child;
              childStart = currentOffset;
              break;
            }
          }
          currentOffset = childEnd;
        }

        if (targetNode && targetNode.text) {
          const text = targetNode.text;
          const localOffset = $head.parentOffset - childStart;

          let start = localOffset;
          while (start > 0 && /\S/.test(text[start - 1])) start--;

          let end = localOffset;
          while (end < text.length && /\S/.test(text[end])) end++;

          if (start < end) {
            const startPos = $head.start() + childStart + start;
            const endPos = $head.start() + childStart + end;

            const wordSelection = TextSelection.create(editor.state.doc, startPos, endPos);
            editor.view.dispatch(editor.state.tr.setSelection(wordSelection));
            from = wordSelection.from;
            to = wordSelection.to;
          }
        }
      }
    }

    const text = editor.state.doc.textBetween(from, to, ' ');
    openSealModal(text);
  };


  const openSealModal = (text: string, pos?: number) => {
    setCurrentCoverText(text);
    setRealSecret(text); // Default real secret to the selected text so they can edit it
    setSealError('');
    setConfirmWhisperKey('');
    setCurrentEditPos(pos || null);

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
      setSealError(t('whisper.encryptionFailed'));
      return;
    }

    if (currentEditPos !== null) {
      editor.chain().focus()
        .setNodeSelection(currentEditPos)
        .setWhisperNode({
          coverText: currentCoverText,
          encryptedSecret: encryptedSecret,
          originNoteId: activeDoc.id
        }).run();
    } else {
      editor.chain().focus().setWhisperNode({
        coverText: currentCoverText,
        encryptedSecret: encryptedSecret,
        originNoteId: activeDoc.id
      }).run();
    }

    setIsModalOpen(false);
    setWhisperKey('');
    setConfirmWhisperKey('');
    setRealSecret('');
    setCurrentCoverText('');
    setCurrentEditPos(null);
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
        await invoke<string>('decrypt_secret', {
          ciphertext: activeRevealData.encryptedSecret,
          key: revealKey
        });

        // Zero-click Handoff
        onSetSessionWhisperKey(revealKey);
        setRevealError('');
        setActivePopoverData({
          coverText: activeRevealData.coverText,
          encryptedSecret: activeRevealData.encryptedSecret,
          rect: activeRevealData.rect
        });
        setIsRevealModalOpen(false);
        setActiveRevealData(null);
        setRevealKey('');
        setRevealNewerVersion(false);
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
    setRevealError('');
    setRevealNewerVersion(false);
  };

  const actionButtons = (
    <>
      {/* Import Button */}
      <button
        type="button"
        className="flex items-center gap-1.5 md:text-xs text-sm font-medium text-blue-500 hover:text-blue-600 md:text-gray-500 md:hover:text-gray-900 cursor-pointer transition-colors px-2 py-2 min-h-[44px] md:min-h-0 md:px-0 md:py-0"
        onClick={handleImportClick}
      >
        <Download className="w-4 h-4 md:w-3.5 md:h-3.5" />
        <span className="hidden md:inline">{t('import.button')}</span>
      </button>
      {/* Export Button */}
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
        className={`flex items-center gap-1.5 md:text-xs text-sm font-medium cursor-pointer transition-colors px-3 py-2 min-h-[44px] md:min-h-0 md:px-3 md:py-1.5 rounded-md disabled:opacity-50 ${hasUnsavedChanges
          ? 'text-blue-600 md:bg-gray-800 md:text-white md:shadow-sm md:hover:bg-gray-900'
          : 'text-gray-400 md:text-gray-500 md:hover:text-gray-900 md:hover:bg-gray-100'
          }`}
        onClick={(e) => { e.preventDefault(); onSave(); }}
        disabled={isSaving || !hasActiveSession}
      >
        <span className="md:hidden whitespace-nowrap">{isSaved ? t('editor.saved') : t('editor.save')}</span>
        <Save className="w-4 h-4 md:w-3.5 md:h-3.5 hidden md:block shrink-0" />
        <span className="hidden md:inline whitespace-nowrap">{isSaved ? t('editor.saved') : t('editor.save')}</span>
      </button>
    </>
  );

  return (
    <div className="relative w-full px-0 py-0 md:max-w-[800px] md:mx-auto md:px-8 md:py-12 sm:px-16 sm:py-24 prose prose-slate max-w-none focus:outline-none [&_.ProseMirror]:outline-none flex flex-col h-full bg-white dark:bg-zinc-950">

      {/* 桌面端吸顶操作栏：毛玻璃背景 sticky header */}
      <div className="hidden md:flex sticky top-0 z-10 items-center justify-end gap-4 w-full bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md pt-2 pb-4 mb-4">
        {actionButtons}
      </div>

      {/* 移动端通过 React Portal 将按钮传送到顶部 Header */}
      {mobileHeaderNode && createPortal(
        <div className="flex items-center justify-end gap-1">
          {actionButtons}
        </div>,
        mobileHeaderNode
      )}

      {/* 必须先判断 editor 是否存在，再渲染 BubbleMenu */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{
            duration: 100,
            appendTo: () => document.body,
            zIndex: 99999,
            maxWidth: '90vw',
            offset: [0, 12],
          }}
          className="flex items-center p-1 space-x-1 bg-white border border-gray-200 shadow-md rounded-lg relative pointer-events-auto"
          shouldShow={({ state, from, to }) => {
            if (isRevealModalOpen) return false;
            if (typeof window !== 'undefined' && window.innerWidth < 768) return false;

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
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('bold') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title={t('menu.bold')}
          >
            <Bold className="w-4 h-4" />
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('italic') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title={t('menu.italic')}
          >
            <Italic className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1"></div>

          <div className="relative">
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
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
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
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
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            className={`p-1.5 rounded-md transition-colors ${editor.isActive('highlight') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            title="Highlight"
          >
            <Highlighter className="w-4 h-4" />
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
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
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleWhisperToolClick}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            {t('menu.whisper')}
          </button>
        </BubbleMenu>
      )}

      {/* Editor Content Area */}
      <div className="w-full relative flex-1 min-h-0 md:min-h-[500px] flex flex-col mt-4 md:mt-0 px-4 md:px-0 bg-transparent">

        {/* Find in Page Floating Panel */}
        <AnimatePresence>
          {isSearchOpen && (
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
                  setSearchTermState(val);
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
                onClick={closeSearch}
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                title={t('editor.findClose')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <EditorContent
          editor={editor}
          className="w-full flex-1 focus:outline-none border-none outline-none ring-0 h-full"
          onClick={() => editor?.commands.focus()}
        />


        {/* Update timestamp — fixed bottom-right, hidden when editor focused */}
        {!isEditorFocused && (
          <div className="fixed bottom-4 right-4 text-xs md:text-[10px] text-gray-400 opacity-50 select-none pointer-events-none z-10">
            {t('editor.lastUpdate')} {formatTime(lastSavedTimestamp)}
          </div>
        )}
      </div>

      {/* 密语封存弹窗 Seal Modal */}
      {isModalOpen && (
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

      {/* 密语阅读弹窗 Reveal Modal */}
      {isRevealModalOpen && activeRevealData && (
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
                onClick={handleCloseRevealModal}
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
      )}

      {/* 密语轻量级解密浮层 Popover (Authorized State) */}
      {createPortal(
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
                {/* Arrow Caret — z-30 sits ABOVE body (z-10), offset -5px for 1px overlap to cover body border seam */}
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

                <div className="bg-white dark:bg-zinc-900/95 dark:backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-4 md:p-6 w-[calc(100vw-32px)] md:w-[340px] max-w-[340px] max-h-64 flex flex-col relative z-10">
                  <button
                    className="absolute top-3 right-3 z-20 p-1.5 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center justify-center bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md"
                    onClick={() => {
                      setActivePopoverData(null);
                      setPopoverCopied(false);
                    }}
                    aria-label="Close"
                  >
                    <X className="w-5 h-5 md:w-4 md:h-4" />
                  </button>

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
                        <div className="text-lg md:text-xl font-medium tracking-wide text-blue-600 dark:text-blue-400 leading-relaxed break-words pr-10">
                          {popoverDecryptedSecret}
                        </div>
                        <div className="flex items-center justify-end gap-2 md:gap-1.5 opacity-100 md:opacity-0 md:group-hover/secret:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                          <button
                            className="p-2 md:p-1.5 min-w-[36px] min-h-[36px] md:min-w-[28px] md:min-h-[28px] text-zinc-500 md:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-[10px] md:rounded-md transition-colors flex items-center justify-center bg-zinc-100 md:bg-white/50 dark:bg-zinc-800 md:dark:bg-zinc-900/50"
                            onClick={() => {
                              setCurrentCoverText(activePopoverData.coverText);
                              setRealSecret(popoverDecryptedSecret);
                              setSealError('');
                              setConfirmWhisperKey('');
                              setCurrentEditPos(activePopoverData.pos || null);
                              if (sessionWhisperKey) {
                                setWhisperKey(sessionWhisperKey);
                              } else {
                                setWhisperKey('');
                              }
                              setIsModalOpen(true);
                              setActivePopoverData(null);
                            }}
                            title="Edit whisper"
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
                            title="Copy secret"
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
      )}

      {/* Mobile Keyboard Toolbar */}
      <div
        className="md:hidden fixed z-[45] left-0 right-0 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_10px_rgba(0,0,0,0.2)] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        style={{ bottom: keyboardHeight > 0 ? keyboardHeight : 0, transition: 'bottom 0.1s ease-out' }}
      >
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={`p-2 rounded-md transition-colors shrink-0 ${editor?.isActive('bold') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
        >
          <Bold className="w-5 h-5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={`p-2 rounded-md transition-colors shrink-0 ${editor?.isActive('italic') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
        >
          <Italic className="w-5 h-5" />
        </button>

        {/* Text Color Picker */}
        <div className="relative shrink-0 flex items-center justify-center p-2 rounded-md transition-colors text-zinc-500 hover:text-zinc-800">
          <Palette className="w-5 h-5 absolute pointer-events-none" />
          <input
            type="color"
            className="w-5 h-5 opacity-0 cursor-pointer"
            onChange={(e) => {
              editor?.chain().focus().setColor(e.target.value).run();
            }}
          />
        </div>

        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleHighlight().run()}
          className={`p-2 rounded-md transition-colors shrink-0 ${editor?.isActive('highlight') ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800'}`}
        >
          <Highlighter className="w-5 h-5" />
        </button>

        {/* Image Upload */}
        <div className="relative shrink-0 flex items-center justify-center p-2 rounded-md transition-colors text-zinc-500 hover:text-zinc-800">
          <ImageIcon className="w-5 h-5 absolute pointer-events-none" />
          <input
            type="file"
            accept="image/*"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  const base64 = event.target?.result as string;
                  editor?.chain().focus().setImage({ src: base64 }).run();
                };
                reader.readAsDataURL(file);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700 mx-2 shrink-0"></div>

        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={handleWhisperToolClick}
          className="flex items-center justify-center gap-1.5 p-2 px-3 shrink-0 rounded-md transition-colors text-blue-600 dark:text-blue-500 bg-blue-50 dark:bg-blue-900/30 font-medium ml-auto"
        >
          <Lock className="w-5 h-5" />
          <span className="text-sm">{t('menu.whisper')}</span>
        </button>
      </div>

    </div>
  );
}
