pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- tic-tac-toe -- defaults to vs cpu; pause menu toggles 2-player
-- by ethan lott

-- game state
board = {} -- 0 = empty, 1 = player x, 2 = player o
turn = 1
cursor = 5 -- which cell (1-9) the current player is hovering
state = "play" -- "play" = in progress, "win" = someone won, "draw" = full board
winner = 0
win_line = 0 -- winning triple of indices (0 = none), used by _draw to highlight

function reset()
    for i=1,9 do
        board[i] = 0
    end
    turn = 1
    cursor = 5
    state = "play"
    winner = 0
    win_line = 0
    ai_state = "idle"       -- "idle" or "waiting" for a move from the web page
    ai_frames = 0           -- frames spent waiting on the current request
    ai_acked = false        -- has the page acknowledged our request?
end

function _init()
    scores = {0, 0} -- scores[1]=player x wins, scores[2]=player o wins
    p2_is_ai = true         -- false = 2 players, true = player 2 is the cpu (default)
    set_mode(true)          -- registers the pause-menu toggle
    reset()
end

-- update the mode flag AND the pause-menu label to match.
function set_mode(is_ai)
    p2_is_ai = is_ai
    menuitem(1, p2_is_ai and "mode: vs cpu" or "mode: 2 player", toggle_mode)
end

-- pause-menu callback: flip mode and restart the round.
function toggle_mode()
    set_mode(not p2_is_ai)
    reset()
    return true             -- keep the pause menu open after toggling
end

-- board layout constants
-- 3 cells of 35px = 105px board. as a rect it spans 106px (inclusive
-- endpoints), so centering in 128px wants an 11px margin: ox = 11.
ox = 11 -- board origin x (left edge)
oy = 11 -- board origin y (top edge)
cs = 35 -- cell size in pixels

function cell_col(i)
    return (i-1) % 3
end

function cell_row(i)
    return flr((i-1) / 3)
end

function cell_pos(i)
    local x = ox + cell_col(i) * cs
    local y = oy + cell_row(i) * cs
    return x, y
end

-- the 8 ways to win, each a triple of board indices
lines = {
    {1,2,3}, {4,5,6}, {7,8,9}, -- rows
    {1,4,7}, {2,5,8}, {3,6,9}, -- columns
    {1,5,9}, {3,5,7}           -- diagonals
}

-- winner_of(b): 1 or 2 if that player has a line on board b, else 0.
-- pure (no globals touched) so minimax can call it on trial boards.
function winner_of(b)
    for line in all(lines) do
        local a = b[line[1]]
        if a != 0 and a == b[line[2]] and a == b[line[3]] then
            return a
        end
    end
    return 0
end

-- minimax score of board b, to move `who`, from `me`'s perspective.
-- +1 = me wins, -1 = me loses, 0 = draw (optimal play by both sides).
function minimax(b, who, me)
    local w = winner_of(b)
    if w == me then return 1 end
    if w != 0 then return -1 end

    local full = true
    for i=1,9 do if b[i] == 0 then full = false end end
    if full then return 0 end   -- draw

    local best
    for i=1,9 do
        if b[i] == 0 then
            b[i] = who                       -- try the move
            local s = minimax(b, 3-who, me)
            b[i] = 0                          -- undo
            if who == me then                -- my turn: maximize
                if best == nil or s > best then best = s end
            else                             -- their turn: minimize
                if best == nil or s < best then best = s end
            end
        end
    end
    return best
end

-- best legal cell for player `me` on board b.
function best_move(b, me)
    local bestcell, bestscore
    for i=1,9 do
        if b[i] == 0 then
            b[i] = me
            local s = minimax(b, 3-me, me)
            b[i] = 0
            if bestcell == nil or s > bestscore then
                bestcell, bestscore = i, s
            end
        end
    end
    return bestcell
end

-- gpio bridge to the web page (see src/lib/gpio.js + AGENTS.md).
-- the web export mirrors these 128 bytes to a js array the page can read/write.
--   byte 0     status: 0 idle · 1 request · 2 thinking · 3 ready
--   bytes 1..9 board cells (0 empty, 1 human, 2 ai) -- same coding as `board`
--   byte 10    move cell, 0-based (0..8); we add 1 to index board.
--              page WRITES it before ready: the move to play, or a value >8 (no move)
--              meaning "play your own minimax". we OVERWRITE it with the cell actually
--              played before going idle, so the page can read the real move back.
gpio = 0x5f80
gp_status = 0
gp_move = 10
st_idle, st_request, st_thinking, st_ready = 0, 1, 2, 3

-- how long to wait (frames @30fps) on a web move before falling back locally:
ai_ack_frames = 15   -- ~0.5s: no ack -> assume no page (e.g. desktop pico-8)
ai_max_frames = 180  -- ~6s: page acked but never answered -> don't hang

-- publish the board and ask the page for a move.
function request_web_move()
    for i=1,9 do poke(gpio+i, board[i]) end
    poke(gpio+gp_status, st_request)
    ai_state = "waiting"
    ai_frames = 0
    ai_acked = false
