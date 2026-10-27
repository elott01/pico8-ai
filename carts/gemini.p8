pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- gem-in-eye's hub: the room the game starts in, his shop and claude's talk.
-- the left door loads gemini_dungeon.p8, and dying or walking home there
-- loads this back. the run crosses each load() in its param: see carry.
-- load() looks in pico-8's current folder, so run this from carts/ (pico8
-- -root_path <repo>/carts). the export bundles the dungeon in
function _init()
	init_shared()

	-- ex,ey: arrival. each door runs its act
	room = {mx = 16, my = 0, ex = 8, ey = 64,
		doors = {{tx = 0, ty = 8, act = start_run}, {tx = 8, ty = 1, act = enter_wizard}},
		labels = {
			{txt = "vitality: ", val = function() return tier_str(health_tier) end,
			 x = 10, y = 93, col = health_col},
			{txt = "stamina: ", val = function() return tier_str(stamina_tier) end,
			 x = 10, y = 100, col = stamina_col},
			{txt = "armor: ", val = function() return tier_str(armor_tier) end,
			 x = 68, y = 93, col = armor_col},
			{txt = "attack: ", val = function() return tier_str(attack_tier) end,
			 x = 68, y = 100, col = attack_col},
			{txt = "rollbacks: ", val = function() return rollbacks end,
			 x = 10, y = 107},
			{txt = "pruned: ", val = function() return pruned end,
			 x = 10, y = 114},
			{txt = "uptime: ", val = uptime_str,
			 x = 68, y = 107},
			{txt = "max depth: ", val = function() return max_depth end,
			 x = 68, y = 114},
		},
		-- ofs: how far he's paced from home
		claude = {x = 16, y = 24, ofs = 0, dir = 1,
			move_t = 0, walk_t = 0, pause_t = 0, act = enter_talk},
		-- by tile, since the flag can't tell them apart. act returns the msg
		signs = {
			{tx = 2,  ty = 7,  msg = "gem-in-eye keeps this room clean. no merges, no conflicts. rest as long as you like."},
			{tx = 10, ty = 3,  msg = "gem-in-eye's artifacts ^"},
			{tx = 11, ty = 10, msg = "these are your stats. gem-in-eye sells upgrades to the colored ones."},
			{tx = 13, ty = 6, w = 2, h = 2, act = use_vault},
		}}

	vault_caps = {[0] = 10, 20, 40, 80}

	-- key names the tier global, read via _ENV. tint recolours white art.
	-- look names the worn-tier global; its shelf adds tier 0, art[0]
	shop = {
		{name = "vitality", key = "health_tier",  col = health_col,
		 art = split"13,13,13", tint = true},
		{name = "stamina",  key = "stamina_tier", col = stamina_col,
		 art = split"14,14,14", tint = true},
		{name = "armor",    key = "armor_tier",   col = armor_col,
		 art = {[0] = 7, 8, 9, 10}, look = "armor_look"},
		{name = "attack",   key = "attack_tier",  col = attack_col,
		 art = {[0] = 15, 4, 5, 6}, look = "attack_look"},
		{name = "stash",    key = "vault_tier",
		 art = split"72,72,72", size = 2},
	}

	init_wizard()

	arrive()
	x, y = room.ex, room.ey
	show_banner("main branch")
end

function _update()
	frame += 1
	if banner_t > 0 then banner_t -= 1 end

	if scene then
		scene.update()
		return
	end

	-- a dialog freezes the room
	if dialog then
		update_dialog()
		return
	end

	move_player()

	local d = door_at(x + 4, y + 4)
	if d then d.act(d) end

	-- ❎ talks if something's in reach, else swings
	near_talk = talk_at(x, y)
	if near_talk and btnp(❎) then
		-- act may return a message, or nil if it opened its own box
		local msg = near_talk.msg
		if near_talk.act then msg = near_talk.act(near_talk) end
		if msg then open_dialog(msg) end
	elseif btnp(❎) and stamina > 0 then
		swing()
	end

	tick_player()
	update_claude(room.claude)
end

function _draw()
	if scene then
		scene.draw()
		return
	end

	cls()
	draw_hud()
	map(room.mx, room.my, 0, 0, 16, 16)
	draw_claude(room.claude)
	for l in all(room.labels) do
		local c = l.col or 7
		print(l.val(), print(l.txt, l.x, l.y, c) - num_gap, l.y, c)
	end
	draw_player()

	if banner_t > 0 then centre(banner_msg, 60, 7) end

	if not dialog and near_talk and frame % 30 < 20 then
		local hx, hy = hint_pos(near_talk)
		draw_x_hint(hx, hy, 7)
	end
	if dialog then draw_dialog(dialog) end
end

-- the dungeon is gemini_dungeon.p8. it starts a run as it loads
function start_run() go("gemini_dungeon.p8") end

function tier_str(tier)
	return tier.."/"..tier_max
end

-- minutes uncapped (fine for ~9 hours). up0 is what earlier carts ran
function uptime_str()
	local s = flr(up0 + time())
	local ss = s % 60
	return s \ 60 ..":"..(ss < 10 and "0" or "")..ss
end

-- claude paces the hub. 98/100 lift diagonal foot pairs
claude_cycle = split"96,98,96,100"
claude_travel = 8	-- px out from home and back
claude_hold = 3		-- frames per px
claude_step = 2		-- px per cycle frame
claude_pause = 150	-- frames paused at each end

-- his art's box in the 16x16 block, for collision and reach
claude_x1, claude_y1 = 2, 0
claude_x2, claude_y2 = 13, 12

function claude_box(c)
	local bx = c.x + c.ofs
	return bx + claude_x1, c.y + claude_y1, bx + claude_x2, c.y + claude_y2
end

-- poses past ~6 frames read as slow motion: slow him with claude_pause

