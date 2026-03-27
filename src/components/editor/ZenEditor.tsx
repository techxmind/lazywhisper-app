import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { createPortal } from 'react-dom';
import { Share, Save, Download } from 'lucide-react';
import { VaultDocument } from '../../App';
import { useTranslation } from 'react-i18next';
import { ImportModal, ImportModalRef } from './modals/ImportModal';
import { ExportModal, ExportModalRef } from './modals/ExportModal';
import { SealWhisperModal, SealWhisperModalRef } from './modals/SealWhisperModal';
import { RevealWhisperModal, RevealWhisperModalRef, PopoverData } from './modals/RevealWhisperModal';
import { MobileToolbar } from './ui/MobileToolbar';
import { SearchPanel } from './ui/SearchPanel';
import { DesktopBubbleMenu } from './ui/DesktopBubbleMenu';
import { WhisperPopover } from './ui/WhisperPopover';
import { Extension } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
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

const TabIndent = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // 1. Attempt native list hierarchical indentation first
        if (this.editor.commands.sinkListItem('listItem')) {
          return true;
        }
        // 2. If not in a list (or sink failed), intercept focus blur and inject immersive 4-space indent
        return this.editor.commands.insertContent('    ');
      },
    };
  },
});

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
  editorInstanceRef?: React.MutableRefObject<{ destroy: () => void; commands: { clearContent: (emitUpdate?: boolean) => boolean } } | null>;
  onImportDocs?: (docs: VaultDocument[]) => Promise<void>;
  currentVaultPath?: string;
}