end

-- drive the cpu's turn. runs each _update while it's player 2 (ai) to move.
-- asks the web page over gpio; falls back to local minimax if nobody answers.
function update_ai()
    if ai_state == "idle" then
        request_web_move()
        return
    end

    ai_frames += 1
    local status = peek(gpio+gp_status)
    if status >= st_thinking then ai_acked = true end

    local cell = nil
    if status == st_ready then
        local m = peek(gpio+gp_move)          -- 0-based index from the page
        if m >= 0 and m <= 8 and board[m+1] == 0 then
            cell = m + 1
        else
            cell = best_move(board, 2)         -- page sent garbage; recover
        end
    elseif not ai_acked and ai_frames >= ai_ack_frames then
        cell = best_move(board, 2)             -- no bridge listening
    elseif ai_frames >= ai_max_frames then
        cell = best_move(board, 2)             -- bridge stalled
    end

    if cell then
        poke(gpio+gp_move, cell-1)             -- publish the cell we ACTUALLY played
        poke(gpio+gp_status, st_idle)          -- release the bridge; page reads it back
        ai_state = "idle"
        place(cell)
    end
end

function check_win()
    for line in all(lines) do
        local a = board[line[1]]
        local b = board[line[2]]
        local c = board[line[3]]
        -- all three cells filled with the same player?
        if a != 0 and a == b and b == c then
            winner = a
            state = "win"
            win_line = line   -- remember the line for highlighting
            scores[a] += 1    -- count this round for the winner
            return
        end
    end
    -- no winner: if any cell is still empty the game continues,
    -- otherwise the board is full and it's a draw
    for i=1,9 do
        if board[i] == 0 then
            return
        end
    end
    state = "draw" -- board full, nobody won
end

-- place the current player's mark in cell `c`, then resolve the turn.
-- assumes c is a legal (empty) cell.
function place(c)
    board[c] = turn        -- stamp the current player's mark
    sfx(1)
    check_win()
    if state == "win" then
        sfx(2)
    elseif state == "draw" then
        sfx(3)
    else
        turn = 3 - turn    -- hand off to the other player
    end
end

function _update()
    if state == "play" then
        -- cpu's turn? ask the web page (or fall back to local minimax).
        if p2_is_ai and turn == 2 then
            update_ai()
            return                          -- ignore human input on cpu's turn
        end

        local col = cell_col(cursor)
        local row = cell_row(cursor)
        local prev = cursor

        if btnp(0) then col = max(0, col - 1) end -- left
        if btnp(1) then col = min(2, col + 1) end -- right
        if btnp(2) then row = max(0, row - 1) end -- up
        if btnp(3) then row = min(2, row + 1) end -- down
        
        -- convert col/row back into a 1-9 cell index.
        cursor = row * 3 + col + 1

        if cursor != prev then
            sfx(0)                        -- moved to a new cell
        elseif btnp(0) or btnp(1) or btnp(2) or btnp(3) then
            sfx(5)                        -- pressed into an edge
        end

        if btnp(4) or btnp(5) then
            -- only allow placing on an empty cell
            if board[cursor] == 0 then
                place(cursor)
            else
                sfx(4)
            end
        end
    else
        -- state is "win" or "draw"
        if btnp(4) or btnp(5) then
            reset()
            sfx(6)
        end
    end
end

-- draw_mark(i, col): draw the mark in cell i, recolored toward `col`
-- player 1 = x, player 2 = o
function draw_mark(i, col)
    local mark = board[i]
    if mark == 0 then return end -- empty cell, nothing to draw
    local x, y = cell_pos(i) -- top-left of the cell
    local p = 1             -- inset from the cell edges
    local d = cs - 1 - 2*p       -- destination size (square, even -> equal gaps)
    
    -- source rect (pixel coords on the sheet) + the sprite's native ink
    local sx, sy, base
    if mark == 1 then
        sx, sy, base = 8, 0, 8    -- x sprite at (8,0), drawn red (8)
    else
        sx, sy, base = 40, 0, 12  -- o sprite at (40,0), drawn blue (12)
    end

    -- only swap when the requested color differs (i.e. the win highlight)
    if col != base then pal(base, col) end
    sspr(sx, sy, 32, 32, x+p+1, y+p+1, d, d)
    pal() -- reset so the swap doesn't leak into later draws
end

