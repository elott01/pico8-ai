import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDX_STATUS,
  ST_IDLE,
  ST_REQUEST,
  ST_THINKING,
  ST_READY,
  NO_MOVE,
  PROTOCOLS,
  TALK_PROTOCOLS,
  isBoardCart,
  readBoard,
  isLegalMove,
  readTalkCall,
  writeTalkPage,
  readTalkBack,
} from '../lib/gpio.ts';
import type { Board, CartId, Gpio, Protocol, TalkProtocol } from '../lib/gpio.ts';
import { getAiTurn } from '../lib/ai.ts';
import type { AiTurn } from '../lib/ai.ts';
import { getTalk, browserStorage, loadMemory, saveMemory, memoryFor, remember } from '../lib/talk.ts';
import type { TalkReply } from '../lib/talk.ts';
import type { TalkRequest } from '../../api/_types.ts';
import TurnPanel from './TurnPanel.tsx';
import type { Turn } from './TurnPanel.tsx';
import TalkPanel from './TalkPanel.tsx';
import type { TalkTurn } from './TalkPanel.tsx';
import styles from './Pico8Game.module.scss';

type CartStatus = 'loading' | 'ready' | 'missing';

// The cart is embedded as its exported .html in an iframe rather than by injecting the
// .js: the export expects its own shell (canvas wiring, start button, audio gating), and
// loading the .html gets that verbatim. Same-origin, so the cart's GPIO memory stays
// reachable at contentWindow.pico8_gpio.
export default function Pico8Game({
  game,
  onReady,
}: {
  game: CartId;
  /** Fired when the cart is loaded and the poll loop is live — the switcher uses it to
   *  release its latch, since a 1.6MB runtime does not arrive instantly. */
  onReady?: () => void;
}) {
  // Exactly one of these is set: a board cart talks to /api/move, a talk cart to /api/talk,
  // and each poll loop below runs only for its own kind.
  const boardProtocol = isBoardCart(game) ? PROTOCOLS[game] : null;
  const talkProtocol = isBoardCart(game) ? null : TALK_PROTOCOLS[game];
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The poll loop reads status every 100ms but must not be torn down and rebuilt each time
  // it changes, so it goes through a ref rather than the effect's dependency list.
  const statusRef = useRef<CartStatus>('loading');
  const [status, setStatus] = useState<CartStatus>('loading');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [talks, setTalks] = useState<TalkTurn[]>([]);
  // Distinct from the `busy` latch below: that one guards re-entrancy, this one is the
  // only thing the UI can see. Without it the panel sits silent for the ~1.6s the model
  // takes, which reads as a dead page on the very turn the panel exists to evidence.
  const [thinking, setThinking] = useState(false);

  // One setter for both, so the ref the poll loop reads cannot drift from the state the
  // UI renders.
  // Held in a ref and read at call time, so `applyStatus` can have empty deps. Depending on
  // `onReady` directly would make it a new function whenever the parent re-renders, which
  // re-runs the reset effect below, which calls setTurns([]) with a fresh array, which
  // re-renders — an infinite loop that only appears once a parent passes an inline arrow.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const applyStatus = useCallback((next: CartStatus) => {
    statusRef.current = next;
    setStatus(next);
    // 'missing' counts as settled too: a cart that will never load must not leave the
    // switcher latched and every card disabled.
    if (next !== 'loading') onReadyRef.current?.();
  }, []);

  useEffect(() => {
    applyStatus('loading');
    setTurns([]); // analysis from the previous cart would be misleading
    setTalks([]);
    setThinking(false);
  }, [game, applyStatus]);

  // The page's half of the GPIO protocol; the cart's half is in carts/<game>.p8 and both
  // byte layouts are declared in lib/gpio.ts. Nothing below may hardcode an offset — the
  // effect re-runs when `game` changes, so it reads the whole layout off `protocol`.
  useEffect(() => {
    if (!boardProtocol) return;
    const protocol = boardProtocol;
    let busy = false;
    // `clearInterval` stops future ticks but cannot cancel one already suspended at an
    // `await`. That tick still holds the OLD cart's gpio, protocol and game, so on resume it
    // would append the cart-you-just-left's final turn into the new cart's empty panel —
    // observed as a phantom turn #1 with the previous game's commentary. The cleanup below
    // and the suspended tick close over this same variable, which is how the tick learns its
    // cart is gone.
    let cancelled = false;
    const abort = new AbortController();
    let pausedUntil = 0; // epoch ms; while in the future we are rate-limited
    const id = setInterval(async () => {
      // Gated on `ready`, not just on gpio existing. Once carts can be switched, this
      // effect holds the NEW protocol the moment `game` changes while the iframe may still
      // hold the OLD cart — so an ungated tick would read byte 43 of a 9-cell tic-tac-toe
      // board. The iframe is keyed on `game` below so it remounts rather than reusing the
      // element, and `status` returns to 'loading' until the new cart fires onLoad.
      if (statusRef.current !== 'ready') return;

      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously, or the cart keeps re-requesting
      try {
        const board = readBoard(gpio, protocol);

        // While rate-limited, skip the API entirely — it would only 429 again — but still
        // answer the cart so the game never hangs.
        let ai: AiTurn;
        if (Date.now() < pausedUntil) {
          ai = { move: null, reason: 'rate-limited' };
        } else {
          // Flagged only around the network call, so the indicator tracks the model and
          // not the GPIO read-back that follows it.
          setThinking(true);
          ai = await getAiTurn(board, game, undefined, abort.signal);
          if (cancelled) return; // switched mid-request; this turn belongs to the old cart
          setThinking(false);
          if (ai.reason === 'rate-limited') {
            const wait = Math.min(Math.max(ai.retryAfter ?? 60, 5), 15 * 60); // clamped: a bad value must not wedge the game
            pausedUntil = Date.now() + wait * 1000;
          }
        }

        // Narrowing once here is what keeps the analysis fields below unreachable on a
        // turn the model did not decide.
        const analysis = ai.reason === null ? ai : null;

        // A legal model move gets played; anything else sends NO_MOVE so the cart falls
        // back to its own opponent rather than the page inventing a move. Legality goes
        // through the protocol because the move is a cell in one cart and a column in the
        // other — indexing the board directly would silently mean "top row" in Connect Four.
        const modelMove =
          analysis !== null && analysis.move !== null && isLegalMove(board, analysis.move, protocol)
            ? analysis.move
            : null;
        gpio[protocol.idxMove] = modelMove ?? NO_MOVE;
        gpio[IDX_STATUS] = ST_READY;

        // Skipped when cancelled: `gpio` belongs to an iframe React has already unmounted,
        // so this would poll a dead document for its full 3.5s only to return null.
        if (cancelled) return;
        const played = await readCartPlayedMove(gpio, protocol);
        if (cancelled) return;

        setTurns((prev) => {
          // Marks only accumulate within a game, so fewer filled cells than last turn
          // means the cart started a new one.
          const last = prev[prev.length - 1];
          const history = last && filled(board) < filled(last.board) ? [] : prev;
          return [
            ...history,
            {
              n: history.length + 1,
              board,
              protocol, // the panel needs it to render the board and resolve a column
              move: played, // what the cart played
              intended: Number.isInteger(ai.move) ? ai.move : null, // what the model asked for
              lines: analysis?.lines ?? [],
              winMove: analysis?.winMove ?? null,
              blockMove: analysis?.blockMove ?? null,
              // Connect Four's account of its move is one sentence rather than 69 scored
              // lines, so exactly one of these two is populated per game.
              reasoning: analysis?.reasoning ?? null,
              commentary: analysis?.commentary ?? null,
              reason: ai.reason,
              // Only true when the model's own move is the one that got played, so the
              // panel can never credit it with a move the cart substituted.
              fromModel: modelMove !== null && played === modelMove,
            },
          ];
        });
      } finally {
        busy = false;
        setThinking(false); // a throw must never strand the indicator on
      }
    }, 100);
    return () => {
      cancelled = true;
      abort.abort();
      clearInterval(id);
    };
  }, [game, boardProtocol]);

  // The talk cart's half of its protocol (carts/gemini.p8 holds the other). A purchase is one
  // /api/talk call; every later page of the speech is served from `pending` with no call at
  // all, because the server already returned the whole thing.
  useEffect(() => {
    if (!talkProtocol) return;
    const p: TalkProtocol = talkProtocol;
    let busy = false;
    let cancelled = false; // see the board loop: a suspended tick must learn its cart is gone
    const abort = new AbortController();
    let pausedUntil = 0;
    let pending: string[] = [];
    const id = setInterval(async () => {
      if (statusRef.current !== 'ready') return;
      const gpio = iframeRef.current?.contentWindow?.pico8_gpio;
      if (!gpio || busy || gpio[IDX_STATUS] !== ST_REQUEST) return;

      busy = true;
      gpio[IDX_STATUS] = ST_THINKING; // ack synchronously, or the cart keeps re-requesting
      try {
        const call = readTalkCall(gpio, p);
        if (call?.occasion !== 'purchase') {
          // The next page, from memory. An unknown occasion gets an empty page, which the
          // cart treats as the end of the speech rather than waiting out its timeout.
          const page = call ? pending.shift() : undefined;
          writeTalkPage(gpio, p, { text: page ?? '', more: pending.length > 0 });
          gpio[IDX_STATUS] = ST_READY;
          return;
        }
        pending = [];

        const storage = browserStorage();
        const memory = loadMemory(storage);
        const talkMemory = memoryFor(memory, 'gem-in-eye', call.stats);
        const request: TalkRequest = {
          occasion: 'purchase',
          purchase: { item: call.item, tier: call.tier as 1 | 2 | 3, listPrice: call.listPrice },
          stats: call.stats,
          memory: talkMemory,
        };

        let reply: TalkReply;
        if (Date.now() < pausedUntil) {
          reply = { reason: 'rate-limited' };
        } else {
          setThinking(true);
          reply = await getTalk(request, undefined, abort.signal);
          if (cancelled) return;
          setThinking(false);
          if (reply.reason === 'rate-limited') {
            const wait = Math.min(Math.max(reply.retryAfter ?? 60, 5), 15 * 60);
            pausedUntil = Date.now() + wait * 1000;
          }
        }
        const spoke = reply.reason === null ? reply : null;
        const pages = spoke?.pages ?? [];

        // The cart may have stopped waiting (450 frames) while the request was out. Writing
        // now would land a stale reply on whatever it asks next, so the reply is dropped and
        // the turn recorded as late. The cart has already sold at list with its own line.
        const late = gpio[IDX_STATUS] !== ST_THINKING;
        if (!late) {
          pending = pages.slice(1);
          writeTalkPage(gpio, p, {
            text: pages[0] ?? '',
            verdict: spoke?.verdict,
            price: spoke?.price,
            more: pending.length > 0,
          });
          gpio[IDX_STATUS] = ST_READY;
        }

        if (cancelled) return;
        const back = late ? readTalkBack(gpio, p) : await readTalkBackWhenIdle(gpio, p);
        if (cancelled) return;

        const fromModel = !late && back !== null && back.showedSpeech;
        const speech = pages.length ? pages.join(' ') : null;
        saveMemory(storage, remember(memory, 'gem-in-eye', call.stats, talkMemory.agentNumber, fromModel ? speech : null));
        setTalks((prev) => [
          ...prev,
          {
            n: prev.length + 1,
            item: call.item,
            tier: call.tier,
            listPrice: call.listPrice,
            stats: call.stats,
            agentNumber: talkMemory.agentNumber,
            verdict: spoke?.verdict ?? null,
            notice: spoke?.notice ?? null,
            speech,
            charged: back?.charged ?? null,
            reason: reply.reason,
            fromModel,
            late,
          },
        ]);
      } finally {
        busy = false;
        setThinking(false);
      }
    }, 100);
    return () => {
      cancelled = true;
      abort.abort();
      clearInterval(id);
    };
  }, [game, talkProtocol]);

  const src = `/games/${game}.html`;

  return (
    <div>
      {status === 'missing' && (
        <p className={styles.missing}>
          No cart found at <code>{src}</code>. Export a PICO-8 game to{' '}
          <code>public/games/</code> to play.
        </p>
      )}
      <div className={styles.layout}>
        <div className={`${styles.stage} ${status === 'missing' ? styles.hidden : ''}`}>
          <iframe
            // Keyed so switching carts remounts the element. Reusing it with a new `src`
            // leaves the old cart's pico8_gpio reachable during the swap.
            key={game}
            ref={iframeRef}
            className={styles.frame}
            src={src}
            title={game}
            onLoad={() => applyStatus('ready')}
            onError={() => applyStatus('missing')}
          />
        </div>
        {status !== 'missing' &&
          (boardProtocol ? (
            <TurnPanel turns={turns} thinking={thinking} />
          ) : (
            <TalkPanel talks={talks} thinking={thinking} />
          ))}
      </div>
    </div>
  );
}

