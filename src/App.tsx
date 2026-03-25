import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WhisperRadarProvider } from "./contexts/WhisperRadarContext";
import { Sidebar } from "./components/layout/Sidebar";
import { ZenEditor } from "./components/editor/ZenEditor";
import { UnlockScreen } from "./components/layout/UnlockScreen";
import { SettingsModal } from "./components/layout/SettingsModal";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { useKeyboardHeight } from './hooks/useKeyboardHeight';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, confirm, open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { type } from '@tauri-apps/plugin-os';
import { documentDir, join, basename } from '@tauri-apps/api/path';
import { exists, copyFile } from '@tauri-apps/plugin-fs';
import { useAutoLock } from './hooks/useAutoLock';
import { PlusSquare, FolderOpen } from 'lucide-react';
// import { Menu, Submenu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import './index.css';

// Module-level cache to shield Handshake from React 18 Strict Mode double-mounting
let globalInitialColdPath: string | null | undefined = undefined;
let globalHandshakePromise: Promise<string[]> | null = null;
const isMobile = () => type() === 'ios' || type() === 'android';

export interface VaultDocument {
  id: string;
  title: string;
  content: string;
  whisperKeyHash?: string;
}

function App() {
  const { t, i18n } = useTranslation();
  const keyboardHeight = useKeyboardHeight();
  const [isLocked, setIsLocked] = useState(true);
  // HIGH-1 Fix: Password no longer stored in React state. Lives in Rust SESSION_PASSWORD cache.
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  // Persist last active doc to localStorage for restore-on-unlock
  useEffect(() => {
    if (activeDocId) {
      localStorage.setItem('lazywhisper-active-doc', activeDocId);
    }
  }, [activeDocId]);

  // Auto-focus trigger for Editor
  const [editorFocusTrigger, setEditorFocusTrigger] = useState<number>(0);
  const [unlockError, setUnlockError] = useState("");
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});

  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [vaultPath, setVaultPath] = useState("");
  const [isPathReady, setIsPathReady] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isVaultExists, setIsVaultExists] = useState(true);
  const [isForceOverwrite, setIsForceOverwrite] = useState(false);
  const [onboardingConflictPath, setOnboardingConflictPath] = useState<string | null>(null);
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
        if (!isMobile()) {
          await getCurrentWindow().setTitle(newTitle);
        }

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
      const { isLocked, hasUnsaved, vaultPath, documents } = autoLockRef.current;

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
          if (isMobile()) {
            let pathFromStorage = localStorage.getItem('lazywhisper-vault-path');
            if (pathFromStorage) {
              const fileExists = await exists(pathFromStorage).catch(() => false);
              if (fileExists) activePath = pathFromStorage;
            }
            
            if (!activePath) {
               activePath = await join(await documentDir(), 'LazyWhisper.wspace');
            }
            
            const sandboxExists = await exists(activePath).catch(() => false);
            if (!sandboxExists) {
              setNeedsOnboarding(true);
              setIsPathReady(true);
              setIsChecking(false);
              return;
            }
            localStorage.setItem('lazywhisper-vault-path', activePath);
          } else {
            const storedPath = localStorage.getItem('lazywhisper-vault-path');
            if (storedPath) {
              activePath = storedPath;
            } else {
              setNeedsOnboarding(true);
              setIsPathReady(true);
              setIsChecking(false);
              return;
            }
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
    vaultPath: string,
    documents: VaultDocument[]
  }>({
    isLocked,
    min: autoLockMin,
    hasUnsaved: hasUnsavedChanges,
    vaultPath,
    documents
  });

  useEffect(() => {
    autoLockRef.current = { isLocked, min: autoLockMin, hasUnsaved: hasUnsavedChanges, vaultPath, documents };
  }, [isLocked, autoLockMin, hasUnsavedChanges, vaultPath, documents]);

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
      // Restore last active doc, fallback to first doc
      const lastDocId = localStorage.getItem('lazywhisper-active-doc');
      const restoredDoc = lastDocId && parsedDocs.find(d => d.id === lastDocId);
      setActiveDocId(restoredDoc ? restoredDoc.id : parsedDocs[0].id);
      // Password cached in Rust by load_vault — no frontend storage
      setHasActiveSession(true);
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
        // Cache password for the new-vault-via-file-not-found path
        await invoke('cache_session_password', { password });
        setHasActiveSession(true);
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

      await invoke('cache_session_password', { password });

      await invoke('save_vault', {
        filename: vaultPath,
        content: JSON.stringify(initialDocs),
        force_overwrite: isForceOverwrite
      });

      setDocuments(initialDocs);
      setActiveDocId(initialDocs[0].id);
      setHasActiveSession(true);
      setUnsavedDocIds(new Set());
      setIsLocked(false);
      setUnlockError("");
      setIsVaultExists(true); // Force sync immediately so unlock screen knows reality
      setIsForceOverwrite(false); // Reset boundary
      return { success: true };
    } catch (error) {
      console.error("Create workspace failed", error);
      setUnlockError(t("unlock.error"));
      setIsForceOverwrite(false); // Reset boundary
      return { success: false };
    }
  };

  const saveCurrentVault = async (targetDocuments = documents, targetPath = vaultPath) => {
    try {
      await invoke('save_vault', {
        filename: targetPath,
        content: JSON.stringify(targetDocuments),
        force_overwrite: true
      });
      setUnsavedDocIds(new Set());
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const executeGlobalSave = async () => {
    const { isLocked, vaultPath, documents } = autoLockRef.current;
    if (isLocked || !vaultPath) return false;

    setIsSaving(true);
    const success = await saveCurrentVault(documents, vaultPath);
    setIsSaving(false);
    if (success) {
      setLastSavedTimestamp(Date.now());
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    }
    return success;
  };

  const handleImportDocs = async (newDocs: VaultDocument[]) => {
    setDocuments(prev => [...newDocs, ...prev]);
    setUnsavedDocIds(prev => {
      const next = new Set(prev);
      newDocs.forEach(d => next.add(d.id));
      return next;
    });
    // Immediate save after importing
    // Wait one tick for state to flush, then save via ref
    setTimeout(async () => {
      const { vaultPath, documents: currentDocs } = autoLockRef.current;
      if (vaultPath) {
        const allDocs = [...newDocs, ...currentDocs];
        setIsSaving(true);
        const success = await saveCurrentVault(allDocs, vaultPath);
        setIsSaving(false);
        if (success) {
          setLastSavedTimestamp(Date.now());
          setIsSaved(true);
          setUnsavedDocIds(new Set());
          setTimeout(() => setIsSaved(false), 2000);
        }
      }
    }, 50);
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

  // Global mutex: prevents handleManualLock and useAutoLock from racing
  const lockInProgressRef = useRef(false);

  // HIGH-3 Fix: Ref to the Tiptap editor instance for explicit destruction on lock
  const editorInstanceRef = useRef<{ destroy: () => void; commands: { clearContent: (emitUpdate?: boolean) => boolean } } | null>(null);

  const forceLock = () => {
    // Layer 1: Physically destroy Tiptap editor — wipe DOM + ProseMirror doc tree
    if (editorInstanceRef.current) {
      try {
        // Clear content first (zeroes out ProseMirror NodeTree), then destroy instance
        editorInstanceRef.current.commands.clearContent(true);
        editorInstanceRef.current.destroy();
      } catch (_) { /* already destroyed */ }
      editorInstanceRef.current = null;
    }

    // Layer 2: Global State Kill Switch — wipe all sensitive React state
    setIsSettingsOpen(false);

    // Wipe Rust session password cache
    invoke('clear_session').catch(() => { });
    setHasActiveSession(false);
    setDocuments([]);
    setActiveDocId(null);
    setSessionKeys({});
    setUnsavedDocIds(new Set());
    setIsLocked(true);
  };

  const handleManualLock = async () => {
    // Mutex gate: prevent concurrent lock attempts
    if (lockInProgressRef.current) return;
    lockInProgressRef.current = true;

    try {
      if (hasUnsavedChanges) {
        const shouldSave = await ask(
          t('app.unsavedMsg'),
          {
            title: `${t('window.title')} - ${t('app.unsaved')}`,
            kind: 'warning',
            okLabel: t('app.saveAndLock'),
            cancelLabel: t('app.discardAndLock'),
          }
        );

        if (shouldSave) {
          const success = await saveCurrentVault();
          if (!success) {
            lockInProgressRef.current = false;
            return;
          }
        }
      }
      forceLock();
    } finally {
      lockInProgressRef.current = false;
    }
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

    // Delegate password verification and re-encryption to Rust
    await invoke('change_vault_password', {
      filename: vaultPath,
      oldPassword,
      newPassword,
      content: JSON.stringify(documents)
    });
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
  useAutoLock({ autoLockRef, forceLock, lockInProgressRef });

  const handleOnboardingCreateVault = async () => {
    try {
      if (isMobile()) {
        const safePath = await join(await documentDir(), 'LazyWhisper.wspace');
        const fileExists = await exists(safePath);
        
        if (fileExists) {
          // INTERCEPT: File already exists in sandbox
          setOnboardingConflictPath(safePath);
          return;
        }

        // Normal Creation (Sandbox)
        localStorage.setItem('lazywhisper-vault-path', safePath);
        setVaultPath(safePath);
        setIsVaultExists(false); // Creating a new one
        setIsForceOverwrite(false);
        setNeedsOnboarding(false);
      } else {
        const filePath = await save({
          title: t('onboarding.createVaultTitle'),
          defaultPath: 'LazyWhisper.wspace',
          filters: [{ name: 'LazyWhisper Workspace', extensions: ['wspace'] }]
        });

        if (filePath && typeof filePath === 'string') {
          const fileExists = await invoke<boolean>('check_vault_exists', { path: filePath }).catch(() => false);
          
          if (fileExists) {
            // INTERCEPT: File already exists (Desktop OS dialog bypass or race)
            setOnboardingConflictPath(filePath);
            return;
          }

          // Normal Creation (Desktop)
          localStorage.setItem('lazywhisper-vault-path', filePath);
          setVaultPath(filePath);
          setIsVaultExists(false); // Creating a new one
          setIsForceOverwrite(false);
          setNeedsOnboarding(false);
        }
      }
    } catch (e) {
      console.error(e);
      alert(t('onboarding.error') + String(e));
    }
  };

  const handleOnboardingOpenVault = async () => {
    try {
      const filePath = await open({
        title: t('onboarding.openVaultTitle'),
        multiple: false,
        directory: false,
        filters: [{ name: 'LazyWhisper Workspace', extensions: ['wspace'] }]
      });

      if (filePath && typeof filePath === 'string') {
        if (isMobile()) {
          const originalFileName = await basename(filePath);
          const nameWithoutExt = originalFileName.replace(/\.wspace$/, '');

          const timestamp = Date.now();
          const safeFileName = `${nameWithoutExt}_imported_${timestamp}.wspace`; 
          const safePath = await join(await documentDir(), safeFileName);
          
          if (filePath !== safePath) {
            await copyFile(filePath, safePath);
          }
          
          setIsVaultExists(true); // Treat as existing, go to Unlock screen
          localStorage.setItem('lazywhisper-vault-path', safePath);
          setVaultPath(safePath);
          setNeedsOnboarding(false);

        } else {
          // Standard Desktop Flow
          const fileExists = await invoke<boolean>('check_vault_exists', { path: filePath }).catch(() => false);
          setIsVaultExists(fileExists);

          localStorage.setItem('lazywhisper-vault-path', filePath);
          setVaultPath(filePath);
          setNeedsOnboarding(false);
        }
      }
    } catch (e) {
      console.error(e);
      alert(t('onboarding.error') + String(e));
    }
  };

  if (!isPathReady || isChecking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white font-sans z-50">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="LazyWhisper Logo" className="h-10 w-10 opacity-50 animate-pulse" />
          <div className="animate-pulse text-gray-400 tracking-widest text-xs uppercase font-bold">{t('app.scanning')}</div>
        </div>
      </div>
    );
  }

  if (needsOnboarding) {
    if (onboardingConflictPath) {
      return (
        <div className="fixed inset-0 w-full h-full flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm z-50 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 w-full max-w-sm flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-amber-500" />
                {t('unlock.conflictTitle')}
              </h2>
              <p className="text-[14px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t('unlock.conflictMessage')}
              </p>
            </div>
            
            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={() => {
                  localStorage.setItem('lazywhisper-vault-path', onboardingConflictPath);
                  setVaultPath(onboardingConflictPath);
                  setIsVaultExists(true); // Route to unlock!
                  setIsForceOverwrite(false);
                  setOnboardingConflictPath(null);
                  setNeedsOnboarding(false);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-medium transition-colors text-[14px]"
              >
                {t('unlock.conflictOpen')}
              </button>
              
              <button
                onClick={async () => {
                  const confirmed = await confirm(t('unlock.overwriteConfirmMessage'), {
                    title: t('unlock.overwriteConfirmTitle'),
                    kind: 'warning'
                  });
                  if (confirmed) {
                    localStorage.setItem('lazywhisper-vault-path', onboardingConflictPath);
                    setVaultPath(onboardingConflictPath);
                    setIsVaultExists(false); // Route to create!
                    setIsForceOverwrite(true); // FLAG TO WIPE IT!
                    setOnboardingConflictPath(null);
                    setNeedsOnboarding(false);
                  }
                }}
                className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl py-3 font-medium transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-800/50 text-[14px]"
              >
                {t('unlock.conflictOverwrite')}
              </button>
              
              <button
                onClick={() => setOnboardingConflictPath(null)}
                className="w-full text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 text-[14px] font-medium py-2 transition-colors mt-1"
              >
                {t('unlock.conflictCancel')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 w-full h-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 font-sans overflow-hidden z-50">
        {/* ═══════ Whispering Aura: Mesh Gradient Background ═══════ */}
        <div className="absolute w-96 h-96 top-[-10%] left-[-10%] rounded-full bg-indigo-300/40 dark:bg-indigo-900/40 blur-[120px] mix-blend-multiply dark:mix-blend-screen pointer-events-none" />
        <div className="absolute w-96 h-96 top-[10%] right-[-10%] rounded-full bg-purple-300/40 dark:bg-purple-900/40 blur-[120px] mix-blend-multiply dark:mix-blend-screen pointer-events-none" />
        <div className="absolute w-[30rem] h-[30rem] bottom-[-20%] left-[20%] rounded-full bg-sky-300/40 dark:bg-sky-900/40 blur-[120px] mix-blend-multiply dark:mix-blend-screen pointer-events-none" />

        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center gap-8">

          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 bg-brand text-white rounded-3xl shadow-xl shadow-brand/20 flex items-center justify-center flex-shrink-0 animate-bounce-slow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{t('onboarding.title')}</h1>
              <p className="text-[15px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-4">
                {t('onboarding.desc')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full px-2">
            <button
              onClick={handleOnboardingCreateVault}
              className="group relative w-full bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 hover:border-blue-400 hover:shadow-sm hover:bg-white/90 dark:hover:bg-zinc-800/80 active:scale-[0.98]"
            >
              <div className="flex-shrink-0 flex items-center justify-center p-2 rounded-xl bg-blue-100/60 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                <PlusSquare className="w-6 h-6 stroke-[1.5]" />
              </div>
              <div className="flex flex-col text-left">
                <div className="font-semibold text-[16px] text-zinc-900 dark:text-zinc-100">
                  {t('onboarding.createVault')}
                </div>
                <div className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  {t('onboarding.createVaultDesc')}
                </div>
              </div>
            </button>

            <button
              onClick={handleOnboardingOpenVault}
              className="group relative w-full bg-transparent border border-zinc-200 dark:border-zinc-800/60 rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 hover:border-blue-400 hover:shadow-sm hover:bg-white/90 dark:hover:bg-zinc-800/80 active:scale-[0.98]"
            >
              <div className="flex-shrink-0 flex items-center justify-center p-2 rounded-xl bg-zinc-100/60 dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-400">
                <FolderOpen className="w-6 h-6 stroke-[1.5]" />
              </div>
              <div className="flex flex-col text-left">
                <div className="font-semibold text-[16px] text-zinc-900 dark:text-zinc-100">
                  {t('onboarding.openVault')}
                </div>
                <div className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  {t('onboarding.openVaultDesc')}
                </div>
              </div>
            </button>
          </div>
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
        <div className="flex h-full w-full bg-white dark:bg-zinc-950 overflow-hidden">
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

            <div className="flex-1 w-full flex flex-col items-center overflow-y-auto overscroll-y-contain" style={{ paddingBottom: `max(env(safe-area-inset-bottom), ${keyboardHeight}px)` }}>
              {activeDoc ? (
                <ZenEditor
                  activeDoc={activeDoc}
                  documents={documents}
                  hasActiveSession={hasActiveSession}
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
                  editorInstanceRef={editorInstanceRef}
                  onImportDocs={handleImportDocs}
                  currentVaultPath={vaultPath}
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
