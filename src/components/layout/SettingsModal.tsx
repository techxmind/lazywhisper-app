import { useState, useEffect } from 'react';
import { Key, Info } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVaultPath: string;
  onVaultPathChange: (newPath: string) => void;
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  autoLockMin: number;
  onAutoLockChange: (min: number) => void;
}

export function SettingsModal({ isOpen, onClose, currentVaultPath, onVaultPathChange, onChangePassword, autoLockMin, onAutoLockChange }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const { theme, setTheme } = useTheme();

  // UX State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Global ESC handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isPasswordModalOpen) {
          setIsPasswordModalOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPasswordModalOpen, onClose]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  // MEDIUM-5: Zeroize password fields on unmount
  useEffect(() => {
    return () => {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    };
  }, []);

  if (!isOpen) return null;

  const handleChangeLocation = async () => {
    try {
      const selectedPath = await open({
        filters: [{
          name: 'WhisperSpace',
          extensions: ['wspace']
        }]
      });

      if (selectedPath) {
        onVaultPathChange(selectedPath);
        onClose();
      }
    } catch (e) {
      console.error('Failed to change space path', e);
    }
  };

  const handleUpdatePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('settings.pwdRequired'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.pwdMismatch'));
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await onChangePassword(oldPassword, newPassword);
      setPasswordSuccess(t('settings.pwdSuccess'));
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setPasswordSuccess('');
        setIsPasswordModalOpen(false); // auto close the sub-modal
      }, 1500);
    } catch (e: any) {
      if (typeof e === 'string' && (e.includes('Incorrect current password') || e.includes('Invalid signature') || e.includes('wrong password'))) {
        setPasswordError(t('settings.pwdIncorrect'));
      } else {
        setPasswordError(e.message || e || t('settings.pwdFailed'));
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-50 md:bg-black/20 md:items-center md:justify-center md:p-4">
      <div className="w-full h-full md:max-w-[480px] md:h-auto md:bg-white md:border md:border-gray-200 md:rounded-md flex flex-col overflow-hidden">
        
        {/* Mobile Native Header */}
        <div className="md:hidden flex items-center justify-between px-4 pb-2 border-b border-gray-200 bg-white shadow-sm shrink-0 pt-[max(env(safe-area-inset-top),1rem)] select-none">
          <div className="w-16"></div>
          <h3 className="text-[17px] font-semibold text-gray-900 tracking-tight">{t('settings.title')}</h3>
          <div className="w-16 flex justify-end">
            <button
              className="text-gray-900 font-semibold text-[17px] active:opacity-50 transition-opacity"
              onClick={onClose}
            >
              {t('settings.doneBtn')}
            </button>
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden md:block p-6 pb-2 shrink-0">
          <h3 className="text-lg font-light text-gray-900">{t('settings.title')}</h3>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 bg-zinc-50 md:bg-white flex flex-col gap-6 md:gap-6 pb-[calc(max(env(safe-area-inset-bottom),1rem)+2rem)] md:pb-6">


        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">{t('settings.spacePath')}</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={currentVaultPath}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base md:text-sm text-gray-600 outline-none"
            />
            <button
              className="bg-gray-100 min-h-[44px] hover:bg-gray-200 text-gray-700 px-4 py-3 md:py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap font-medium"
              onClick={handleChangeLocation}
            >
              {t('settings.changeBtn')}
            </button>
          </div>
          <div className="bg-gray-50 border border-gray-200 text-gray-500 text-xs p-3 rounded-md mt-3 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 text-gray-400" />
            <span>{t('settings.pathNote')}</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">{t('settings.security')}</label>
          <button
            className="w-full min-h-[44px] bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-3 md:py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
            onClick={() => setIsPasswordModalOpen(true)}
          >
            <Key className="w-4 h-4 text-gray-500" /> {t('settings.modifyPassword')}
          </button>
        </div>

        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">{t('settings.preferences')}</label>
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            <div className="flex items-center justify-between py-4">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-0">{t('settings.autoLock')}</label>
              <div className="relative w-40 md:w-48">
                <select
                  value={autoLockMin}
                  onChange={(e) => onAutoLockChange(Number(e.target.value))}
                  className="appearance-none min-h-[44px] bg-white border border-gray-200 rounded-lg py-3 md:py-2.5 px-3 text-base md:text-sm text-gray-700 w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                >
                  <option value={0}>{t('settings.never')}</option>
                  <option value={1}>{t('settings.min1')}</option>
                  <option value={5}>{t('settings.min5')}</option>
                  <option value={15}>{t('settings.min15')}</option>
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <div className="flex items-center justify-between py-4">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-0">{t('settings.language')}</label>
              <div className="relative w-40 md:w-48">
                <select
                  value={i18n.language}
                  onChange={(e) => {
                    i18n.changeLanguage(e.target.value);
                    localStorage.setItem('lazywhisper-lang', e.target.value);
                  }}
                  className="appearance-none min-h-[44px] bg-white border border-gray-200 rounded-lg py-3 md:py-2.5 px-3 text-base md:text-sm text-gray-700 w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                >
                  <option value="en">{t('settings.langEn')}</option>
                  <option value="zh">{t('settings.langZh')}</option>
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <div className="flex items-center justify-between py-4">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-0">{t('settings.theme')}</label>
              <div className="relative w-40 md:w-48">
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as 'system' | 'light' | 'dark')}
                  className="appearance-none min-h-[44px] bg-white border border-gray-200 rounded-lg py-3 md:py-2.5 px-3 text-base md:text-sm text-gray-700 w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                >
                  <option value="system">{t('settings.themeSystem')}</option>
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex justify-end border-t border-gray-100 mt-2 pt-4 shrink-0 px-6 pb-6">
          <button
            className="bg-gray-800 min-h-[44px] hover:bg-gray-900 text-white px-6 py-3 md:py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
            onClick={onClose}
          >
            {t('settings.doneBtn')}
          </button>
        </div>

        <div className="mt-8 md:mt-0 border-gray-100 flex flex-col items-center justify-center shrink-0 mb-4 md:mb-0">
          <div className="text-sm font-semibold text-gray-700">{t('window.title')}</div>
          <div className="text-xs text-gray-400 mt-1">{t('settings.version')} {appVersion} {t('settings.cryptoEngine')}</div>
        </div>
        
        </div> {/* End of scrollable area */}
      </div>

      {/* Password Sub-Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-start pt-[15dvh] md:items-center md:pt-0 justify-center p-4 bg-black/20 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 rounded-md w-full max-w-[400px] p-6 flex flex-col gap-6 max-h-[70dvh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-light text-gray-900">{t('settings.changePwdTitle')}</h3>
              <p className="text-xs text-amber-600 mt-1">{t('settings.changePwdNote')}</p>
            </div>

            <div className="flex flex-col gap-4">
              <input
                type="password"
                placeholder={t('settings.currentPwd')}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest"
                autoFocus
              />
              <input
                type="password"
                placeholder={t('settings.newPwd')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest"
              />
              <input
                type="password"
                placeholder={t('settings.confirmNewPwd')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 md:py-2.5 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow tracking-widest"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUpdatePassword();
                }}
              />

              <div className="min-h-[20px] text-xs">
                {passwordError && <span className="text-red-500">{passwordError}</span>}
                {passwordSuccess && <span className="text-green-600">{passwordSuccess}</span>}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                className="bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200 focus:ring-offset-1"
                onClick={() => setIsPasswordModalOpen(false)}
              >
                {t('settings.cancel')}
              </button>
              <button
                className="bg-gray-800 hover:bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-1 disabled:opacity-50"
                onClick={handleUpdatePassword}
                disabled={isUpdatingPassword || !oldPassword || !newPassword || !confirmPassword}
              >
                {isUpdatingPassword ? t('settings.updating') : t('settings.updatePwd')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