function update_claude(c)
	if c.pause_t > 0 then
		c.pause_t -= 1
		return
	end

	c.move_t += 1
	if c.move_t < claude_hold then return end
	c.move_t = 0

	-- waits instead of pushing, so he can't trap you
	local nx = c.x + c.ofs + c.dir
	if x + 7 >= nx + claude_x1 and x <= nx + claude_x2
	and y + 7 >= c.y + claude_y1 and y <= c.y + claude_y2 then
		return
	end

	c.ofs += c.dir

	c.walk_t = (c.walk_t + 1) % (claude_step * #claude_cycle)

	-- reset at the turn, or the last step flashes
	if c.ofs <= 0 or c.ofs >= claude_travel then
		c.dir = -c.dir
		c.pause_t = claude_pause
		c.walk_t = 0	-- the standing pose
	end
end

function draw_claude(c)
	local f = c.walk_t \ claude_step % #claude_cycle + 1
	-- flipping only moves his eyes: he looks back where he came from
	spr(claude_cycle[f], c.x + c.ofs, c.y, 2, 2, c.dir < 0)
end

function is_solid(px, py)
	if fget(tile_at(px, py), 0) then return true end
	-- claude is solid, which sign_reach relies on
	local x1, y1, x2, y2 = claude_box(room.claude)
	return px >= x1 and px <= x2 and py >= y1 and py <= y2
end

-- reach: grow the player's box by sign_reach and look for a sign
sign_reach = 4

function sign_at(px, py)
	for ty = (py - sign_reach) \ 8, (py + 7 + sign_reach) \ 8 do
		for tx = (px - sign_reach) \ 8, (px + 7 + sign_reach) \ 8 do
			if fget(tile_at(tx * 8, ty * 8), 2) then
				for s in all(room.signs) do
					if tx >= s.tx and tx < s.tx + (s.w or 1)
					and ty >= s.ty and ty < s.ty + (s.h or 1) then
						return s
					end
				end
			end
		end
	end
end

function talk_at(px, py)
	local x1, y1, x2, y2 = claude_box(room.claude)
	if px + 7 + sign_reach >= x1 and px - sign_reach <= x2
	and py + 7 + sign_reach >= y1 and py - sign_reach <= y2 then
		return room.claude
	end
	return sign_at(px, py)
end

-- one tile up, centred. tracks claude as he paces
function hint_pos(t)
	if t == room.claude then
		local x1, y1 = claude_box(t)
		return x1 + 2, y1 - 8
	end
	return t.tx * 8 + ((t.w or 1) - 1) * 4, t.ty * 8 - 8
end

-- stash: one press stores all that fits (holding back never helps)
function vault_cap()
	return vault_caps[vault_tier]
end

function tokens_str(n)
	return n.." token"..(n == 1 and "" or "s")
end

function use_vault()
	local n = min(tokens, vault_cap() - vault)
	vault += n
	tokens -= n
	local count = ". stash "..vault.."/"..vault_cap()
	if n > 0 then return "stored "..tokens_str(n)..count end
	if tokens > 0 then return "no room left"..count end
	return "nothing to store"..count
end

-- the purse is spent before the stash
function afford(n) return tokens + vault >= n end

function spend(n)
	local p = min(tokens, n)
	tokens -= p
	vault -= n - p
end

box_max_w = 116		-- text wraps past this
box_pad = 4
box_bg = 1
box_edge = 12
box_col = 7
line_h = 6			-- baseline to baseline
glyph_h = 5			-- ink height of a line
char_w = 4
mark_w = 5			-- the "done" marker
mark_h = 3
mark_gap = 2		-- gap before it
msg_speed = 2		-- frames per character

-- ^ draws as an up arrow (p8scii's ⬆️ is a button)
arrow_char = "^"
arrow_w = 6			-- arrow plus letter gap

-- measured by printing off-screen. ^ counts as an arrow's width
function text_w(s)
	local w = print(s, 0, -20)
	for j = 1, #s do
		if sub(s, j, j) == arrow_char then w += arrow_w - char_w end
	end
	return w - 1		-- drop the trailing gap
end

box_chars = (box_max_w - box_pad * 2) \ char_w

function open_dialog(msg)
	dialog = fit_box({lines = wrap_text(msg, box_chars)})
end

-- size a box to its lines. boxes are tables, so a scene can show two
function fit_box(b)
	local len, widest = 0, 0
	for l in all(b.lines) do
		len += #l
		widest = max(widest, text_w(l))
	end
	-- the marker sits after the last line. menus have none
	b.last_w = text_w(b.lines[#b.lines])
	if not b.is_menu then widest = max(widest, b.last_w + mark_gap + mark_w) end
	b.len = len
	b.w = widest + box_pad * 2
	b.h = box_pad * 2 + (#b.lines - 1) * line_h + glyph_h
	b.x = flr(64 - b.w / 2)
	b.y = flr(64 - b.h / 2)
	-- characters revealed. a menu shows at once
	b.n = b.is_menu and len or 0
	b.t = 0
	return b
end

-- rows keep a 2-char caret slot so moving never resizes. pick(i) on ❎
function open_menu(rows, pick, cols)
	menu = {rows = rows, sel = 1, pick = pick, cols = cols,
		lines = {}, is_menu = true}
	menu_lines(menu)
	fit_box(menu)
end

function menu_lines(m)
	for i = 1, #m.rows do
		m.lines[i] = (i == m.sel and "> " or "  ")..m.rows[i]
	end
end

-- ⬆️⬇️ move, ❎ picks. 🅾️ is the caller's
function update_menu(m)
	local s = m.sel
	if btnp(⬆️) then s -= 1 end
	if btnp(⬇️) then s += 1 end
	m.sel = mid(1, s, #m.rows)
	menu_lines(m)
	if btnp(❎) then m.pick(m.sel) end
end

function dialog_done(d)
	return d.n >= d.len
end

-- the reveal alone, for scenes that handle buttons themselves
function advance_dialog(d)
	if not dialog_done(d) then
		d.t += 1
		if d.t >= msg_speed then
			d.t = 0
			d.n += 1
		end
	end
end

function update_dialog()
	advance_dialog(dialog)
	-- first press finishes, second closes
	if btnp(❎) then
		if dialog_done(dialog) then
			dialog = nil
		else
			dialog.n = dialog.len
		end
	end
end

-- wrapped up front so lines don't reflow
function wrap_text(str, maxc)
	local lines, ln, word = {}, "", ""
	for i = 1, #str + 1 do
		local c = i <= #str and sub(str, i, i) or " "
		if c == " " then
			if #word > 0 then
				if #ln == 0 then
					ln = word
				elseif #ln + 1 + #word <= maxc then
					ln = ln.." "..word
				else
					add(lines, ln)
					ln = word
				end
				word = ""
			end
		else
			word = word..c
		end
	end
	if #ln > 0 then add(lines, ln) end
	return lines
end

-- ❎ badge a column wider than p8scii's so it centres. x punched in black
function draw_badge(hx, hy, col)
	rectfill(hx + 1, hy, hx + 6, hy + 4, col)			-- top and bottom
	rectfill(hx, hy + 1, hx + 7, hy + 3, col)			-- sides
end

function draw_x_hint(hx, hy, col)
	draw_badge(hx, hy, col)
	-- x,y pairs punched out of the badge
	local p = split"2,1,5,1,3,2,4,2,2,3,5,3"
	for i = 1, 12, 2 do pset(hx + p[i], hy + p[i + 1], 0) end
end

function draw_o_hint(hx, hy, col)
	draw_badge(hx, hy, col)
	rectfill(hx + 2, hy + 1, hx + 5, hy + 3, 0)
	line(hx + 3, hy + 2, hx + 4, hy + 2, col)
end

function draw_arrow(px, py)
	line(px + 2, py, px + 2, py + 4, box_col)		-- stem
	line(px, py + 2, px + 4, py + 2, box_col)		-- barbs
	line(px + 1, py + 1, px + 3, py + 1, box_col)
end

function draw_dialog(d)
	local x1 = d.x + d.w - 1
	local y1 = d.y + d.h - 1
	rectfill(d.x, d.y, x1, y1, box_bg)
	rect(d.x, d.y, x1, y1, box_edge)

	local left = d.n
	for i = 1, #d.lines do
		if left <= 0 then break end
		local ln = d.lines[i]
		local shown = sub(ln, 1, min(left, #ln))
		local px = d.x + box_pad
		local py = d.y + box_pad + (i - 1) * line_h
		-- optional per-line colour (shop rows)
		local col = d.cols and d.cols[i] or box_col
		-- print runs between ^ placeholders, with an arrow in each gap
		local run = ""
		for j = 1, #shown do
			local c = sub(shown, j, j)
			if c == arrow_char then
				px = print(run, px, py, col)
				run = ""
				draw_arrow(px, py)
				px += arrow_w
			else
				run = run..c
			end
		end
		print(run, px, py, col)
		left -= #ln
	end

	-- blinking "done" marker after the last line. not on menus
	if not d.is_menu and dialog_done(d) and frame % 30 < 20 then
		local mx = d.x + box_pad + d.last_w + mark_gap
		-- centred on the ink
		local my = d.y + box_pad + (#d.lines - 1) * line_h
			+ (glyph_h - mark_h) \ 2
		line(mx, my, mx + 4, my, box_col)
		line(mx + 1, my + 1, mx + 3, my + 1, box_col)
		pset(mx + 2, my + 2, box_col)
	end
end

-- the wizard scene (the shop) replaces the room while up
wiz_x = 48			-- head on screen
wiz_y = 17
sheet_x = 96		-- head on the sheet (sprite 76)
sheet_y = 32
eye_x = 21			-- pupil home, from the head origin
eye_y = 12

-- gaze: tl, bl, br, tr. he looks down at you from the bottom two, shifting
-- between them, and now and then glances up
sq = {{0,0},{0,1},{1,1},{1,0}}
gaze_rest = 60		-- frames he looks down, at least. up to twice that
gaze_look = 40		-- frames a glance up holds, at least. likewise
gaze_up = 3			-- 1 in gaze_up looks down ends in a glance up

-- glint on the flower eye. box relative to the head
shine_x = 11
shine_y = 11
shine_bw = 4
shine_bh = 4
shine_col = 7
shine_skip = 15		-- face peach, skipped so the glint stays on the eye
shine_w = 2			-- band thickness
shine_step = 1		-- diagonals per frame
shine_hold = 2		-- frames per step
shine_pause = 70	-- frames between sweeps

wiz_msg = "greetings, traveler. the road ahead is dark, but you need not walk it alone."

-- his line under the menu. purchases overwrite it
wiz_prompt = "how may i serve you?"

-- the gem is red: 14, 8, 2. a verdict recolours it for gem_glints sweeps of
-- the glint, then it's red again. impressed, neutral, unimpressed
gem_tints = {split"11,3,1", split"12,13,1", split"10,9,4"}
gem_glints = 3

-- which diagonals the glint box covers. reads the sheet, so runs in _init
function init_wizard()
	local dmin, dmax = 999, -999
	for ry = shine_y, shine_y + shine_bh - 1 do
		for rx = shine_x, shine_x + shine_bw - 1 do
			local c = sget(sheet_x + rx, sheet_y + ry)
			if c != 0 and c != shine_skip then
				dmin = min(dmin, rx + ry)
				dmax = max(dmax, rx + ry)
			end
		end
	end
	-- start just short of the head
	shine_d0 = dmin - shine_w + 1
	shine_frames = (dmax - shine_d0) \ shine_step + 1
end

function enter_wizard(door)
	wiz_door = door
	scene = {update = update_wizard, draw = draw_wizard_scene}
	shine_t, gem_t, gaze, gaze_t = 0, 0, 3, gaze_rest
	menu, shelf, pages = nil
	open_dialog(wiz_msg)
end

function exit_wizard()
	scene, dialog, menu, shelf = nil
	-- a tile below the door, so you don't walk straight back in
	x = wiz_door.tx * 8
	y = wiz_door.ty * 8 + 8
	-- facing out of the door, standing pose
	facing = "down"
	walk_t = 0
end

-- greeting, menu, shelf. ❎ in, 🅾️ out
function update_wizard()
	-- glint: burst, then pause. no pause while he thinks
	shine_t = (shine_t + 1) % (shine_frames * shine_hold + (asking and 0 or shine_pause))
	if gem_t > 0 then gem_t -= 1 end
	update_gaze()
	advance_dialog(dialog)
	if asking then
		update_ask()
	elseif pages then
		if turn_page() then
			if btnp(❎) and more then request(oc_next) else pages = nil end
		end
	elseif shelf then
		update_shelf()
	elseif menu then
		if btnp(🅾️) then exit_wizard() else update_menu(menu) end
	elseif btnp(❎) then
		open_shop()
	elseif btnp(🅾️) then
		exit_wizard()
	end
end

-- up: back down to either corner. down: to the other bottom corner, or up
function update_gaze()
	gaze_t -= 1
	if gaze_t > 0 then return end
	if sq[gaze][2] == 0 then
		gaze, gaze_t = rnd(split"2,3"), gaze_rest + rnd(gaze_rest)
	elseif rnd(gaze_up) < 1 then
		gaze, gaze_t = rnd(split"1,4"), gaze_look + rnd(gaze_look)
	else
		gaze, gaze_t = 5 - gaze, gaze_rest + rnd(gaze_rest)
	end
end

function mouth_frame()
	-- the mouth moves while text appears
	if dialog_done(dialog) then return 0 end
	return split"0,1,2,1"[frame \ 3 % 4 + 1]
end

-- the glint's leading diagonal, nil while paused
function shine_lead()
	local f = shine_t \ shine_hold
	if f >= shine_frames then return nil end
	return shine_d0 + f * shine_step
end

function draw_shine(lead)
	if lead == nil then return end
	for ry = shine_y, shine_y + shine_bh - 1 do
		local x1 = max(shine_x, lead - ry)
		local x2 = min(shine_x + shine_bw - 1, lead + shine_w - 1 - ry)
		for rx = x1, x2 do
			-- masked to the eye
			local c = sget(sheet_x + rx, sheet_y + ry)
			if c != 0 and c != shine_skip then
				pset(wiz_x + rx, wiz_y + ry, shine_col)
			end
		end
	end
end

function draw_wizard()
	local hx, hy = wiz_x, wiz_y

	-- 1. head, 0 transparent. a fresh verdict tints the gem
	local t = gem_t > 0 and gem_tints[verdict]
	if t then pal(14, t[1]) pal(8, t[2]) pal(2, t[3]) end
	spr(76, hx, hy, 4, 4)
	pal()

	-- 2. face interior again with 0 opaque, clipped
	clip(hx + 14, hy + 14, 7, 8)
	palt(0, false)
	spr(76, hx, hy, 4, 4)
	palt()
	clip()

	-- 3. glint
	draw_shine(shine_lead())

	-- 4. pupil
	local g = sq[gaze]
	rectfill(hx + 21, hy + 12, hx + 22, hy + 13, 7)
	pset(hx + eye_x + g[1], hy + eye_y + g[2], 12)

	-- 5. mouth. rectfill is opaque
	rectfill(hx + 15, hy + 21, hx + 18, hy + 21 + mouth_frame(), 0)
end

function draw_wizard_scene()
	cls(0)
	-- backdrop: sprites 128-255, drawn in the sprite editor. the map holds
	-- the room and the sfx region is free for sound
	memcpy(0x6000, 0x1000, 0x1000)
	draw_wizard()
	local xw = "buy"
	if shelf then
		draw_shelf()
		-- an owned tier with a look is worn, not bought
		if shelf.it.look and shelf.at <= _ENV[shelf.it.key] then xw = "equip" end
	end
	if pages then xw = "next" end
	-- no hints while input is locked
	draw_boxes(menu and not shelf, not asking and xw, shelf and "back" or "leave")
end

-- box over the hints, menu over the box. xw, ow: the ❎ and 🅾️ words
function draw_boxes(show_menu, xw, ow)
	dialog.y = 113 - dialog.h
	if show_menu then
		-- menu 3px over the box, same width
		local w = max(menu.w, dialog.w)
		menu.w, dialog.w = w, w
		menu.x = flr(64 - w / 2)
		dialog.x = menu.x
		menu.y = dialog.y - 2 - menu.h
		draw_dialog(menu)
	end
	draw_dialog(dialog)
	-- fixed x, spaced for the widest words, so neither moves. no xw, no hints
	if xw then
		draw_x_hint(30, 118, 7)
		print(xw, 41, 118, 6)
		draw_o_hint(68, 118, 7)
		print(ow, 79, 118, 6)
	end
end

-- the shop: a menu of upgrades, each opening a shelf

-- doubles like vault_caps: a full stash buys the next tier. a guess
tier_cost = split"10,20,40"

function price(t) return tier_cost[t] end

-- columns fit the longest name and top price, so rows never reflow
function shop_rows()
	local rows, nw, pw = {}, 0, max(3, #tostr(price(tier_max)))
	for it in all(shop) do nw = max(nw, #it.name) end
	for it in all(shop) do
		local t = _ENV[it.key]
		local n, p = it.name, tostr(t < tier_max and price(t + 1) or "max")
		while #n < nw do n = n.." " end
		while #p < pw do p = " "..p end
		add(rows, n.."   "..tier_str(t).."  "..p)
	end
	return rows
end

-- ❎ on the greeting: menu up, standing line below
function open_shop()
	local cols = {}
	for it in all(shop) do add(cols, it.col or box_col) end
	open_menu(shop_rows(), open_shelf, cols)
	open_dialog(wiz_prompt)
end

-- the cursor starts on the tier for sale. lo: a look's shelf starts at 0
function open_shelf(i)
	local it = shop[i]
	shelf = {it = it, i = i, at = min(_ENV[it.key] + 1, tier_max), lo = it.look and 0 or 1}
	open_dialog(shelf_line())
end

function shelf_line()
	local it, t = shelf.it, shelf.at
	return it.name.." "..t..". "
		..(it.look and t == _ENV[it.look] and "equipped."
			or t <= _ENV[it.key] and "owned." or tokens_str(price(t))..".")
end

-- ⬅️➡️ browse, ❎ buys, 🅾️ back to the menu
function update_shelf()
	local a = shelf.at
	if btnp(⬅️) then a -= 1 end
	if btnp(➡️) then a += 1 end
	a = mid(shelf.lo, a, tier_max)
	if a != shelf.at then
		shelf.at = a
		open_dialog(shelf_line())
	end
	if btnp(❎) then
		buy()
	elseif btnp(🅾️) then
		shelf = nil
		open_dialog(wiz_prompt)
	end
end

-- the next tier goes to gem-in-eye first (sell). ❎ on owned + look wears it
function buy()
	local it = shelf.it
	local t = _ENV[it.key] + 1
	if it.look and shelf.at < t then
		_ENV[it.look] = shelf.at
		open_dialog(shelf_line())
	end
	if shelf.at != t then return end
	local list = price(t)
	if not afford(list) then
		open_dialog("not enough. "..it.name.." "..t.." costs "..list..". you have "..(tokens + vault))
		return
	end
	poke2(gpio + gp_pruned, pruned)
	poke2(gpio + gp_rollbacks, rollbacks)
	poke2(gpio + gp_uptime, flr(up0 + time()))
	put(gp_max_depth, max_depth)
	put(gp_depth, depth)
	put(gp_purse, tokens)
	put(gp_stash, vault)
	for k = 1, #shop do put(gp_tiers + k - 1, _ENV[shop[k].key]) end
	put(gp_item, shelf.i)
	put(gp_tier, t)
	put(gp_list, list)
	request(oc_purchase)
end

-- a quote is held to half-to-full list. any fallback: list and own line
function sell(ok)
	local it, t = shelf.it, shelf.at
	local list, len, p, v = price(t), reply_len(ok), get(gp_price), get(gp_verdict)
	local cost = len > 0 and p > 0 and mid(ceil(list / 2), p, list) or list
	-- the glint restarts, so its first sweep crosses the new colour
	if len > 0 and gem_tints[v] then
		verdict, gem_t, shine_t = v, gem_glints * (shine_frames * shine_hold + shine_pause), 0
	end
	spend(cost)
	_ENV[it.key] = t
	-- wear what's just bought
	if it.look then _ENV[it.look] = t end
	apply_tiers()
	menu.rows = shop_rows()
	menu_lines(menu)
	if len > 0 then
		show_page(len)
	else
		open_dialog("bought "..it.name.." "..t..". "..tokens_str(tokens).." left. stash "..vault.."/"..vault_cap())
	end
	put(gp_price, cost)
	put(gp_len, len)
end

-- bridge; must match src/lib/gpio.ts. the protocol test parses these lines
gpio = 0x5f80
gp_status = 0
st_idle, st_request, st_thinking, st_ready = 0, 1, 2, 3
ai_ack_frames = 15
ai_max_frames = 450

gp_pruned = 1
gp_rollbacks = 3
gp_uptime = 5
gp_max_depth = 7
gp_depth = 8
gp_purse = 9
gp_stash = 10
gp_tiers = 11
gp_occasion = 16
oc_purchase, oc_next = 2, 3
gp_item = 17
gp_tier = 18
gp_list = 19

gp_verdict = 24
gp_price = 25
gp_flags = 26
gp_len = 27
gp_text = 28

function put(o, v) poke(gpio + o, v) end
function get(o) return peek(gpio + o) end

-- payload first, then status
function request(oc)
	put(gp_occasion, oc)
	put(gp_status, st_request)
	asking, ask_t = oc, 0
end

function update_ask()
	ask_t += 1
	local st = get(gp_status)
	local ok = st == st_ready
	if ok or ask_t >= (st < st_thinking and ai_ack_frames or ai_max_frames) then
		if asking == oc_purchase then sell(ok) else show_page(reply_len(ok)) end
		asking = nil
		put(gp_status, st_idle)
	end
end

function reply_len(ok) return ok and min(get(gp_len), 100) or 0 end

-- flags bit 0: more to fetch. none ends the speech on the page shown
function show_page(len)
	pages = nil
	if len > 0 then
		local s = ""
		for i = 0, len - 1 do s ..= chr(get(gp_text + i)) end
		open_dialog(s)
		pages, more = {}, get(gp_flags) % 2 > 0
	end
end

-- owned and for-sale draw as is, locked tiers dimmed
shelf_cy = 70		-- between the head and a 3-line box
shelf_gap = 24		-- px between slots

function draw_shelf()
	local it, lo = shelf.it, shelf.lo
	local s, t = it.size or 1, _ENV[it.key]
	local function sx(i) return 64 + (i - (lo + tier_max) / 2) * shelf_gap end
	for i = lo, tier_max do
		if i > t + 1 then
			for c = 1, 15 do pal(c, c < 6 and 1 or 5) end
		elseif it.tint then
			pal(7, it.col)
		end
		spr(it.art[i], sx(i) - s * 4, shelf_cy - s * 4, s, s)
		pal()
	end
	draw_arrow(sx(shelf.at) - 2, shelf_cy + s * 4 + 3)
end

-- claude's talk: his line, ❎ topics, ❎ answer, 🅾️ back out

-- asks max 26 chars. each say string starts a box. show(t) gates a topic
claude_hello = "hi there! you must be the new agent. i'm claude, pleased to meet you!"
claude_back = "hi again!"
claude_prompt = "what's on your mind?"
claude_topics = {
	{ask = "who are you?",
	 say = {"todo: what claude is. lore.md has this undecided."}},
	{ask = "who was the old agent?",
	 say = {"todo: the old agent joke.",
		"todo: a second box, to show an answer can run over several."},
	 show = function() return rollbacks > 0 end},
}
page_lines = 3

-- met isn't saved: a rollback keeps it, a reset doesn't. it's carried as
-- 0/1, since this cart reloads after every trip to the dungeon
function enter_talk()
	scene = {update = update_talk, draw = draw_talk}
	menu, pages = nil
	open_dialog(met > 0 and claude_back or claude_hello)
	met = 1
end

function exit_talk()
	scene, dialog, menu, pages = nil
end

-- rebuilt each time so topics can change. the caret keeps its row
function open_topics()
	local sel, rows = menu and menu.sel or 1, {}
	topics, menu = {}, nil
	for t in all(claude_topics) do
		if not t.show or t.show(t) then
			add(topics, t)
			add(rows, t.ask)
		end
	end
	open_dialog(claude_prompt)
	if #rows > 0 then
		open_menu(rows, ask_topic)
		menu.sel = min(sel, #rows)
		menu_lines(menu)
	end
end

function ask_topic(i)
	local t = topics[i]
	t.asked = true
	pages = {}
	for s in all(t.say) do
		local lines = wrap_text(s, box_chars)
		for j = 1, #lines, page_lines do
			local p = {}
			for k = j, min(j + page_lines - 1, #lines) do add(p, lines[k]) end
			add(pages, p)
		end
	end
	next_page()
end

function next_page()
	dialog = fit_box({lines = deli(pages, 1)})
end

-- ❎ finishes a page, then turns it. true past the last, or on 🅾️
function turn_page()
	if btnp(❎) and not dialog_done(dialog) then
		dialog.n = dialog.len
	elseif btnp(❎) and #pages > 0 then
		next_page()
	else
		return btnp(❎) or btnp(🅾️)
	end
end

function update_talk()
	advance_dialog(dialog)
	if pages then
		if turn_page() then
			pages = nil
			open_topics()
		end
	elseif menu then
		if btnp(🅾️) then exit_talk() else update_menu(menu) end
	elseif btnp(❎) then
		open_topics()
	elseif btnp(🅾️) then
		exit_talk()
	end
end

-- 2x, centred where the head goes
function draw_talk()
	cls(0)
	local s = claude_cycle[1]
	sspr(s % 16 * 8, s \ 16 * 8, 16, 16, wiz_x, wiz_y + 3, 32, 32)
	draw_boxes(menu and not pages, pages and "next" or "ask", pages and "back" or "leave")
end

-- >> shared: gemini.p8 and gemini_dungeon.p8 carry this section byte for
-- byte. it draws only from sprites 0-63, which are the same in both sheets.
-- tests/cart-bundle.test.ts holds both to that

-- the run's defaults. arrive() then overwrites them with what the other cart
-- carried over
function init_shared()
	-- vitality and stamina match their hud bars
	health_col = 8
	stamina_col = 11
	armor_col = 12
	attack_col = 9

	alive = true
	flipx = false
	facing = "side"
	speed = 1
	walk_t = 0
	attack = 0

	-- a tier counts upgrades bought, 0..tier_max. each adds one bar
	tier_max = 3
	health_base = 3
	stamina_base = 3
	health_tier = 0
	stamina_tier = 0

	-- armor does nothing yet. attack speeds up crate breaking
	armor_tier = 0
	armor_look = 0	-- worn tier. the rating stays armor_tier
	attack_tier = 0
	attack_look = 0	-- likewise the sword

	vault_tier = 0

	health_max, health = 0, 0
	stamina_max, stamina = 0, 0
	apply_tiers()

	hurt = 0
	stamina_rate = 45	-- frames per stamina point
	stam_t = 0

	num_gap = 3		-- px a count tucks toward its colon

	-- capped so the readout fits its corner
	token_max = 99
	token_digits = #tostr(token_max)

	bar_slots = max(health_base, stamina_base) + tier_max
	bar_w = bar_slots * 5 + 2	-- outline included

	-- sized for maxed bars so icons never move; the gutters absorb it
	icon_gap = 1
	stat_w = 8 + icon_gap + bar_w
	hud_gap = (128 - stat_w * 2 - (4 * (8 + token_digits) - num_gap - 1)) / 2
	local hx = 0
	health_x = hx + 8 + icon_gap
	hx += stat_w + hud_gap
	stamina_x = hx + 8 + icon_gap
	hx += stat_w + hud_gap
	token_hud_x = hx

	tokens = 0
	vault = 0		-- stash, safe from rollbacks
	pruned = 0
	rollbacks = 0
	max_depth = 0
	depth = 0		-- current room, from 1
	banner_t = 0
	banner_msg = ""
	frame = 0

	-- the hub's: whether claude has met you. it rides through the dungeon so
	-- a run doesn't reset it
	met = 0
	up0 = 0
end

-- 48 neutral, 49/50 tuck a foot in. only row 7, the feet, differs
walk_cycle = split"48,49,48,50"

-- head-on, a step lifts a foot instead
walk_cycle_ud = split"48,51,48,52"

walk_hold = 4		-- frames per step: one footfall per tile

-- button, dx, dy
pads = {{0, -1, 0}, {1, 1, 0}, {3, 0, 1}, {2, 0, -1}}

bodies = {side = 48, down = 11, up = 12}

-- armor 6, highlight 7, as in shelf art 8-10. blades are 7 too: drawn first
armor_pals = {[0] = split"6,7", split"3,11", split"8,14", split"10,7"}

-- hilt 4, blade 7, gem 8 (guard middle in 3, 29, 53, 54), as in art 4-6
sword_pals = {[0] = split"4,7,4", split"7,13,8", split"10,7,11", split"13,8,1"}

-- the down swing's wider stance has its own steps
swing_cycle = split"29,53,29,54"

-- dy: the blade's tile, which is also the hit box. feet: swing steps
swings = {
	down = {body = 29, blade = 45, dy = 8, feet = swing_cycle},
	up = {body = 44, blade = 28, dy = -8, feet = walk_cycle_ud},
}

function walk_set()
	local sw = attack > 0 and swings[facing]
	return sw and sw.feet or facing == "side" and walk_cycle or walk_cycle_ud
end

-- the hit box matches the drawn blade
function sword_ofs()
	local sw = swings[facing]
	if sw then return 0, sw.dy end
	return flipx and -8 or 8, 0
end

-- step frame for distance t along cycle c
function step_spr(c, t)
	return c[t \ walk_hold % #c + 1]
end

-- h rows of sprite n from row top: a body is rows 0-6, its feet row 7
function draw_rows(n, x, y, fx, top, h)
	sspr(n % 16 * 8, n \ 16 * 8 + top, 8, h, x, y + top, 8, h, fx)
end

-- you're never in a wall, so this only tests the leading edge
function move_player()
	local moved = false
	for p in all(pads) do
		local dx, dy = p[2] * speed, p[3] * speed
		if btn(p[1]) and box_free(x + dx, y + dy) then
			x += dx
			y += dy
			moved = true
		end
	end

	-- horizontal wins diagonals. from buttons, so you can turn at a wall
	if btn(⬅️) or btn(➡️) then
		facing = "side"
		flipx = not btn(➡️)
	elseif btn(⬇️) then
		facing = "down"
	elseif btn(⬆️) then
		facing = "up"
	end

	-- by distance so feet don't slide. wrapped: numbers top out at 32767
	walk_t = moved and (walk_t + 1) % (walk_hold * #walk_cycle) or 0
end

function swing()
	attack = 6
	stamina -= 1
end

-- stamina refills a point at a time; a swing and a hurt wear off
function tick_player()
	if stamina < stamina_max then
		stam_t += 1
		if stam_t >= stamina_rate then
			stamina += 1
			stam_t = 0
		end
	else
		stam_t = 0
	end
	if attack > 0 then attack -= 1 end
	if hurt > 0 then hurt -= 1 end
end

-- blinks while hurt
function draw_player()
	if hurt > 0 and hurt % 4 >= 2 then return end
	-- only the side view flips
	local sw, fx = attack > 0 and swings[facing], facing == "side" and flipx
	-- hilt and gem stay mapped for the body, which carries both
	local q = sword_pals[attack_look]
	pal(4, q[1])
	pal(7, q[2])
	pal(8, q[3])
	if sw then
		spr(sw.blade, x, y + sw.dy)
	elseif attack > 0 then
		spr(3, x + sword_ofs(), y, 1, 1, flipx)
	end
	local p = armor_pals[armor_look]
	pal(6, p[1])
	pal(7, p[2])
	draw_rows(sw and sw.body or attack > 0 and 2 or bodies[facing], x, y, fx, 0, 7)
	draw_rows(step_spr(walk_set(), walk_t), x, y, fx, 7, 1)
	pal()
end

function draw_hud()
	draw_bar(13, health_x, health, health_max, health_col)
	draw_bar(14, stamina_x, stamina, stamina_max, stamina_col)
	-- padded to the cap's width so the readout holds still
	local tv = tostr(tokens)
	while #tv < token_digits do tv = " "..tv end
	local tx = print("tokens: ", token_hud_x, 0, 10)
	print(tv, tx - num_gap, 0, 10)
end

-- centred on the screen, measured by printing off-screen (🅾️ is wide)
function centre(s, y, c)
	print(s, 64 - print(s, 0, -8) / 2, y, c)
end

-- bar lengths from tiers. a bar that grows refills; the other is untouched
function apply_tiers()
	local hmax = health_base + health_tier
	local smax = stamina_base + stamina_tier
	if hmax != health_max then health = hmax end
	if smax != stamina_max then stamina = smax end
	health_max = hmax
	stamina_max = smax
end

function draw_bar(icon, bx, n, nmax, col)
	pal(7, col)
	spr(icon, bx - 8 - icon_gap, 0)
	pal()
	rect(bx, 0, bx + 1 + nmax * 5, 6, 7)
	for i = 0, n - 1 do
		rectfill(bx + 2 + i * 5, 2, bx + 4 + i * 5, 4, col)
	end
end

banner_hold = 60	-- frames the room banner shows

function show_banner(msg)
	banner_msg = msg
	banner_t = banner_hold
end

-- room-relative: x,y are 0..127
function tile_at(px, py)
	return mget(room.mx + px \ 8, room.my + py \ 8)
end

-- is_solid is each cart's own: the hub's counts claude
function box_free(px, py)
	return not (is_solid(px, py) or is_solid(px + 7, py)
		or is_solid(px, py + 7) or is_solid(px + 7, py + 7))
end

function is_door(px, py)
	return fget(tile_at(px, py), 1)
end

-- the flag marks a door; the room's doors table says which
function door_at(px, py)
	if not is_door(px, py) then return end
	local tx, ty = px \ 8, py \ 8
	for d in all(room.doors) do
		if d.tx == tx and d.ty == ty then return d end
	end
end

-- what crosses a load(), in the order of its param. split leaves "false" a
-- truthy string, so a flag here is 0/1. where you arrive is the door's job
carry = split"tokens,vault,pruned,rollbacks,max_depth,depth,health,health_max,stamina,stamina_max,health_tier,stamina_tier,armor_tier,armor_look,attack_tier,attack_look,vault_tier,met,up"

-- time() restarts with each cart: up carries the uptime, up0 offsets it
function go(cart)
	up = up0 + time()
	local s = ""
	for k in all(carry) do s ..= tostr(_ENV[k]).."," end
	load(cart, nil, s)
end

-- true if another cart sent us here
function arrive()
	local v = split(stat(6))
	if #v < #carry then return end
	for i = 1, #carry do _ENV[carry[i]] = v[i] end
	up0 = up
	return true
end
-- << shared

__gfx__
0000000000676660006766600000000000000000000000000000000000676660003b3330008e888000a7aaa00076660000766600077077000000770000000000
0000000000655550006555500000000000000000000000000000000000655550003555500085555000a555500055550000666600777777700007700000000000
0070070000666560006665600000000000000000000000000000000000666560003335300088858000aaa5a00065560000666600777777700077000000000000
0007700000666560006665600000000000000000000000000000000000666560003335300088858000aaa5a00065560000666600077777000777770000000000
00077000000550000605500040000000070000000a0000000d000000000550000005500000055000000550000005500000055000077777000007700004000000
0070070000676600006766648777770078ddddd0ab777770d188888000676600003b3300008e880000a7aa000067660000676600007770000077000044777770
00000000060660600006600040000000070000000a0000000d0000000606606003033030080880800a0aa0a00606606006066060000700000700000004000000
00000000005005000050050000000000000000000000000000000000005505000050550000505000000505000050050000500500000000000000000000000000
00088000003333300033330000333300000000000000000000000000000000000000000000000000000000000000000000000000007666000000000000000000
00388300003333300033330000333300000000000000000000000000000000000000000000000000000000000000000000000000005555000000000000000000
03333330003a83800083380000333300000000000000000000000000000000000000000000000000000000000000000000000000006556000000000000000000
07033070003332300032230000333300000000000000000000000000000000000000000000000000000000000000000000000000006556000000000000000000
07733770000330000003300000033000000000000000000000000000000000000000000000000000000000000000000000000700000550600000000000000000
03333330000444300343443003443430000000000000000000000000000000000000000000000000000000000000000000000700006666000000000000000000
03333330000440000004400000044000000000000000000000000000000000000000000000000000000000000000000000000700006460000000000000000000
03333330005005000050050000500500000000000000000000000000000000000000000000000000000000000000000000000700054845000000000000000000
00aaaa00007aaa000077aa0000a77a0000aa770000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa000000000000766600000700000000000000000000
0aa99aa007a99aa007799aa00a779aa00aa77aa00aa997700aa99a700aa99aa00aa99aa00aa99aa00aa99aa00000000000666600000700000000000000000000
aa9aa9aa7a9aa9aa779aa9aaa77aa9aaaa77a9aaaa9a77aaaa9aa77aaa9aa977aa9aa9aaaa9aa9aaaa9aa9aa0000000000666600000700000000000000000000
aa9aa9aaaa9aa9aa7a9aa9aa779aa9aaa77aa9aaaa9779aaaa9a77aaaa9aa77aaa9aa977aa9aa9a7aa9aa9aa0000000000666640000700000000000000000000
aa9aa9aaaa9aa9aaaa9aa9aa7a9aa9aa779aa9aaaa77a9aaaa9779aaaa9a77aaaa9aa77aaa9aa977aa9aa9aa0000000000055400000700000000000000000000
aa9aa9aaaa9aa9aaaa9aa9aaaa9aa9aa7a9aa9aaa77aa9aaaa77a9aaaa9779aaaa9a77aaaa9aa77aaa9aa9a70000000006676600000000000000000000000000
0aa99aa00aa99aa00aa99aa00aa99aa00aa99aa007a99aa00a799aa00a779aa00aa77aa00aa977a00aa99a700000000000066000000000000000000000000000
00aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa00007aaa00007aaa0000a7aa0000a77a0000aaa7000000000000500500000000000000000000000000
00676660006766600067666000676660006766600076660000766600000000000000000000000000000000000000000000000000000000000000000000000000
00655550006555500065555000655550006555500055550000555500000000000000000000000000000000000000000000000000000000000000000000000000
00666560006665600066656000666560006665600065560000655600000000000000000000000000000000000000000000000000000000000000000000000000
00666560006665600066656000666560006665600065560000655600000000000000000000000000000000000000000000000000000000000000000000000000
00055000000550000005500000055000000550000005506000055060000000000000000000000000000000000000000000000000000000000000000000000000
00676600006766000067660000676600006766000066660000666600000000000000000000000000000000000000000000000000000000000000000000000000
06066060060660600606606006066060060660600064600000646000000000000000000000000000000000000000000000000000000000000000000000000000
00500500000505000050500000000500005000000048450005484000000000000000000000000000000000000000000000000000000000000000000000000000
ddd1dddd00000000dddd1ddddddddddd00000000dd1111dd00000000000000000011111111111100444444440000000000000000000000000033330000000000
55515555000000005555155555555555000000005144441500000000000000000177777777777710455545540000000000000000000000033333333300000000
55515555000000005555155555555555000000005444444500000000000000000111111111111110444444440000000000000000000033333333300a00000000
11111111000000001111111111111111000000001444444100000000000000000161766666661d10454554540000000000000000003333333333000000000000
ddddddd1000000001ddddddddddddddd00000000d4444a4d00000000000000000161666166661710444444440000000000000000033333333333300000000000
55555551000000001555555555555555000000005444444500000000000000000161661116661710000440000000000000000000333333333333333000000000
55555551000000001555555555555555000000005444444500000000000000000161617771661d10000440000000000000000000333333333333333000000000
11111111000000001111111111111111000000001444444100000000000000000161117671161d10000440000000000000000003333333333333333333300000
00000000000000000000000000000000000000000000000000000000000000000161617771661710000000000000000003333333333333333333333333333330
0000000000000000000000000000000000000000000000000000000000000000016166111666171000000000000000000000000777ffffffff77ffff70000000
000000000000000000000000000000000000000000000000000000000000000001d1ddd1dddd1d10000000000000000000000007fffffffffff7ffff70000000
000000000000000000000000000000000000000000000000000000000000000001d1111111111d100000000000000000000000ffffffeefffffff77ff0000000
000000000000000000000000000000000000000000000000000000000000000001dddddddddddd100000000000000000000000fffffe788fffff77c7f0000000
000000000000000000000000000000000000000000000000000000000000000000111111111111000000000000000000000000fffff8882fffff7777f0000000
000000000000000000000000000000000000000000000000000000000000000000155100001551000000000000000000000000077fff82fff0fff77ff0000000
0000000000000000000000000000000000000000000000000000000000000000001111000011110000000000000000000000000777fffffff00ffffff0000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000007777fffffff00ffff70000000
00990099999009000099009999900900009900999990090000000000000000000000000000000000000000000000000000000000777ffffffff0fff770000000
00990099999009000099009999900900009900999990090000000000000000000000000000000000000000000000000000000000777fffffff00fff770000000
99999999999999999999999999999999999999999999999900000000000000000000000000000000000000000000000000000000077777777777777700000000
9999999999999999999999999999999999999999999999990000000000000000000000000000000000000000000000000000000000777ffffffff77000000000
99999999999999999999999999999999999999999999999900000000000000000000000000000000000000000000000000000000007777f0000f777000000000
009999999999990000999999999999000099999999999900000000000000000000000000000000000000000000000000000000000007777ffff7770000000000
0099999999999900009999999999990000999999999999000000000000000000000000000000000000000000000000000000000000007777ff77700000000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000000000077777f77700000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000007777777000000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000007777777000000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000000777777000000000000
00990990099099000000099000009900009900000990000000000000000000000000000000000000000000000000000000000000000000077777000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007777000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000777000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
44444444449444444444444444444444494444444444444444444444944444444444444444444449444444444444444444444494444444444444444444444944
44442444444444444444424444444444444444244444444444444442444444444444444424444444444444444244444444444444442444444444444444424444
44424444444444444444442444444444444444444244444444444444444424444444444444444442444444444444444444244444444444444444424444444444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
11101111111011111110111111101111111011111110dd1111101111111077777777011111101111111011111110111111101111111011111110111111101111
11101111111011111110111111101111111011111110111116666606666066666666066660666661111011111110111111101111111011111110111111101111
11101113331011111010111111101111111011111110111605555505555066666666055550555550611011111110111111101111101011111118811111101111
0000088aaa00dd00000000000000000000400000000006650555550555506666666605555055555056600000000004000000000000000000000aa11000000000
1111199333cc7710111111101114441011d1111011116550550000000000555555550000000000550556111011111d10dd4441101111111044488ccddd111110
111118833377dd2221111110111d6d1011c1111011165555222222222222222222222222222222225555611011111b1011d6d110144444109998811777111110
1111188333ccdd999117776011d888d01ccc11101116665888822888822888822888822888822888856661101111bbb01dcccd10116996104448811ddd111110
0000088333ccdd22207777760d87888d0c7c00000005552888822888822888822888822888822888825550000000b7b0dc7cccd0000690004448811ddd000000
1110188333ccdd22217007061d88888d1ccc11111115552888822888822888822888822888822888825551111110bbb1dcccccd1111961114448811ddd101111
1110199aaa777799917776661d88882d1ccc11111115558822028828299888299888299882882022885551111110bbb1dcccc1d111699611999aacc777101111
1110188333ccdd222117676110d222d111111111111555882202882290098290098290098288202288555111111033311d111d11144444114448811ddd101111
00099999999999999999999999999999999999000000008822028809000099000099000090882022880000000099999999999999999999999999999999999000
11144444444444444444444444444444444444101116668822028000000000000000000000082022886661101144444444444444444444444444444444444110
11122222222222222222222222222222222222101115558822028000000000000000000000082022885551101122222222222222222222222222222222222110
11111420111111101121222022212110114211101115558822020000000000000000000000002022885551101111421021222220212111101111111014211110
00000200000000000000000000000000002000000005558822020000000000000000000000002022885550000000200000000000000000000000000002000000
11101111111011111124222222202111111011111115558822000000000000000000000000000022885551111110111122202222222011111110111411101111
1110114994101111121d222a22201211111011111110008822000000000000000000000000000022880001111110111212202a22244441111110111d11101111
11101611116011441129222922277777777011111116668822000000000000000000000000000022886661111110677876202922622016111440111810101111
000006bbbb6000dd00999007700cccccccc0000000055588220000000000000000000000000000228855500000006ff8f6007700608806000dd0008880000000
111116b77b611eeee19792276d21bbbbbbbb1110111555882000000000000000000000000000000288555110111116778776672068878610dddd118781111110
111116b7cb611e7ee19992176212333333331110111555882200000000000000000000000000002288555110111116ff8ff6671062771610d7dd118881111110
1111163bb3611eeee1999127611eeeeeeeeee110111555880000000000000000000000000000000088555010111167778776672061771610dddd118881111110
0000006666000eee2044400440022222222220000000009a99000000000000000000000000000099a900000000006fff8ff6440006666000ddd2002220000000
11199999999999999999999999999999999999111116664444000000000000000000000000000044446661111199999999999999999999999999999999999111
11144444444444444444444444444444444444111115558809000000000000000000000000000090885551111144444444444444444444444444444444444111
11122222222222222222222222222222222222111015558809000000000000000000000000000090885551111122222222222222222222222222222222222111
00000420000000000000000000000000004200000005558824000000000000000000000000000042885550000000420000000000000000000000000004200000
1111121011111110ccc1111011111110dd21111011155588200000000000000000000000000000028855511011112110111111101111111011111110d2111110
111111101111111c7ccc111041111110111111101110008822000000000000000000000000000022880001101111111011111110411111101111111011111110
11111014441111c77cccc110d1111110111111101116668822003333333303333333333333330022886661101111101011111110d11111b01b11114441111110
0000000d6d0000c7ccccd000e0004400000000000005558823333333333300333333333333333332885550000000000000000000c0000b3bb3b000d6d0000000
111011dbbbd011ccccccd11eee10dd1111101111111555833333333333333333333333333333333338555111111011111677711ccc1011b33b101d999d101111
11101db7bbbd111cccdd111e7e1aaaa111101111111553333333333333333333333333333333333333355111111011116777771c7c101113b110d97999d01111
11101dbbbbbd1111ddd0211eee1a7aa111101111111533333313333333333033333333333333313333335111111011116070071ccc1011499410d99999d01111
00000dbbbb3d00049994000eee0aaaa000000000000333333133333333333333333333333333331333333000000000006667770ccc0000444400d99994d00000
111111d333d1114444442222221aaa9011111110dd333333133333333333333333333333333333313333331011111110167671111111111441111d444d111110
11199999999999999999999999999999999999101333333133133333333333333333333333333133133333301199999999999999999999999999999999999110
1114444444444444444a444444444444444444103333331333133333333333333333333333333133313333331144444444444444444444444444444444444110
000222222222222222a9a22222222222222222033333313331033333333333333333333333333013331333333022222222222222222222222222222222222000
1110142111101122222922222110111111421199a999a99999033333333333333333333333333099999a999a9910421111101111111011111110111114201111
1110121111101212227772221210111111201444444444444203333333333333333333333333302444444444444021111110111111a01111aa10111112101111
11101111111011212277622121101111111010000000000000033333333333333333333333333000000ffff000001111111011111a9a11119910111111101111
0000000000000000007760000000000000000000000000000003333333333333333333333333300000ffffff00000000000000009aa9a000aa00000000000000
222222222222222224999422222222222222222fffffff222222222222222222222222222222222222fffffff22222222222222a9a9aa9a29922222222222222
444444444442444444444444244444444444424ffffffff4442444444444444244444444444424444ffffffff244444444444424494494444442444444444444
444444444449444444444444444494444444444f4f4f4ff4444444444444449444444444444444494ff4f4f4f444444494444444444444444944444444444444
999999999999999999999999999999999999999f4f4f4f999999999999999999999999999999999999f4f4f4f999999999999999999999999999999999999999
4444444444444444444444444444444444444442f2f2f24444444444444444444444444444444444442f2f2f2444444444444444444444444444444444444444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
44422222222222222222222222222444422222222222222222222222222444444444422222222222222222222222222444422222222222222222222222222444
444244444444444444444444444494444244444444444444444444444494444a4444424444444444444444444444449444424444444444444444444444449444
44424444444444444444444444449444424444444444444444444444449444a9a444424444444444444444444444449444424444444444444444444444449444
444244444444444444444444444494444244444444444444444444444494444a4444424444444444444444444444449444424444444444444444444444449444
44429999999999999999999999999444429999999999999999999999999444444444429999999999999999999999999444429999999999999999999999999444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
__label__
44444444449444444444444444444444494444444444444444444444944444444444444444444449444444444444444444444494444444444444444444444944
44442444444444444444424444444444444444244444444444444442444444444444444424444444444444444244444444444444442444444444444444424444
44424444444444444444442444444444444444444244444444444444444424444444444444444442444444444444444444244444444444444444424444444444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
11101111111011111110111111101111111011111110dd1111101111111077777777011111101111111011111110111111101111111011111110111111101111
11101111111011111110111111101111111011111110111116666606666066666666066660666661111011111110111111101111111011111110111111101111
11101113331011111010111111101111111011111110111605555505555066666666055550555550611011111110111111101111101011111118811111101111
0000088aaa00dd00000000000000000000400000000006650555550555506666666605555055555056600000000004000000000000000000000aa11000000000
1111199333cc7710111111101114441011d1111011116550550000000000555555550000000000550556111011111d10dd4441101111111044488ccddd111110
111118833377dd2221111110111d6d1011c1111011165555222222222222222222222222222222225555611011111b1011d6d110144444109998811777111110
1111188333ccdd999117776011d888d01ccc11101116665888822888822888822888822888822888856661101111bbb01dcccd10116996104448811ddd111110
0000088333ccdd22207777760d87888d0c7c00000005552888822888822888822888822888822888825550000000b7b0dc7cccd0000690004448811ddd000000
1110188333ccdd22217007061d88888d1ccc11111115552888822888822888822888822888822888825551111110bbb1dcccccd1111961114448811ddd101111
1110199aaa777799917776661d88882d1ccc11111115558822028828299888299888299882882022885551111110bbb1dcccc1d111699611999aacc777101111
1110188333ccdd222117676110d222d111111111111555882202882290098290098290098288202288555111111033311d111d11144444114448811ddd101111
00099999999999999999999999999999999999000000008822028809000099000099000090882022880000000099999999999999999999999999999999999000
11144444444444444444444444444444444444101116668822028000000000000000000000082022886661101144444444444444444444444444444444444110
11122222222222222222222222222222222222101115558822028000000000000033330000082022885551101122222222222222222222222222222222222110
11111420111111101121222022212110114211101115558822020000000000033333333300002022885551101111421021222220212111101111111014211110
00000200000000000000000000000000002000000005558822020000000033333333300a00002022885550000000200000000000000000000000000002000000
11101111111011111124222222202111111011111115558822000000003333333333000000000022885551111110111122202222222011111110111411101111
1110114994101111121d222a22201211111011111110008822000000033333333333300000000022880001111110111212202a22244441111110111d11101111
11101611116011441129222922277777777011111116668822000000333333333333333000000022886661111110677876202922622016111440111810101111
000006bbbb6000dd00999007700cccccccc0000000055588220000003333333333333330000000228855500000006ff8f6007700608806000dd0008880000000
111116b77b611eeee19792276d21bbbbbbbb1110111555882000000333333333333333333330000288555110111116778776672068878610dddd118781111110
111116b7cb611e7ee19992176212333333331110111555882333333333333333333333333333333288555110111116ff8ff6671062771610d7dd118881111110
1111163bb3611eeee1999127611eeeeeeeeee110111555880000000777ffffffff77ffff7000000088555010111167778776672061771610dddd118881111110
0000006666000eee2044400440022222222220000000009a99000007fffffffffff7ffff70000099a900000000006fff8ff6440006666000ddd2002220000000
111999999999999999999999999999999999991111166644440000ffffffeefffffff77ff0000044446661111199999999999999999999999999999999999111
111444444444444444444444444444444444441111155588090000fffffe788fffff7777f0000090885551111144444444444444444444444444444444444111
111222222222222222222222222222222222221110155588090000fffff8882fffff7c77f0000090885551111122222222222222222222222222222222222111
000004200000000000000000000000000042000000055588240000077fff82fff0fff77ff0000042885550000000420000000000000000000000000004200000
1111121011111110ccc1111011111110dd211110111555882000000777fffffff00ffffff00000028855511011112110111111101111111011111110d2111110
111111101111111c7ccc111041111110111111101110008822000007777fffffff00ffff70000022880001101111111011111110411111101111111011111110
11111014441111c77cccc110d1111110111111101116668822003333777ffffffff0fff773330022886661101111101011111110d11111b01b11114441111110
0000000d6d0000c7ccccd000e0004400000000000005558823333333777fffffff00fff773333332885550000000000000000000c0000b3bb3b000d6d0000000
111011dbbbd011ccccccd11eee10dd1111101111111555833333333337777777777777773333333338555111111011111677711ccc1011b33b101d999d101111
11101db7bbbd111cccdd111e7e1aaaa111101111111553333333333333777ffffffff7733333333333355111111011116777771c7c101113b110d97999d01111
11101dbbbbbd1111ddd0211eee1a7aa1111011111115333333133333337777f0000f77733333313333335111111011116070071ccc1011499410d99999d01111
00000dbbbb3d00049994000eee0aaaa00000000000033333313333333337777ffff777333333331333333000000000006667770ccc0000444400d99994d00000
111111d333d1114444442222221aaa9011111110dd3333331333333333337777ff777333333333313333331011111110167671111111111441111d444d111110
11199999999999999999999999999999999999101333333133133333333377777f77733333333133133333301199999999999999999999999999999999999110
1114444444444444444a444444444444444444103333331333133333333337777777333333333133313333331144444444444444444444444444444444444110
000222222222222222a9a22222222222222222033333313331033333333337777777333333333013331333333022222222222222222222222222222222222000
1110142111101122222922222110111111421199a999a99999033333333333777777333333333099999a999a9910421111101111111011111110111114201111
1110121111101212227772221210111111201444444444444203333333333337777733333333302444444444444021111110111111a01111aa10111112101111
11101111111011212277622121101111111010000000000000033333333333337777333333333000000ffff000001111111011111a9a11119910111111101111
0000000000000000007760000000000000000000000000000003333333333333377733333333300000ffffff00000000000000009aa9a000aa00000000000000
222222222222222224999422222222222222222fffffff222222222222222222222222222222222222fffffff22222222222222a9a9aa9a29922222222222222
444444444442444444444444244444444444424ffffffff4442444444444444244444444444424444ffffffff244444444444424494494444442444444444444
444444444449444444444444444494444444444f4f4f4ff4444444444444449444444444444444494ff4f4f4f444444494444444444444444944444444444444
999999999999999999999999999999999999999f4f4f4f999999999999999999999999999999999999f4f4f4f999999999999999999999999999999999999999
4444444444444444444444444444444444444442f2f2f24444444444444444444444444444444444442f2f2f2444444444444444444444444444444444444444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
44422222222222222222222222222444422222222222222222222222222444444444422222222222222222222222222444422222222222222222222222222444
444244444444444444444444444494444244444444444444444444444494444a4444424444444444444444444444449444424444444444444444444444449444
44424444444444444444444444449444424444444444444444444444449444a9a444424444444444444444444444449444424444444444444444444444449444
444244444444444444444444444494444244444444444444444444444494444a4444424444444444444444444444449444424444444444444444444444449444
44429999999999999999999999999444429999999999999999999999999444444444429999999999999999999999999444429999999999999999999999999444
22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
000000ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11117717771777177717771777177111771177111111111777177717771717177717111777177711111111177717171777111111111111111c0000000
000000c11171117171711171111711171171717111711111111111171171717171717171117111711171711111111117117171711111111111111111c0000000
000000c11171117711771177111711171171717111777111111111171177117771717177117111771177111111111117117771771111111111111111c0000000
000000c11171717171711171111711171171717171117117111111171171717171777171117111711171711111111117117171711111111111111111c0000000
000000c11177717171777177711711777171717771771171111111171171717171171177717771777171711711111117117171777111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11177711771777177111111777171717771777177111111777117711111771177717771717111111111777171717771111171711771717111c0000000
000000c11171717171717171711111717171717111717171711111171171111111717171717171717111111111717171711711111171717171717111c0000000
000000c11177117171777171711111777177717711777171711111171177711111717177717711771111111111771171711711111177717171717111c0000000
000000c11171717171717171711111717171717111717171711111171111711111717171717171717117111111717171711711111111717171717111c0000000
000000c11171717711717177711111717171717771717177711111777177111111777171717171717171111111777117711711111177717711177111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11177117771777177111111771117717771111171717771711171711111777177711111777171111771771177711111111111111111111111c0000000
000000c11171717111711171711111717171711711111171717171711171711111171117111111717171117171717171111111177777111111111111c0000000
000000c11171717711771171711111717171711711111171717771711177111111171117111111777171117171717177111111117771111111111111c0000000
000000c11171717111711171711111717171711711111177717171711171711111171117111111717171117171717171111111111711111111111111c0000000
000000c11171717771777177711111717177111711111177717171777171711111777117111111717177717711717177711711111111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000c11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c0000000
000000ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000007777770000666060606060000000000000000077777700006000666066606060666000000000000000000000000000000
00000000000000000000000000000077077077000606060606060000000000000000770000770006000600060606060600000000000000000000000000000000
00000000000000000000000000000077700777000660060606660000000000000000770770770006000660066606060660000000000000000000000000000000
00000000000000000000000000000077077077000606060600060000000000000000770000770006000600060606660600000000000000000000000000000000
00000000000000000000000000000007777770000666006606660000000000000000077777700006660666060600600666000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000

__gff__
0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000101000200000505050000000000000000000000000005050000000000000101000000000000000000000000000001010000000000000000000000000000
__map__
0000000000000000000000000000000041414141414141414141414141414141000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000043404040404040404540404040404043000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000404141414141414141414a4141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141484942000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414a41414141414141414141585942000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000045414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414a41414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000040414141414141414141414141414142000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000043404040404040404040404040404043000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
