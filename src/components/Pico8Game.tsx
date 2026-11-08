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
import Handheld from './Handheld.tsx';
import FullscreenLayer from './FullscreenLayer.tsx';
import CrtScreen from './CrtScreen.tsx';
import { BUTTON_KEYS } from '../lib/buttons.ts';
import { readVolume, saveVolume, routeAudio } from '../lib/volume.ts';
import { CARTS, NO_CART_PANEL } from '../lib/carts.ts';
import styles from './Pico8Game.module.scss';

declare global {
  interface Window {
    // The export's shell declares these inside the iframe.
    p8_run_cart?: () => void;
    p8_request_fullscreen?: () => void;
    p8_touch_detected?: boolean;
    p8_allow_mobile_menu?: boolean;
  }
}

// Where the D-pad and keys are pressed by a finger, and fullscreen has to bring its own.
const TOUCH_INPUT = '(hover: none), (pointer: coarse)';

// P, PICO-8's pause key, which the handheld's lettering names. Enter opens the pause menu too,
// but on the page it presses whatever button has focus, so it isn't a key meant for the cart.
const PAUSE_KEY = 80;

// 'empty' is no cart in the device at all: ejected.
type CartStatus = 'loading' | 'ready' | 'missing' | 'empty';

// The CRT toggle's choice, kept across visits. localStorage throws in some privacy modes, so
// a blocked store costs the choice and nothing else.
const CRT_KEY = 'pico-crt';

function readCrt(): boolean {
  try {
    return localStorage.getItem(CRT_KEY) === 'on';
  } catch {
    return false;
  }
}

