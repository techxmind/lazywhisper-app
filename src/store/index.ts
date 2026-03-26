import { LazyStore } from '@tauri-apps/plugin-store';
import { create } from 'zustand';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

// 1. Singleton Native Store
export const nativeStore = new LazyStore('app_config.json', { 
  autoSave: false,
  defaults: {
    'lazywhisper-vault-path': null,
    'lazywhisper-autolock-time': 5,
    'lazywhisper-active-doc': null,
    'lazywhisper-theme': 'system',
    'lazywhisper-lang': 'en'
  }
});

// 2. Debounced Save Mechanism (Performance Trap Fix)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedSave = () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await nativeStore.save();
    } catch (e) {
      console.error("Failed to debounced save native store:", e);
    }
  }, 2000); // 2 seconds debounce for high-frequency settings
};

// Immediate Save for Critical Settings
const immediateSave = async () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  try {
    await nativeStore.save();
  } catch (e) {
    console.error("Failed to immediate save native store:", e);
  }
};

// 3. Reactive State Binding (Zustand)
interface AppState {
  vaultPath: string | null;
  autoLockMin: number;
  activeDocId: string | null;
  theme: string;
  lang: string;
  isReady: boolean;
  
  setVaultPath: (path: string | null) => Promise<void>;
  setAutoLockMin: (min: number) => Promise<void>;
  setActiveDocId: (id: string | null) => Promise<void>;
  setTheme: (theme: string) => Promise<void>;
  setLang: (lang: string) => Promise<void>;
  initStore: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  vaultPath: null,
  autoLockMin: 5,
  activeDocId: null,
  theme: 'system',
  lang: 'en',
  isReady: false,

  setVaultPath: async (path) => {
    set({ vaultPath: path });
    await nativeStore.set('lazywhisper-vault-path', path);
    await immediateSave(); // Critical, infrequent
  },
  setAutoLockMin: async (min) => {
    set({ autoLockMin: min });
    await nativeStore.set('lazywhisper-autolock-time', min);
    await immediateSave(); // Critical, infrequent
  },
  setActiveDocId: async (id) => {
    set({ activeDocId: id });
    await nativeStore.set('lazywhisper-active-doc', id);
    debouncedSave(); // High frequency (user switching notes)
  },
  setTheme: async (theme) => {
    set({ theme });
    await nativeStore.set('lazywhisper-theme', theme);
    // Double-Write Sync: maintain a synchronous read-only copy for the 0-ms index.html bootloader.
    localStorage.setItem('lazywhisper-theme-sync', theme);
    await immediateSave(); // Low frequency
  },
  setLang: async (lang) => {
    set({ lang });
    await nativeStore.set('lazywhisper-lang', lang);
    await immediateSave(); // Low frequency
  },

  initStore: async () => {
    if (get().isReady) return;

    // A. Silent Data Migration
    const keysToMigrate = [
      'lazywhisper-vault-path',
      'lazywhisper-autolock-time',
      'lazywhisper-active-doc',
      'lazywhisper-theme',
      'lazywhisper-lang'
    ];

    let migrated = false;
    for (const key of keysToMigrate) {
      const oldVal = localStorage.getItem(key);
      if (oldVal !== null) {
        if (key === 'lazywhisper-autolock-time') {
          await nativeStore.set(key, Number(oldVal) || 5);
        } else {
          await nativeStore.set(key, oldVal);
        }
        localStorage.removeItem(key);
        migrated = true;
      }
    }

    if (migrated) {
      await immediateSave();
      console.log('✅ Silent Data Migration from localStorage completed');
    }

    // B. Load values from Native Store into Memory concurrently (IPC Parallelization)
    const [vaultPath, autoLockMin, activeDocId, theme, lang] = await Promise.all([
      nativeStore.get<string>('lazywhisper-vault-path'),
      nativeStore.get<number>('lazywhisper-autolock-time'),
      nativeStore.get<string>('lazywhisper-active-doc'),
      nativeStore.get<string>('lazywhisper-theme'),
      nativeStore.get<string>('lazywhisper-lang')
    ]);
    
    // Unify double-write fallback token on every boot so index.html maintains perfect cohesion
    localStorage.setItem('lazywhisper-theme-sync', theme ?? 'system');

    // C. Install Window Close Listener for final save
    const appWindow = getCurrentWindow();
    let unlistenClose: () => void;
    
    appWindow.onCloseRequested(async (event) => {
      event.preventDefault(); // Pause the native OS close
      
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        try {
          await nativeStore.save();
        } catch(e) {}
      }
      
      if (unlistenClose) unlistenClose();
      
      // Fire the Rust-level process termination command to bypass macOS window manager coalescing.
      invoke('force_exit').catch(console.error);
    }).then(fn => { unlistenClose = fn; });

    set({
      vaultPath: vaultPath ?? null,
      autoLockMin: autoLockMin ?? 5,
      activeDocId: activeDocId ?? null,
      theme: theme ?? 'system',
      lang: lang ?? 'en',
      isReady: true
    });
  }
}));
