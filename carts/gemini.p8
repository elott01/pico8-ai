pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
function _init()
	-- vitality and stamina match their hud bars
	health_col = 8
	stamina_col = 11
	armor_col = 12
	attack_col = 9

	-- ex,ey: arrival. doors: `to` a room or an `act`; `lock`: shut until spent
	rooms = {
		{mx = 0,  my = 0, combat = true,  ex = 112, ey = 64,
		 -- home right, deeper left
		 doors = {{tx = 15, ty = 8, to = 2}, {tx = 0, ty = 8, lock = true, act = descend}},
		 labels = {}, signs = {}},
		{mx = 16, my = 0, combat = false, ex = 8,   ey = 64,
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
		 }},
	}
	alive = true
	flipx = false
	facing = "side"
	speed = 1
	walk_t = 0

	token_alive = false

	token_frames = 10	-- sprites 33..42
	token_hold = 2		-- frames per shine frame
	token_pause = 70	-- frames between glints
	token_t = 0

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
		 art = split"164,164,164", size = 2},
	}

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

	drops = {}
	tokens = 0
	vault = 0		-- stash, safe from rollbacks
	pruned = 0
	rollbacks = 0
	max_depth = 0
	depth = 0		-- current room, from 1
	banner_t = 0
	banner_msg = ""
	frame = 0

	init_wizard()
	find_layouts()

	goto_room(2)
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

function sword_box()
	local dx, dy = sword_ofs()
	return x + dx, y + dy
end

function hit(ax, ay, bx, by)
	return ax < bx + 8 and ax + 8 > bx and ay < by + 8 and ay + 8 > by
end

function mid_tile(px, py)
	return (px + 4) \ 8, (py + 4) \ 8
end

-- the tile id is the damage state; a swing adds attack_tier + 1
crate_base, crate_stages = 144, 3

function hit_crate()
	local tx, ty = mid_tile(sword_box())
	if tx < 0 or tx > 15 or ty < 0 or ty > 15 then return end
	local mx, my = room.mx + tx, room.my + ty
	local st = mget(mx, my) - crate_base
	if st < 0 or st >= crate_stages then return end
	st += attack_tier + 1
	if st < crate_stages then
		mset(mx, my, crate_base + st)
	else
		mset(mx, my, 129)
		flow_at = nil
		drop_from(tx, ty)
	end
end

-- odds out of 100. kind is the hud sprite: 13 heart, 14 bolt
drop_heart = 20
drop_bolt = 30

function drop_from(tx, ty)
	local r = rnd(100)
	if r < drop_heart + drop_bolt then
		add(drops, {x = tx * 8, y = ty * 8, kind = r < drop_heart and 13 or 14})
	end
end

-- only picked up when it would help
function take_drops()
	for d in all(drops) do
		if hit(x, y, d.x, d.y) then
			if d.kind == 13 and health < health_max then
				health += 1
				del(drops, d)
			elseif d.kind == 14 and stamina < stamina_max then
				stamina = stamina_max
				stam_t = 0
				del(drops, d)
			end
		end
	end
end

