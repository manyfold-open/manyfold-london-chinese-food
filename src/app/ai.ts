/**
 * Whether this reader wants AI illustrations shown for dishes without a photo. On unless they
 * turned it off, here, in this browser; the site can also turn them off for everyone.
 */

import { useCallback, useSyncExternalStore } from 'react';

export const AI_KEY = 'lcf.ai';
const CHANGE = 'lcf:ai';

const read = (): boolean => {
  try {
    return localStorage.getItem(AI_KEY) !== 'off';
  } catch {
    return true;
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE, onChange);
  return () => window.removeEventListener(CHANGE, onChange);
};

export function useAiPreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.removeItem(AI_KEY);
      else localStorage.setItem(AI_KEY, 'off');
    } catch {
      // storage blocked: the choice lasts this page
    }
    window.dispatchEvent(new Event(CHANGE));
  }, []);
  return [on, set];
}
