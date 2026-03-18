import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, AlertCircle } from 'lucide-react';

interface UnlockScreenProps {
  onUnlock: (password: string) => Promise<{ success: boolean, error?: string }> | void;
  onCreate: (password: string) => Promise<{ success: boolean, error?: string }> | void;
  isVaultExists: boolean;
  error?: string;
}

export function UnlockScreen({ onUnlock, onCreate, isVaultExists, error }: UnlockScreenProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Robust AutoFocus on Mount (bypassing animation swallowing)
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // MEDIUM-5: Zeroize passwords on unmount
  useEffect(() => {
    return () => {
      setPassword('');
      setConfirmPassword('');
    };
  }, []);

  // Brute-force resistance states
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutEndTime, setLockoutEndTime] = useState<number | null>(null);
  const [remainingLockout, setRemainingLockout] = useState(0);
  const [newerVersionError, setNewerVersionError] = useState(false);

  // Extracted from useEffect to avoid React deduping identical error strings
  const triggerLockoutState = () => {
    const currentFailures = failedAttempts + 1;
    setFailedAttempts(currentFailures);

    let lockMs = 0;
    if (currentFailures >= 10) lockMs = 5 * 60 * 1000; // 5 mins
    else if (currentFailures >= 5) lockMs = 60 * 1000; // 1 min
    else if (currentFailures >= 3) lockMs = 30 * 1000; // 30 sec

    if (lockMs > 0) {
      const end = Date.now() + lockMs;
      setLockoutEndTime(end);
    }
  };

  // Tick the countdown
  useEffect(() => {
    if (!lockoutEndTime) return;

    const interval = setInterval(() => {
      const left = Math.ceil((lockoutEndTime - Date.now()) / 1000);
      if (left <= 0) {
        setLockoutEndTime(null);
        setRemainingLockout(0);
      } else {
        setRemainingLockout(left);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutEndTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutEndTime && Date.now() < lockoutEndTime) return;

    setLocalError('');
    setNewerVersionError(false);

    if (!password.trim()) return;

    let success = true;
    let isNewerVersion = false;

    if (!isVaultExists) {
      if (password !== confirmPassword) {
        setLocalError(t('unlock.passwordMismatch'));
        return;
      }
      const res = await onCreate(password);
      if (res && res.success === false) success = false;
    } else {
      const res = await onUnlock(password);
      if (res && res.success === false) {
        success = false;
        if (res.error && res.error.includes("ERROR_NEWER_VERSION")) {
          isNewerVersion = true;
          setNewerVersionError(true);
        }
      }
    }

    if (!success && !isNewerVersion) {
      triggerLockoutState();
    }
  };

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-[99999] pt-[max(env(safe-area-inset-top),1rem)]">
      <div className="w-full max-w-xs md:max-w-sm px-6 mx-auto flex flex-col items-center">
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="LazyWhisper Logo" className="h-10 w-10 opacity-90" />
            <h1 className="text-xl font-bold text-gray-800 tracking-wide">
              {t('window.title')}
            </h1>
          </div>
          {!isVaultExists && (<h2 className="text-sm font-medium text-gray-500"> {t('unlock.createTitle')}</h2>)}
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-2">
          <input
            ref={inputRef}
            type="password"
            placeholder={t('unlock.placeholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow text-center tracking-widest disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            disabled={!!lockoutEndTime || newerVersionError}
          />
          {!isVaultExists && (
            <input
              type="password"
              placeholder={t('unlock.confirmPlaceholder')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow text-center tracking-widest mt-1"
            />
          )}

          {(error || localError) && !lockoutEndTime && !newerVersionError && (
            <p className="text-red-500 text-sm text-center mt-2 animate-pulse">{localError || error}</p>
          )}

          {lockoutEndTime && remainingLockout > 0 && !newerVersionError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg mt-4 w-full justify-center">
              <Lock size={16} />
              <span>{t('unlock.lockout', { time: remainingLockout })}</span>
            </div>
          )}

          {newerVersionError && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-600 text-sm px-4 py-3 rounded-lg mt-4 w-full justify-center text-left">
              <AlertCircle size={16} className="shrink-0" />
              <span>{t('unlock.newerVersion')}</span>
            </div>
          )}

          <button
            type="submit"
            className="mt-6 w-full min-h-[44px] md:min-h-0 bg-gray-800 hover:bg-gray-900 text-white font-medium py-3 md:py-2.5 rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:cursor-not-allowed disabled:shadow-none"
            disabled={!!lockoutEndTime || newerVersionError}
          >
            {isVaultExists ? t('unlock.button') : t('unlock.createButton')}
          </button>
        </form>
      </div>
    </div>
  );
}
