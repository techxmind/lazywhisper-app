import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAppStore } from '../store';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: 'light' | 'dark'; // What is actually being rendered
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const storeTheme = useAppStore((state) => state.theme);
  const setStoreTheme = useAppStore((state) => state.setTheme);
  
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      let isDark = false;
      if (storeTheme === 'dark') {
        isDark = true;
      } else if (storeTheme === 'system') {
        isDark = mediaQuery.matches;
      }

      root.classList.remove('light', 'dark');
      if (isDark) {
        root.classList.add('dark');
        setActualTheme('dark');
      } else {
        root.classList.add('light');
        setActualTheme('light');
      }
    };

    applyTheme();

    // Listen for system preference changes if in 'system' mode
    const handler = () => {
      if (storeTheme === 'system') applyTheme();
    };
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, [storeTheme]);

  const setTheme = (newTheme: Theme) => {
    setStoreTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme: storeTheme as Theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
