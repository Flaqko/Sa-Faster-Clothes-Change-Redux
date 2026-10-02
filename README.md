# Faster Clothes Change Redux v1.0

Original mod and clothing animation by **Junior_Djjr**.  
CLEO Redux port/remaster by **Flaqko**.

Target: **GTA San Andreas Classic 1.0 + CLEO Redux**.

## What it does

Speeds up the clothes-changing sequences while preserving GTA's normal wardrobe logic and Junior_Djjr's body-part camera framing.

The release uses a private animation block named **`FClothes`**. GTA's vanilla `CLOTHES` block remains intact as the wardrobe-facing block; once it is streamed, its 13 animation hierarchies are redirected to Junior_Djjr's initialized stripped animation data.

## Installation

Copy the folder:

`FasterClothesChange[mem]`

into your GTA San Andreas `CLEO` folder.

Keep the `[mem]` permission tag on the folder name.

## Files

- `index.js` — CLEO Redux script
- `animations/FClothes.ifp` — bundled private animation block (`FClothes`)

## Release notes

- Based on the proven v0.8 camera-hold build.
- 13/13 clothing animations use Junior_Djjr's stripped animation data.
- Donor animations are initialized through GTA before redirecting them.
- No `TASK_PLAY_ANIM` injection.
- No animation-speed workaround.
- Camera holds the last detected Hat/Legs/Shoes/Torso/Watch framing instead of snapping back between the very short pose animations.
- Debug logging disabled for release.
