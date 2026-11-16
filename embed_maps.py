"""Writes js/maps.js from the .map files in this folder.

The page runs straight from disk, where a script cannot read files, so
the maps it offers are carried inside js/maps.js. Run this again after
adding, removing or editing a map:

	python embed_maps.py

basic.map, if there is one, comes first and so is the map the page
starts on; the rest follow in alphabetical order.
"""

import base64
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "js" / "maps.js"


def main():
	maps = sorted(HERE.glob("*.map"), key = lambda p: (p.stem.lower() != "basic", p.stem.lower()))
	if not maps:
		raise SystemExit("No .map files in " + str(HERE))

	lines = [
		"/* The maps the page offers, each a .map file in base64. Written by",
		" * embed_maps.py: do not edit, run that again instead. */",
		'"use strict";',
		"window.BoloMaps = [",
	]
	for path in maps:
		data = path.read_bytes()
		if not data.startswith(b"BMAPBOLO"):
			raise SystemExit(path.name + " is not a Bolo map")
		entry = {"name": path.stem, "data": base64.b64encode(data).decode("ascii")}
		lines.append("\t" + json.dumps(entry, ensure_ascii = False) + ",")
		print(f"{path.name}: {len(data)} bytes")
	lines.append("];")

	OUT.write_text("\n".join(lines) + "\n", encoding = "utf-8", newline = "\n")
	print("Wrote " + str(OUT.relative_to(HERE)))


if __name__ == "__main__":
	main()
