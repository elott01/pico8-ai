import Pico8Game from './components/Pico8Game.tsx';
import ThemeToggle from './components/ThemeToggle.tsx';
import styles from './App.module.scss';

export default function App() {
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <ThemeToggle />
      </div>
      <h1 className={styles.title}>PICO-8 + Gemini</h1>
      <p className={styles.tagline}>Turn-based carts with a Gemini-powered AI opponent.</p>
      {/* Single game for now; the cart switcher comes later. `connect_four` is already a
          valid CartId and the page speaks its protocol, but /api/move still builds a
          tic-tac-toe prompt, so it would fall back on every turn. */}
      <Pico8Game game="tic_tac_toe" />
    </main>
  );
}
