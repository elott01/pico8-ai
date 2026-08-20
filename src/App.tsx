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
      {/* Both carts work end to end; only the routing is hardcoded. Flip this to
          "connect_four" to play it until the switcher lands — see cart-switcher-plan.md. */}
      <Pico8Game game="tic_tac_toe" />
    </main>
  );
}
