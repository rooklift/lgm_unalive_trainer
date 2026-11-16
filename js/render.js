/*
 * Drawing: the 15 x 15 square view of the map, and on it the men, the
 * tank, shells, explosions and the gunsight.
 *
 * Where a sprite goes, and how WinBolo's three "animation smoothness"
 * settings change that, is ported from WinBolo's sprite_positions.c
 * (John Morrison and contributors, GPL).
 */

"use strict";
(function () {

const { MAP_SIZE } = window.BoloMap;
const { TILE, NAMES, name_for } = window.BoloTiles;
const { get_dir } = window.BoloSim;

const VIEW_SQUARES = 15;
const VIEW_PIXELS = VIEW_SQUARES * TILE; /* 240: classic Bolo's map view */

const ANIM_CLASSIC = 0;          /* whole game pixels */
const ANIM_MATCH_PIXELATION = 1; /* snapped to one texel of the sprite art */
const ANIM_SMOOTH = 2;           /* as fine as the screen allows */

const TANK_SUBTRACT = 128;

/* Where the tip of each of the 16 shell sprites is, in pixels from the
 * sprite's corner: the tip, not the corner, is put on the shell's position. */
const SHELL_TIP_COL = [1.5, 3, 4, 4, 4, 4, 4, 3, 1.5, 0, 0, 0, 0, 0, 0, 0];
const SHELL_TIP_ROW = [0, 0, 0, 0, 1.5, 3, 4, 4, 4, 4, 3, 3, 1.5, 0, 0, 0];

const two_digits = i => String(i).padStart(2, "0");

const SPRITE_NAMES = (() => {
	let n = NAMES.slice();
	for (let i = 0; i < 16; i++) n.push("tank_self_" + two_digits(i), "tank_selfboat_" + two_digits(i), "shell_" + two_digits(i));
	for (let i = 1; i <= 8; i++) n.push("explosion" + i);
	for (let i = 0; i <= 2; i++) n.push("lgm_frame" + i);
	n.push("crosshair");
	return n;
})();

let sprites = new Map(); /* name -> image */

/* Loads every sprite. Resolves when all have settled; a missing file
 * only leaves its sprite undrawn. */
function load_sprites(base = "sprites/") {
	return Promise.all(SPRITE_NAMES.map(name => new Promise(resolve => {
		let img = new Image();
		img.addEventListener("load", () => {
			sprites.set(name, img);
			resolve();
		});
		img.addEventListener("error", () => {
			console.warn("Missing sprite: " + name);
			resolve();
		});
		img.src = base + name + ".png";
	})));
}

/* spritePositionOffset: how far along one axis, in game pixels, something
 * at WORLD coordinate w is drawn. The art here is WinBolo's classic 16
 * pixel sheet, one texel to a game pixel, so "match pixelation" snaps to
 * the nearest whole game pixel where classic rounds down to one. */
function position(mode, w) {
	if (mode === ANIM_SMOOTH) return w / 16;
	if (mode === ANIM_MATCH_PIXELATION) return Math.floor(w / 16 + 0.5);
	return w >> 4;
}

/* Draws one frame. scale is canvas pixels per game pixel. options is
 * { smoothness, show_gunsight }. */
function draw(ctx, game, scale, options) {
	let mode = options.smoothness;
	let view = game.view;
	let size = VIEW_PIXELS * scale;

	ctx.imageSmoothingEnabled = false;

	if (game.view_is_static()) {
		draw_static(ctx, scale);
		return;
	}

	/* Game pixel of the view's top left corner. Everything below is
	 * placed in game pixels from there, then scaled. */
	let base_x = (view.x + 1) * TILE;
	let base_y = (view.y + 1) * TILE;
	let put = (name, x, y) => {
		let img = sprites.get(name);
		if (!img) return;
		ctx.drawImage(img, (x - base_x) * scale, (y - base_y) * scale, img.width * scale, img.height * scale);
	};

	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, size, size);

	for (let my = view.y + 1; my <= view.y + VIEW_SQUARES; my++) {
		for (let mx = view.x + 1; mx <= view.x + VIEW_SQUARES; mx++) {
			let inside = mx >= 0 && my >= 0 && mx < MAP_SIZE && my < MAP_SIZE;
			put(inside ? name_for(game.grid, mx, my) : "deep_sea", mx * TILE, my * TILE);
		}
	}

	/* spritePositionLgm: a man is 3 x 4 pixels, centred on the middle of
	 * the game pixel he is in. He is only ever known to the pixel, so no
	 * setting moves him more finely; smooth just drops the last rounding. */
	for (let man of game.lgms) {
		if (man.gone) continue;
		let x = (man.x >> 4) - 1;
		let y = (man.y >> 4) - (mode === ANIM_SMOOTH ? 1.5 : 1);
		put("lgm_frame" + man.frame, x, y);
	}

	let tank = game.tank;
	if (!tank.destroyed) {
		let name = (tank.on_boat ? "tank_selfboat_" : "tank_self_") + two_digits(get_dir(tank.angle));
		put(name, position(mode, tank.x - TANK_SUBTRACT), position(mode, tank.y - TANK_SUBTRACT));
	}

	for (let shell of game.shells) {
		let dir = get_dir(shell.angle);
		put("shell_" + two_digits(dir), position(mode, shell.x) - SHELL_TIP_COL[dir], position(mode, shell.y) - SHELL_TIP_ROW[dir]);
	}

	/* length counts down from 8; the pictures run from explosion1, the
	 * first spark, to explosion8, the last of the debris. */
	for (let e of game.explosions) {
		put("explosion" + (9 - e.length), e.x >> 4, e.y >> 4);
	}

	/* The crosshair is 17 pixels square so that its middle pixel is the
	 * one a shell bursts on. Always on whole game pixels. */
	if (options.show_gunsight && !tank.destroyed) {
		let [gx, gy] = game.gunsight();
		put("crosshair", ((gx - TANK_SUBTRACT) & 0xffff) >> 4, ((gy - TANK_SUBTRACT) & 0xffff) >> 4);
	}
}

/* The static a dead player's view shows until the tank is back: chunky
 * grey noise, new every few frames. */
let static_canvas = null;
let static_age = 0;

function draw_static(ctx, scale) {
	const CELL = 2; /* game pixels per speck */
	let n = VIEW_PIXELS / CELL;
	if (!static_canvas) {
		static_canvas = document.createElement("canvas");
		static_canvas.width = static_canvas.height = n;
	}
	if (static_age-- <= 0) {
		static_age = 4;
		let sctx = static_canvas.getContext("2d");
		let data = sctx.createImageData(n, n);
		for (let i = 0; i < data.data.length; i += 4) {
			let v = Math.random() < 0.5 ? 0 : 60 + Math.floor(Math.random() * 196);
			data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
			data.data[i + 3] = 255;
		}
		sctx.putImageData(data, 0, 0);
	}
	ctx.drawImage(static_canvas, 0, 0, VIEW_PIXELS * scale, VIEW_PIXELS * scale);
}

window.BoloRender = { VIEW_PIXELS, ANIM_CLASSIC, ANIM_MATCH_PIXELATION, ANIM_SMOOTH, load_sprites, draw };

})();
