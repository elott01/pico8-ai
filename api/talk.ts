// gem-in-eye's voice: the shopkeeper in carts/gemini.p8. Holds the API key, asks Gemini to
// judge the agent, price the sale and speak, and returns the speech already paged for the
// cart. Vercel pre-parses JSON, so req.body is an object.
//
// A sibling of move.ts rather than another game in it: a speech has no legal set and no
// right answer. They share the Gemini call, the origin check and the rate limits, so the
// two endpoints draw on one quota and follow one set of retry rules (_ask_gemini.ts).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, QuotaError, errorMessage } from './_ratelimit.ts';
import { askGemini, isSameOrigin, CLIENT_ABORT_MS } from './_ask_gemini.ts';
import type { CallStats } from './_ask_gemini.ts';
import { buildTalkPrompt, talkConfig, parseTalkReply, priceBand } from './_talk_prompt.ts';
import type { ParsedTalk } from './_talk_prompt.ts';
import { cleanSpeech, paginate } from './_talk_text.ts';
import { readTalkRequest } from './_talk_request.ts';
import type { TalkRequest, TalkSuccess, TalkRateLimited } from './_types.ts';

/** Every field null: the cart charges list price and says its own line. */
const FALLBACK: TalkSuccess = { verdict: null, price: null, pages: null, notice: null };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // One greppable line per request, as in move.ts: without it a 9.8s request and a 1.4s
  // one look identical from outside, and the page's abort happens where we cannot see it.
  const started = Date.now();
  const stats: CallStats = { calls: 0, geminiMs: 0 };
  const done = (outcome: string, extra = '') => {
    const total = Date.now() - started;
    const late = total >= CLIENT_ABORT_MS ? ' TOO-LATE' : total >= CLIENT_ABORT_MS * 0.8 ? ' SLOW' : '';
    console.log(`[talk] ${outcome} calls=${stats.calls} gemini=${stats.geminiMs}ms total=${total}ms${extra}${late}`);
  };
  const rateLimited = (retryAfter: number) => {
    const body: TalkRateLimited = { verdict: null, price: null, pages: null, notice: null, rateLimited: true, retryAfter };
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json(body);
  };

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  // 429 rather than a silent fallback, so the panel can tell a rate limit from a model
  // failure. The limiter is shared with /api/move: both spend the same free-tier quota.
  const limit = await checkRateLimit(req);
  if (limit.limited) {
    done('rate-limited', ` retryAfter=${limit.retryAfter}s`);
    return rateLimited(limit.retryAfter);
  }

  const request = readTalkRequest(req.body);
  if (typeof request === 'string') return res.status(400).json({ error: request });

  // No key (fresh checkout): still answer, so the cart/page loop can be exercised. The cart
  // reads all-null as "fall back", which is exactly what it should do without a model.
  if (!process.env.GEMINI_API_KEY) return res.status(200).json(FALLBACK);

  const list = request.purchase.listPrice;
  try {
    let reply = await ask(request, stats, started);

    // The price enum makes an out-of-band price unrepresentable, so this should never fire.
    // If it does, retry once with the band spelled out — the same pattern move.ts uses for
    // an illegal move — but only while the client can still read the answer, and only when
    // the model actually named a price.
    if (reply.badPrice && Date.now() - started < CLIENT_ABORT_MS) {
      const { min, max } = priceBand(list);
      console.log(`[talk] price out of band for list ${list}; retrying with correction`);
      const retry = await ask(request, stats, started, `price must be a whole number from ${min} to ${max}.`);
      // Keep the first speech if the retry lost it: the words are the product, the price is not.
      reply = { ...retry, speech: retry.speech ?? reply.speech, notice: retry.notice ?? reply.notice };
    }

    const { pages, cut } = paginate(reply.speech ? cleanSpeech(reply.speech) : '');
    const body: TalkSuccess = {
      verdict: reply.verdict,
      price: reply.price,
      pages: pages.length ? pages : null,
      notice: reply.notice,
    };
    done(
      body.pages ? 'ok' : 'no-speech',
      ` ${request.purchase.item}${request.purchase.tier} verdict=${body.verdict} price=${body.price}/${list} pages=${pages.length}${cut ? ' cut' : ''}`,
    );
    return res.status(200).json(body);
  } catch (e) {
    if (e instanceof QuotaError) {
      done('quota', ` retryAfter=${e.retryAfter}s`);
      return rateLimited(e.retryAfter);
    }
    // 502, not the all-null 200. The cart sells at list with its own line either way, but
    // the page reads a 200 with no speech as the model answering with nothing, and only an
    // error status as the model being unavailable — which is what happened.
    done('FAILED', ` err=${JSON.stringify(errorMessage(e))}`);
    return res.status(502).json({ error: 'model unavailable' });
  }
}

async function ask(request: TalkRequest, stats: CallStats, started: number, correction?: string): Promise<ParsedTalk> {
  const reply = await askGemini({
    prompt: buildTalkPrompt(request, { correction }),
    config: talkConfig(request),
    stats,
    started,
    tag: 'talk',
  });
  return parseTalkReply(reply, request.purchase.listPrice);
}
