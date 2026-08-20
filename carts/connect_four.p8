pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- connect four -- defaults to vs cpu; pause menu toggles 2-player
-- by ethan lott

-- game state
cols, rows = 7, 6
board = {}      -- board[c][r]: r=1 is the BOTTOM row. 0 empty, 1 human, 2 ai
heights = {}    -- heights[c] = discs currently in column c (0..6)
turn = 1
cursor = 4      -- hovered column, 1..7
state = "play"  -- "play" | "drop" | "win" | "draw"
winner = 0
win_cells = 0   -- list of {c,r} forming the winning four (0 = none)
anim = nil      -- falling disc, or nil

-- reset() must BUILD the inner tables, not just fill them: `board = {}`
-- has no board[c], so board[c][r]=0 would index nil on the first pass.
function reset()
    for c=1,cols do
        board[c] = {}
        for r=1,rows do board[c][r] = 0 end
        heights[c] = 0
    end
    turn = 1
    cursor = 4
    state = "play"
    winner = 0
    win_cells = 0
    anim = nil              -- the pause menu can open mid-drop, and
                            -- toggle_mode() calls reset(); without this
                            -- (and state above) we'd resume into "drop"
                            -- holding an anim pointing at a zeroed cell.
    ai_state = "idle"       -- "idle" or "waiting" for a move from the web page
    ai_frames = 0           -- frames spent waiting on the current request
    ai_acked = false        -- has the page acknowledged our request?
end

function _init()
    scores = {0, 0} -- scores[1]=player 1 wins, scores[2]=player 2 wins
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

-->8
-- board model and gravity

function legal(c)
    return heights[c] < rows
end

-- put a disc for `who` in column c; returns the row it lands on.
-- heights is redundant with board but makes gravity and legality O(1);
-- drop_at/undrop are the ONLY two places that may touch it.
function drop_at(c, who)
    local r = heights[c] + 1
    board[c][r] = who
    heights[c] = r
    return r
end

function undrop(c)
    board[c][heights[c]] = 0
    heights[c] -= 1
end

-- horizontal, vertical, both diagonals. gravity guarantees any new four
-- passes through the disc just played, so we scan out from it rather than
-- enumerating connect four's 69 lines.
dirs = {{1,0}, {0,1}, {1,1}, {1,-1}}

-- run_at(c,r,who): the cells forming a four-or-longer run through (c,r), else nil.
function run_at(c, r, who)
    for d in all(dirs) do
        local run = {{c, r}}
        for s=-1,1,2 do
            local cc, rr = c + d[1]*s, r + d[2]*s
            while cc >= 1 and cc <= cols and rr >= 1 and rr <= rows
                  and board[cc][rr] == who do
                add(run, {cc, rr})
                cc += d[1]*s
                rr += d[2]*s
            end
        end
        if #run >= 4 then return run end
    end
    return nil
end

-- same scan as run_at, but boolean: the fallback calls this per node and
-- allocating a table each time would be wasteful.
function wins_at(c, r, who)
    for d in all(dirs) do
        local n = 1
        for s=-1,1,2 do
            local cc, rr = c + d[1]*s, r + d[2]*s
            while cc >= 1 and cc <= cols and rr >= 1 and rr <= rows
                  and board[cc][rr] == who do
                n += 1
                cc += d[1]*s
                rr += d[2]*s
            end
        end
        if n >= 4 then return true end
    end
    return false
end

-- called when a disc LANDS (end of the animation), not when it's released.
function resolve(c, r)
    local run = run_at(c, r, turn)
    if run then
        winner = turn
        state = "win"
        win_cells = run
        scores[turn] += 1
        sfx(2)
        return
    end

    -- draw = EVERY column full. testing heights[c] -- the parameter -- would
    -- declare a draw the moment any single column fills. `i` on purpose.
    local full = true
    for i=1,cols do if heights[i] < rows then full = false end end
    if full then
        state = "draw"
        sfx(3)
        return
    end

    turn = 3 - turn
end

-->8
-- the fallback opponent
-- exists for AVAILABILITY, not to be the player: it runs when the page is
-- absent, rate-limited, timed out, errored, or named an illegal column.
-- one ply of tactics -- deliberately weak. a stronger fallback playing a
-- chunk of every game would make the cart the player.

order = {4, 3, 5, 2, 6, 1, 7}   -- centre-out; centre columns sit on more lines