export function ZenEditor({ activeDoc, documents, hasActiveSession = false, sessionWhisperKey, onSetSessionWhisperKey, onUpdateDocHash, onContentChange, onSave, hasUnsavedChanges, isSaving, isSaved, lastSavedTimestamp, editorInstanceRef, onImportDocs, currentVaultPath }: ZenEditorProps) {
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
  const sealModalRef = useRef<SealWhisperModalRef>(null);

  const exportModalRef = useRef<ExportModalRef>(null);

  // --- Find in Page State ---
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // --- Import Component Ref ---
  const importModalRef = useRef<ImportModalRef>(null);

  const revealModalRef = useRef<RevealWhisperModalRef>(null);

  // Popover State (UX Upgrade)
  const [activePopoverData, setActivePopoverData] = useState<PopoverData | null>(null);


  // Fix: Track session key in a mutable ref to escape useEditor's stale closure
  const sessionKeyRef = useRef(sessionWhisperKey);
  useEffect(() => {
    sessionKeyRef.current = sessionWhisperKey;
  }, [sessionWhisperKey]);

  // 🚀 Zero-Render Debounce: decouple high-frequency typing from React render cycle.
  // Instead of storing HTML in useState (which triggers re-render on every keystroke),
  // we use a ref-based timer that fires the parent notification with zero React overhead.
  const localContentRef = useRef(activeDoc.content); // For instant sync logic bypassing stale closures
  const localTitleRef = useRef(activeDoc.title || t('sidebar.untitled'));
  const wasDirtyRef = useRef(false);
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleContentSync = useCallback(() => {
    if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
    contentDebounceRef.current = setTimeout(() => {
      const isDirty = localContentRef.current !== baselineContentRef.current;
      if (isDirty) {
        onContentChange(activeDoc.id, localContentRef.current, localTitleRef.current, true);
        wasDirtyRef.current = true;
      } else if (wasDirtyRef.current) {
        onContentChange(activeDoc.id, localContentRef.current, localTitleRef.current, false);
        wasDirtyRef.current = false;
      }
    }, 500);
  }, [activeDoc.id, onContentChange]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (contentDebounceRef.current) clearTimeout(contentDebounceRef.current);
    };
  }, []);



  const editor = useEditor({
    extensions: [
      StarterKit,
      TabIndent,
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
      scheduleContentSync(); // 🚀 Zero-render: ref-based debounce, no React setState
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

              let pos: number | undefined;
              try {
                const domPos = _view.posAtDOM(whisperSpan, 0);
                for (let i = Math.max(0, domPos - 10); i <= domPos + 10; i++) {
                  const node = _view.state.doc.nodeAt(i);
                  if (node?.type.name === 'whisperNode' && node.attrs.encryptedSecret === encryptedSecret) {
                    pos = i;
                    break;
                  }
                }
              } catch (e) { }

              if (sessionKeyRef.current) {
                setActivePopoverData({ coverText, encryptedSecret, rect, pos });
              } else {
                revealModalRef.current?.startReveal({ coverText, encryptedSecret, rect, pos });
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
              try {
                const domPos = _view.posAtDOM(whisperSpan, 0);
                for (let i = Math.max(0, domPos - 10); i <= domPos + 10; i++) {
                  const node = _view.state.doc.nodeAt(i);
                  if (node?.type.name === 'whisperNode' && node.attrs.encryptedSecret === encryptedSecret) {
                    pos = i;
                    break;
                  }
                }
              } catch (e) { }

              if (sessionKeyRef.current) {
                setActivePopoverData({ coverText, encryptedSecret, rect, pos });
              } else {
                revealModalRef.current?.startReveal({ coverText, encryptedSecret, rect, pos });
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
        // 🔒 XSS Sandbox: DOMParser creates an inert document that does NOT
        // execute scripts, fire onerror handlers, or trigger network requests.
        // Unlike div.innerHTML which pre-executes payloads before Tiptap sanitizes.
        const sandboxDoc = new DOMParser().parseFromString(activeDoc.content, 'text/html');
        const parser = PMDOMParser.fromSchema(editor.schema);
        const parsed = parser.parse(sandboxDoc.body);
        const tr = editor.state.tr
          .replaceWith(0, editor.state.doc.content.size, parsed.content)
          .setMeta('addToHistory', false);
        editor.view.dispatch(tr);

        const normalizedHTML = editor.getHTML();
        localContentRef.current = normalizedHTML;
        baselineContentRef.current = normalizedHTML;
      }
      localTitleRef.current = activeDoc.title || t('sidebar.untitled');

      // Content-aware AutoFocus: only focus empty (new) documents
      if (prevDocIdRef.current !== activeDoc.id) {
        prevDocIdRef.current = activeDoc.id;
        const contentIsEmpty = !activeDoc.content || activeDoc.content === '<p></p>' || activeDoc.content === '';
        if (contentIsEmpty) {
          console.log("ContentIsEmpty,AutoFocus to end");
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




  // Click detection for Whisper Reveal is now handled natively via `handleClick` editorProps
  // Removed old DOM listener hook entirely to avoid propagation conflicts.

  // --- Find in Page: close handler ---
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const closePopover = useCallback(() => {
    setActivePopoverData(null);
  }, []);

  const handleEditWhisperPopup = useCallback((coverText: string, pos: number | undefined, secret: string) => {
    sealModalRef.current?.startSeal(coverText, pos, secret);
    setActivePopoverData(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F → Open Find in Page
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchOpen(true);
        return;
      }

      // Global ESC
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          closeSearch();
        } else if (activePopoverData) {
          setActivePopoverData(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activePopoverData, isSearchOpen, closeSearch]);

  if (!editor) {
    return null;
  }


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
    sealModalRef.current?.startSeal(text);
  };


  const handleSealSuccess = (coverText: string, encryptedSecret: string, currentEditPos: number | null) => {
    if (currentEditPos !== null) {
      editor.view.dispatch(
        editor.view.state.tr.setNodeMarkup(currentEditPos, undefined, {
          coverText,
          encryptedSecret,
          originNoteId: activeDoc.id
        })
      );
      editor.commands.focus();
    } else {
      editor.chain().focus().setWhisperNode({
        coverText,
        encryptedSecret,
        originNoteId: activeDoc.id
      }).run();
    }
  };

  const handleRevealSuccess = (key: string, data: PopoverData) => {
    onSetSessionWhisperKey(key);
    setActivePopoverData(data);
  };

  const actionButtons = (
    <>
      {/* Import Button */}
      <button
        type="button"
        className="flex items-center gap-1.5 md:text-xs text-sm font-medium text-blue-500 hover:text-blue-600 md:text-gray-500 md:hover:text-gray-900 cursor-pointer transition-colors px-2 py-2 min-h-[44px] md:min-h-0 md:px-0 md:py-0"
        onClick={() => importModalRef.current?.startImport()}
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
          exportModalRef.current?.startExport();
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
        <DesktopBubbleMenu
          editor={editor}
          onSealClick={handleWhisperToolClick}
        />
      )}

      {/* Editor Content Area */}
      <div className="w-full relative flex-1 min-h-0 md:min-h-[500px] flex flex-col mt-4 md:mt-0 px-4 md:px-0 bg-transparent">

        {/* Find in Page Floating Panel */}
        <SearchPanel 
          editor={editor}
          isOpen={isSearchOpen}
          onClose={closeSearch}
        />

        <EditorContent
          editor={editor}
          className="w-full flex-1 focus:outline-none border-none outline-none ring-0 h-full"
        />


        {/* Update timestamp — fixed bottom-right, hidden when editor focused */}
        {!isEditorFocused && (
          <div className="fixed bottom-4 right-4 text-xs md:text-[10px] text-gray-400 opacity-50 select-none pointer-events-none z-10">
            {t('editor.lastUpdate')} {formatTime(lastSavedTimestamp)}
          </div>
        )}
      </div>

      <SealWhisperModal
        ref={sealModalRef}
        activeDoc={activeDoc}
        sessionWhisperKey={sessionWhisperKey}
        onSetSessionWhisperKey={onSetSessionWhisperKey}
        onUpdateDocHash={onUpdateDocHash}
        onSealSuccess={handleSealSuccess}
      />

      <ExportModal
        ref={exportModalRef}
        activeDoc={activeDoc}
        documents={documents}
      />

      {/* 🧩 Excerpted Modular UI Components */}
      <ImportModal 
        ref={importModalRef} 
        currentVaultPath={currentVaultPath || null} 
        onImportSuccess={onImportDocs || (() => {})} 
      />

      <RevealWhisperModal
        ref={revealModalRef}
        activeDoc={activeDoc}
        editor={editor}
        onUpdateDocHash={onUpdateDocHash}
        onRevealSuccess={handleRevealSuccess}
      />

      {/* 密语轻量级解密浮层 Popover (Authorized State) */}
      <WhisperPopover
        activePopoverData={activePopoverData}
        sessionWhisperKey={sessionWhisperKey}
        onClose={closePopover}
        onEditWhisper={handleEditWhisperPopup}
      />

      {/* Mobile Keyboard Toolbar */}
      <MobileToolbar
        editor={editor}
        keyboardHeight={keyboardHeight}
        onSealClick={handleWhisperToolClick}
      />

    </div>
  );
}