function _draw()
    cls(0)

    -- score tallies in the top corners
    local s1 = ""..scores[1]
    local s2 = ""..scores[2]
    print(s1, 2, 2, 8)            -- player 1, top-left, red (8)
    print(s2, 126 - #s2*4, 2, 12) -- player 2, top-right, blue (12)

    -- grid: outer border + two inner verticals + two inner horizontals
    rect(ox, oy, ox+3*cs, oy+3*cs, 6) -- outer border encloses all 9 cells
    for k=1,2 do
        local gx = ox + k*cs -- x of the k-th vertical line
        local gy = oy + k*cs -- y of the k-th horizontal line
        line(gx, oy, gx, oy+3*cs, 6) -- vertical, full board height
        line(ox, gy, ox+3*cs, gy, 6) -- horizontal, full board width
    end

    -- marks
    for i=1,9 do
        -- x is red (8), o is blue (12)
        draw_mark(i, board[i]==1 and 8 or 12)
    end

    -- win highlight: redraw the winning three in yellow
    if win_line != 0 then
        for idx in all(win_line) do
            draw_mark(idx, 10) -- 10 = yellow
        end
    end

    -- cursor: outline the hovered cell (only while playing)
    if state == "play" then
        local cx, cy = cell_pos(cursor)
        -- tint by whose turn it is: x red, o blue.
        local ccol = turn==1 and 8 or 12
        rect(cx, cy, cx+cs, cy+cs, ccol)
    end

    -- status line at the bottom
    local msg
    if state == "win" then
        msg = "player "..winner.." wins! press z/x"
    elseif state == "draw" then
        msg = "draw! press z/x"
    elseif p2_is_ai and turn == 2 then
        msg = "cpu thinking..."
    else
        msg = "player "..turn.."'s turn"
    end
    -- center horizontally: each char is 4px wide, so the string is
    -- #msg*4 px; (128 - #msg*4)/2 simplifies to 64 - #msg*2.
    print(msg, 64 - #msg*2, 120, 7)
end



__gfx__
000000008880000000000000000000000000088800000000000cccccccccc0000000000000000000000000000000000000000000000000000000000000000000
000000008888000000000000000000000000888800000000cccccccccccccccc0000000000000000000000000000000000000000000000000000000000000000
00700700888880000000000000000000000888880000000cccccccccccccccccc000000000000000000000000000000000000000000000000000000000000000
000770000888880000000000000000000088888000000cccccccc000000cccccccc0000000000000000000000000000000000000000000000000000000000000
00077000008888800000000000000000088888000000cccccc000000000000cccccc000000000000000000000000000000000000000000000000000000000000
0070070000088888000000000000000088888000000cccccc00000000000000cccccc00000000000000000000000000000000000000000000000000000000000
0000000000008888800000000000000888880000000cccc000000000000000000cccc00000000000000000000000000000000000000000000000000000000000
000000000000088888000000000000888880000000cccc00000000000000000000cccc0000000000000000000000000000000000000000000000000000000000
00000000000000888880000000000888880000000ccccc00000000000000000000ccccc000000000000000000000000000000000000000000000000000000000
00000000000000088888000000008888800000000cccc0000000000000000000000cccc000000000000000000000000000000000000000000000000000000000
00000000000000008888800000088888000000000ccc000000000000000000000000ccc000000000000000000000000000000000000000000000000000000000
0000000000000000088888000088888000000000cccc000000000000000000000000cccc00000000000000000000000000000000000000000000000000000000
0000000000000000008888800888880000000000cccc000000000000000000000000cccc00000000000000000000000000000000000000000000000000000000
0000000000000000000888888888800000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000000088888888000000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000000008888880000000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000000008888880000000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000000088888888000000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000000888888888800000000000ccc00000000000000000000000000ccc00000000000000000000000000000000000000000000000000000000
0000000000000000008888800888880000000000cccc000000000000000000000000cccc00000000000000000000000000000000000000000000000000000000
0000000000000000088888000088888000000000cccc000000000000000000000000cccc00000000000000000000000000000000000000000000000000000000
00000000000000008888800000088888000000000ccc000000000000000000000000ccc000000000000000000000000000000000000000000000000000000000
00000000000000088888000000008888800000000cccc0000000000000000000000cccc000000000000000000000000000000000000000000000000000000000
00000000000000888880000000000888880000000ccccc00000000000000000000ccccc000000000000000000000000000000000000000000000000000000000
000000000000088888000000000000888880000000cccc00000000000000000000cccc0000000000000000000000000000000000000000000000000000000000
0000000000008888800000000000000888880000000cccc000000000000000000cccc00000000000000000000000000000000000000000000000000000000000
0000000000088888000000000000000088888000000cccccc00000000000000cccccc00000000000000000000000000000000000000000000000000000000000
00000000008888800000000000000000088888000000cccccc000000000000cccccc000000000000000000000000000000000000000000000000000000000000
000000000888880000000000000000000088888000000cccccccc000000cccccccc0000000000000000000000000000000000000000000000000000000000000
00000000888880000000000000000000000888880000000cccccccccccccccccc000000000000000000000000000000000000000000000000000000000000000
000000008888000000000000000000000000888800000000cccccccccccccccc0000000000000000000000000000000000000000000000000000000000000000
000000008880000000000000000000000000088800000000000cccccccccc0000000000000000000000000000000000000000000000000000000000000000000
__sfx__
0002000024550245501e2001e2001e2001e2001a2001920018200182001720017200172001d200172001d20017200172001d20018200192001d2001a2001d2001d2001c2001c2001c2001c2001d2001d2001e200
00070000243502b350000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0009000024450284502b4503045030440304303042500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
000c00001c15018155000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500000000000000000000
000800000c65000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
010600001303007000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
010800001825030240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
