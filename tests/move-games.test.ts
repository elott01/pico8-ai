// /api/move serving two carts.
//
// The failure this guards is silent: a 42-cell board read as tic-tac-toe, or a Connect Four
// column applied as a cell index, produces a plausible-looking move rather than an error.
// Nothing downstream would notice — the cart would just play somewhere odd and the panel
// would credit the model for it.

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_CALLS_PER_MIN = '999';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { asResponse, mockReq, mockRes, successBody } from './_mocks.ts';

const { default: handler } = await import('../api/move.ts');

const HOST = 'pico8-ai.vercel.app';
const TTT_BOARD = new Array(9).fill(0);
const C4_BOARD = new Array(42).fill(0);

/** A Gemini reply carrying whatever fields the test cares about. */
const reply = (fields: Record<string, unknown>) =>
  asResponse({
    status: 200,
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }],
    }),
  });

let seq = 0;
async function call(body: unknown) {
  const { res, out } = mockRes();
  await handler(
    mockReq({
      headers: { host: HOST, origin: `https://${HOST}`, 'x-real-ip': `games-${seq++}` },
      body,
    }),
    res,
  );
  return out;
}

/** Captures what was sent to Gemini so the prompt and schema can be inspected. */
function captureRequest(replyFields: Record<string, unknown>) {
  const sent: { prompt: string; config: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, opts?: RequestInit) => {
    const body = JSON.parse(String(opts?.body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    sent.push({ prompt: body.contents[0].parts[0].text, config: body.generationConfig });
    return reply(replyFields);
  }) as typeof globalThis.fetch;
  return sent;
}

describe('board length is checked against the declared game', () => {
  it('rejects a 42-cell board sent as tic-tac-toe', async () => {
    const res = await call({ board: C4_BOARD, game: 'tic_tac_toe' });
    assert.equal(res.code, 400);
  });

  it('rejects a 9-cell board sent as connect_four', async () => {
    const res = await call({ board: TTT_BOARD, game: 'connect_four' });
    assert.equal(res.code, 400);
  });

  it('rejects a Connect Four board sent with no game, rather than guessing', async () => {
    // The default is tic-tac-toe, so this must 400 on length — never be inferred from it.
    const res = await call({ board: C4_BOARD });
    assert.equal(res.code, 400);
  });

  it('rejects an unknown game instead of falling back', async () => {
    const res = await call({ board: TTT_BOARD, game: 'chess' });
    assert.equal(res.code, 400);
    assert.match(String((res.body as { error: string }).error), /unknown game/);
  });

  it('still accepts a tic-tac-toe board with no game, so a stale client keeps working', async () => {
    captureRequest({ move: 4, lines: [], winMove: null, blockMove: null, commentary: 'x' });
    const res = await call({ board: TTT_BOARD });
    assert.equal(res.code, 200);
    assert.equal(successBody(res.body).move, 4);
  });
});

describe('each game gets its own prompt and decoding config', () => {
  it('sends the Connect Four prompt, with the move enum constrained to legal columns', async () => {
    const sent = captureRequest({ reasoning: 'centre', move: '3', commentary: 'x' });
    const res = await call({ board: C4_BOARD, game: 'connect_four' });

    assert.equal(res.code, 200);
    assert.match(sent[0].prompt, /Connect Four/);
    assert.match(sent[0].prompt, /LINES ONE DISC FROM FOUR/, 'must ship the measured variant');

    const schema = sent[0].config.responseSchema as {
      properties: { move: { enum: string[] } };
    };
    assert.deepEqual(schema.properties.move.enum, ['0', '1', '2', '3', '4', '5', '6']);
  });

  it('sends the tic-tac-toe prompt with no schema', async () => {
    const sent = captureRequest({ move: 4, lines: [], winMove: null, blockMove: null, commentary: 'x' });
    await call({ board: TTT_BOARD, game: 'tic_tac_toe' });

    assert.match(sent[0].prompt, /tic-tac-toe/);
    assert.equal(sent[0].config.responseSchema, undefined);
  });

  it('parses Connect Four\'s enum move back to a number', async () => {
    // Gemini enums are strings, so the reply carries "3". A string reaching the page would
    // fail the cart's `m >= 0 and m <= 6` guard and silently become a fallback turn.
    captureRequest({ reasoning: 'centre', move: '3', commentary: 'x' });
    const res = await call({ board: C4_BOARD, game: 'connect_four' });
    assert.strictEqual(successBody(res.body).move, 3);
  });
});

describe('each game returns only its own analysis fields', () => {
  it('Connect Four sends reasoning and no lines', async () => {
    captureRequest({ reasoning: 'blocked the open three', move: '4', commentary: 'ha' });
    const body = successBody((await call({ board: C4_BOARD, game: 'connect_four' })).body);

    assert.equal(body.reasoning, 'blocked the open three');
    assert.equal(body.commentary, 'ha');
    assert.equal(body.lines, undefined, '69 lines would be a wall of JSON the panel cannot use');
    assert.equal(body.winMove, undefined);
  });

  it('tic-tac-toe sends lines and no reasoning string', async () => {
    captureRequest({
      move: 4,
      winMove: 4,
      blockMove: null,
      lines: [{ line: [0, 1, 2], values: [0, 0, 0], ones: 0, twos: 0 }],
      commentary: 'ha',
    });
    const body = successBody((await call({ board: TTT_BOARD, game: 'tic_tac_toe' })).body);

    assert.equal(body.winMove, 4);
    assert.equal(body.lines?.length, 1);
    assert.equal(body.reasoning, undefined, 'its reasoning IS the lines array');
  });
});

describe('the illegal-move retry speaks each game\'s language', () => {
  it('corrects a full Connect Four column and keeps the retried move', async () => {
    // Column 0 is full; every other column has room.
    const board = new Array(42).fill(0);
    for (let row = 0; row < 6; row++) board[row * 7] = row % 2 === 0 ? 1 : 2;

    let n = 0;
    const prompts: string[] = [];
    globalThis.fetch = (async (_url: RequestInfo | URL, opts?: RequestInit) => {
      const sent = JSON.parse(String(opts?.body)) as { contents: { parts: { text: string }[] }[] };
      prompts.push(sent.contents[0].parts[0].text);
      n++;
      return reply({ reasoning: 'r', move: n === 1 ? '0' : '3', commentary: 'x' });
    }) as typeof globalThis.fetch;

    const res = await call({ board, game: 'connect_four' });

    assert.equal(prompts.length, 2, 'should retry exactly once');
    assert.match(prompts[1], /IMPORTANT: Column 0 is NOT playable/);
    assert.match(prompts[1], /columns/, 'the correction must name columns, not cells');
    assert.equal(successBody(res.body).move, 3);
  });

  it('does not retry a legal Connect Four column', async () => {
    const sent = captureRequest({ reasoning: 'r', move: '3', commentary: 'x' });
    await call({ board: C4_BOARD, game: 'connect_four' });
    assert.equal(sent.length, 1);
  });
});

describe('the no-key branch answers per game', () => {
  it('returns the first legal column for Connect Four', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await call({ board: C4_BOARD, game: 'connect_four' });
      assert.equal(res.code, 200);
      // 0 is a legal COLUMN here. Under the old cell-based helper this branch would have
      // answered with a cell index, which Connect Four's cart would reject.
      assert.equal(successBody(res.body).move, 0);
    } finally {
      process.env.GEMINI_API_KEY = saved;
    }
  });
});
