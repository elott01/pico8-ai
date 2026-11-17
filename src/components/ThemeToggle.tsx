import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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

// How long the mouse rests on the icon before it opens, so crossing it on the way somewhere
// else leaves the links alone, and how long the mouse can stray before it closes.
const HOVER_OPEN_MS = 100;
const HOVER_CLOSE_MS = 150;
// How long after a hover opens it a click on a choice is ignored. Longer than $slide in the
// stylesheet, with a beat to see where the icons ended up.
const CLICK_GUARD_MS = 300;

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

// One icon, the current choice, that opens sideways into all three, always in the same
// order, so the other two appear either side of it. A mouse opens it by resting on it and
// closes it by leaving, so it stays open through a choice, showing the highlight move, and
// focus stays where it was, since that may be the cart. A click, tap, Enter or Space opens it
// too, moving focus in, and then a choice closes it.
//
// Opening slides the icons along, so a click just after a hover would land on whichever one
// had slid under the pointer. That is what CLICK_GUARD_MS is for.
//
// The icon you click is a transparent button over the strip of three, which draws the
// current choice even while closed. Closed, the strip is inert, so only that button is in
// the tab order and the accessibility tree.
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const stripId = useId();
  // Where focus goes once the open state has rendered: into the strip when it was opened,
  // back to the icon when it closes from inside the strip.
  const focusStrip = useRef(false);
  const focusIcon = useRef(false);
  // Opened by the mouse rather than a click or key, so the mouse leaving closes it.
  const openedByHover = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const ignoreClicksUntil = useRef(0);

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
    strip.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();

  // React 18 has no inert prop, so it is set on the element, before paint so the strip is
  // never reachable while closed. Focus moves first when closing, since inert would drop it.
  useLayoutEffect(() => {
    if (!open) openedByHover.current = false;
    if (!open && focusIcon.current) {
      focusIcon.current = false;
      trigger.current?.focus();
    }
    if (strip.current) strip.current.inert = !open;
    if (open && focusStrip.current) {
      focusStrip.current = false;
      focusCurrent();
    }
  }, [open]);

  const close = () => {
    focusIcon.current = !!strip.current?.contains(document.activeElement);
    setOpen(false);
  };

  // These listen on the document because a hover leaves focus outside. Focus landing elsewhere
  // has to close it too, as it may have landed on the link under the pill.
  useEffect(() => {
    if (!open) return;
    const elsewhere = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', elsewhere, true);
    document.addEventListener('focusin', elsewhere, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', elsewhere, true);
      document.removeEventListener('focusin', elsewhere, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const at =CHOICES.findIndex((c) => c.value === choice);
  const current = CHOICES[at];

  return (
    <div
      ref={root}
      className={`${styles.toggle} ${open ? styles.open : ''}`}
      // Which slot of the strip shows through while closed
      style={{ '--at': at } as CSSProperties}
      // Mouse only: a tap sends these too, and would open it just before its click closed it
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(hoverTimer.current);
        if (open) return;
        hoverTimer.current = setTimeout(() => {
          openedByHover.current = true;
          ignoreClicksUntil.current = performance.now() + CLICK_GUARD_MS;
          setOpen(true);
        }, HOVER_OPEN_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(hoverTimer.current);
        if (openedByHover.current) hoverTimer.current = setTimeout(close, HOVER_CLOSE_MS);
      }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
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
        aria-controls={stripId}
        // Only the keyboard reaches it while open; see .trigger
        onClick={() => {
          clearTimeout(hoverTimer.current);
          focusStrip.current = !open;
          setOpen(!open);
        }}
      />

      <div className={styles.window}>
        <div ref={strip} id={stripId} className={styles.strip} role="group" aria-label="Colour theme">
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
                if (performance.now() < ignoreClicksUntil.current) return;
                setChoice(value);
                if (!openedByHover.current) close();
              }}
            >
              {icon}
            </button>
          ))}
        </div>
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
