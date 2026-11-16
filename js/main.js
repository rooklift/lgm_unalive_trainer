/*
 * The page: loads the map and the art, runs the clock, and wires the
 * options and the score to the game.
 *
 * Everything here is a plain script, not a module, and nothing is
 * fetched, so that the page runs when index.html is opened from disk.
 */
"use strict";
(function () {

const { parse_map } = window.BoloMap;
const { Game } = window.BoloSim;
const { Input } = window.BoloInput;
const { load_sprites, draw, VIEW_PIXELS, ANIM_SMOOTH } = window.BoloRender;

/* The maps on offer, as { name, data } with data the .map file in base64
 * (js/maps.js, written by embed_maps.py). The first is loaded at the
 * start; with more than one the page shows a chooser. */
const MAPS = window.BoloMaps || [];

const HALF_STEP_MS = 10;      /* WinBolo's GAME_TICK_LENGTH; every second one is a game tick */
const MAX_CATCH_UP_MS = 250;  /* longer gaps (a hidden tab) are dropped, not replayed */
const OPTIONS_KEY = "lgm_trainer_options";

const SOUND_MAX_VOICES = 12;  /* how many of one sound can be playing at once */
const SOUND_NAMES = [
	"shooting_self", "shot_tree_near", "shot_tree_far", "shot_building_near", "shot_building_far",
	"man_dying_near", "man_dying_far", "tank_sinking_near", "bubbles", "mine_explosion_near",
];

let $ = id => document.getElementById(id);

let canvas = $("game");
let ctx = canvas.getContext("2d");
let input = new Input($("keys"));
let game = null;
let scale = 1; /* canvas pixels per game pixel */

/* ------------------------------------------------------------- options */

let options = { map: 0, zoom: 2, smoothness: ANIM_SMOOTH, lgm_count: 2, sound: true };

function load_options() {
	try {
		let saved = JSON.parse(localStorage.getItem(OPTIONS_KEY)) || {};
		for (let key of Object.keys(options)) {
			if (typeof saved[key] === typeof options[key]) options[key] = saved[key];
		}
	} catch (e) {
		/* nothing saved that we can read: the defaults */
	}
	if (!MAPS[options.map]) options.map = 0;
}

function save_options() {
	try {
		localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
	} catch (e) {
		/* storage unavailable: the options last until the page is closed */
	}
}

/* The canvas is 240 game pixels each way, shown at the chosen whole-number
 * size. On a high density screen it carries more pixels than that, so
 * smooth movement can use them. */
function size_canvas() {
	let density = Math.max(1, Math.round(window.devicePixelRatio || 1));
	scale = options.zoom * density;
	if (canvas.width !== VIEW_PIXELS * scale) canvas.width = canvas.height = VIEW_PIXELS * scale;
	canvas.style.width = canvas.style.height = VIEW_PIXELS * options.zoom + "px";
}

function wire_options() {
	let number_option = (id, key, after) => {
		let el = $(id);
		el.value = String(options[key]);
		el.addEventListener("change", () => {
			options[key] = Number(el.value);
			save_options();
			if (after) after();
			el.blur(); /* give the keyboard back to the game */
		});
	};
	let check_option = (id, key) => {
		let el = $(id);
		el.checked = options[key];
		el.addEventListener("change", () => {
			options[key] = el.checked;
			save_options();
			el.blur();
		});
	};

	for (let [i, map] of MAPS.entries()) $("map").add(new Option(map.name, String(i)));
	$("map_option").hidden = MAPS.length < 2;

	number_option("map", "map", start_map);
	number_option("zoom", "zoom", size_canvas);
	number_option("smoothness", "smoothness");
	number_option("lgm_count", "lgm_count", () => {
		if (game) game.lgm_count = options.lgm_count;
	});
	check_option("sound", "sound");

	$("reset_keys").addEventListener("click", e => {
		input.reset_keys();
		e.currentTarget.blur();
	});
	$("reset_stats").addEventListener("click", e => {
		if (game) game.stats = { shots: 0, kills: 0, escaped: 0, deaths: 0 };
		e.currentTarget.blur();
	});
}

/* --------------------------------------------------------------- sound */

/* Sounds are <audio> elements, because unlike fetched and decoded sound
 * they load when the page is opened from disk. One element plays one
 * sound at a time, so each sound has as many as it has needed so far to
 * overlap itself: the gun's two seconds of echo are still going when
 * the next shot is fired. */
let sound_players = new Map(); /* name -> its <audio> elements */

function new_player(name) {
	let player = new Audio("sounds/" + name + ".wav");
	player.preload = "auto";
	return player;
}

function load_sounds() {
	for (let name of SOUND_NAMES) sound_players.set(name, [new_player(name)]);
}

function play_sounds(names) {
	if (!options.sound) return;
	for (let name of names) {
		let players = sound_players.get(name);
		if (!players) continue;
		let player = players.find(p => p.paused || p.ended);
		if (!player) {
			if (players.length >= SOUND_MAX_VOICES) continue;
			player = new_player(name);
			players.push(player);
		}
		player.currentTime = 0;
		/* A browser refuses to play before the first key or click, and a
		 * missing file cannot play at all; neither is worth a message. */
		player.play().catch(() => {});
	}
}

/* ---------------------------------------------------------------- loop */

let half_steps = 0;   /* even ones are game ticks, as in WinBolo */
let last_time = null;
let owed_ms = 0;

function frame(now) {
	requestAnimationFrame(frame);
	if (!game) return;

	if (last_time !== null) owed_ms += Math.min(now - last_time, MAX_CATCH_UP_MS);
	last_time = now;

	while (owed_ms >= HALF_STEP_MS) {
		owed_ms -= HALF_STEP_MS;
		let is_game_tick = half_steps % 2 === 0;
		let keys = input.sample(is_game_tick);
		if (keys.scroll.up) game.scroll_by_square(0, -1);
		if (keys.scroll.down) game.scroll_by_square(0, 1);
		if (keys.scroll.left) game.scroll_by_square(-1, 0);
		if (keys.scroll.right) game.scroll_by_square(1, 0);
		game.step(keys, is_game_tick);
		half_steps++;
	}

	play_sounds(game.sounds);
	game.sounds.length = 0;

	draw(ctx, game, scale, options);
	show_status();
}

/* Writes text into the page only when it has changed, so a frame in which
 * nothing changed costs the browser no layout. */
function show(id, text) {
	let el = $(id);
	if (el.textContent !== text) el.textContent = text;
}

function show_status() {
	let stats = game.stats, tank = game.tank;
	show("stat_kills", String(stats.kills));
	show("stat_shots", String(stats.shots));
	show("stat_ratio", stats.kills > 0 ? (stats.shots / stats.kills).toFixed(1) : "–");
	show("stat_escaped", String(stats.escaped));
	show("stat_range", (tank.sight_len / 2).toFixed(1));

	let message = "";
	if (tank.destroyed) message = "Your tank sank in deep sea. A new one is on its way.";
	else if (tank.on_boat) message = "You are on a boat. It has to be at full speed to land.";
	show("message", message);
}

/* --------------------------------------------------------------- start */

function start_map() {
	let map = MAPS[options.map];
	game = null;
	if (!map) {
		$("message").textContent = "There are no maps in js/maps.js. Run embed_maps.py to put some there.";
		return;
	}
	try {
		let bytes = Uint8Array.from(atob(map.data), c => c.charCodeAt(0));
		game = new Game(parse_map(bytes), options.lgm_count);
		last_time = null;
		owed_ms = 0;
		half_steps = 0;
	} catch (err) {
		$("message").textContent = "Could not load the map " + map.name + ": " + err.message + ".";
	}
}

load_options();
wire_options();
size_canvas();
load_sounds();
window.addEventListener("resize", size_canvas); /* moving to a screen of another density */
canvas.addEventListener("pointerdown", () => {
	/* a click on the game takes the keyboard back from whatever option had it */
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

load_sprites().then(start_map);
requestAnimationFrame(frame);

})();