// The cart is embedded as its exported .html in an iframe rather than by injecting the
// .js: the export expects its own shell (canvas wiring, start button, audio gating), and
// loading the .html gets that verbatim. Same-origin, so the cart's GPIO memory stays
// reachable at contentWindow.pico8_gpio.
export default function Pico8Game({
  game,
  onReady,
  onEject,
}: {
  /** The cart in the device, or null once it has been ejected. */
  game: CartId | null;
  /** Fired when the cart is loaded and the poll loop is live — the switcher uses it to
   *  release its latch, since a 1.6MB runtime does not arrive instantly. */
  onReady?: () => void;
  /** The handheld's Eject button. */
  onEject?: () => void;
}) {
  // At most one of these is set: a board cart talks to /api/move, a talk cart to /api/talk,
  // and each poll loop below runs only for its own kind. With no cart, neither runs.
  const boardProtocol = game !== null && isBoardCart(game) ? PROTOCOLS[game] : null;
  const talkProtocol = game !== null && !isBoardCart(game) ? TALK_PROTOCOLS[game] : null;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  // What keepTouchOut reads on each touch, so it goes through a ref. See it, and the overlay.
  const letTouchInRef = useRef(false);
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
  const [crt, setCrt] = useState(readCrt);
  const toggleCrt = useCallback(() => {
    setCrt((on) => {
      try {
        localStorage.setItem(CRT_KEY, on ? 'off' : 'on');
      } catch {
        // see readCrt
      }
      return !on;
    });
  }, []);
  // CrtScreen covers the game once there is one, and .crt only ever covers PICO-8's poster.
  const [crtOverGame, setCrtOverGame] = useState(false);
  // The volume slider's setting, kept across visits like CRT's. A cart's sound starts from the
  // ref, and the setter routeAudio gave for the cart that's in takes each change after that.
  const [volume, setVolume] = useState(() => readVolume(browserStorage()));
  const volumeRef = useRef(volume);
  const setGainRef = useRef<((percent: number) => void) | null>(null);
  const changeVolume = useCallback((percent: number) => {
    // A drag reports every move, most of them to the step it's already on
    if (percent === volumeRef.current) return;
    volumeRef.current = percent;
    setVolume(percent);
    saveVolume(browserStorage(), percent);
    setGainRef.current?.(percent);
  }, []);
  const [keyboardHeld, setKeyboardHeld] = useState(0);
  // Whether the cart's window has focus, which is whether the keyboard reaches it, and how many
  // keys meant for it have gone to the page instead. The handheld's lettering shows both.
  const [keyboardInCart, setKeyboardInCart] = useState(false);
  const [missedKeys, setMissedKeys] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [overlay, setOverlay] = useState(false);

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
    // No cart means no iframe to wait for, so it settles at once and the switcher's latch
    // can't stick.
    applyStatus(game === null ? 'empty' : 'loading');
    setTurns([]); // analysis from the previous cart would be misleading
    setTalks([]);
    setThinking(false);
    setKeyboardHeld(0); // watchKeys' blur doesn't cover this: WebKit sends none from a removed iframe
    setGainRef.current = null; // the last cart's sound went with its window
    // Nor watchFocus's. The hint shows while the next cart loads, so it can't wait for that
    // cart's own check: a switch that left focus in the old one would show the P line till then.
    setKeyboardInCart(false);
  }, [game, applyStatus]);

  // A key the cart would have taken, pressed while the page has the keyboard: the moment a
  // player finds the cart isn't listening, so the lettering blinks its hint. The key itself is
  // left alone. Arrow keys still scroll the page, since someone reading About may mean them, and
  // moving focus into the cart unasked would be focus moving invisibly. Repeats from a held key
  // count once, and anything under a modifier is a shortcut, not a game key. It listens whenever
  // the hint shows, which is while a cart is in, loading or not.
  useEffect(() => {
    if (game === null || keyboardInCart) return;
    const missed = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.keyCode in BUTTON_KEYS || event.keyCode === PAUSE_KEY) setMissedKeys((n) => n + 1);
    };
    window.addEventListener('keydown', missed);
    return () => window.removeEventListener('keydown', missed);
  }, [game, keyboardInCart]);

  // The handheld's D-pad and keys. pico8_buttons is the export's own hook for on-page
  // controls, read every frame beside the keyboard. Before the cart's page has loaded there is
  // nothing to write to, and nothing is lost: Handheld lets go of everything on a cart change.
  const pressButtons = useCallback((held: number) => {
    const buttons = iframeRef.current?.contentWindow?.pico8_buttons;
    if (buttons) buttons[0] = held;
  }, []);

  // The handheld's Fullscreen button and FullscreenLayer's Exit. This is the export's own
  // fullscreen, run inside its page, so PICO-8 knows about it and draws the game at a whole multiple of 128. It's
  // a toggle, so one call serves both. Fullscreening the iframe from out here works too, but
  // PICO-8 can't tell and draws 768 where 1024 fits. The iframe stays put either way, which is
  // what keeps both poll loops below answering the cart. Focus goes to the iframe itself, or the
  // cart gets no keys: p8_give_focus, which the export's own button uses, focuses a textarea
  // that's display:none here, and does nothing. Pressed before the cart has started, this starts
  // it as its play button would; if it's already running, p8_run_cart does nothing.
  //
  // A finger gets the overlay below instead. iPhone has no fullscreen for anything but video, and
  // real fullscreen would cover the handheld's controls on the touch screens that do have it.
  const toggleFullscreen = useCallback(() => {
    const frame = iframeRef.current;
    frame?.contentWindow?.p8_run_cart?.();
    if (window.matchMedia(TOUCH_INPUT).matches) {
      setOverlay((on) => !on);
      return;
    }
    frame?.focus();
    frame?.contentWindow?.p8_request_fullscreen?.();
  }, []);

  // The phone's fullscreen: the iframe stretched over the page, with PICO-8's own controller. The
  // same iframe, because the poll loops live here, and a popover because the top layer is the way
  // out from under the handheld's transform, which traps a plain position: fixed. Everything
  // about the cart's page is the export's own switches, which keepTouchOut otherwise holds off.
  // p8_touch_detected comes after p8_run_cart for a reason: set any sooner, the export's boot
  // takes the touch path, which rearranges its page and adds a #playing hash.
  useEffect(() => {
    const frame = iframeRef.current;
    const win = frame?.contentWindow;
    const screen = screenRef.current;
    if (!overlay || !win || !screen) return;
    screen.popover = 'manual';
    screen.showPopover();
    letTouchInRef.current = true;
    win.p8_allow_mobile_menu = false; // its fullscreen and close icons do nothing here
    win.p8_touch_detected = true;
    const release = holdPageStill(win);
    return () => {
      release();
      letTouchInRef.current = false;
      win.p8_touch_detected = false;
      // A finger still down never gets to let go, once touches stop reaching PICO-8
      if (win.pico8_buttons) win.pico8_buttons[0] = 0;
      // Set for the touch layout, and nothing puts it back
      const canvas = frame.contentDocument?.getElementById('canvas');
      if (canvas) canvas.style.pointerEvents = '';
      screen.hidePopover();
      screen.removeAttribute('popover');
    };
  }, [overlay]);

  // Esc and the browser's own controls leave without coming through toggleFullscreen, so this
  // follows the event rather than the button.
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  // The page's half of the GPIO protocol; the cart's half is in carts/<game>.p8 and both
  // byte layouts are declared in lib/gpio.ts. Nothing below may hardcode an offset — the
  // effect re-runs when `game` changes, so it reads the whole layout off `protocol`.
  useEffect(() => {
    if (!boardProtocol || game === null) return;
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

  const src = game === null ? '' : `/games/${game}.html`;

  // Two items of App's grid rather than one box of its own, so the cart switcher can sit
  // beside them on a wide screen.
  return (
    <>
      <div className={styles.device}>
        {status === 'missing' && (
          <p className={styles.missing}>
            No cart found at <code>{src}</code>. Export a PICO-8 game to{' '}
            <code>public/games/</code> to play.
          </p>
        )}
        <div className={status === 'missing' ? styles.hidden : styles.handheld}>
          <Handheld
            cartName={game === null ? null : CARTS[game].name}
            powered={status === 'ready'}
            thinking={thinking}
            // Live once a cart has loaded, like the switcher, which is latched while one loads
            canEject={status === 'ready'}
            onEject={onEject}
            onFullscreen={toggleFullscreen}
            crt={crt}
            onCrt={toggleCrt}
            volume={volume}
            onVolume={changeVolume}
            onButtons={pressButtons}
            keyboardHeld={keyboardHeld}
            keyboardInCart={keyboardInCart}
            missedKeys={missedKeys}
          >
            <div
              ref={screenRef}
              className={`${styles.screen} ${overlay ? styles.overlay : crt && !crtOverGame ? styles.crt : ''}`}
            >
              {game === null ? (
                <p className={styles.insert}>insert a cart</p>
              ) : (
                <iframe
                  // Keyed so switching carts remounts the element. Reusing it with a new `src`
                  // leaves the old cart's pico8_gpio reachable during the swap.
                  key={game}
                  ref={iframeRef}
                  className={styles.frame}
                  // PICO-8's page is a little bigger than the iframe (its menu buttons hang off
                  // the game's right edge), so without this it gets its own scrollbars. Those
                  // would also narrow the page and shift the game out of the crop.
                  scrolling="no"
                  src={src}
                  title={game}
                  onLoad={() => {
                    setGainRef.current = routeVolume(iframeRef.current, volumeRef.current);
                    paintPageBlack(iframeRef.current);
                    keepTouchOut(iframeRef.current, letTouchInRef);
                    watchKeys(iframeRef.current, setKeyboardHeld);
                    watchFocus(iframeRef.current, setKeyboardInCart);
                    applyStatus('ready');
                  }}
                  onError={() => applyStatus('missing')}
                />
              )}
              {/* In this page, because the overlay isn't real fullscreen and this one can be
                  clicked. Beside the iframe rather than in it, where PICO-8 cancels touches. */}
              {overlay && (
                <button type="button" className={styles.overlayExit} onClick={toggleFullscreen}>
                  Exit
                </button>
              )}
            </div>
          </Handheld>
        </div>
      </div>
      {fullscreen && iframeRef.current && (
        <FullscreenLayer frame={iframeRef.current} onExit={toggleFullscreen} />
      )}
      {crt && status === 'ready' && iframeRef.current && (
        <CrtScreen key={game} frame={iframeRef.current} onOverGame={setCrtOverGame} />
      )}
      {status !== 'missing' && (
        <div className={styles.panel}>
          {game !== null && boardProtocol ? (
            <TurnPanel turns={turns} thinking={thinking} intro={CARTS[game].panel} />
          ) : game !== null && talkProtocol ? (
            <TalkPanel talks={talks} thinking={thinking} intro={CARTS[game].panel} />
          ) : (
            <TurnPanel turns={[]} thinking={false} intro={NO_CART_PANEL} />
          )}
        </div>
      )}
    </>
  );
}

// PICO-8's page switches to its own touch layout once it has seen a touch: it shrinks the
// game to two thirds of its window, draws its own controller over it, and reads every later
// touch as a press of that controller, zeroing pico8_buttons. The handheld's D-pad and keys
// are this page's touch controls, so touches inside the cart's page stop at its window,
// in the capture phase, before any of PICO-8's listeners see them. A tap still clicks,
// because a click is an event of its own, so the play button still starts the cart. The
// overlay covers the handheld and wants PICO-8's controller, so it lets them through.
function keepTouchOut(frame: HTMLIFrameElement | null, letIn: { current: boolean }) {
  const win = frame?.contentWindow;
  if (!win) return;
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    win.addEventListener(
      type,
      (event) => {
        if (!letIn.current) event.stopImmediatePropagation();
      },
      { capture: true },
    );
  }
}

