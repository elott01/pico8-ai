// Serverless proxy: holds the Gemini key, builds the prompt, returns a clean move.
// Runs on Vercel's Node runtime (see engines.node in package.json). Vercel
// auto-parses JSON request bodies, so req.body is already an object here.

// Mirrors the getAiTurn timeout in src/lib/ai.js. Diagnostic only — nothing here
// enforces it; it just flags answers that finished after the client stopped waiting.
const CLIENT_ABORT_MS = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // TODO(phase-9): rate limit per IP (in-memory or Vercel KV) before this URL
  // goes public — on trip, return { move: null } so the client falls back to a
  // local move. Pair with a local minimax fallback so Gemini is an enhancement,
  // not a dependency. See build plan Phase 9.

  const { board } = req.body ?? {};

  // Validate input before doing anything else: a 9-element array of 0/1/2.
  if (!isValidBoard(board)) {
    return res.status(400).json({ error: 'board must be a 9-element array of 0/1/2' });
  }

  // No key configured (e.g. fresh `vercel dev` before setup): return a legal
  // move so the end-to-end loop still works. Swap this for the real call once
  // GEMINI_API_KEY is set.
  if (!process.env.GEMINI_API_KEY) {
    return res.status(200).json({ move: firstLegal(board) });
  }

  try {
    let parsed = await askGemini(board);

    // The model still occasionally names an occupied cell despite listing legalCells.
    // Retry ONCE, echoing the mistake back — cheaper and more honest than silently
    // overriding it, and it keeps `lines`/commentary consistent with the final move.
    // This is the Step 6 illegal-move guard.
    if (!isLegalMove(parsed.move, board)) {
      console.log(`[move] illegal move ${parsed.move}; retrying with correction`);
      const correction =
        `Cell ${parsed.move} is NOT empty. You may only play one of these cells: ` +
        `${JSON.stringify(legalCells(board))}. Choose one of them.`;
      parsed = await askGemini(board, correction);
    }

    console.log('[move] lines:', JSON.stringify(parsed.lines));
    console.log('[move] winMove:', parsed.winMove, '| blockMove:', parsed.blockMove, '=> move:', parsed.move);
    console.log('[move] commentary:', parsed.commentary);

    // Pass the model's own analysis through to the client so the UI can show that a
    // real LLM picked this move. `move` stays the only field the game depends on; if
    // it is still illegal after the retry, the client's validateMove falls back.
    return res.status(200).json({
      move: parsed.move,
      winMove: parsed.winMove ?? null,
      blockMove: parsed.blockMove ?? null,
      lines: parsed.lines ?? [],
      commentary: parsed.commentary ?? null,
    });
  } catch (e) {
    // Let the client fall back to a local legal move rather than erroring out.
    console.log('[move] gemini call FAILED, falling back to null:', e.message);
    return res.status(200).json({ move: null });
  }
}

const MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// One full turn from the model: builds the prompt (optionally with a correction note),
// retries transient overload, and returns the parsed JSON. Throws on unparseable output.
async function askGemini(board, correction) {
  // Retry transient overload/rate-limit (503/429) a couple times with a short backoff
  // — these clear quickly. Attempt count and backoff have to fit inside CLIENT_ABORT_MS
  // alongside generation (and any legality retry), or the client gives up mid-retry.
  const started = Date.now();
  let r, data;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY, // key stays server-side
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(board, correction) }] }],
        // Ask for clean JSON back instead of prose/markdown fences. Low temp because
        // move choice should be near-deterministic, not creative.
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    data = await r.json();
    if (r.status !== 503 && r.status !== 429) break; // only overload is worth retrying
    console.log(`[move] gemini ${r.status} (attempt ${attempt + 1}), retrying…`);
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }

  // TEMP DIAGNOSTIC — remove once confirmed. The elapsed time matters: a 200 logged
  // past the client's abort deadline means the browser already fell back.
  const ms = Date.now() - started;
  const late = ms > CLIENT_ABORT_MS ? ' ⚠ PAST CLIENT ABORT' : '';
  console.log('[move] gemini HTTP:', r.status, `(${ms}ms${late})`);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    console.log('[move] unparseable response body:', JSON.stringify(data));
    throw new Error('could not parse model response');
  }
}

