import React, { createContext, useContext, useEffect, useState } from 'react';

const WhisperRadarContext = createContext<boolean>(false);

export function WhisperRadarProvider({ children }: { children: React.ReactNode }) {
  const [isRadarActive, setIsRadarActive] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsRadarActive(true);
        document.body.classList.add('radar-active');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsRadarActive(false);
        document.body.classList.remove('radar-active');
      }
    };

    const handleBlur = () => {
      setIsRadarActive(false);
      document.body.classList.remove('radar-active');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.body.classList.remove('radar-active');
    };
  }, []);

  return (
    <WhisperRadarContext.Provider value={isRadarActive}>
      {children}
    </WhisperRadarContext.Provider>
  );
}

export const useWhisperRadar = () => useContext(WhisperRadarContext);