// The volume slider's gain, put between PICO-8 and the speakers when the cart's page has loaded,
// which is before its play button can be pressed and PICO-8 connects its sound. A Gem-in-Eye door
// is a load() inside the same page, so the gain stays. See lib/volume.ts.
function routeVolume(frame: HTMLIFrameElement | null, percent: number) {
  const win = frame?.contentWindow as (Window & typeof globalThis) | null | undefined;
  return win?.AudioNode ? routeAudio(win, percent) : null;
}

// PICO-8's page has a #222 background, which shows round the game wherever the iframe is bigger
// than it (see .frame), as a grey bezel inside the handheld's black glass. The page is ours to
// reach, being same-origin, and the cart's own screen is black.
function paintPageBlack(frame: HTMLIFrameElement | null) {
  const body = frame?.contentDocument?.body;
  if (body) body.style.background = '#000';
}

// Which of the handheld's buttons the keyboard is holding, so they can move with it. Keys go to
// whichever window has focus, so this listens in the cart's, and a button moves only when the
// cart got its key. It's only a watcher: the runtime has the key already, so nothing here goes
// near pico8_buttons. Two keys can press one button, so it stays down until both are up. A blur
// lets go of everything, as the runtime does, because a key released elsewhere sends its keyup
// elsewhere. Keys under Cmd don't count, because macOS sends no keyup for them at all.
function watchKeys(frame: HTMLIFrameElement | null, onChange: (held: number) => void) {
  const win = frame?.contentWindow;
  if (!win) return;
  const down = new Set<number>();
  const report = () => onChange([...down].reduce((held, key) => held | BUTTON_KEYS[key]!, 0));
  win.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode in BUTTON_KEYS && !event.metaKey) down.add(event.keyCode);
      report();
    },
    { capture: true },
  );
  win.addEventListener(
    'keyup',
    (event) => {
      down.delete(event.keyCode);
      report();
    },
    { capture: true },
  );
  win.addEventListener('blur', () => {
    down.clear();
    report();
  });
}

