/*
 * Reader for Bolo "BMAPBOLO" version 1 map files, after the reader in
 * WinBolo's bolo_map.c (John Morrison), by way of the LGM map editor.
 *
 * File layout:
 *   "BMAPBOLO"                        8 bytes, no terminator
 *   version                           1 byte, must be 1
 *   nPills, nBases, nStarts           1 byte each, max 16
 *   pills   x,y,owner,armour,speed    5 bytes each
 *   bases   x,y,owner,armour,shells,mines  6 bytes each
 *   starts  x,y,dir                   3 bytes each
 *   runs    datalen,y,startx,endx + nibble RLE payload
 *   terminator run 04 FF FF FF
 *
 * Nibble RLE (high nibble first): length code 0-7 means the next
 * (code+1) nibbles are literal terrain codes; 8-15 means the next
 * single nibble repeats (code-6) times. Padded to a whole byte.
 * Squares not covered by any run are deep sea.
 */
"use strict";
(function () {

const MAP_SIZE = 256;

/* Terrain codes */
const BUILDING = 0, RIVER = 1, SWAMP = 2, CRATER = 3, ROAD = 4, FOREST = 5,
	RUBBLE = 6, GRASS = 7, HALFBUILDING = 8, BOAT = 9, DEEP_SEA = 0xff;

const MINE_START = 10, MINE_END = 15, MINE_SUBTRACT = 8;
const MAX_ITEMS = 16; /* pills, bases and starts each */

/* Returns { grid, pills, bases, starts }. grid is a Uint8Array indexed
 * [y * 256 + x]. The trainer has no mines, so mined terrain is loaded as
 * the terrain under the mine. */
function parse_map(bytes) {
	if (bytes.length < 12) throw new Error("File too short");
	let magic = String.fromCharCode(...bytes.subarray(0, 8));
	if (magic !== "BMAPBOLO") throw new Error("Not a Bolo map (bad BMAPBOLO header)");
	if (bytes[8] !== 1) throw new Error(`Unsupported map version ${bytes[8]}`);

	let n_pills = bytes[9], n_bases = bytes[10], n_starts = bytes[11];
	if (n_pills > MAX_ITEMS || n_bases > MAX_ITEMS || n_starts > MAX_ITEMS) {
		throw new Error("Too many pills/bases/starts");
	}

	let p = 12;
	let need = n => {
		if (p + n > bytes.length) throw new Error("Unexpected end of file");
	};

	let pills = [];
	for (let i = 0; i < n_pills; i++) {
		need(5);
		pills.push({ x: bytes[p], y: bytes[p + 1], owner: bytes[p + 2], armour: bytes[p + 3], speed: bytes[p + 4] });
		p += 5;
	}
	let bases = [];
	for (let i = 0; i < n_bases; i++) {
		need(6);
		bases.push({ x: bytes[p], y: bytes[p + 1], owner: bytes[p + 2], armour: bytes[p + 3], shells: bytes[p + 4], mines: bytes[p + 5] });
		p += 6;
	}
	let starts = [];
	for (let i = 0; i < n_starts; i++) {
		need(3);
		starts.push({ x: bytes[p], y: bytes[p + 1], dir: bytes[p + 2] });
		p += 3;
	}

	let grid = new Uint8Array(MAP_SIZE * MAP_SIZE);
	grid.fill(DEEP_SEA);

	for (;;) {
		/* A file that simply ends is a valid end of the run list (WinBolo
		 * tests feof first), so the 04 FF FF FF terminator is optional. */
		if (p + 4 > bytes.length) break;
		let datalen = bytes[p], y = bytes[p + 1], startx = bytes[p + 2], endx = bytes[p + 3];
		p += 4;
		if (datalen === 4 && y === 0xff && startx === 0xff && endx === 0xff) break;
		if (datalen < 4) throw new Error(`Bad run length ${datalen} at offset ${p - 4}`);
		let data_bytes = datalen - 4;
		need(data_bytes);

		let nibs = [];
		for (let i = 0; i < data_bytes; i++) {
			nibs.push(bytes[p + i] >> 4, bytes[p + i] & 0x0f);
		}
		p += data_bytes;

		let x = startx, i = 0;
		while (x < endx && i < nibs.length) {
			let code = nibs[i++];
			if (code >= 8) {
				if (i >= nibs.length) throw new Error("Truncated run payload");
				let t = nibs[i++];
				for (let k = 0; k < code - 6; k++) grid[y * MAP_SIZE + (x++ & 0xff)] = t;
			} else {
				for (let k = 0; k < code + 1; k++) {
					if (i >= nibs.length) throw new Error("Truncated run payload");
					grid[y * MAP_SIZE + (x++ & 0xff)] = nibs[i++];
				}
			}
		}
		if (x !== endx) throw new Error(`Run for row ${y} ended at ${x}, expected ${endx}`);
	}

	for (let i = 0; i < grid.length; i++) {
		if (grid[i] >= MINE_START && grid[i] <= MINE_END) grid[i] -= MINE_SUBTRACT;
	}

	return { grid, pills, bases, starts };
}

const BoloMap = {
	MAP_SIZE, BUILDING, RIVER, SWAMP, CRATER, ROAD, FOREST, RUBBLE, GRASS, HALFBUILDING, BOAT, DEEP_SEA,
	parse_map,
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = BoloMap;
} else {
	window.BoloMap = BoloMap;
}

})();
