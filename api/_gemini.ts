// Which model the game plays against, where it lives, and how it is asked to decode.
// Underscore-prefixed so Vercel treats it as a helper rather than a route.
//
// Constants only, and deliberately free of imports and side effects, because `bench/`
// imports it too. That is the whole reason it exists: the harness must measure the model
// and decoding settings production actually uses. A second copy of the model id in bench/
// would let the benchmark score a *different* model than the one serving moves, and
// nothing in the output would look wrong — the same silent-drift failure as the wire
// contract in _types.ts.

export const MODEL = 'gemini-3.1-flash-lite';

export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** JSON out, not prose; low temperature because a move should be near-deterministic. */
export const GENERATION_CONFIG = { temperature: 0.1, responseMimeType: 'application/json' };
