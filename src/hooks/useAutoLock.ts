import { useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { VaultDocument } from '../App';

interface UseAutoLockProps {
  autoLockRef: React.MutableRefObject<{
    min: number;
    isLocked: boolean;
    vaultPath: string;
    documents: VaultDocument[];
    hasUnsaved: boolean;
  }>;
  forceLock: () => void;
  lockInProgressRef: React.MutableRefObject<boolean>;
}

export function useAutoLock({ autoLockRef, forceLock, lockInProgressRef }: UseAutoLockProps) {
  const { t } = useTranslation();
  const lastActiveTimeRef = useRef<number>(Date.now());
  const lastThrottleTimeRef = useRef<number>(0);

  useEffect(() => {
    // 1. Throttled activity updater (max 1 update per second)
    const updateActivity = () => {
      const now = Date.now();
      if (now - lastThrottleTimeRef.current > 1000) {
        lastActiveTimeRef.current = now;
        lastThrottleTimeRef.current = now;
      }
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);

    // 2. Heartbeat Polling (Check every 2 seconds)
    const interval = setInterval(async () => {
      const state = autoLockRef.current;
      
      // If already locked, set to 'Never' (0), or another lock flow is in progress, skip
      if (state.isLocked || state.min === 0 || lockInProgressRef.current) return;

      const idleTime = Date.now() - lastActiveTimeRef.current;
      const timeoutMs = state.min * 60 * 1000;

      // Conditional Lock Trigger
      if (idleTime >= timeoutMs) {
        // Prevent concurrent triggers by artificially pushing the active time far into the future temporarily
        lastActiveTimeRef.current = Date.now() + 9999999; 

        // Safe Fallback: Auto-Save Before Lock
        if (state.hasUnsaved) {
          try {
            console.log("🔒 [Auto-Lock] 检测到未保存数据，正在安全落盘...");
            await invoke('save_vault', {
              filename: state.vaultPath,
              content: JSON.stringify(state.documents),
              force_overwrite: true
            });
          } catch (error) {
            console.error("🚨 [Auto-Lock] 自动保存失败！", error);
            // Critical Failure: Abort lock to prevent data wiping
            await message(t('app.autoSaveFailedMsg'), { 
              title: `${t('window.title')} - ${t('app.autoSaveFailedTitle')}`, 
              kind: 'error' 
            });
            
            // Reset timer so it can keep tracking user idle time safely
            lastActiveTimeRef.current = Date.now();
            return; 
          }
        }

        // Vault is synced, strictly lock it down
        forceLock();
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
    };
  }, [t, autoLockRef, forceLock]); 
}
