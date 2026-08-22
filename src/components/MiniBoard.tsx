// A board rendered small, in whatever shape the cart's protocol says.
//
// Extracted from TurnPanel because the cart switcher wants the same thing for a different
// reason: an empty 3x3 next to an empty 7x6 says "which game" faster than any label. One
// implementation means a new cart gets a correct mini-board in both places for free, and a
// board-size change cannot make one of them wrong.

import type { CSSProperties } from 'react';
import { landingCell } from '../lib/gpio.ts';
import type { Board, Protocol } from '../lib/gpio.ts';
import styles from './MiniBoard.module.scss';

const MARK = ['', 'X', 'O']; // 0 empty, 1 human (X), 2 AI (O)

export default function MiniBoard({
  board,
  protocol,
  move = null,
  size,
}: {
  board: Board;
  protocol: Protocol;
  /** The move to ring, in this cart's move unit. Omit for a plain board. */
  move?: number | null;
  /** Cell size override; defaults to something that fits the turn panel. */
  size?: string;
}) {
  // `board` is the position *before* the move, so the ringed cell has to be derived rather
  // than read: in Connect Four `move` is a column and gravity decides the row. landingCell
  // answers both carts, so the highlight can never point at a cell the cart did not fill.
  const played = move === null ? null : landingCell(board, move, protocol);

  // Column count is data, not styling, so it rides in as a custom property rather than a
  // per-cart class — the palette stays entirely in the stylesheet either way. Wider boards
  // get smaller cells so a 7-wide grid still fits its container.
  const vars = {
    '--board-cols': protocol.cols,
    '--cell-size': size ?? (protocol.cols > 4 ? '14px' : '18px'),
  } as CSSProperties;

  return (
    <div className={styles.board} style={vars} aria-hidden="true">
      {board.map((v, i) => (
        <div key={i} className={`${styles.cell} ${i === played ? styles.cellPlayed : ''}`}>
          {i === played ? 'O' : MARK[v]}
        </div>
      ))}
    </div>
  );
}

/** An empty board of this cart's shape — the switcher's label art. */
export function emptyBoard(protocol: Protocol): Board {
  return new Array(protocol.cells).fill(0);
}
