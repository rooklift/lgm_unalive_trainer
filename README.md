# LGM Unalive Trainer

Practice for shooting little green men in Bolo / WinBolo. A web page: one tank, infinite shells, and men who keep running from tree to tree across open ground.

## Running it

Open `index.html` in a browser: double-clicking it is enough. Nothing needs installing or serving, though it works from a web server or GitHub Pages too.

## Playing

- Click a key box and press a key to set it. The defaults are WinBolo's: W / S accelerate and decelerate, A / D turn, Space shoots, Num + and Enter lengthen and shorten the gun range, and the arrow keys scroll the view.
- You start on a boat. A boat only lands at full speed, so keep accelerating into the shore.
- A man is not hit by a shell flying over him. He dies when a shell bursts within half a square of him: at the end of its range, where the gunsight is, or against the tree he is in.
- Shot trees grow back in a second or two.
- Driving into deep sea without a boat sinks the tank. A new one arrives at a start square about five seconds later.

## Maps

A page opened from disk cannot read files, so the maps are carried inside `js/maps.js`, which is written from the `.map` files in this folder by

```
python embed_maps.py
```

Run it again after adding, removing or editing a map; until then the page keeps the old copy. `basic.map` is the map the page starts on, and with more than one map the page shows a chooser. Men need forest to run between and ground they can cross in a straight line.

## How faithful it is

The tank, boat, shell and man physics are ported by hand from the WinBolo source, with the same constants and the same per-tick arithmetic: 10 ms half-steps, of which every second one is a full game tick. `js/sim.js` names the WinBolo routine each part comes from.

Deliberate differences, all from what a trainer is for:

- Shells and trees: ammunition never runs out, and terrain damaged by shells is restored after one to two seconds. Soft ground hit by a shell fired from a boat is not changed.
- The men are not builders with a tank to go back to. They appear in a tree, run straight to another, and vanish there.
- There are no pillboxes, bases, mines or other tanks. Mined squares in a map load as the terrain under the mine.
- The view scrolls as WinBolo does with auto-scrolling and smooth scrolling both off: a whole square at a time.
- "Match pixelation" snaps movement to one texel of the sprite art. This page uses WinBolo's classic 16-pixel art, where a texel is a game pixel, so it differs from "Classic" only in rounding to the nearest pixel instead of down.

## Credits

The physics is ported from [WinBolo](https://www.winbolo.com/) by John Morrison and contributors, and the sprites and sounds are WinBolo's. WinBolo is licensed under the GNU General Public License, version 3 or later, which applies to this derived work too. Bolo itself is by Stuart Cheshire.
