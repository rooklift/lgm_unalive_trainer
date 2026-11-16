Desiderata:

A trainer for Bolo / WinBolo LGM sniping. Implement as a website:

* A game window of the correct size as classic Bolo's actual main game box (none of the peripherals needed).
* Alongside that, easy-to-use key setup boxes, i.e. click a box and press the key.
* Required keys and player actions:
  - Accelerate, decelerate, turn clockwise, turn anticlockwise.
  - Increase gun range, decrease gun range, shoot.
  - Camera scroll up, down, left, right.
* Don't implement the other player actions, i.e. the player has no LGM of his own.

The trainer:

* Load the map included (assume future versions might have other maps).
* Enemy LGMs mysteriously spawn in trees and run to some tree some meaningful distance away; reject any path that makes them travel only through forest.
* Player has infinite ammo (but no mines) with which to practice shooting LGMs.
* Trees can be shot but grow back within a second or two.
* The player can only "die" by driving into deep sea; respawn as normal.

Notes:

Source code and graphics for Bolo and WinBolo is available in the obvious places locally. Use WinBolo as the main reference for gameplay, as if "animation smoothness" was set to "smooth" mode. Actually - ideally there could be an option to switch between WinBolo's "animation smoothness" settings.

You'll have to be careful to get the physics accurate. Recommend you spend some time reading and understanding Bolo and/or WinBolo code.