// Whether the cart has the keyboard. Keys go to the window with focus, so that's the cart's
// window having it: a click on its screen, or Tab reaching the iframe, gives it focus, and a
// click anywhere else on the page takes it away. Leaving the browser takes it too, and gives
// it back on return, which is right, and nothing on the page shows meanwhile. It starts from
// where focus is, not from the last cart's answer: WebKit sends no blur from a removed iframe.
function watchFocus(frame: HTMLIFrameElement | null, onChange: (focused: boolean) => void) {
  const win = frame?.contentWindow;
  if (!win) return;
  onChange(document.activeElement === frame && document.hasFocus());
  win.addEventListener('focus', () => onChange(true));
  win.addEventListener('blur', () => onChange(false));
}

// Nothing behind the overlay may move, because any of it showing through is the page. PICO-8
// only cancels a touch on its controller, so a drag anywhere else ran out of the iframe and
// scrolled the page behind, and Safari's bars with it, which opened gaps down to About.
//
// So every touch in the cart's page is cancelled, which also ends zooming and the long-press
// callout, and PICO-8 still sees them: cancelling isn't stopping. `passive: false` is what makes
// it count, because Safari ignores a cancel from a window's touch listener otherwise. This page
// keeps its touchstart, or Exit couldn't be tapped. The .cart-overlay class is the backstop, for
// whatever gets past that: the page can't scroll, and isn't drawn, with black behind it.
function holdPageStill(win: Window) {
  const scrollY = window.scrollY;
  const cancel = (event: Event) => event.preventDefault();
  const options = { passive: false };
  const inCart = ['touchstart', 'touchmove', 'gesturestart'];
  const inPage = ['touchmove', 'gesturestart'];
  for (const type of inCart) win.addEventListener(type, cancel, options);
  for (const type of inPage) document.addEventListener(type, cancel, options);
  document.documentElement.classList.add('cart-overlay');
  return () => {
    for (const type of inCart) win.removeEventListener(type, cancel);
    for (const type of inPage) document.removeEventListener(type, cancel);
    document.documentElement.classList.remove('cart-overlay');
    window.scrollTo(0, scrollY);
  };
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