-- step frame for distance t along cycle c
function step_spr(c, t)
	return c[t \ walk_hold % #c + 1]
end

-- h rows of sprite n from row top: a body is rows 0-6, its feet row 7
function draw_rows(n, x, y, fx, top, h)
	sspr(n % 16 * 8, n \ 16 * 8 + top, 8, h, x, y + top, 8, h, fx)
end

function _update()
	frame += 1
	if banner_t > 0 then banner_t -= 1 end

	if scene then
		scene.update()
		return
	end

	if not alive then
		if btnp(🅾️) then respawn() end
		return
	end

	-- a dialog freezes the room
	if dialog then
		update_dialog()
		return
	end

	-- you're never in a wall, so this only tests the leading edge
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

	local d = door_at(x + 4, y + 4)
	if d then
		if d.act then d.act(d) else goto_room(d.to) end
	end

	-- ❎ talks if something's in reach, else swings
	near_talk = talk_at(x, y)
	if near_talk and btnp(❎) then
		-- act may return a message, or nil if it opened its own box
		local msg = near_talk.msg
		if near_talk.act then msg = near_talk.act(near_talk) end
		if msg then open_dialog(msg) end
	elseif btnp(❎) and stamina > 0 then
		attack = 6
		stamina -= 1
		hit_crate()
	end

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
	token_t = (token_t + 1) % (token_frames * token_hold + token_pause)

	if room.combat then
		if attack > 0 then
			local sx, sy = sword_box()
			for z in all(zombies) do
				if hit(sx, sy, z.x, z.y) then
					del(zombies, z)
					pruned += 1
				end
			end
		end

		if token_alive and hit(x, y, token_x, token_y) then
			tokens = min(tokens + 1, token_max)
			tokens_left -= 1
			spawn_wave(token_wakes)
			if tokens_left > 0 then spawn_token() else token_alive = false end
		end

		take_drops()

		for z in all(zombies) do
			if hurt <= 0 and hit(x, y, z.x, z.y) then
				health -= 1
				hurt = 30
				if health <= 0 then alive = false end
			end
		end

		update_zombies()
		update_locks()
	end
	if room.claude then
		update_claude(room.claude)
	end
end

function _draw()
	if scene then
		scene.draw()
		return
	end

	cls()
	draw_bar(13, health_x, health, health_max, health_col)
	draw_bar(14, stamina_x, stamina, stamina_max, stamina_col)
	-- padded to the cap's width so the readout holds still
	local tv = tostr(tokens)
	while #tv < token_digits do tv = " "..tv end
	local tx = print("tokens: ", token_hud_x, 0, 10)
	print(tv, tx - num_gap, 0, 10)
	map(room.mx, room.my, 0, 0, 16, 16)
	if room.claude then
		draw_claude(room.claude)
	end
	for l in all(room.labels) do
		local c = l.col or 7
		print(l.val(), print(l.txt, l.x, l.y, c) - num_gap, l.y, c)
	end
	-- blink while hurt
	if alive and (hurt <= 0 or hurt % 4 < 2) then
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
	if room.combat then
		for z in all(zombies) do
			draw_zombie(z)
		end
		-- tinted to the bar they fill
		for d in all(drops) do
			pal(7, d.kind == 13 and health_col or stamina_col)
			spr(d.kind, d.x, d.y)
			pal()
		end
		if token_alive then
			local f = token_t \ token_hold
			spr(f < token_frames and 33 + f or 32, token_x, token_y)
		end
	end

	if alive and banner_t > 0 then centre(banner_msg, 60, 7) end

	if not alive then
		print("game over", 46, 60, 8)
		if frame % 30 < 20 then centre("press 🅾️ to rollback", 70, 7) end
	end

	if alive and not dialog and near_talk and frame % 30 < 20 then
		local hx, hy = hint_pos(near_talk)
		draw_x_hint(hx, hy, 7)
	end
	if dialog then draw_dialog(dialog) end
end

-- centred on the screen, measured by printing off-screen (🅾️ is wide)
function centre(s, y, c)
	print(s, 64 - print(s, 0, -8) / 2, y, c)
end

function tier_str(tier)
	return tier.."/"..tier_max
end

-- time() pauses with the cart. minutes uncapped (fine for ~9 hours)
function uptime_str()
	local s = flr(time())
	local ss = s % 60
	return s \ 60 ..":"..(ss < 10 and "0" or "")..ss
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

-- a flow index's top-left in px
function tile_xy(i)
	return i % 16 * 8, i \ 16 * 8
end

-- reachable non-door tiles, or a room could never be spent
function floor_tiles()
	local t = {}
	for i = 0, 255 do
		if flow[i] and not is_door(tile_xy(i)) then add(t, i) end
	end
	return t
end

function spawn_token()
	token_x, token_y = tile_xy(rnd(floor_tiles()))
	token_alive = true
end

-- zombie bodies 17-19 share the knight's feet row, so his steps fit
function spawn_zombie(zx, zy)
	add(zombies, {x = zx, y = zy, speed = 0.75,
		walk_t = 0, body = 17, side = true, flipx = false})
end

function draw_zombie(z)
	local fx = z.side and z.flipx
	draw_rows(z.body, z.x, z.y, fx, 0, 7)
	draw_rows(step_spr(z.side and walk_cycle or walk_cycle_ud, z.walk_t),
		z.x, z.y, fx, 7, 1)
end

-- flow field: bfs from your tile, rebuilt when it changes. no corner-cutting
nbrs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}, {-1, -1}, {1, -1}, {-1, 1}, {1, 1}}

function open_tile(tx, ty)
	return tx >= 0 and tx < 16 and ty >= 0 and ty < 16
	and not fget(mget(room.mx + tx, room.my + ty), 0)
end

function can_step(tx, ty, dx, dy)
	return open_tile(tx + dx, ty + dy)
	and (dx == 0 or dy == 0 or (open_tile(tx + dx, ty) and open_tile(tx, ty + dy)))