-- would `who` win immediately by playing column c?
function wins_with(c, who)
    if not legal(c) then return false end
    local r = drop_at(c, who)
    local w = wins_at(c, r, who)
    undrop(c)
    return w
end

function fallback_move()
    for c in all(order) do if wins_with(c, 2) then return c end end   -- take the win
    for c in all(order) do if wins_with(c, 1) then return c end end   -- block theirs
    for c in all(order) do                                            -- don't set them up
        if legal(c) then
            drop_at(c, 2)
            local gift = wins_with(c, 1)   -- can they win directly on top?
            undrop(c)
            if not gift then return c end
        end
    end
    -- every column gifts a win; forced.
    for c in all(order) do if legal(c) then return c end end
end
-- the third loop checking only column c is correct, not narrow: loop 2 already
-- established the opponent has no immediate win anywhere, and dropping in c
-- opens exactly one new cell. do not "fix" it into a full board scan.

-->8
-- gpio bridge to the web page; must stay in sync with src/lib/gpio.ts.
--   byte 0       status: 0 idle · 1 request · 2 thinking · 3 ready
--   bytes 1..42  board, row-major from the TOP-LEFT:
--                  index = 1 + row_from_top*7 + col_from_left  (both 0-based)
--                  values 0 empty · 1 human · 2 ai
--   byte 43      move column, 0-based. the page writes the column to play, or
--                a value >6 meaning "play your own fallback"; we overwrite it
--                with the column ACTUALLY played before going idle, so the
--                page can read it back.
gpio = 0x5f80
gp_status = 0
gp_move = 43
st_idle, st_request, st_thinking, st_ready = 0, 1, 2, 3

-- how long to wait (frames @30fps) on a web move before falling back locally:
ai_ack_frames = 15   -- ~0.5s: no ack -> assume no page (e.g. desktop pico-8)
-- must exceed the page's request timeout (getAiTurn, ~10s) so the page always
-- gets to answer and read back what was played; if it bails first it can't.
-- only a dead page should reach this. the drop animation must not run inside
-- this budget -- see _update.
ai_max_frames = 450  -- ~15s: page acked but never answered -> don't hang

-- the wire is row-major from the TOP; our board is column-major from the
-- BOTTOM. this transform lives here and NOWHERE else.
function publish_board()
    for rt=0,rows-1 do                 -- rt = row from the top
        for c=1,cols do
            poke(gpio + 1 + rt*cols + (c-1), board[c][rows-rt])
        end
    end
end

-- publish the board and ask the page for a move.
function request_web_move()
    publish_board()
    poke(gpio+gp_status, st_request)
    ai_state = "waiting"
    ai_frames = 0
    ai_acked = false
end

-- drive the cpu's turn. runs each _update while it's player 2 (ai) to move.
function update_ai()
    if ai_state == "idle" then
        request_web_move()
        return
    end

    ai_frames += 1                                     -- without this neither
                                                       -- timeout can ever fire
    local status = peek(gpio+gp_status)
    if status >= st_thinking then ai_acked = true end  -- tells "no page" apart
                                                       -- from "page thinking"

    -- `local` is load-bearing: an unqualified assignment here would be a
    -- GLOBAL that survives the turn, so the frame after request_web_move()
    -- -- when no branch below assigns -- would still see last turn's column
    -- and replay it instantly, never waiting for the page.
    local col = nil
    if status == st_ready then
        local m = peek(gpio+gp_move)        -- 0-based column from the page
        if m >= 0 and m <= 6 and legal(m+1) then
            col = m + 1
        else
            col = fallback_move()           -- page sent garbage; recover
        end
    elseif not ai_acked and ai_frames >= ai_ack_frames then
        col = fallback_move()               -- no bridge listening
    elseif ai_frames >= ai_max_frames then
        col = fallback_move()               -- bridge stalled
    end

    if col then
        -- order matters: move byte first, then status, so the page never
        -- observes idle alongside a stale column.
        poke(gpio+gp_move, col-1)           -- the column we ACTUALLY played
        poke(gpio+gp_status, st_idle)       -- release the bridge; page reads it back
        ai_state = "idle"
        begin_drop(col)
    end
end

-->8
-- layout, drop animation, update, draw

