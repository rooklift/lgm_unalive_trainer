/*
 * Keyboard: which key does what, the boxes that let the player change
 * that, and the reading of the keys once every 10 ms half-step the way
 * WinBolo's inputGetKeys reads them (gui/sdl3/input.c, turn_tap.h).
 */
"use strict";
(function () {

/* Every action, in the order the setup boxes are shown. Keys are
 * KeyboardEvent.code values, so they name a physical key whatever the
 * keyboard layout. The defaults are WinBolo's. */
const ACTIONS = [
	{ id: "accelerate", label: "Accelerate", key: "KeyW" },
	{ id: "decelerate", label: "Decelerate", key: "KeyS" },
	{ id: "turn_left", label: "Turn anticlockwise", key: "KeyA" },
	{ id: "turn_right", label: "Turn clockwise", key: "KeyD" },
	{ id: "shoot", label: "Shoot", key: "Space" },
	{ id: "range_up", label: "Increase gun range", key: "NumpadAdd" },
	{ id: "range_down", label: "Decrease gun range", key: "Enter" },
	{ id: "scroll_up", label: "Scroll up", key: "ArrowUp" },
	{ id: "scroll_down", label: "Scroll down", key: "ArrowDown" },
	{ id: "scroll_left", label: "Scroll left", key: "ArrowLeft" },
	{ id: "scroll_right", label: "Scroll right", key: "ArrowRight" },
];

const STORAGE_KEY = "lgm_trainer_keys";
const INPUT_GUNSIGHT_WAIT_TIME = 6; /* half-steps between range changes while a key is held */
const INPUT_SCROLL_WAIT_TIME = 3;   /* half-steps between one-square scrolls of the view */

/* What to call a key on its box. */
function key_name(code) {
	if (!code) return "(none)";
	const NAMES = {
		Space: "Space", Enter: "Enter", NumpadEnter: "Num Enter", NumpadAdd: "Num +", NumpadSubtract: "Num -",
		NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .",
		ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
		Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
		Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
		ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
		AltLeft: "Left Alt", AltRight: "Right Alt",
	};
	if (NAMES[code]) return NAMES[code];
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return "Num " + code.slice(6);
	return code;
}

/* turn_tap.h: keeps a turn key press that began and ended between two
 * half-steps from being lost, and keeps two quick presses as two. */
class TurnTap {
	constructor() {
		this.reset();
	}

	reset() {
		this.physical_down = false;
		this.last_output = false;
		this.pending = 0;
	}

	event(down) {
		if (down && !this.physical_down) this.pending++;
		this.physical_down = down;
	}

	read(held) {
		if (this.pending && this.last_output) {
			this.last_output = false;
			return false;
		}
		if (this.pending) {
			this.pending--;
			held = true;
		}
		this.last_output = held;
		return held;
	}
}

class Input {

	/* box_parent is the element the key setup boxes are built in. */
	constructor(box_parent) {
		this.keys = {};          /* action id -> key code */
		this.held = new Set();   /* key codes down now */
		this.capturing = null;   /* action id whose box is waiting for a key */
		this.buttons = {};       /* action id -> its box */
		this.left_tap = new TurnTap();
		this.right_tap = new TurnTap();
		this.shoot_pressed = false; /* a shoot press not yet seen by a game tick */
		this.gunsight_count = 0;
		this.scroll_count = 0;

		this.load_keys();
		this.build_boxes(box_parent);

		window.addEventListener("keydown", e => this.on_key(e, true));
		window.addEventListener("keyup", e => this.on_key(e, false));
		window.addEventListener("blur", () => this.release_all());
	}

	load_keys() {
		let saved = {};
		try {
			saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
		} catch (e) {
			/* no saved keys, or none we can read: the defaults */
		}
		for (let action of ACTIONS) {
			this.keys[action.id] = typeof saved[action.id] === "string" ? saved[action.id] : action.key;
		}
	}

	save_keys() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keys));
		} catch (e) {
			/* storage unavailable: the keys last until the page is closed */
		}
	}

	reset_keys() {
		for (let action of ACTIONS) this.keys[action.id] = action.key;
		this.capturing = null;
		this.save_keys();
		this.refresh_boxes();
	}

	build_boxes(parent) {
		for (let action of ACTIONS) {
			let row = document.createElement("label");
			row.className = "key_row";
			let name = document.createElement("span");
			name.textContent = action.label;
			let button = document.createElement("button");
			button.type = "button";
			button.className = "key_box";
			button.addEventListener("click", () => {
				this.capturing = this.capturing === action.id ? null : action.id;
				this.refresh_boxes();
				button.blur(); /* so Space and Enter go to the game, not the button */
			});
			row.append(name, button);
			parent.append(row);
			this.buttons[action.id] = button;
		}
		this.refresh_boxes();
	}

	refresh_boxes() {
		for (let action of ACTIONS) {
			let button = this.buttons[action.id];
			let waiting = this.capturing === action.id;
			button.textContent = waiting ? "press a key…" : key_name(this.keys[action.id]);
			button.classList.toggle("waiting", waiting);
			button.classList.toggle("unset", !waiting && !this.keys[action.id]);
		}
	}

	release_all() {
		this.held.clear();
		this.left_tap.reset();
		this.right_tap.reset();
		this.shoot_pressed = false;
	}

	on_key(e, down) {
		if (this.capturing) {
			if (!down) return;
			e.preventDefault();
			if (e.code !== "Escape") {
				/* a key does one thing: take it off whatever had it */
				for (let action of ACTIONS) {
					if (this.keys[action.id] === e.code) this.keys[action.id] = "";
				}
				this.keys[this.capturing] = e.code;
				this.save_keys();
			}
			this.capturing = null;
			this.release_all();
			this.refresh_boxes();
			return;
		}

		if (e.target instanceof HTMLSelectElement) return; /* an open option list keeps its arrows */
		let action = ACTIONS.find(a => this.keys[a.id] === e.code);
		if (!action) return;
		/* Ctrl+W and the like are the browser's, unless the player has put
		 * an action on a modifier key and so holds one down to play. A
		 * release always counts, or the key would stay held. */
		let modifier_bound = ACTIONS.some(a => /^(Control|Alt|Meta)/.test(this.keys[a.id]));
		if (down && !modifier_bound && (e.ctrlKey || e.altKey || e.metaKey)) return;
		e.preventDefault(); /* no page scrolling on the arrows or Space */
		if (down) this.held.add(e.code);
		else this.held.delete(e.code);
		if (e.repeat) return;
		if (action.id === "turn_left") this.left_tap.event(down);
		if (action.id === "turn_right") this.right_tap.event(down);
		if (action.id === "shoot" && down) this.shoot_pressed = true;
	}

	is_held(id) {
		return this.held.has(this.keys[id]);
	}

	/* The keys as one 10 ms half-step sees them: what Game.step takes,
	 * plus scroll, the directions to move the view one square in now. */
	sample(is_game_tick) {
		/* turnTapReadPair */
		let left_held = this.is_held("turn_left"), right_held = this.is_held("turn_right");
		let turn_left = this.left_tap.read(left_held);
		let turn_right = false;
		if (!(turn_left && !left_held && !right_held && this.right_tap.pending && !this.right_tap.last_output)) {
			turn_right = this.right_tap.read(right_held);
		}

		/* The tankButton chain of inputGetKeys: one of nine states, so of
		 * two opposed keys held together only one counts. */
		let forward = this.is_held("accelerate"), backward = this.is_held("decelerate");
		let out = { accel: false, decel: false, left: false, right: false, shoot: false, sight: 0, scroll: { up: false, down: false, left: false, right: false } };
		if (forward && turn_right) out.accel = out.right = true;
		else if (forward && turn_left) out.accel = out.left = true;
		else if (backward && turn_left) out.decel = out.left = true;
		else if (backward && turn_right) out.decel = out.right = true;
		else if (forward) out.accel = true;
		else if (backward) out.decel = true;
		else if (turn_left) out.left = true;
		else if (turn_right) out.right = true;

		if (is_game_tick) {
			out.shoot = this.is_held("shoot") || this.shoot_pressed;
			this.shoot_pressed = false;
		}

		/* WinBolo with smooth scrolling off: the scroll keys are looked at
		 * every third half-step, and each one held moves the view a whole
		 * square. The count runs whether or not a key is down. */
		this.scroll_count++;
		if (this.scroll_count >= INPUT_SCROLL_WAIT_TIME) {
			this.scroll_count = 0;
			out.scroll.up = this.is_held("scroll_up");
			out.scroll.down = this.is_held("scroll_down");
			out.scroll.left = this.is_held("scroll_left");
			out.scroll.right = this.is_held("scroll_right");
		}

		/* A held range key acts at once, then every sixth half-step. */
		this.gunsight_count++;
		if (this.gunsight_count >= INPUT_GUNSIGHT_WAIT_TIME) {
			if (this.is_held("range_up")) {
				out.sight = 1;
				this.gunsight_count = 0;
			} else if (this.is_held("range_down")) {
				out.sight = -1;
				this.gunsight_count = 0;
			} else {
				this.gunsight_count = INPUT_GUNSIGHT_WAIT_TIME;
			}
		}

		return out;
	}
}

window.BoloInput = { Input };

})();
