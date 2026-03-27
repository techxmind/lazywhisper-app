import { type } from '@tauri-apps/plugin-os';

export const isMobile = () => {
  try {
    return type() === 'ios' || type() === 'android';
  } catch {
    return false;
  }
};