function filled(board: Board) {
  return board.filter((c) => c !== 0).length;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The cart writes the move it actually played to the move byte and only then returns to
// idle, so both conditions have to hold before the value can be trusted — otherwise we read
// the NO_MOVE sentinel we just wrote. The accepted range is per-cart (0..8 cells for
// tic-tac-toe, 0..6 columns for Connect Four), so it comes off the protocol rather than
// being spelled out here. The timeout is an upper bound, not a wait: a normal turn resolves
// in ~20ms, but the first AI turn of a game has taken ~1.6s to get here.
async function readCartPlayedMove(
  gpio: Gpio,
  p: Protocol,
  timeoutMs = 3500,
): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gpio[IDX_STATUS] === ST_IDLE) {
      const move = gpio[p.idxMove];
      if (move >= 0 && move <= p.maxMove) return move;
    }
    await sleep(16);
  }
  return null; // no cart listening, or it never wrote a move; the panel shows no move
}

// After a purchase the cart writes the price it charged, and whether it printed the page's
// speech, and only then returns to idle — so idle is what makes the read-back trustworthy.
async function readTalkBackWhenIdle(gpio: Gpio, p: TalkProtocol, timeoutMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gpio[IDX_STATUS] === ST_IDLE) return readTalkBack(gpio, p);
    await sleep(16);
  }
  return null; // no cart listening; the panel shows the charge as unknown
}