end

function build_flow(ptx, pty)
	flow = {}
	local q, head = {ptx + pty * 16}, 1
	flow[q[1]] = 0
	while head <= #q do
		local i = q[head]
		head += 1
		local tx, ty = i % 16, i \ 16
		for n in all(nbrs) do
			-- off-edge indexes alias, but can_step checks real coords
			local j = tx + n[1] + (ty + n[2]) * 16
			if not flow[j] and can_step(tx, ty, n[1], n[2]) then
				flow[j] = flow[i] + 1
				add(q, j)
			end
		end
	end
end

function box_free(px, py)
	return not (is_solid(px, py) or is_solid(px + 7, py)
		or is_solid(px, py + 7) or is_solid(px + 7, py + 7))
end

-- next tile downhill, ties toward you. adjacent or unreached: at you
function zombie_goal(z, ptx, pty)
	local tx, ty = mid_tile(z.x, z.y)
	local here = flow[tx + ty * 16]
	if not here or here <= 1 then return x, y end
	local gx, gy, bd, be = x, y, here, 999
	for n in all(nbrs) do
		local nx, ny = tx + n[1], ty + n[2]
		local d = flow[nx + ny * 16]
		if d and d < here and can_step(tx, ty, n[1], n[2]) then
			local e = (nx - ptx) * (nx - ptx) + (ny - pty) * (ny - pty)
			if d < bd or (d == bd and e < be) then
				gx, gy, bd, be = nx * 8, ny * 8, d, e
			end
		end
	end
	return gx, gy
end

-- distance on foot, 999 if unreached
function zflow(z)
	local tx, ty = mid_tile(z.x, z.y)
	return flow[tx + ty * 16] or 999
end

