import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.scss';

// Three states, not two: once you have overridden the OS, a two-way switch gives you no
// way back to following it.
type ThemeChoice = 'system' | 'light' | 'dark';

// Shared with the pre-paint script in index.html — change one and you must change both,
// or the page flashes the stored theme's opposite on load.
const STORAGE_KEY = 'theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'AUTO' },
  { value: 'light', label: 'LIGHT' },
  { value: 'dark', label: 'DARK' },
];

// localStorage throws outright in some privacy modes, so every access is guarded: a
// blocked store should cost you persistence, not the page.
function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    // 'system' removes the attribute rather than setting it, which is what re-arms the
    // prefers-color-scheme rule in tokens.scss (it is gated on :not([data-theme])).
    if (choice === 'system') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = choice;
    }
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Non-fatal: the choice still applies for this page view.
    }
  }, [choice]);

  return (
    <div className={styles.group} role="group" aria-label="Colour theme">
      {CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={`${styles.button} ${choice === value ? styles.active : ''}`}
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
