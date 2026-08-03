import Pico8Game from './components/Pico8Game.tsx';

export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '1rem' }}>
      <h1>PICO-8 + Gemini</h1>
      <p>Turn-based carts with a Gemini-powered AI opponent.</p>
      {/* Single game for now; a multi-game menu comes later (milestone 7). */}
      <Pico8Game game="tic_tac_toe" />
    </main>
  );
}
