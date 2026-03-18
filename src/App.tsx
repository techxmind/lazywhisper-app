import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WhisperRadarProvider } from "./contexts/WhisperRadarContext";
import { Sidebar } from "./components/layout/Sidebar";
import { ZenEditor } from "./components/editor/ZenEditor";
import { UnlockScreen } from "./components/layout/UnlockScreen";
import { SettingsModal } from "./components/layout/SettingsModal";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { documentDir, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, confirm } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { useAutoLock } from './hooks/useAutoLock';
// import { Menu, Submenu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import './index.css';

// Module-level cache to shield Handshake from React 18 Strict Mode double-mounting
let globalInitialColdPath: string | null | undefined = undefined;
let globalHandshakePromise: Promise<string[]> | null = null;

export interface VaultDocument {
  id: string;
  title: string;
  content: string;
  whisperKeyHash?: string;
}

function App() {
  const { t, i18n } = useTranslation();
  const [isLocked, setIsLocked] = useState(true);
  const [vaultPassword, setVaultPassword] = useState("");
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  
  // Auto-focus trigger for Editor
  const [editorFocusTrigger, setEditorFocusTrigger] = useState<number>(0);
  const [unlockError, setUnlockError] = useState("");
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});

  const [vaultPath, setVaultPath] = useState("");
  const [isPathReady, setIsPathReady] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isVaultExists, setIsVaultExists] = useState(true);
  const [unsavedDocIds, setUnsavedDocIds] = useState<Set<string>>(new Set());
  const hasUnsavedChanges = unsavedDocIds.size > 0;
  const [autoLockMin, setAutoLockMin] = useState(() => Number(localStorage.getItem('lazywhisper-autolock-time') || 5));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState(Date.now());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // iOS Keyboard Safeshield
  useEffect(() => {
    const applyViewportHeight = () => {
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      // Forcefully correct any iOS background wrapper panning
      window.scrollTo(0, 0); 
    };

    const blockDocumentScroll = () => {
      if (window.scrollY > 0 || window.scrollX > 0) {
        window.scrollTo(0, 0);
      }
    };

    window.visualViewport?.addEventListener('resize', applyViewportHeight);
    window.addEventListener('resize', applyViewportHeight);
    window.addEventListener('focusin', applyViewportHeight);
    window.addEventListener('scroll', blockDocumentScroll, { passive: false });

    // Init
    applyViewportHeight();

    return () => {
      window.visualViewport?.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('focusin', applyViewportHeight);
      window.removeEventListener('scroll', blockDocumentScroll);
    };
  }, []);

  useEffect(() => {
    const updateWindowTitle = async () => {
      try {
        //const appName = t('sidebar.brand') || 'LazyWhisper';
        const newTitle = t('window.title') || 'LazyWhisper';
        await getCurrentWindow().setTitle(newTitle);

        // macOS native menu override
        /*
        const aboutText = `${t('menu.about')} ${appName}`;
        const quitText = `${t('menu.quit')} ${appName}`;

        const appMenu = await Submenu.new({
          text: appName,
          items: [
            await MenuItem.new({ 
              text: aboutText, 
              action: () => {
                // simple action to open settings for now, or just notify
                console.log("About clicked");
              } 
            }),
            await PredefinedMenuItem.new({ item: 'Separator' }),
            await PredefinedMenuItem.new({ item: 'Quit', text: quitText })
          ]
        });

        // Other standard macOS menus (Edit, Window, etc.) could be added here later
        const menu = await Menu.new({ items: [appMenu] });
        await menu.setAsAppMenu();
        */
      } catch (error) {
        console.error("Failed to set window title or menu:", error);
      }
    };

    updateWindowTitle();
  }, [i18n.language, t]);

  useEffect(() => {
    console.log("🟡 [React] App mounted, 准备注册监听与拉取...");
    let isMounted = true;
    let hasHandledExternal = false;
    let unlistenDrop: (() => void) | undefined;
    let unlistenWspace: (() => void) | undefined;

    // A ref helper to avoid relying on outdated closures
    async function handleExternalWspaceOpen(path: string) {
      const { isLocked, hasUnsaved, vaultPath, vaultPassword, documents } = autoLockRef.current;
      
      if (path === vaultPath) return;

      if (!isLocked) {
        if (hasUnsaved) {
          const shouldSaveAndSwitch = await ask(
            t('app.switchUnsavedMsg'), 
            { title: `${t('window.title')} - ${t('app.switchUnsavedTitle')}`, kind: 'warning', okLabel: t('app.saveAndSwitch'), cancelLabel: t('app.cancel') }
          );

          if (shouldSaveAndSwitch) {
            try {
              await invoke('save_vault', {
                filename: vaultPath,
                password: vaultPassword,
                content: JSON.stringify(documents)
              });
              setUnsavedDocIds(new Set());
            } catch (e) {
              console.error("Failed to save before switching", e);
              return; 
            }
          } else {
            return; 
          }
        } else {
          const shouldSwitch = await confirm(
            t('app.switchConfirmMsg'),
            { title: `${t('window.title')} - ${t('app.switchConfirmTitle')}`, kind: 'info', okLabel: t('app.confirmSwitch'), cancelLabel: t('app.cancel') }
          );
          
          if (!shouldSwitch) return;
        }
      }

      // Safe to switch
      setVaultPath(path);
      setIsVaultExists(true);
      forceLock();
    }

    async function initializeApp() {
      // 1. 【先挂载监听器】：哪怕 macOS 事件晚来，我们也能抓到
      unlistenDrop = await listen<string[]>('tauri://file-drop', (event) => {
        const payload = event.payload;
        if (!payload || payload.length === 0) return;
        const path = payload[0];
        if (path && path.endsWith('.wspace')) {
          hasHandledExternal = true;
          handleExternalWspaceOpen(path);
        }
      });

      unlistenWspace = await listen<string>('wspace-file-opened', (event) => {
        invoke('log_to_rust', { message: `🟣 [React] 监听器捕获到 Rust 广播的路径: ${event.payload}` });
        const path = event.payload;
        if (path && path.endsWith('.wspace')) {
          hasHandledExternal = true;
          handleExternalWspaceOpen(path);
        }
      });
      invoke('log_to_rust', { message: "🟢 [React] wspace-file-opened 监听器已就位" });

      // 2. 【主动握手】：查收积压队列 (Cold Start Sync)
      let activePath = '';
      try {
        if (globalInitialColdPath !== undefined) {
          // Strict Mode Fast Path: Already fetched from Rust during the first unmounted render
          invoke('log_to_rust', { message: `🔵 [React] 命中内存缓存的冷启动路径: ${globalInitialColdPath}` });
          if (globalInitialColdPath !== null) {
            hasHandledExternal = true;
            activePath = globalInitialColdPath;
            setVaultPath(activePath);
            setIsVaultExists(true); 
            
            setIsPathReady(true);
            setIsChecking(false);
            invoke('log_to_rust', { message: `🔴 [React] 最终决定加载的空间路径: ${activePath}` });
            return;
          }
        } else {
          invoke('log_to_rust', { message: "🔵 [React] 正在向 Rust 请求初始冷启动路径..." });
          // Await shared promise for Strict Mode race conditions
          if (!globalHandshakePromise) {
            globalHandshakePromise = invoke<string[]>('frontend_is_ready');
          }
          const pendingPaths = await globalHandshakePromise;
          
          if (pendingPaths.length > 0) {
            // Find the last legitimate path sent from OS
            const targetPath = pendingPaths.reverse().find(p => p.endsWith('.wspace'));
            if (targetPath) {
              globalInitialColdPath = targetPath; // Save to global Scope
            } else {
              globalInitialColdPath = null;
            }
          } else {
            globalInitialColdPath = null;
          }

          // If we found one, apply it exactly like the fast path block
          if (globalInitialColdPath !== null && globalInitialColdPath !== undefined) {
            hasHandledExternal = true;
            activePath = globalInitialColdPath;
            setVaultPath(activePath);
            setIsVaultExists(true); 
            
            setIsPathReady(true);
            setIsChecking(false);
            invoke('log_to_rust', { message: `🔴 [React] 最终决定加载的空间路径: ${activePath}` });
            return; // EXIT EARLY! Do not load local storage historical defaults.
          }
        }
        
        // 3. 【绝对降级】：队列为空，且没有收到打断事件，加载历史记录
        if (hasHandledExternal) return; // Prevent Late-arriving AppleEvent race condition from being clobbered!

        if (isMounted) {
          const storedPath = localStorage.getItem('lazywhisper-vault-path');
          if (storedPath) {
            activePath = storedPath;
          } else {
            const docsDir = await documentDir();
            activePath = await join(docsDir, 'LazyWhisper.wspace');
            // localStorage.setItem('lazywhisper-vault-path', activePath); // Removed as per instruction
          }
        }
      } catch (err) {
        console.error("Failed to run handshake sequence", err);
        activePath = 'lazywhisper.wspace';
      }

      if (isMounted) {
        setVaultPath(activePath);
        invoke('log_to_rust', { message: `🔴 [React] 最终决定加载的空间路径: ${activePath}` });
        try {
          const fileExists = await invoke<boolean>('check_vault_exists', { path: activePath });
          setIsVaultExists(fileExists);
        } catch (err) {
          setIsVaultExists(false); 
        }
        setIsPathReady(true);
        setIsChecking(false);
      }
    }

    initializeApp();

    return () => {
      isMounted = false;
      if (unlistenDrop) unlistenDrop();
      if (unlistenWspace) unlistenWspace();
    };
  }, [t]);

  // Warm start global event loop absorbed into initialization sequence
  // References for AutoLock listeners
  const autoLockRef = useRef<{
    isLocked: boolean,
    min: number,
    hasUnsaved: boolean,
    vaultPassword: string,
    vaultPath: string,
    documents: VaultDocument[]
  }>({
    isLocked,
    min: autoLockMin,
    hasUnsaved: hasUnsavedChanges,
    vaultPassword,
    vaultPath,
    documents
  });

  useEffect(() => {
    autoLockRef.current = { isLocked, min: autoLockMin, hasUnsaved: hasUnsavedChanges, vaultPassword, vaultPath, documents };
  }, [isLocked, autoLockMin, hasUnsavedChanges, vaultPassword, vaultPath, documents]);

  const handleUnlock = async (password: string) => {
    try {
      const rawContent = await invoke<string>("load_vault", {
        filename: vaultPath,
        password,
      });

      let parsedDocs: VaultDocument[] = [];

      if (rawContent && rawContent.trim()) {
        try {
          const parsed = JSON.parse(rawContent);
          if (Array.isArray(parsed)) {
            // Standard document array setup
            parsedDocs = parsed;
          } else if (parsed && typeof parsed === 'object') {
            // Legacy fallback if they previously saved with SpaceData wrapper
            parsedDocs = parsed.documents || [];
          }
        } catch (e) {
          console.warn("Failed to parse space JSON. Initializing empty space.", e);
        }
      }

      if (parsedDocs.length === 0) {
        parsedDocs = [{ id: Date.now().toString(), title: t('sidebar.untitled'), content: '' }];
      }

      setDocuments(parsedDocs);
      setActiveDocId(parsedDocs[0].id);
      setVaultPassword(password);
      setUnsavedDocIds(new Set());
      setIsLocked(false);
      setUnlockError("");
      return { success: true };

    } catch (error) {
      console.error("Unlock failed", error);
      if (typeof error === 'string' && error.includes("os error 2")) {
        const initialDocs = [{ id: Date.now().toString(), title: t('sidebar.untitled'), content: '' }];
        setDocuments(initialDocs);
        setActiveDocId(initialDocs[0].id);
        setVaultPassword(password);
        setIsLocked(false);
        setUnlockError("");
        return { success: true };
      } else {
        const errorMsg = typeof error === 'string' && error.includes('ERROR_NEWER_VERSION') ? error : t("unlock.error");
        setUnlockError(errorMsg);
        return { success: false, error: errorMsg };
      }
    }
  };

  const handleCreateVault = async (password: string) => {
    try {
      const initialDocs = [{ id: Date.now().toString(), title: t('sidebar.untitled'), content: '' }];

      await invoke('save_vault', {
        filename: vaultPath,
        password,
        content: JSON.stringify(initialDocs)
      });

      setDocuments(initialDocs);
      setActiveDocId(initialDocs[0].id);
      setVaultPassword(password);
      setUnsavedDocIds(new Set());
      setIsLocked(false);
      setUnlockError("");
      setIsVaultExists(true); // Force sync immediately so unlock screen knows reality
      return { success: true };
    } catch (error) {
      console.error("Create vault failed", error);
      setUnlockError(t("unlock.error"));
      return { success: false };
    }
  };

  const saveCurrentVault = async (targetPassword = vaultPassword, targetDocuments = documents, targetPath = vaultPath) => {
    try {
      await invoke('save_vault', {
        filename: targetPath,
        password: targetPassword,
        content: JSON.stringify(targetDocuments)
      });
      setUnsavedDocIds(new Set());
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const executeGlobalSave = async () => {
    const { isLocked, vaultPath, vaultPassword, documents } = autoLockRef.current;
    if (isLocked || !vaultPath || !vaultPassword) return false;

    setIsSaving(true);
    const success = await saveCurrentVault(vaultPassword, documents, vaultPath);
    setIsSaving(false);
    if (success) {
      setLastSavedTimestamp(Date.now());
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    }
    return success;
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        executeGlobalSave();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  const forceLock = () => {
    // Layer 1: Global State Kill Switch
    setIsSettingsOpen(false);
    
    setVaultPassword("");
    setDocuments([]);
    setActiveDocId(null);
    setSessionKeys({});
    setUnsavedDocIds(new Set());
    setIsLocked(true);
  };

  const handleManualLock = () => {
    if (hasUnsavedChanges) {
      const confirmSave = window.confirm(t('app.unsavedMsg'));
      if (confirmSave) {
        saveCurrentVault().then(forceLock);
        return;
      }
    }
    forceLock();
  };

  const handleNewDoc = () => {
    const newDoc: VaultDocument = { id: Date.now().toString(), title: t('sidebar.untitled'), content: '' };
    setDocuments(prev => [newDoc, ...prev]);
    setActiveDocId(newDoc.id);
    setUnsavedDocIds(prev => new Set(prev).add(newDoc.id));
    setEditorFocusTrigger(Date.now()); // Global UX AutoFocus
  };

  const handleDeleteDoc = async (id: string) => {
    if (autoLockRef.current.isLocked) return;
    
    const isConfirm = await confirm(t('app.deleteConfirm'), {
      title: t('window.title') || 'LazyWhisper',
      kind: 'warning'
    });
    if (!isConfirm) return;

    setDocuments(prev => {
      const filtered = prev.filter(d => d.id !== id);
      if (filtered.length === 0) {
        const newDoc = { id: Date.now().toString(), title: t('sidebar.untitled'), content: '' };
        setActiveDocId(newDoc.id);
        return [newDoc];
      }
      if (activeDocId === id) {
        setActiveDocId(filtered[0].id);
      }
      return filtered;
    });
    setUnsavedDocIds(prev => new Set(prev).add('__deleted__'));
  };

  const activeDoc = documents.find(doc => doc.id === activeDocId);

  const handleContentChange = (id: string, newContent: string, title?: string, isDirty?: boolean) => {
    if (autoLockRef.current.isLocked) return;

    setDocuments(prev => prev.map(doc => {
      if (doc.id === id) {
        let newTitle = title;
        if (!newTitle) {
          const textContent = newContent.replace(/<[^>]+>/g, '').trim();
          newTitle = textContent ? textContent.slice(0, 15) + (textContent.length > 15 ? '...' : '') : t('sidebar.untitled');
        }
        return { ...doc, content: newContent, title: newTitle };
      }
      return doc;
    }));
    setUnsavedDocIds(prev => {
      const next = new Set(prev);
      if (isDirty !== false) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleVaultPathChange = async (newPath: string) => {
    setIsChecking(true);
    try {
      const fileExists = await invoke<boolean>('check_vault_exists', { path: newPath });
      setIsVaultExists(fileExists);
    } catch (err) {
      setIsVaultExists(false);
    }
    setVaultPath(newPath);
    localStorage.setItem('lazywhisper-vault-path', newPath);
    forceLock();
    setIsChecking(false);
  };

  const handleChangePassword = async (oldPassword: string, newPassword: string) => {
    if (autoLockRef.current.isLocked) throw new Error('Security Error: App is locked');
    
    if (oldPassword !== vaultPassword) {
      throw new Error('Incorrect current password.');
    }

    const success = await saveCurrentVault(newPassword, documents, vaultPath);
    if (!success) throw new Error('Failed to update space data.');

    setVaultPassword(newPassword);
  };

  const handleUpdateDocHash = (id: string, hash: string) => {
    setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, whisperKeyHash: hash } : doc));
  };

  const handleSetSessionKey = (id: string, key: string | null) => {
    setSessionKeys(prev => {
      const newKeys = { ...prev };
      if (key) newKeys[id] = key;
      else delete newKeys[id];
      return newKeys;
    });
  };

  // Setup auto lock feature via Timestamp Polling (Heartbeat) extracted to custom hook
  useAutoLock({ autoLockRef, forceLock });

  if (!isPathReady || isChecking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white font-sans z-50">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="LazyWhisper Logo" className="h-10 w-10 opacity-50 animate-pulse" />
          <div className="animate-pulse text-gray-400 tracking-widest text-xs uppercase font-bold">Scanning Space Matrix...</div>
        </div>
      </div>
    );
  }

  return (
    <WhisperRadarProvider>
      {isLocked ? (
        <UnlockScreen
          onUnlock={handleUnlock}
          onCreate={handleCreateVault}
          isVaultExists={isVaultExists}
          error={unlockError}
        />
      ) : (
        <div 
          className="flex w-full bg-white dark:bg-zinc-950 overflow-hidden" 
          style={{ height: 'var(--app-height, 100dvh)' }}
        >
          {/* 移动端毛玻璃遮罩 */}
          {isMobileMenuOpen && (
            <div 
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          <Sidebar
            isMobileMenuOpen={isMobileMenuOpen}
            onLock={handleManualLock}
            onOpenSettings={() => { setIsSettingsOpen(true); setIsMobileMenuOpen(false); }}
            documents={documents}
            activeDocId={activeDocId}
            onDocSelect={(id) => { setActiveDocId(id); setIsMobileMenuOpen(false); }}
            onNewDoc={(...args) => { handleNewDoc(...args); setIsMobileMenuOpen(false); }}
            onDeleteDoc={handleDeleteDoc}
            unsavedDocIds={unsavedDocIds}
          />
          
          <main className="flex-1 flex flex-col h-full relative overflow-hidden bg-white dark:bg-zinc-950">
            {/* 移动端顶部 Header (Native Look) */}
            <header className="md:hidden pt-[max(env(safe-area-inset-top),1rem)] border-b border-zinc-200/50 dark:border-zinc-800/50 flex flex-col bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md z-10 shrink-0">
              <div className="relative h-14 px-2 flex items-center justify-between">
                <div className="flex items-center min-w-[4rem] z-10">
                  <button 
                    type="button" 
                    onClick={() => setIsMobileMenuOpen(true)} 
                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                    aria-label="Open Menu"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                </div>
                
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                  <span className="font-semibold text-base text-zinc-900 dark:text-zinc-100 truncate px-16">
                    {t('sidebar.brand') || 'LazyWhisper'}
                  </span>
                </div>

                <div className="flex items-center justify-end min-w-[4rem] z-10" id="mobile-header-actions">
                  {/* ZenEditor buttons will render here via React Portal */}
                </div>
              </div>
            </header>

            <div className="flex-1 w-full flex flex-col items-center overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
              {activeDoc ? (
                <ZenEditor 
                  activeDoc={activeDoc}
                  documents={documents}
                  vaultPassword={vaultPassword}
                  sessionWhisperKey={sessionKeys[activeDoc.id] || null}
                  onSetSessionWhisperKey={(key) => handleSetSessionKey(activeDoc.id, key)}
                  onUpdateDocHash={handleUpdateDocHash}
                  onContentChange={handleContentChange}
                  onSave={executeGlobalSave}
                  hasUnsavedChanges={hasUnsavedChanges}
                  isSaving={isSaving}
                  isSaved={isSaved}
                  lastSavedTimestamp={lastSavedTimestamp}
                  editorFocusTrigger={editorFocusTrigger}
                />
              ) : (
                <div className="flex items-center justify-center p-20 text-gray-400">
                  {t('editor.emptyState')}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentVaultPath={vaultPath}
        onVaultPathChange={handleVaultPathChange}
        onChangePassword={handleChangePassword}
        autoLockMin={autoLockMin}
        onAutoLockChange={(min) => {
          setAutoLockMin(min);
          localStorage.setItem('lazywhisper-autolock-time', min.toString());
        }}
      />
    </WhisperRadarProvider>
  );
}

export default App;