function update_zombies()
	local ptx, pty = mid_tile(x, y)
	if flow_at != ptx + pty * 16 then
		flow_at = ptx + pty * 16
		build_flow(ptx, pty)
	end

	for i = 1, #zombies do
		local z = zombies[i]
		local wasx, wasy = z.x, z.y
		local sp = z.speed

		-- one axis at a time, so walls slide it along
		local gx, gy = zombie_goal(z, ptx, pty)
		local mx, my = mid(-sp, gx - z.x, sp), mid(-sp, gy - z.y, sp)
		if box_free(z.x + mx, z.y) then z.x += mx else mx = 0 end
		if box_free(z.x, z.y + my) then z.y += my else my = 0 end

		-- unstack: only the further one yields (both yielding deadlocks at
		-- one-tile gaps). ties go by list order
		local zd = zflow(z)
		for j = 1, #zombies do
			local other = zombies[j]
			if other != z and hit(z.x, z.y, other.x, other.y) then
				local od = zflow(other)
				if zd > od or (zd == od and i > j) then
					local px = z.x < other.x and -sp or sp
					local py = z.y < other.y and -sp or sp
					if box_free(z.x + px, z.y) then z.x += px end
					if box_free(z.x, z.y + py) then z.y += py end
				end
			end
		end

		-- face the way it moves, or the player when still
		local fx, fy = mx, my
		if fx == 0 and fy == 0 then fx, fy = x - z.x, y - z.y end
		-- 17 side, 18 toward you, 19 walking away
		z.side = abs(fx) > abs(fy)
		if z.side then z.flipx = fx < 0 end
		z.body = z.side and 17 or fy < 0 and 19 or 18

		local d = max(abs(z.x - wasx), abs(z.y - wasy))
		z.walk_t = d > 0 and (z.walk_t + d) % (walk_hold * #walk_cycle) or 0
	end
end

-- claude paces the hub. 226/228 lift diagonal foot pairs
claude_cycle = split"224,226,224,228"
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

-- dying drops the purse (tokens). the stash is safe
function respawn()
	rollbacks += 1
	alive, health, stamina, facing = true, health_max, stamina_max, "side"
	stam_t, hurt, attack, walk_t, tokens = 0, 0, 0, 0, 0
	goto_room(2)
end

function goto_room(n)
	room = rooms[n]
	x, y = room.ex, room.ey
	if room.combat then
		enter_battle()
	else
		zombies = {}
		show_banner("main branch")
	end
end

-- layouts: framed 16x16 map slots with walls inside. duplicates count once
function framed(x0, y0)
	for i = 1, 14 do
		if not (fget(mget(x0 + i, y0 + 1), 0) and fget(mget(x0 + i, y0 + 15), 0)) then
			return false
		end
	end
	for i = 2, 14 do
		for ex in all({x0, x0 + 15}) do
			local t = mget(ex, y0 + i)
			if not (fget(t, 0) or fget(t, 1)) then return false end
		end
	end
	return true
end

function find_layouts()
	layouts = {}
	local seen = {}
	for sy = 0, 1 do
		for sx = 0, 7 do
			local x0, y0, used = sx * 16, sy * 16, false
			for r in all(rooms) do
				if r.mx == x0 and r.my == y0 then used = true end
			end
			if not used and framed(x0, y0) then
				local key, walls = "", 0
				for iy = 2, 14 do
					for ix = 1, 14 do
						local t = mget(x0 + ix, y0 + iy)
						key = key..t..","
						if fget(t, 0) then walls += 1 end
					end
				end
				if walls > 0 and not seen[key] then
					seen[key] = true
					add(layouts, {x = x0, y = y0})
				end
			end
		end
	end
end

-- a random layout, randomly flipped, kept if every door is reachable
function build_layout()
	local ax, ay = room.ex \ 8, room.ey \ 8
	for try = 1, 9 do
		local l = try < 9 and #layouts > 0 and rnd(layouts)
		local fx, fy = rnd() < 0.5, rnd() < 0.5
		for iy = 2, 14 do
			for ix = 1, 14 do
				mset(room.mx + ix, room.my + iy,
					l and mget(l.x + (fx and 15 - ix or ix), l.y + (fy and 16 - iy or iy)) or 129)
			end
		end
		build_flow(ax, ay)
		flow_at = ax + ay * 16
		local ok = open_tile(ax, ay)
		for d in all(room.doors) do
			if not flow[mid(1, d.tx, 14) + mid(2, d.ty, 14) * 16] then ok = false end
		end
		if ok then
			place_crates()
			return
		end
	end
end

-- crates go where smashing saves walking. solid, so never required
crate_min_save = 4		-- min tiles saved
crate_max = 3			-- per room

function room_crates(d) return min(1 + d \ 4, crate_max) end

function place_crates()
	local pick = {}
	for ty = 2, 14 do
		for tx = 1, 14 do
			local t = mget(room.mx + tx, room.my + ty)
			if fget(t, 0) and (t < crate_base or t >= crate_base + crate_stages) then
				local best = 0
				for p in all({{-1, 0, 1, 0}, {0, -1, 0, 1}}) do
					local a = flow[tx + p[1] + (ty + p[2]) * 16]
					local b = flow[tx + p[3] + (ty + p[4]) * 16]
					if a and b then best = max(best, abs(a - b) - 1) end
				end
				if best >= crate_min_save then add(pick, tx + ty * 16) end
			end
		end
	end
	for i = 1, room_crates(depth) do
		if #pick == 0 then return end
		local k = rnd(pick)
		del(pick, k)
		mset(room.mx + k % 16, room.my + k \ 16, crate_base)
	end
end

function start_run()
	depth = 0
	descend()
end

function descend()
	depth += 1
	max_depth = max(max_depth, depth)
	goto_room(1)
end

-- depth dials. each token taken wakes token_wakes more
function room_wave(d) return min(d, spawn_cap) end
function room_tokens(d) return 2 + d end
token_wakes = 1

function enter_battle()
	zombies = {}
	drops = {}
	build_layout()
	spawn_wave(room_wave(depth))
	tokens_left = room_tokens(depth)
	token_alive = false
	if tokens_left > 0 then spawn_token() end
	show_banner("depth "..depth)
end

function show_banner(msg)
	banner_msg = msg
	banner_t = banner_hold
end

spawn_cap = 12		-- max opening wave
spawn_clear = 40	-- px kept clear of the player (chebyshev)
banner_hold = 60	-- frames the room banner shows

function spawn_wave(n)
	-- far from you, spread out before doubling up. else the furthest tile
	local clear, best, bd = {}, nil, -1
	for i in all(floor_tiles()) do
		local px, py = tile_xy(i)
		local d = max(abs(px - x), abs(py - y))
		if d >= spawn_clear then add(clear, i) end
		if d > bd then best, bd = i, d end
	end
	local pool = {}
	for k = 1, n do
		if #zombies >= spawn_cap or not best then return end
		if #pool == 0 then
			for c in all(clear) do add(pool, c) end
		end
		local i = best
		if #pool > 0 then
			i = rnd(pool)
			del(pool, i)
		end
		spawn_zombie(tile_xy(i))
	end
end

-- room-relative: x,y are 0..127
function tile_at(px, py)
	return mget(room.mx + px \ 8, room.my + py \ 8)
end

function is_solid(px, py)
	if fget(tile_at(px, py), 0) then return true end
	-- claude is solid, which sign_reach relies on
	local c = room.claude
	if not c then return false end
	local x1, y1, x2, y2 = claude_box(c)
	return px >= x1 and px <= x2 and py >= y1 and py <= y2
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

-- a lock door is shut until the room is spent. set every frame
door_open, door_locked = 133, 135

function update_locks()
	local spent = tokens_left == 0 and #zombies == 0
	for d in all(room.doors) do
		if d.lock then
			mset(room.mx + d.tx, room.my + d.ty, spent and door_open or door_locked)
		end
	end
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
	local c = room.claude
	if c then
		local x1, y1, x2, y2 = claude_box(c)
		if px + 7 + sign_reach >= x1 and px - sign_reach <= x2
		and py + 7 + sign_reach >= y1 and py - sign_reach <= y2 then
			return c
		end
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
sheet_x = 96		-- head on the sheet (sprite 140)
sheet_y = 64
eye_x = 21			-- pupil home, from the head origin
eye_y = 12

-- gaze path: tl, bl, br, tr
sq = {{0,0},{0,1},{1,1},{1,0}}
gaze_hold = 24		-- frames per corner

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

-- gem colours 14, 8, 2 per verdict: impressed, neutral, unimpressed
gem_tints = {split"11,3,1", split"12,13,1", split"14,8,2"}

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
	shine_t = 0
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

	-- 1. head, 0 transparent. the last verdict tints the gem
	local t = gem_tints[verdict]
	if t then pal(14, t[1]) pal(8, t[2]) pal(2, t[3]) end
	spr(140, hx, hy, 4, 4)
	pal()

	-- 2. face interior again with 0 opaque, clipped
	clip(hx + 14, hy + 14, 7, 8)
	palt(0, false)
	spr(140, hx, hy, 4, 4)
	palt()
	clip()

	-- 3. glint
	draw_shine(shine_lead())

	-- 4. pupil
	local g = sq[frame \ gaze_hold % 4 + 1]
	rectfill(hx + 21, hy + 12, hx + 22, hy + 13, 7)
	pset(hx + eye_x + g[1], hy + eye_y + g[2], 12)

	-- 5. mouth. rectfill is opaque
	rectfill(hx + 15, hy + 21, hx + 18, hy + 21 + mouth_frame(), 0)
end

function draw_wizard_scene()
	cls(0)
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
	poke2(gpio + gp_uptime, flr(time()))
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
	if len > 0 and gem_tints[v] then verdict = v end
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

-- met isn't saved: a rollback keeps it, a reset doesn't
function enter_talk(c)
	scene = {update = update_talk, draw = draw_talk}
	menu, pages = nil
	open_dialog(c.met and claude_back or claude_hello)
	c.met = true
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
00000000000000000066660000000000000000000000000000666600000000000000000000000000006666000000000000000000000000000066660000000000
00000000000000066666666600000000000000000000000666666666000000000000000000000006666666660000000000000000000000066666666600000000
00000000000066666666600600000000000000000000666666666006000000000000000000006666666660060000000000000000000066666666600600000000
00000000006666666666000000000000000000000066666666660000000000000000000000666666666600000000000000000000006666666666000000000000
00000000066666666666600000000000000000000666666666666000000000000000000006666666666660000000000000000000066666666666600000000000
00000000666666666666666000000000000000006666666666666660000000000000000066666666666666600000000000000000666666666666666000000000
00000006666666666666666000000000000000066666666666666660000000000000000666666666666666600000000000000006666666666666666000000000
00000006666666666666666666600000000000066666666666666666666000000000000666666666666666666660000000000006666666666666666666600000
06666666666666666666666666666660066666666666666666666666666666600666666666666666666666666666666006666666666666666666666666666660
000000077733333333773333700000000000000777ffffffff77ffff700000000000000777ffffffff77ffff700000000000000777ffffffff77ffff70000000
0000000733333333333733337000000000000007fffffffffff7ffff7000000000000007fffffffffff7ffff7000000000000007fffffffffff7ffff70000000
00000033333383333333383330000000000000ffffffcffffffffcfff0000000000000ffffffcffffffffcfff0000000000000ffffffcffffffffcfff0000000
00000033333888333333888330000000000000fffffcccffffffcccff0000000000000fffffcccffffffcccff0000000000000fffffcccffffffcccff0000000
000000333388aa8333388aa830000000000000ffffcc77cffffcc77cf0000000000000ffffc77ccffffc77ccf0000000000000ffffc77ccffffc77ccf0000000
00000007733888333033888330000000000000077ffcccfff0ffcccff0000000000000077ffcccfff0ffcccff0000000000000077ffcccfff0ffcccff0000000
000000077733833330033833700000000000000777ffcffff00ffcff700000000000000777ffcffff00ffcff700000000000000777ffcffff00ffcff70000000
0000000777733333330033377000000000000007777fffffff00fff77000000000000007777fffffff00fff77000000000000007777fffffff00fff770000000
0000000077733333333033377000000000000000777ffffffff0fff77000000000000000777ffffffff0fff77000000000000000777ffffffff0fff770000000
0000000077733333330033377000000000000000777fffffff00fff77000000000000000777fffffff00fff77000000000000000777fffffff00fff770000000
00000000077777777777777700000000000000000777777777777777000000000000000007777777777777770000000000000000077777777777777700000000
000000000077733333333770000000000000000000777ff0000ff770000000000000000000777ffffffff770000000000000000000777ff0000ff77000000000
0000000000777732222377700000000000000000007777f0000f77700000000000000000007777f0000f77700000000000000000007777f0000f777000000000
00000000000777733337770000000000000000000007777ffff7770000000000000000000007777ffff7770000000000000000000007777ffff7770000000000
000000000000777733777000000000000000000000007777ff777000000000000000000000007777ff777000000000000000000000007777ff77700000000000
0000000000007777737770000000000000000000000077777f7770000000000000000000000077777f7770000000000000000000000077777f77700000000000
00000000000007777777000000000000000000000000077777770000000000000000000000000777777700000000000000000000000007777777000000000000
00000000000007777777000000000000000000000000077777770000000000000000000000000777777700000000000000000000000007777777000000000000
00000000000000777777000000000000000000000000007777770000000000000000000000000077777700000000000000000000000000777777000000000000
00000000000000077777000000000000000000000000000777770000000000000000000000000007777700000000000000000000000000077777000000000000
00000000000000007777000000000000000000000000000077770000000000000000000000000000777700000000000000000000000000007777000000000000
00000000000000000777000000000000000000000000000007770000000000000000000000000000077700000000000000000000000000000777000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
ddd1dddd00000000dddd1ddddddddddd44400444dd1111dd44400444dd1111dd9999929999909299999092000000000000000000000000000033330000000000
55515555000000005555155555555555444004445144441544400444514444154444424444404244444042400000000000000000000000033333333300000000
55515555000000005555155555555555444004445444444544400444564444654444424444440244444402440000000000000000000033333333300a00000000
11111111000000001111111111111111454004541444444145400454146446412222222222222222222222220000000000000000003333333333000000000000
ddddddd1000000001ddddddddddddddd45400454d4444a4d45400454d446644d9929999999299999992099990000000000000000033333333333300000000000
55555551000000001555555555555555444004445444444544400444544664454424444444244444442404440000000000000000333333333333333000000000
55555551000000001555555555555555444004445444444544400444546446454424444444244444442440440000000000000000333333333333333000000000
11111111000000001111111111111111444004441444444144400444164444612222222222222222222222020000000000000003333333333333333333300000
44444444444444444444440000000000000000000000000000000000000000002992992922222222222222222222220003333333333333333333333333333330
4499994444999044449990400000000000000000000000000000000000000000244244242999999229999092299990900000000777ffffffff77ffff70000000
49499494494990944949909400000000000000000000000000000000000000002992992924244242242440422424404200000007fffffffffff7ffff70000000
499449944994490449944904000000000000000000000000000000000000000024424424244224422442240224422402000000ffffffeefffffff77ff0000000
499449944994490449044904000000000000000000000000000000000000000029929929244224422442240224022402000000fffffe788fffff77c7f0000000
494994944949949449009494000000000000000000000000000000000000000024424424242442422424424224004242000000fffff8882fffff7777f0000000
449999444499994440999944000000000000000000000000000000000000000029929929244444422444444220444442000000077fff82fff0fff77ff0000000
4444444444444444444444440000000000000000000000000000000000000000244244242222222222222222222222220000000777fffffff00ffffff0000000
000000dd700000000000555555550000001111111111110000000000000000000000000000000000000000000000000000000007777fffffff00ffff70000000
00000ddd077700000005555555555000017777777777771000000000000000000000000000000000000000000000000000000000777ffffffff0fff770000000
0000ddd0078000000055555555555500011111111111111000000000000000000000000000000000000000000000000000000000777fffffff00fff770000000
000ddd00070dd00005555555555555500161766666661d1000000000000000000000000000000000000000000000000000000000077777777777777700000000
070dd000000ddd00555555555555555501616661666617100000000000000000000000000000000000000000000000000000000000777ffffffff77000000000
078000000000ddd04444444444444444016166111666171000000000000000000000000000000000000000000000000000000000007777f0000f777000000000
0777000000000ddd44444444444444440161617771661d10000000000000000000000000000000000000000000000000000000000007777ffff7770000000000
70000000000000dd44444444444444440161117671161d100000000000000000000000000000000000000000000000000000000000007777ff77700000000000
70000000000000004444444444444444016161777166171000000000000000000000000000000000000000000000000000000000000077777f77700000000000
0700000000000dd04777744444477774016166111666171000000000000000000000000000000000000000000000000000000000000007777777000000000000
007770000000ddd0477774111147777401d1ddd1dddd1d1000000000000000000000000000000000000000000000000000000000000007777777000000000000
00780000000ddd00477774111147777401d1111111111d1000000000000000000000000000000000000000000000000000000000000000777777000000000000
0070d00000ddd000444444111144444401dddddddddddd1000000000000000000000000000000000000000000000000000000000000000077777000000000000
00000d0070dd00004444441111444444001111111111110000000000000000000000000000000000000000000000000000000000000000007777000000000000
000000d0080000004444441111444444001551000015510000000000000000000000000000000000000000000000000000000000000000000777000000000000
0000000d707000004444441111444444001111000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000
44444444000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
45554554000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
44444444000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
45455454000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
44444444000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00044000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00044000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00044000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990099999009000099009999900900009900999990090000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990099999009000099009999900900009900999990090000000000000000000000000000000000000000000000000000000000000000000000000000000000
99999999999999999999999999999999999999999999999900000000000000000000000000000000000000000000000000000000000000000000000000000000
99999999999999999999999999999999999999999999999900000000000000000000000000000000000000000000000000000000000000000000000000000000
99999999999999999999999999999999999999999999999900000000000000000000000000000000000000000000000000000000000000000000000000000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00999999999999000099999999999900009999999999990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990990099099000099099009909900009909900990990000000000000000000000000000000000000000000000000000000000000000000000000000000000
00990990099099000000099000009900009900000990000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__label__
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
00000000000000000000000000000000000000000000000000000000000000000033330000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000033333333300000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000033333333300a00000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000003333333333000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000033333333333300000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000333333333333333000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000333333333333333000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000003333333333333333333300000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000003333333333333333333333333333330000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000777ffffffff77ffff70000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000007fffffffffff7ffff70000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000ffffffeefffffff77ff0000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000fffffe788fffff7777f0000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000fffff8882fffff77c7f0000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000077fff82fff0fff77ff0000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000777fffffff00ffffff0000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000007777fffffff00ffff70000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000777ffffffff0fff770000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000777fffffff00fff770000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000077777777777777700000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000777ffffffff77000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000007777f0000f777000000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000000007777ffff7770000000000000000000000000000000000000000000000000000000000
0000000000000000000000000000000000000000000000000000000000007777ff77700000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000077777f77700000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000007777777000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000007777777000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000777777000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000077777000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000007777000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000777000000000000000000000000000000000000000000000000000000000000
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
0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
0100010102020801010101000000000001010100000000000101010100000000000000000505000000000000000000000000000005050000000000000000000005000000000000000000000000000000000000000000000000000000000000000101000000000000000000000000000001010000000000000000000000000000
__map__
8181818181818181818181818181818181818181818181818181818181818181000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
8380808080808080808080808080808383808080808080808580808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083
8081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818181808181818181818280818181818081818100800081818182
8081818081818181818181818181818280818181818181818181c08181818182808181818080808080808082818181828081818181818181818181818181818280818181818181818181818181818182808181808181818181818181818181828081818181818181808181818181818280818181808081818100808081818182
8081818081818181818181818080818280818181818181818181818181818182808181818081818181818182818181828081818181818181818181810000818280818181818181818181818081818182808181808181818181818181808081828081818181818181808181818181818280818181808181818100008081818182
8081818081818181818181818181818280818181818181818181818181818182808181818081818181818182818181828081808080808080008080808080818280818181808081818181808080818182808181808181818181818181818181828081818080818181808181818081818280818181818181808281818181818182
8081818181818080808080818181818280818181818181818181818181a4a582808181818081818100818182818181828081818181818181000000000081818280818181808080808080808081818182808181818181808080808081818181828081818181818181828181818181818280808081818181808281810082828282
808181818181808181818081818181828081c081818181818181818181b4b582808181818181818100818181818181828081808080808080808080808080818280818181818181810081818081818182808181818181808181818081818181828081818181818181008181818181818280818181818181808281818181818182
8581818181818081818180818181818585818181818181818181818181818182858181818181818082818181818181858581818181818180828181818181818585818181818181810081818181818185858181818181808181818081818181858581818181818181008181818181818585818181818181808281818181818185
8081818181818081818180818181818280818181818181818181818181818182808181818181818082818181818181828081818181818180828181818181818280818181808181810081818181818182808181818181808181818081818181828081818181818181008181818181818280818181818181810081818181818182
808181818181808081808081808181828081818181818181818181c081818182808181818181818082818181818181828081808080808080808080008080818280818181808181810080808081818182808181818181808081808081808181828080808080808281008181818281818280818181818181000081818181008182
8081818181818181818181818081818280818181818181818181818181818182808181818181818082818181818181828081818181818181008181818181818280818181808181818181818181818182808181818181818181818181808181828081818181818181008181818181818280818181818180808080818181818182
8081818080808081818181818081818280818181818181818181818181818182808181818181818082818181818181828081808000808080808080808080818280818181808181818181818181818182808181808080808181818181808181828081818181818180808080818181818280818080808080818180808080808182
8081818181818181818181818081818280818181818181818181818181818182808181818181818181818181818181828081818181818181818181818181818280818181808080818181818181818182808181818181818181818181808181828081818181818181818181818181818280818000008181818181818181808182
8081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818181818181818181818280818181818181818181818181818182
8380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083
8380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083
8380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083
8081818081818081818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818180818181818181818280818181818181818181818181818182
8081818081818081818181818181818280818181818080808282828181818182808181818181818182828181818181828081818181818181818080808081818280818181818181818181818181818182808081808180818081808180818081828081818181818080808181818181818280818181818181818181818181818182
8081818081818081818181818181818280818181808000000000828200818182808182828282818182828282818181828081818181818181818181818081818280818181808281818182828281818182808181818181818081818181818181828081818181818181818181818181818280818180828181818181008082818182
8081818181818081818181818181818280818180800000008100008282818182808181828181818182828282818181828081828180808181818181818081818280818180808282818181818282818182808081808080818081808180818081828081818082818080808181818181818280818180828181818181818082818182
8081818181818081818181808181818280818080818181810081818182828182808181818081818182818181818181828081828181808081000081818081818280818080808282820081818181818182808181818181818181818180818181828081818082818180818181818181818280818181818181818181818181818182
8081818181818081818181808181818280818081818181810081818181828182808182828282818182818181818181828081828181818080000081818181818280818181818181810081808181828282808081808180818081808180818081828081818181818180818181818181818280818181818181818181818181818182
8581818181818081818181808181818585818181818181810081818181818185858181818181818282818181818181858581818181818180800081818181818585818181818181810081808181818185858181818181818181808181818181858581818181818180818181818181818585818181818181818181818181818185
8081818181818081818181808181818280818281818181810081818181808182808181818181818282818182808181828081828181818181808081818181818280818181818180810081808181828282808081808180818081808180818081828081818181818180818181818181818280818181818181818181818181818182
8081818181818081818181808180818280818082818181810081818180828182808181808080818082818182808181828081828181818181000081818181818280818181818180810081818181818182808181808181818181818181818181828081818181818180818181818181818280818181818181818181818181818182
8080808081818181818181808180818280818180828181818181818082818182808181818180818180828282808181828081828181818282818181818181818280818180808080818181818181818182808081808180818081808080818081828081818181818190818181808281818280818180828181818181818082818182
8081818181818181818181808181818280818181808281818181828281818182808181808080818181818080808181828081828181828281818080808081818280818181818180818181818282818182808181818181818181818181818181828081818181818180818181808281818280818180828181818181818082818182
8080808081818181818181808181818280818181818082808282828181818182808181808080818181818181818181828081818182828181818180808181818280818181818180818182828281818182808081808180818081808180818081828081818181818180818181818181818280818181008181818181818181818182
8081818181818181818181808181818280818181818181818181818181818182808181808080818181818181818181828081818181818181818181818181818280818181818181818181818181818182808181818181818181818181818181828081818181818180818181818181818280818181818181818181818181818182
8380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083838080808080808080808080808080838380808080808080808080808080808383808080808080808080808080808083
