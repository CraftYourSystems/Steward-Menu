import { useState, useEffect } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTheme = params.get('theme');
      if (urlTheme === 'dark') return true;
      if (urlTheme === 'light') return false;

      const saved = localStorage.getItem('steward_theme');
      if (saved) return saved === 'dark';
    } catch {
      // ignore
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem('steward_theme', dark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [dark]);

  const toggle = () => setDark(d => !d);

  return { dark, toggle };
}