-- 7 cols * 16 = 112 wide, 6 rows * 16 = 96 tall.
ox = 8      -- (128-112)/2
oy = 20     -- leaves room above for the hovering cursor disc and the scores
cs = 16
cur_y = 12  -- centre y of the hovering cursor disc / where a drop starts
grav = 1.4  -- ~5 frames for the top row, ~12 for the bottom

-- centre of cell (c, r), r=1 at the bottom
function cell_pos(c, r)
    return ox + (c-1)*cs + 7, oy + (rows-r)*cs + 7
end

function col_x(c)
    return ox + (c-1)*cs + 7
end

-- ASSUMES legal(c) -- every caller checks: input tests legal(cursor), the
-- gpio path tests legal(m+1), and fallback_move() only returns a legal
-- column. reaching here on a full column writes board[c][7], which is
-- invisible to run_at and publish_board and kills the column for good.
-- commits the move to the model immediately so all logic stays consistent;
-- the animation is only the disc's picture catching up.
function begin_drop(c)
    local r = drop_at(c, turn)
    state = "drop"
    anim = {c = c, r = r, who = turn, y = cur_y, vy = 0}
end

function update_drop()
    anim.vy += grav
    anim.y += anim.vy
    local _, ty = cell_pos(anim.c, anim.r)
    if anim.y >= ty then
        local c, r = anim.c, anim.r
        anim = nil
        state = "play"
        sfx(1)
        resolve(c, r)       -- resolve AFTER landing, and after state is back
    end
end

function _update()
    -- the ai loop must not run during a drop: it would see ai_state == "idle"
    -- and fire a second request for a move already played. gating here also
    -- keeps ai_frames from advancing during the animation, which would
    -- quietly shrink the timeout budget every turn.
    if state == "drop" then
        update_drop()
        return
    end

    if state == "play" then
        if p2_is_ai and turn == 2 then
            update_ai()
            return                          -- ignore human input on cpu's turn
        end

        -- cursor moves along columns only; up/down are unused.
        local prev = cursor
        if btnp(0) then cursor = mid(1, cursor-1, cols) end -- left
        if btnp(1) then cursor = mid(1, cursor+1, cols) end -- right

        if cursor != prev then
            sfx(0)                          -- moved to a new column
        elseif btnp(0) or btnp(1) then
            sfx(5)                          -- pressed into an edge
        end

        if btnp(4) or btnp(5) then
            if legal(cursor) then
                begin_drop(cursor)
            else
                sfx(4)                      -- column full
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

function disc_col(v)
    if v == 1 then return 8 end     -- player 1 red
    if v == 2 then return 12 end    -- player 2 blue
    return 0                        -- empty hole
end

function _draw()
    cls(0)

    -- score tallies in the top corners
    local s1 = ""..scores[1]
    local s2 = ""..scores[2]
    print(s1, 2, 2, 8)            -- player 1, top-left, red (8)
    print(s2, 126 - #s2*4, 2, 12) -- player 2, top-right, blue (12)

    -- board frame. grey (6) so it can't collide with a player colour.
    rectfill(ox, oy, ox+cols*cs-1, oy+rows*cs-1, 6)

    -- holes and discs in one pass. the cell a falling disc is bound for is
    -- drawn empty until it lands -- drop_at() already stamped it.
    for c=1,cols do
        for r=1,rows do
            local x, y = cell_pos(c, r)
            local v = board[c][r]
            if anim and anim.c == c and anim.r == r then v = 0 end
            circfill(x, y, 6, disc_col(v))
        end
    end

    -- win highlight: redraw the winning four in yellow
    if win_cells != 0 then
        for cell in all(win_cells) do
            local x, y = cell_pos(cell[1], cell[2])
            circfill(x, y, 6, 10)
        end
    end

    -- the falling disc
    if anim then
        circfill(col_x(anim.c), anim.y, 6, disc_col(anim.who))
    end

    -- hovering cursor disc, tinted by whose turn it is
    if state == "play" and not (p2_is_ai and turn == 2) then
        circfill(col_x(cursor), cur_y, 6, disc_col(turn))
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

__sfx__
0002000024550245501e2001e2001e2001e2001a2001920018200182001720017200172001d200172001d20017200172001d20018200192001d2001a2001d2001d2001c2001c2001c2001c2001d2001d2001e200
00070000243502b350000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0009000024450284502b4503045030440304303042500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
000c00001c15018155000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500005000050000500000000000000000000
000800000c65000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
010600001303007000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
010800001825030240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
