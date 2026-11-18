/*
 * The simulation: one tank, its shells, and the little green men it is
 * here to shoot.
 *
 * The tank, boat, shell and man physics are ported from WinBolo
 * (John Morrison and contributors, GPL): tank.c, shells.c, lgm.c,
 * bolo_map.c, util.c, scroll.c and explosions.c. Routine names are given
 * in the comments so each piece can be checked against its source.
 *
 * Units, as in WinBolo: a WORLD coordinate is 16 bits, 256 to a map
 * square and 16 to a game pixel. Angles are "bradians", 256 to a circle,
 * 0 north, clockwise. The clock is a 10 ms half-step: odd half-steps
 * ("keys ticks") only turn the tank, even ones ("game ticks", 50 a
 * second) run everything.
 */

"use strict";
(function () {

const {
	MAP_SIZE, BUILDING, RIVER, SWAMP, CRATER, ROAD, FOREST, RUBBLE, GRASS,
	HALFBUILDING, BOAT, DEEP_SEA,
} = (typeof module !== "undefined" && module.exports) ? require("./map.js") : window.BoloMap;

/* ---------------------------------------------------------------- rules */

const TANK_ACCEL_RATE = 0.25;       /* speed gained per game tick */
const TANK_TERRAIN_DECEL_RATE = 0.25; /* drag when above the terrain's cap */
const TANK_SLOWKEY_RATE = 0.25;     /* the decelerate key */
const TANK_AUTOSLOW_RATE = 0.25;    /* auto slowdown, when the player has it on */
const TANK_MIN_MOVE_SPEED = 6;      /* residual speed needed to move at all */
const TANK_HIT_RADIUS = 112;        /* the circle that collides with walls */
const TANK_NUDGE_ITERATIONS = 5;
const TANK_TURN_RAMP_STEPS = 0;     /* half-steps a turn spends at an eighth of its rate. WinBolo: 6. Off here, on trial */
const TANK_RELOAD_TIME = 13;        /* game ticks between shots */
const TANK_DEATH_WAIT = 255;        /* game ticks before the respawn */
const TANK_WATER_TIME = 15;         /* game ticks per "glug" when wading */
const TANK_MOVE_BOAT_SUB = 64;      /* how far inside a bank a slow boat is held */
const TANK_SUBTRACT = 128;          /* tank centre to sprite corner */
const STATIC_ON_TICKS_DEEPSEA = 195; /* death wait below which the view is static */

const GUNSIGHT_MIN = 2;             /* in half squares */
const GUNSIGHT_MAX = 14;

const SHELL_LIFE = 8;               /* game ticks to cross one square */
const SHELL_SPEED = 32;             /* WORLD units per game tick */
const SHELL_START_ADD = 5;          /* steps a new shell starts ahead of the tank */

const EXPLOSION_START = 8;          /* frames, counted down */
const EXPLODE_UPDATE_TIME = 3;      /* game ticks per frame */

const LGM_MAX_FRAMES = 2;
const LGM_MAX_GOAL = 16;            /* how near his goal counts as arrived */
const LGM_BLAST_RADIUS = 128;       /* MAP_SQUARE_MIDDLE: a blast this near kills */

const MAP_MINE_EDGE_LO = 20;        /* the outer squares are all mined */
const MAP_MINE_EDGE_HI = 236;

const MAIN_SCREEN_SIZE = 15;        /* the view, in squares, both ways */
const SCROLL_CENTER = 8;
const NO_SCROLL_EDGE = 2;

const SDIST_SOFT = 15;              /* squares beyond which a sound is "far" */
const SDIST_NONE = 40;              /* and beyond which it is not heard */

/* Tank speed cap, tank turn rate and man speed for each terrain
 * (MAP_SPEED_T*, MAP_TURN_T* and MAP_MANSPEED_T* in bolo_map.h). */
const TERRAIN = new Map([
	[DEEP_SEA,     { speed: 3,  turn: 0.5,  man: 0 }],
	[BUILDING,     { speed: 0,  turn: 0,    man: 0 }],
	[RIVER,        { speed: 3,  turn: 0.25, man: 0 }],
	[SWAMP,        { speed: 3,  turn: 0.25, man: 4 }],
	[CRATER,       { speed: 3,  turn: 0.25, man: 4 }],
	[ROAD,         { speed: 16, turn: 1,    man: 16 }],
	[FOREST,       { speed: 6,  turn: 0.5,  man: 8 }],
	[RUBBLE,       { speed: 3,  turn: 0.25, man: 4 }],
	[GRASS,        { speed: 12, turn: 1,    man: 16 }],
	[HALFBUILDING, { speed: 0,  turn: 0,    man: 0 }],
	[BOAT,         { speed: 16, turn: 1,    man: 16 }],
]);
const SPEED_BOAT = 16;              /* also the speed a boat needs to land */
const TURN_BOAT = 1;

/* ------------------------------------------------- trainer's own rules */

const REGROW_MIN_TICKS = 50;        /* a shot tree comes back in 1 to 2 seconds */
const REGROW_MAX_TICKS = 100;
const LGM_MIN_RUN = 8;              /* squares between where a man starts and ends */
const LGM_MIN_OPEN = 3 * 256;       /* WORLD units of his run that must be out of the trees */
const LGM_RESPAWN_MIN_TICKS = 25;   /* wait before a replacement appears */
const LGM_RESPAWN_MAX_TICKS = 75;
const LGM_ROUTE_TRIES = 200;

/* ----------------------------------------------------------------- util */

const u16 = v => v & 0xffff;
const rand_int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/* roundDouble: round half away from zero */
function round_double(v) {
	return v >= 0 ? Math.trunc(v + 0.5) : Math.trunc(v - 0.5);
}

/* The radians utilCalcDistance works in. It takes pi as 3.14159, and so
 * does this. */
function bradians_to_radians(angle) {
	angle -= 64;
	if (angle < 0) angle += 256;
	let db = (360.0 / 256.0) * angle;
	return (db / 360.0) * (2.0 * 3.14159);
}

/* utilCalcDistance: the whole WORLD units moved at this angle and speed */
function calc_distance(angle, speed) {
	let rad = bradians_to_radians(angle);
	return [round_double(speed * Math.cos(rad)), round_double(speed * Math.sin(rad))];
}

/* utilCalcDistanceHP: the same in 1/256ths, for shells */
function calc_distance_hp(angle, speed) {
	let rad = bradians_to_radians(angle);
	return [round_double(speed * Math.cos(rad) * 256.0), round_double(speed * Math.sin(rad) * 256.0)];
}

/* utilGetDir: which of the 16 sprite directions an angle is drawn as.
 * A heading exactly halfway between two rounds down. */
function get_dir(angle) {
	if (angle <= 8 || angle > 248) return 0;
	return Math.ceil((angle - 8) / 16);
}

/* utilGet16Dir: the angle snapped to those 16 directions. Tanks move
 * along this, not along their exact angle; shells fly along the exact one. */
const get_16_dir = angle => get_dir(angle) * 16;

/* utilCalcAngle: the bearing from one point to another */
function calc_angle(x1, y1, x2, y2) {
	let dx = x2 - x1, dy = y2 - y1;
	let angle = Math.atan(Math.abs(dx) / Math.abs(dy));
	angle = (angle / (2.0 * 3.14159)) * 360.0;
	let ret = Math.fround((256.0 / 360.0) * angle);
	if (dx <= 0 && dy <= 0) return Math.fround(256 - ret);
	if (dx > 0 && dy >= 0) return Math.fround(128 - ret);
	if (dx <= 0 && dy >= 0) return Math.fround(ret + 128);
	return ret;
}

/* ------------------------------------------------------------- the game */

class Game {

	/* map is what parse_map returns. lgm_count is how many men to keep
	 * running about at once. */
	constructor(map, lgm_count) {
		this.grid = Uint8Array.from(map.grid); /* terrain as it is now */
		this.orig = Uint8Array.from(map.grid); /* terrain as the map had it */
		this.starts = map.starts;
		this.lgm_count = lgm_count;
		this.auto_slowdown = false; /* WinBolo's Auto Slowdown preference; the page sets it */

		this.shells = [];
		this.explosions = [];
		this.explosion_clock = 0;
		this.lgms = [];
		this.lgm_spawn_timers = []; /* game ticks until each missing man appears */
		this.regrow = [];           /* { x, y, ticks }: shot trees on their way back */
		this.sounds = [];           /* names of sounds for the caller to play and clear */
		this.stats = { shots: 0, kills: 0, escaped: 0, deaths: 0 };

		this.forest = []; /* every forest square on the map, as [x, y] */
		for (let y = 0; y < MAP_SIZE; y++) {
			for (let x = 0; x < MAP_SIZE; x++) {
				if (this.orig[y * MAP_SIZE + x] === FOREST) this.forest.push([x, y]);
			}
		}

		this.view = { x: 0, y: 0 }; /* see the scrolling section */
		this.tank = {
			x: 0, y: 0, angle: 0, speed: 0,
			on_boat: true, last_river_x: 0, last_river_y: 0,
			sight_len: GUNSIGHT_MAX, reload: 0,
			destroyed: false, death_wait: 0,
			water_count: 0, residual_speed: 0,
			first_left: 0, first_right: 0,
		};
		this.place_tank();
	}

	terrain(mx, my) {
		if (mx < 0 || my < 0 || mx >= MAP_SIZE || my >= MAP_SIZE) return DEEP_SEA;
		return this.grid[my * MAP_SIZE + mx];
	}

	/* Sound heard from square (mx, my): the near or far recording by
	 * distance from the tank, or nothing at all (soundDist). */
	sound_at(name, mx, my) {
		let gap_x = Math.abs(mx - (this.tank.x >> 8));
		let gap_y = Math.abs(my - (this.tank.y >> 8));
		if (gap_x < SDIST_SOFT && gap_y < SDIST_SOFT) this.sounds.push(name + "_near");
		else if (gap_x < SDIST_NONE && gap_y < SDIST_NONE) this.sounds.push(name + "_far");
	}

	/* ------------------------------------------------------------ clock */

	/* One 10 ms half-step. input is { accel, decel, left, right, shoot,
	 * sight }: the first four as tankButton would have them (at most one
	 * of each pair), sight +1 or -1 on the half-steps the range keys act. */
	step(input, is_game_tick) {
		let tank = this.tank;
		if (input.sight > 0 && tank.sight_len < GUNSIGHT_MAX) tank.sight_len++;
		if (input.sight < 0 && tank.sight_len > GUNSIGHT_MIN) tank.sight_len--;

		if (!is_game_tick) {
			if (!tank.destroyed) this.tank_turn(input);
			return;
		}

		this.tank_update(input);
		for (let man of this.lgms) this.lgm_update(man);
		this.lgms = this.lgms.filter(man => !man.gone);
		this.shells_update();
		this.explosions_update();
		this.regrow_update();
		this.lgm_spawn_update();
		if (tank.speed > 0 && !tank.destroyed) this.scroll_follow_tank();
	}

	/* ------------------------------------------------------------- tank */

	/* tankCreate / tankDeath: onto a boat at a random start, facing the
	 * way the start says (startsConvertDir turns the file's direction
	 * into sixteenths of a circle clockwise from north). */
	place_tank() {
		let tank = this.tank;
		let start = this.starts.length > 0 ? this.starts[rand_int(0, this.starts.length - 1)] : null;
		let mx = start ? start.x : MAP_SIZE / 2;
		let my = start ? start.y : MAP_SIZE / 2;
		tank.x = (mx << 8) + 128;
		tank.y = (my << 8) + 128;
		tank.angle = start ? ((20 - start.dir) & 15) * 16 : 0;
		tank.speed = 0;
		tank.residual_speed = 0;
		tank.on_boat = true;
		tank.destroyed = false;
		tank.death_wait = 0;
		tank.reload = 0;
		tank.water_count = 0;
		this.center_view_on_tank();
	}

	/* tankUpdate: one game tick of the tank */
	tank_update(input) {
		let tank = this.tank;
		let bmx = tank.x >> 8, bmy = tank.y >> 8;

		if (tank.reload > 0) tank.reload--;

		if (input.shoot && tank.reload === 0 && !tank.destroyed) {
			this.shell_add(tank.x, tank.y, tank.angle, tank.sight_len / 2, tank.on_boat);
			tank.reload = TANK_RELOAD_TIME;
			this.stats.shots++;
			this.sounds.push("shooting_self");
		}

		if (tank.death_wait > 0) {
			tank.death_wait--;
			if (tank.death_wait === 0) this.place_tank();
		} else if (!tank.on_boat && this.terrain(bmx, bmy) === DEEP_SEA) {
			this.sound_at("tank_sinking", bmx, bmy);
			tank.destroyed = true;
			tank.death_wait = TANK_DEATH_WAIT;
			this.stats.deaths++;
		} else {
			this.tank_move(input, bmx, bmy);
		}
	}

	/* mapGetSpeed */
	tank_speed_cap(mx, my) {
		if (this.tank.on_boat) return SPEED_BOAT;
		return TERRAIN.get(this.terrain(mx, my)).speed;
	}

	/* mapGetTurnRate */
	tank_turn_rate(mx, my) {
		let t = this.terrain(mx, my);
		if (this.tank.on_boat && (t === DEEP_SEA || t === RIVER)) return TURN_BOAT;
		return TERRAIN.get(t).turn;
	}

	/* tankTurn: runs on every half-step. In WinBolo a turn starts at an
	 * eighth of the terrain's rate and reaches the full rate after six
	 * half-steps of the key being held; with TANK_TURN_RAMP_STEPS at 0
	 * it is at the full rate from the first. */
	tank_turn(input) {
		let tank = this.tank;
		let rate = this.tank_turn_rate(tank.x >> 8, tank.y >> 8);
		if (input.left) {
			let amount = rate;
			if (tank.first_left < TANK_TURN_RAMP_STEPS) {
				tank.first_left++;
				amount /= 8;
				if (tank.first_left === 1) amount = this.tank_visible_turn(amount, true);
			}
			tank.angle -= amount;
			if (tank.angle < 0) tank.angle += 256;
		} else {
			tank.first_left = 0;
		}
		if (input.right) {
			let amount = rate;
			if (tank.first_right < TANK_TURN_RAMP_STEPS) {
				tank.first_right++;
				amount /= 8;
				if (tank.first_right === 1) amount = this.tank_visible_turn(amount, false);
			}
			tank.angle += amount;
			if (tank.angle > 256) tank.angle -= 256;
		} else {
			tank.first_right = 0;
		}
	}

	/* tankVisibleTurn: the first half-step of a fresh press turns far
	 * enough to move the gunsight a pixel, so a tap always shows. */
	tank_visible_turn(step, left) {
		let tank = this.tank;
		if (step <= 0) return step;
		let [sx, sy] = this.gunsight_at(tank.x, tank.y, tank.angle);
		for (let i = 1; i <= 128; i++) {
			let amount = step * i;
			if (amount > 16) break;
			let angle = tank.angle + (left ? -amount : amount);
			if (angle < 0) angle += 256;
			if (angle > 256) angle -= 256;
			let [nx, ny] = this.gunsight_at(tank.x, tank.y, angle);
			if ((nx >> 4) !== (sx >> 4) || (ny >> 4) !== (sy >> 4)) return amount;
		}
		return step;
	}

	/* tankAccel */
	tank_accel(input, bmx, bmy) {
		let tank = this.tank;
		let cap = this.tank_speed_cap(bmx, bmy);
		if (input.decel || tank.speed > cap) {
			let speed = tank.speed;
			if (tank.speed > cap) speed -= TANK_TERRAIN_DECEL_RATE;
			if (input.decel) speed -= TANK_SLOWKEY_RATE;
			tank.speed = Math.max(0, speed);
		} else if (tank.speed < cap && input.accel) {
			tank.speed = Math.min(cap, tank.speed + TANK_ACCEL_RATE);
		}
	}

	is_wall(mx, my) {
		let t = this.terrain(mx, my);
		return t === BUILDING || t === HALFBUILDING;
	}

	/* mapIsLand: anything but water, a moored boat included */
	is_land(mx, my) {
		let t = this.terrain(mx, my);
		return t !== RIVER && t !== DEEP_SEA;
	}

	/* mapIsMine, for the only mines the trainer has: the map's outer edge */
	is_edge_mine(mx, my) {
		return mx <= MAP_MINE_EDGE_LO || mx >= MAP_MINE_EDGE_HI || my <= MAP_MINE_EDGE_LO || my >= MAP_MINE_EDGE_HI;
	}

	/* tankCheckGroundClear: a tank that finds itself inside a wall edges
	 * out of it */
	tank_check_ground_clear(bmx, bmy) {
		let tank = this.tank;
		if (!this.is_wall(bmx, bmy)) return;
		tank.x = u16(tank.x + (((tank.x & 0xff) >> 4) >= 8 ? 1 : -1));
		tank.y = u16(tank.y + (((tank.y & 0xff) >> 4) >= 8 ? 1 : -1));
		tank.speed = Math.max(0, tank.speed - 1);
	}

	/* tankNudgeBuildings: the tank is a circle, each wall square a box;
	 * push the circle out of every box it overlaps, along the shortest
	 * way out, so it slides along walls and round corners. */
	tank_nudge_buildings() {
		let tank = this.tank;
		const R = TANK_HIT_RADIUS;
		let cx = tank.x, cy = tank.y;
		for (let pass = 0; pass < TANK_NUDGE_ITERATIONS; pass++) {
			let cmx = cx >> 8, cmy = cy >> 8;
			let moved = false;
			for (let gy = cmy - 1; gy <= cmy + 1; gy++) {
				for (let gx = cmx - 1; gx <= cmx + 1; gx++) {
					if (gx < 0 || gy < 0 || gx > 255 || gy > 255) continue;
					if (!this.is_wall(gx, gy)) continue;
					let min_x = gx << 8, max_x = min_x + 256;
					let min_y = gy << 8, max_y = min_y + 256;
					let qx = cx < min_x ? min_x : (cx > max_x ? max_x : cx); /* closest point of the box */
					let qy = cy < min_y ? min_y : (cy > max_y ? max_y : cy);
					let dx = cx - qx, dy = cy - qy;
					let d2 = dx * dx + dy * dy;
					if (d2 >= R * R) continue;
					if (d2 > 0) {
						let dist = Math.fround(Math.sqrt(d2));
						let scale = Math.fround((R - dist) / dist);
						cx += Math.trunc(dx * scale);
						cy += Math.trunc(dy * scale);
					} else {
						/* centre inside the box: out by the nearest edge */
						let p_l = cx - min_x, p_r = max_x - cx, p_t = cy - min_y, p_b = max_y - cy;
						let m = Math.min(p_l, p_r, p_t, p_b);
						if (m === p_l) cx -= m + R;
						else if (m === p_r) cx += m + R;
						else if (m === p_t) cy -= m + R;
						else cy += m + R;
					}
					moved = true;
				}
			}
			if (!moved) break;
		}
		tank.x = Math.max(0, Math.min(0xffff, cx));
		tank.y = Math.max(0, Math.min(0xffff, cy));
	}

	/* The boat a tank steps out of stays moored on the last river square
	 * it crossed, if that is next to where the tank landed. */
	tank_leave_boat(mx, my) {
		let tank = this.tank;
		let rx = tank.last_river_x, ry = tank.last_river_y;
		if (Math.abs(mx - rx) + Math.abs(my - ry) <= 2 && this.terrain(rx, ry) === RIVER) {
			this.grid[ry * MAP_SIZE + rx] = BOAT;
		}
		tank.on_boat = false;
	}

	/* tankMoveUnified: turn, accelerate, move, then sort out walls,
	 * boats and water. bmx, bmy is the square the tank started the tick on. */
	tank_move(input, bmx, bmy) {
		let tank = this.tank;

		this.tank_check_ground_clear(bmx, bmy);
		this.tank_turn(input);
		this.tank_accel(input, bmx, bmy);

		/* Auto slowdown: with neither the accelerate nor the decelerate key
		 * down the tank slows as if braking. Turning alone does not stop it. */
		if (this.auto_slowdown && tank.speed > 0 && !input.accel && !input.decel) {
			tank.speed = Math.max(0, tank.speed - TANK_AUTOSLOW_RATE);
		}

		/* Speed is banked until there is enough of it to move, so a tank at
		 * speed 3 moves 6 units every other tick. */
		tank.residual_speed += Math.trunc(tank.speed);
		if (tank.residual_speed >= TANK_MIN_MOVE_SPEED) {
			let [dx, dy] = calc_distance(get_16_dir(tank.angle), tank.residual_speed);
			tank.x = u16(tank.x + dx);
			tank.y = u16(tank.y + dy);
			tank.residual_speed = 0;
		}

		this.tank_nudge_buildings();

		let mx = tank.x >> 8, my = tank.y >> 8;
		let here = this.terrain(mx, my);

		if (tank.on_boat) {
			if (here === RIVER) {
				tank.last_river_x = mx;
				tank.last_river_y = my;
			} else if (here === BOAT) {
				/* ran down a moored boat */
				this.grid[my * MAP_SIZE + mx] = RIVER;
				this.explosion_add((mx << 8) + 128, (my << 8) + 128);
				this.sound_at("shot_building", mx, my);
			}

			/* A boat below landing speed is held a little inside its water
			 * square wherever the next square is land, so the tank does not
			 * ride half onto the bank before being turned back. */
			if (tank.speed < SPEED_BOAT && !this.is_land(mx, my)) {
				let min_x = mx << 8, max_x = min_x + 255;
				let min_y = my << 8, max_y = min_y + 255;
				let held = (ax, ay) => ax >= 0 && ay >= 0 && ax <= 255 && ay <= 255 && this.is_land(ax, ay) && this.terrain(ax, ay) !== BOAT;
				if (held(mx - 1, my)) tank.x = Math.max(tank.x, min_x + TANK_MOVE_BOAT_SUB);
				if (held(mx + 1, my)) tank.x = Math.min(tank.x, max_x - TANK_MOVE_BOAT_SUB);
				if (held(mx, my - 1)) tank.y = Math.max(tank.y, min_y + TANK_MOVE_BOAT_SUB);
				if (held(mx, my + 1)) tank.y = Math.min(tank.y, max_y - TANK_MOVE_BOAT_SUB);
			}

			if (this.is_land(mx, my)) {
				if (this.is_wall(mx, my) || tank.speed >= SPEED_BOAT) {
					this.tank_leave_boat(mx, my);
				} else {
					/* Too slow to land: back onto the square it came from, one
					 * axis at a time so it can still slide along the bank. */
					let x_crossed = mx !== bmx && this.is_land(mx, bmy);
					let y_crossed = my !== bmy && this.is_land(bmx, my);
					if (!x_crossed && !y_crossed) x_crossed = y_crossed = true;
					if (x_crossed) tank.x = Math.max(bmx << 8, Math.min((bmx << 8) + 255, tank.x));
					if (y_crossed) tank.y = Math.max(bmy << 8, Math.min((bmy << 8) + 255, tank.y));
				}
			}

			/* The map's outer edge is mined, and a mine takes the boat. */
			if (tank.on_boat && this.is_edge_mine(bmx, bmy)) {
				this.sound_at("mine_explosion", bmx, bmy);
				this.explosion_add((bmx << 8) + 128, (bmy << 8) + 128);
				tank.on_boat = false;
				tank.speed = 0;
			}
		} else {
			if (here === BOAT) {
				/* drove onto a moored boat: aboard */
				this.grid[my * MAP_SIZE + mx] = RIVER;
				tank.on_boat = true;
				tank.last_river_x = mx;
				tank.last_river_y = my;
			} else if (here === RIVER && tank.speed <= TERRAIN.get(RIVER).speed) {
				/* Wading. This is where a real tank's shells and mines leak
				 * away; here it only makes the noise. */
				tank.water_count++;
				if (tank.water_count === TANK_WATER_TIME) {
					tank.water_count = 0;
					this.sounds.push("bubbles");
				}
			}
		}
	}

	/* tankGetGunsightAt: the WORLD position a shell fired from here at
	 * this angle and the current range would burst at. */
	gunsight_at(x, y, angle) {
		let [x_step, y_step] = calc_distance_hp(angle, SHELL_SPEED);
		let x_acc = 0, y_acc = 0;
		let total = (SHELL_LIFE * this.tank.sight_len) >> 1;
		for (let i = 0; i < total; i++) {
			x_acc += x_step;
			y_acc += y_step;
			x = u16(x + (x_acc >> 8));
			y = u16(y + (y_acc >> 8));
			x_acc &= 0xff;
			y_acc &= 0xff;
		}
		let [lead_x, lead_y] = calc_distance(angle, SHELL_SPEED);
		return [u16(x + lead_x), u16(y + lead_y)];
	}

	gunsight() {
		return this.gunsight_at(this.tank.x, this.tank.y, this.tank.angle);
	}

	/* ----------------------------------------------------------- shells */

	/* shellsAddItem. len is the range in squares. */
	shell_add(x, y, angle, len, on_boat) {
		let [x_add, y_add] = calc_distance(angle, SHELL_SPEED);
		let [x_step, y_step] = calc_distance_hp(angle, SHELL_SPEED);
		this.shells.push({
			x: u16(x + SHELL_START_ADD * x_add),
			y: u16(y + SHELL_START_ADD * y_add),
			angle, on_boat, x_step, y_step, x_acc: 0, y_acc: 0,
			length: Math.max(0, 1 + Math.trunc(SHELL_LIFE * len) - SHELL_START_ADD),
		});
	}

	/* mapIsPassable: what a shell flies over. One fired from a boat flies
	 * low and stops at the first land of any kind. */
	shell_passes(mx, my, on_boat) {
		switch (this.terrain(mx, my)) {
			case DEEP_SEA: case RIVER: case CRATER: return true;
			case SWAMP: case ROAD: case RUBBLE: case GRASS: return !on_boat;
		}
		return false;
	}

	/* shellsUpdate. A man is not hit by a shell passing over him; he dies
	 * when one bursts close enough, at the end of its range or against
	 * something. */
	shells_update() {
		let live = [];
		for (let shell of this.shells) {
			if (shell.length > 0) {
				shell.x_acc += shell.x_step;
				shell.y_acc += shell.y_step;
				let nx = u16(shell.x + (shell.x_acc >> 8));
				let ny = u16(shell.y + (shell.y_acc >> 8));
				shell.x_acc &= 0xff;
				shell.y_acc &= 0xff;
				let mx = nx >> 8, my = ny >> 8;
				if (!this.shell_passes(mx, my, shell.on_boat)) {
					/* the burst is at the middle of the square it hit */
					this.shell_damage(mx, my);
					this.shell_burst((mx << 8) + 128, (my << 8) + 128);
				} else {
					shell.length--;
					shell.x = nx;
					shell.y = ny;
					live.push(shell);
				}
			} else {
				this.shell_burst(shell.x, shell.y);
			}
		}
		this.shells = live;
	}

	/* What a shell does to the square that stopped it (the terrain switch
	 * in shellsCalcCollision), by the trainer's rules. A tree is shot down
	 * to grass and is back a second or two later. A building becomes a
	 * shot building for good, and a shot building takes any number of
	 * hits without changing: in WinBolo it would wear down to rubble,
	 * which men and tanks can cross, and the map would come apart. A boat
	 * sinks. Soft ground hit from a boat is left as it was: in WinBolo it
	 * takes several hits to change. */
	shell_damage(mx, my) {
		let i = my * MAP_SIZE + mx;
		switch (this.grid[i]) {
			case FOREST:
				this.grid[i] = GRASS;
				this.regrow.push({ x: mx, y: my, ticks: rand_int(REGROW_MIN_TICKS, REGROW_MAX_TICKS) });
				this.sound_at("shot_tree", mx, my);
				break;
			case BUILDING:
				this.grid[i] = HALFBUILDING;
				this.sound_at("shot_building", mx, my);
				break;
			case HALFBUILDING:
				this.sound_at("shot_building", mx, my);
				break;
			case BOAT:
				this.grid[i] = RIVER;
				this.sound_at("shot_building", mx, my);
				break;
		}
	}

	shell_burst(x, y) {
		this.explosion_add(x, y);
		for (let man of this.lgms) {
			if (!man.gone && this.lgm_blast_catches(man, x, y)) {
				man.gone = true;
				this.stats.kills++;
				this.sound_at("man_dying", man.x >> 8, man.y >> 8);
				this.lgm_spawn_timers.push(rand_int(LGM_RESPAWN_MIN_TICKS, LGM_RESPAWN_MAX_TICKS));
			}
		}
	}

	/* ------------------------------------------------------- explosions */

	/* An explosion is drawn as a 16 pixel square centred on its pixel. */
	explosion_add(x, y) {
		this.explosions.push({ x: u16(x - TANK_SUBTRACT) & 0xfff0, y: u16(y - TANK_SUBTRACT) & 0xfff0, length: EXPLOSION_START });
	}

	/* explosionsUpdate: a frame every third game tick, all in step */
	explosions_update() {
		this.explosion_clock++;
		if (this.explosion_clock !== EXPLODE_UPDATE_TIME) return;
		this.explosion_clock = 0;
		for (let e of this.explosions) e.length--;
		this.explosions = this.explosions.filter(e => e.length >= 1);
	}

	/* ------------------------------------------------------------ trees */

	regrow_update() {
		for (let r of this.regrow) {
			if (--r.ticks > 0) continue;
			let i = r.y * MAP_SIZE + r.x;
			this.grid[i] = this.orig[i];
		}
		this.regrow = this.regrow.filter(r => r.ticks > 0);
	}

	/* -------------------------------------------------------------- men */

	lgm_speed(mx, my) {
		return TERRAIN.get(this.terrain(mx, my)).man;
	}

	/* One game tick of walking, as lgmMoveAway does it: straight at the
	 * goal at the speed of the ground underfoot, each axis blocked
	 * separately by ground a man cannot cross. Returns "arrived",
	 * "stuck" or "walking". speed_at(mx, my) is the ground speed to use. */
	lgm_walk(man, speed_at) {
		let bmx = man.x >> 8, bmy = man.y >> 8;
		let angle = calc_angle(man.x, man.y, man.dest_x, man.dest_y);
		let [x_add, y_add] = calc_distance(angle, speed_at(bmx, bmy));
		let new_bmx = u16(man.x + x_add) >> 8;
		let new_bmy = u16(man.y + y_add) >> 8;
		let no_go = false;
		let stuck = false;

		if (speed_at(bmx, new_bmy) > 0) {
			man.y = u16(man.y + y_add);
		} else {
			no_go = true;
			new_bmy = bmy;
		}
		if (speed_at(new_bmx, new_bmy) > 0 && x_add !== 0) {
			man.x = u16(man.x + x_add);
		} else if (no_go || y_add === 0) {
			stuck = true;
		}

		if (Math.abs(man.x - man.dest_x) <= LGM_MAX_GOAL && Math.abs(man.y - man.dest_y) <= LGM_MAX_GOAL) return "arrived";
		return stuck ? "stuck" : "walking";
	}

	/* lgmUpdate */
	lgm_update(man) {
		/* Where he was a tick ago is where a shell bursting this tick
		 * tests him: WinBolo judges a shell against what its player was
		 * shown, and single player is always one tick behind. */
		man.seen_x = man.x;
		man.seen_y = man.y;
		man.frame++;
		if (man.frame > LGM_MAX_FRAMES) man.frame = 0;
		let result = this.lgm_walk(man, (mx, my) => this.lgm_speed(mx, my));
		if (result !== "walking") {
			man.gone = true;
			if (result === "arrived") this.stats.escaped++;
			this.lgm_spawn_timers.push(rand_int(LGM_RESPAWN_MIN_TICKS, LGM_RESPAWN_MAX_TICKS));
		}
	}

	/* lgmBlastCatches: a burst within half a square kills. One against a
	 * wall only kills a man on that same square. */
	lgm_blast_catches(man, x, y) {
		let mx = x >> 8, my = y >> 8;
		if (this.is_wall(mx, my)) return (man.seen_x >> 8) === mx && (man.seen_y >> 8) === my;
		return Math.hypot(man.seen_x - x, man.seen_y - y) <= LGM_BLAST_RADIUS;
	}

	/* Keeps lgm_count men on the map, each new one after a short wait. */
	lgm_spawn_update() {
		while (this.lgms.length + this.lgm_spawn_timers.length < this.lgm_count) this.lgm_spawn_timers.push(0);
		while (this.lgms.length + this.lgm_spawn_timers.length > this.lgm_count && this.lgm_spawn_timers.length > 0) this.lgm_spawn_timers.pop();
		for (let i = 0; i < this.lgm_spawn_timers.length; i++) {
			if (this.lgm_spawn_timers[i] > 0) this.lgm_spawn_timers[i]--;
		}
		let ready = this.lgm_spawn_timers.filter(t => t === 0).length;
		this.lgm_spawn_timers = this.lgm_spawn_timers.filter(t => t > 0);
		for (let i = 0; i < ready; i++) {
			let man = this.lgm_new();
			if (man) this.lgms.push(man);
			else this.lgm_spawn_timers.push(LGM_RESPAWN_MAX_TICKS); /* no route found: try later */
		}
	}

	/* A man in one tree with another to run to: far enough apart, a
	 * straight run he can finish, and not one that stays in the forest
	 * all the way. Null if the map has no such pair to offer. */
	lgm_new() {
		if (this.forest.length < 2) return null;
		let is_tree = ([x, y]) => this.terrain(x, y) === FOREST; /* not one that is shot away just now */
		for (let attempt = 0; attempt < LGM_ROUTE_TRIES; attempt++) {
			let from = this.forest[rand_int(0, this.forest.length - 1)];
			let to = this.forest[rand_int(0, this.forest.length - 1)];
			if (Math.hypot(to[0] - from[0], to[1] - from[1]) < LGM_MIN_RUN) continue;
			if (!is_tree(from) || !is_tree(to)) continue;
			let man = {
				x: (from[0] << 8) + 128, y: (from[1] << 8) + 128,
				dest_x: (to[0] << 8) + 128, dest_y: (to[1] << 8) + 128,
				frame: 0, gone: false,
			};
			if (!this.lgm_route_ok(man)) continue;
			man.seen_x = man.x;
			man.seen_y = man.y;
			return man;
		}
		return null;
	}

	/* Walks the route on the map as loaded, and says whether it arrives
	 * with enough of the way spent out of the trees. */
	lgm_route_ok(man) {
		let ghost = { x: man.x, y: man.y, dest_x: man.dest_x, dest_y: man.dest_y };
		let terrain_at = (mx, my) => this.orig[my * MAP_SIZE + mx];
		let speed_at = (mx, my) => TERRAIN.get(terrain_at(mx, my)).man;
		let open = 0;
		for (let tick = 0; tick < 10000; tick++) {
			let px = ghost.x, py = ghost.y;
			let result = this.lgm_walk(ghost, speed_at);
			if (terrain_at(ghost.x >> 8, ghost.y >> 8) !== FOREST) open += Math.hypot(ghost.x - px, ghost.y - py);
			if (result === "arrived") return open >= LGM_MIN_OPEN;
			if (result === "stuck") return false;
		}
		return false;
	}

	/* -------------------------------------------------------- scrolling */

	/* The view is MAIN_SCREEN_SIZE squares each way. view.x, view.y is the
	 * square up and left of its top left corner (WinBolo keeps a one
	 * square border), so the squares on screen are view.x + 1 to
	 * view.x + 15. It only ever moves by whole squares. */

	/* scrollCenterObject */
	center_view_on_tank() {
		let view = this.view;
		view.x = (u16(this.tank.x - TANK_SUBTRACT) >> 8) - SCROLL_CENTER;
		view.y = (u16(this.tank.y - TANK_SUBTRACT) >> 8) - SCROLL_CENTER;
	}

	/* manualScrollKeepsTankOnScreen: the scroll keys cannot push the tank
	 * out of the view */
	can_view_be(x, y) {
		let tank = this.tank;
		if (x < 0 || y < 0 || x + MAIN_SCREEN_SIZE > 255 || y + MAIN_SCREEN_SIZE > 255) return false;
		if (tank.x - TANK_SUBTRACT < (x + 1) * 256) return false;
		if (tank.x + TANK_SUBTRACT > (x + 1 + MAIN_SCREEN_SIZE) * 256) return false;
		if (tank.y - TANK_SUBTRACT < (y + 1) * 256) return false;
		if (tank.y + TANK_SUBTRACT > (y + 1 + MAIN_SCREEN_SIZE) * 256) return false;
		return true;
	}

	/* The scroll keys (the left, right, up and down cases of
	 * clientRenderFrame): the view moves a square if that keeps the tank
	 * in it. */
	scroll_by_square(dx, dy) {
		if (!this.can_view_be(this.view.x + dx, this.view.y + dy)) return;
		this.view.x += dx;
		this.view.y += dy;
	}

	/* scrollNoAutoScroll: a moving tank that comes within two squares of
	 * the edge it is heading for pulls the view along a square. */
	scroll_follow_tank() {
		let tank = this.tank, view = this.view;
		let angle = get_16_dir(tank.angle);
		let object_x = u16(tank.x - TANK_SUBTRACT) >> 8;
		let object_y = u16(tank.y - TANK_SUBTRACT) >> 8;
		let east = angle >= 16 && angle <= 112;
		let west = angle >= 144 && angle <= 240;
		let south = angle >= 80 && angle <= 176;
		let north = angle <= 48 || angle >= 208;
		if (object_x - view.x >= MAIN_SCREEN_SIZE - NO_SCROLL_EDGE && east) view.x++;
		if (object_x - 1 < view.x + NO_SCROLL_EDGE && west) view.x--;
		if (object_y - view.y >= MAIN_SCREEN_SIZE - NO_SCROLL_EDGE && south) view.y++;
		if (object_y <= view.y + NO_SCROLL_EDGE && north) view.y--;
	}

	/* Whether the view shows static instead of the map: from a little
	 * after the tank sinks until it is back. */
	view_is_static() {
		return this.tank.destroyed && this.tank.death_wait < STATIC_ON_TICKS_DEEPSEA;
	}
}

const BoloSim = { Game, get_dir };

if (typeof module !== "undefined" && module.exports) {
	module.exports = BoloSim;
} else {
	window.BoloSim = BoloSim;
}

})();
