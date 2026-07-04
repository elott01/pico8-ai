// Serverless proxy: holds the Gemini key, builds the prompt, returns a clean move.
// Runs on Vercel's Node runtime (see engines.node in package.json). Vercel
// auto-parses JSON request bodies, so req.body is already an object here.

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

  const model = 'gemini-2.5-flash'; // verify the current free model in AI Studio
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const r = await fetch(url, {
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

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const move = JSON.parse(text).move;
    return res.status(200).json({ move });
  } catch {
    // Let the client fall back to a local legal move rather than erroring out.
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
    'You are playing tic-tac-toe as player 2.',
    'Board is a 9-element array, indices 0..8, row-major.',
    '0 = empty, 1 = opponent, 2 = you.',
    `Current board: ${JSON.stringify(board)}.`,
    'Choose the index of your best legal move (a cell that is 0).',
    'Respond ONLY as JSON: {"move": <index>}.',
  ].join(' ');
}
