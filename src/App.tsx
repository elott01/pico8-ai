import { useEffect, useRef, useState } from 'react';
import Pico8Game from './components/Pico8Game.tsx';
import CartCard from './components/CartCard.tsx';
import ThemeToggle from './components/ThemeToggle.tsx';
import { CART_ORDER, CARTS } from './lib/carts.ts';
import type { CartId } from './lib/gpio.ts';
import styles from './App.module.scss';

export default function App() {
  // null once Eject has emptied the device.
  const [game, setGame] = useState<CartId | null>('tic_tac_toe');
  // Each cart is a 1.6MB PICO-8 runtime, so a switch is not instant. Latching here stops a
  // second selection racing the first — two `src` writes in flight would leave the poll loop
  // reading whichever iframe won. Cleared when the new cart reports ready.
  const [swapping, setSwapping] = useState(false);
  const carts = useRef<HTMLDivElement>(null);

  // After an eject, focus goes to the shelf, where the next move is. Left alone it would
  // drop to the page: Eject disables itself once the slot is empty, and a disabled button
  // can't keep focus.
  useEffect(() => {
    if (game === null) carts.current?.querySelector('button')?.focus();
  }, [game]);

  const status =
    game === null ? 'Cart ejected' : swapping ? `Loading ${CARTS[game].name}…` : `${CARTS[game].name} loaded`;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <ThemeToggle />
      </div>
      <h1 className={styles.title}>
        Ethan’s{' '}
        <span className={styles.pun}>
          Pico-<span className={styles.ai}>AI</span>ght
        </span>{' '}
        Arcade
      </h1>
      {/* Has to name PICO-8: without it, anyone who doesn't know the console reads the
          title's pun as "aight". */}
      <p className={styles.tagline}>PICO-8 carts with Google Gemini built in.</p>

      {/* The carts, the device and the panel share one grid; Pico8Game supplies the last
          two. The grid moves them between layouts, but the carts always come first in the
          DOM: the cart's iframe swallows Tab, so Tab has to reach them before it. */}
      <div className={styles.arcade}>
        <section className={styles.shelf} aria-labelledby="carts-heading">
          <h2 id="carts-heading" className={styles.shelfHeading}>
            Carts
          </h2>
          <div ref={carts} className={styles.carts} role="group" aria-label="Choose a cart">
            {CART_ORDER.map((id) => (
              <CartCard
                key={id}
                id={id}
                selected={id === game}
                busy={swapping}
                onSelect={(next) => {
                  setSwapping(true);
                  setGame(next);
                }}
              />
            ))}
          </div>
        </section>

        {/* The game area changes underneath the buttons, which is invisible without this. */}
        <p className={styles.srOnly} role="status">
          {status}
        </p>

        <Pico8Game game={game} onReady={() => setSwapping(false)} onEject={() => setGame(null)} />
      </div>
    </main>
  );
}
