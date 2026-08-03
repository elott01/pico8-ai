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
      {/* Single game for now; a multi-game menu comes later (milestone 7). */}
      <Pico8Game game="tic_tac_toe" />
    </main>
  );
}
