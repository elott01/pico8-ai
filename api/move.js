// Serverless proxy: holds the Gemini key, builds the prompt, returns a clean move.
// Runs on Vercel's Node runtime (see engines.node in package.json). Vercel
// auto-parses JSON request bodies, so req.body is already an object here.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // TEMP DIAGNOSTIC — remove after confirming the key loads. Prints whether the
  // env var is visible to the running function, plus its length (never the value).
  const k = process.env.GEMINI_API_KEY;
  console.log('[move] GEMINI_API_KEY present:', !!k, 'length:', k ? k.length : 0);

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

  // The 2.5 family is retired for new API keys (404) and the `-latest` flagship
  // gets 503-stormed on the free tier. 2.0-flash is callable, low-demand, and
  // plenty for tic-tac-toe with the explicit-strategy prompt below.
  const model = 'gemini-2.0-flash'; // verify the current free model in AI Studio
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    // Retry transient overload/rate-limit (503/429) a couple times with a short
    // backoff — these clear quickly. Kept small to stay under the client's 5s
    // abort in ai.js; on persistent failure we fall through to the null fallback.
    let r, data;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY, // key stays server-side
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(board) }] }],
          // Ask for clean JSON back instead of prose/markdown fences.
          generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
        }),
      });
      data = await r.json();
      if (r.status !== 503 && r.status !== 429) break; // only overload is worth retrying
      console.log(`[move] gemini ${r.status} (attempt ${attempt + 1}), retrying…`);
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }

    // TEMP DIAGNOSTIC — remove once confirmed. Shows if Google actually answered.
    console.log('[move] gemini HTTP:', r.status, 'body:', JSON.stringify(data).slice(0, 300));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const move = JSON.parse(text).move;
    console.log('[move] gemini move:', move);
    return res.status(200).json({ move });
  } catch (e) {
    // Let the client fall back to a local legal move rather than erroring out.
    console.log('[move] gemini call FAILED, falling back to null:', e.message);
    return res.status(200).json({ move: null });
  }
}

function isValidBoard(board) {
  return Array.isArray(board) && board.length === 9 && board.every((c) => c === 0 || c === 1 || c === 2);
}

function firstLegal(board) {
  const i = board.indexOf(0);
  return i >= 0 ? i : null;
}

function buildPrompt(board) {
  return [
    'You are playing tic-tac-toe as player 2 (you are "2").',
    'Board is a 9-element array, indices 0..8, row-major (0,1,2 = top row; 3,4,5 = middle; 6,7,8 = bottom).',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'Winning lines: [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6].',
    'Decide your move using this exact priority:',
    '1. If you (2) have two in any line with the third cell empty, play it to WIN.',
    '2. Else if the opponent (1) has two in any line with the third cell empty, play it to BLOCK.',
    '3. Else take the center (4) if empty.',
    '4. Else take a corner (0,2,6,8) if empty.',
    '5. Else take any empty cell.',
    'The chosen cell MUST currently be 0. Respond ONLY as JSON: {"move": <index>}.',
  ].join(' ');
}
