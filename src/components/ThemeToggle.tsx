import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './ThemeToggle.module.scss';

// Three states, not two: once you have overridden the OS, a two-way switch gives you no
// way back to following it.
type ThemeChoice = 'system' | 'light' | 'dark';

// Shared with the pre-paint script in index.html — change one and you must change both,
// or the page flashes the stored theme's opposite on load.
const STORAGE_KEY = 'theme';

const CHOICES: { value: ThemeChoice; name: string; label: string; icon: ReactNode }[] = [
  { value: 'system', name: 'Auto', label: 'Auto theme, follows your system', icon: <Monitor /> },
  { value: 'light', name: 'Light', label: 'Light theme', icon: <Sun /> },
  { value: 'dark', name: 'Dark', label: 'Dark theme', icon: <Moon /> },
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

// One icon, the current choice, that opens into all three. It opens on hover for a mouse,
// and on click, tap, Enter or Space for everyone, since hover alone would shut out touch
// and the keyboard. The three hang below the icon: sideways they would cover the header's
// links or run off a phone's screen, and over the icon a click on it after a hover would
// land on whichever choice sat there.
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const trayId = useId();
  const closeTimer = useRef<number | undefined>(undefined);
  // Where focus goes once the open state has rendered: into the tray when it was opened from
  // the keyboard or a tap, back to the icon when it closes from inside the tray.
  const focusTray = useRef(false);
  const focusIcon = useRef(false);

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

  const focusCurrent = () =>
    tray.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();

  useEffect(() => {
    if (open && focusTray.current) {
      focusTray.current = false;
      focusCurrent();
    } else if (!open && focusIcon.current) {
      focusIcon.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  // A tap or click anywhere else closes it; on a touch screen there's no pointer to leave.
  useEffect(() => {
    if (!open) return;
    const elsewhere = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', elsewhere);
    return () => document.removeEventListener('pointerdown', elsewhere);
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // The tray hides as it closes, so focus inside it would drop to the page; it goes back to
  // the icon instead.
  const close = () => {
    focusIcon.current = !!tray.current?.contains(document.activeElement);
    setOpen(false);
  };

  const current = CHOICES.find((c) => c.value === choice)!;

  return (
    <div
      ref={root}
      className={`${styles.toggle} ${open ? styles.open : ''}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        window.clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        // A moment's grace, so a diagonal move to the tray doesn't snap it shut
        closeTimer.current = window.setTimeout(close, 300);
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        focusIcon.current = true;
        setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        // See CartCard: WebKit skips buttons in the tab order by default, so this is
        // required for the toggle to be keyboard-reachable in Safari.
        tabIndex={0}
        aria-label={`Colour theme: ${current.name}`}
        aria-expanded={open}
        aria-controls={trayId}
        onClick={() => {
          // A mouse click comes after a hover, which has already opened it
          if (open) return focusCurrent();
          focusTray.current = true;
          setOpen(true);
        }}
      >
        {current.icon}
      </button>

      <div ref={tray} id={trayId} className={styles.tray} role="group" aria-label="Colour theme">
        {CHOICES.map(({ value, name, label, icon }) => (
          <button
            key={value}
            type="button"
            className={styles.choice}
            tabIndex={0}
            aria-label={label}
            title={name}
            aria-pressed={choice === value}
            onClick={() => {
              setChoice(value);
              close();
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Monitor() {
  return (
    <Icon>
      <rect x="2.5" y="3" width="13" height="9" rx="1.5" />
      <path d="M6.5 15.5h5M9 12v3.5" />
    </Icon>
  );
}

function Sun() {
  return (
    <Icon>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 1.5v1.8M9 14.7v1.8M1.5 9h1.8M14.7 9h1.8M3.7 3.7l1.3 1.3M13 13l1.3 1.3M3.7 14.3 5 13M13 5l1.3-1.3" />
    </Icon>
  );
}

function Moon() {
  return (
    <Icon>
      <path d="M15 10.6A6.3 6.3 0 1 1 7.4 3a5 5 0 0 0 7.6 7.6z" />
    </Icon>
  );
}