function isValidBoard(board) {
  return Array.isArray(board) && board.length === 9 && board.every((c) => c === 0 || c === 1 || c === 2);
}

function firstLegal(board) {
  const i = board.indexOf(0);
  return i >= 0 ? i : null;
}

function legalCells(board) {
  return board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
}

function isLegalMove(move, board) {
  return Number.isInteger(move) && move >= 0 && move < 9 && board[move] === 0;
}

// The model reliably transcribes each line's values but is unreliable at counting
// over what it just wrote (it emitted "[1,4,7]: 0,2,2" and still concluded "no line
// has two 2s", missing a win). So the schema below makes the count an explicit field
// per line, and forces it to commit to winMove/blockMove BEFORE choosing `move` —
// JSON keys generate in order, so each field is conditioned on the ones above it.
//
// Same reason for "legalCells" right before "move": the model would derive a line's
// emptyCells correctly and then still pick an occupied square (played the center when
// the center held an opponent piece). Making it list every legal cell and choose from
// that list turns "is this empty?" from an in-head check into a lookup it can't skip.
//
// That ordering is load-bearing, so keep `commentary` LAST: generated after `move`,
// it cannot influence the choice. Moving it above `move` would let flavor text steer
// the game.
function buildPrompt(board, correction) {
  return [
    'You are playing tic-tac-toe as player 2 (you are "2").',
    'Board is a 9-element array, indices 0..8, row-major (0,1,2 = top row; 3,4,5 = middle; 6,7,8 = bottom).',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'The 8 winning lines: [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6].',
    '',
    'STEP 1 — "lines": for EACH of the 8 lines above, in order, emit an object:',
    '{"line": [a,b,c], "values": [va,vb,vc], "twos": <how many values equal 2>,',
    '"ones": <how many values equal 1>, "emptyCells": [<indices whose value is 0>]}.',
    'Count carefully. "twos" is literally how many of the three values are the number 2.',
    '',
    'STEP 2 — "winMove": scan your OWN "lines" output. If any line has twos == 2 and',
    'ones == 0 and exactly one emptyCell, set winMove to that empty cell index. Else null.',
    '',
    'STEP 3 — "blockMove": scan your OWN "lines" output. If any line has ones == 2 and',
    'twos == 0 and exactly one emptyCell, set blockMove to that empty cell index. Else null.',
    '',
    'STEP 4 — "legalCells": the list of every board index whose value is 0. These are the',
    'ONLY cells you may play. If winMove/blockMove are set they will appear in this list.',
    '',
    'STEP 5 — "move": apply this priority EXACTLY, and "move" MUST be one of legalCells:',
    '1. If winMove is not null, move = winMove. (Winning ends the game — ALWAYS take it,',
    '   even if blockMove is also set. Never block when you can win.)',
    '2. Else if blockMove is not null, move = blockMove.',
    '3. Else 4 (center) if 4 is in legalCells.',
    '4. Else a corner (0, 2, 6, or 8) that is in legalCells.',
    '5. Else any cell in legalCells.',
    '',
    'STEP 6 — "commentary": ONE short, playful sentence (max 12 words) addressed to your',
    'opponent about the move you just picked. Flavor only — it must NOT change "move".',
    correction ? `\nIMPORTANT: ${correction}` : '',
    '',
    'Respond ONLY as JSON, with the keys in this exact order:',
    '{"lines": [...8 objects...], "winMove": <index|null>, "blockMove": <index|null>,',
    '"legalCells": [...], "move": <index>, "commentary": "<one sentence>"}.',
  ].join(' ');
}
