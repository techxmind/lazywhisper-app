import { useState, useEffect } from 'react';

/**
 * Monitors window.visualViewport to detect iOS virtual keyboard.
 * 
 * 1. Returns keyboardHeight (pixels) for components that need it.
 * 2. Sets CSS custom property `--app-height` on document.documentElement
 *    to the ACTUAL visible viewport height. This is the key mechanism:
 *    position:fixed containers that use `height: var(--app-height)` will
 *    physically shrink when the iOS keyboard opens, allowing internal
 *    overflow:auto containers to scroll naturally.
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;

    const updateHeight = () => {
      if (vv) {
        // Set --app-height to the ACTUAL visual viewport height
        // This shrinks the fixed container when keyboard opens
        document.documentElement.style.setProperty(
          '--app-height',
          `${vv.height}px`
        );

        const heightDiff = window.innerHeight - vv.height;
        setKeyboardHeight(heightDiff > 50 ? heightDiff : 0);
      } else {
        // Fallback: no visualViewport API
        document.documentElement.style.setProperty(
          '--app-height',
          `${window.innerHeight}px`
        );
      }
    };

    // Initial set
    updateHeight();

    if (vv) {
      vv.addEventListener('resize', updateHeight);
      vv.addEventListener('scroll', updateHeight);
    }
    // Also listen to window resize as fallback
    window.addEventListener('resize', updateHeight);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', updateHeight);
        vv.removeEventListener('scroll', updateHeight);
      }
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  return keyboardHeight;
}
