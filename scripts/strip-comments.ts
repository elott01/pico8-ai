// A cart's code without its comments, for the copy scripts/export-cart.ts exports.
//
// Comments count towards PICO-8's compressed-code limit, the one carts actually hit, and they
// were about a quarter of Gem-in-Eye's code. The .p8 in carts/ keeps every one of them: only
// the export's temporary copy loses them, so they cost nothing on the site.
//
// Lines of code are never joined or split. PICO-8's one-line `if (a) b` and `?` print end at
// the newline, so moving one would change what the cart does. Strings are copied as they are,
// since a `--` inside one isn't a comment.

const LONG_BRACKET = /\[(=*)\[/y;
const LUA = /^(__lua__\n)([\s\S]*?)(\n?)(?=^__\w+__$|(?![\s\S]))/m;

function longBracket(code: string, i: number): string | null {
  LONG_BRACKET.lastIndex = i;
  const open = LONG_BRACKET.exec(code);
  return open ? `]${open[1]}]` : null;
}

/** The index just past the next `close` from `i`, or the end of the code. */
function past(code: string, close: string, i: number): number {
  const j = code.indexOf(close, i);
  return j === -1 ? code.length : j + close.length;
}

/** Lua code without comments, or the blank lines they leave behind. */
export function stripComments(code: string): string {
  const lines: string[] = [];
  let line = '';
  const endLine = (): void => {
    if (line.trim() !== '') lines.push(line.trimEnd());
    line = '';
  };

  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '\n') {
      endLine();
      i += 1;
    } else if (code.startsWith('--', i) || code.startsWith('//', i)) {
      const close = code.startsWith('--', i) ? longBracket(code, i + 2) : null;
      if (close) {
        const end = past(code, close, i + 2);
        // A space, so the code either side can't run together, unless it spanned lines
        if (code.slice(i, end).includes('\n')) endLine();
        else line += ' ';
        i = end;
      } else {
        const end = code.indexOf('\n', i);
        i = end === -1 ? code.length : end;
      }
    } else if (longBracket(code, i)) {
      // Kept on `line` whole, newlines and all, so no blank line inside it is dropped
      const end = past(code, longBracket(code, i)!, i);
      line += code.slice(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      line += code.slice(i, j + 1);
      i = j + 1;
    } else {
      line += c;
      i += 1;
    }
  }
  endLine();
  return lines.join('\n');
}

/** A whole .p8 with its code stripped, and its art, map, sound and label untouched. */
export function stripCart(cart: string): string {
  return cart.replace(LUA, (_, head: string, code: string, tail: string) => head + stripComments(code) + tail);
}
