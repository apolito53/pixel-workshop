# Stardrop: A Moonkeeper Tale
## Pixel Workshop production dogfood / 2026-11-01

**Goal:** use Pixel Workshop for a real, playable mini-game, with its own original characters, multi-frame animations, scenery, environment art, and generated VFX. Keep production notes rather than treating the editor as a one-off drawing toy.

**Play:** /play/moonkeeper on the deployed site. A/D or arrows to move, Space/Up to jump, Shift/K to pulse. Touch controls are provided. Catch twelve falling stars before the timer expires and avoid shades.

**Source of truth:** lib/stardrop-art.ts. All ten assets are built from Pixel Workshop's own createDocument/applyCommands (pixel, line, rect, ellipse, layers, frames) or generateEffectCommands (sparkles, explosion, shockwave). The gallery exports the actual native projects; it is not using a hidden pile of externally generated images. The game rasterizes the shared engine's frameView/composite and plays the resulting cels.

**Art produced:** a layered moonlit mountain valley, six-frame lantern keeper, four-frame star, four-frame shade, six-frame stone beacon, two-layer pine, grass tile, eight-frame ambient sparkles, eight-frame explosion, eight-frame shockwave.

### Production diary: genuine friction

**1. Sprite clips are only numbered frames. High priority.** The same base document can carry animation frames, but there is no native distinction between idle, walk, jump, hit, glow, or death. The game has to decide which numbered frame means what. Proposed: named clips and per-clip FPS/loop/once/ping-pong flags, plus optional tags such as facing and pivot point. Supporting a sprite with more than one animation requires several separate canvases today or conventions outside the file.

**2. Art pack exports need orchestration. High priority.** Each canvas exports separately. I had to construct an additional in-game art gallery, conversion from native RGBA to browser canvases, a sheet downloader, an asset manifest and a manual name map. Proposed: "Export game pack" with named assets, PNG sheets, atlas JSON, pivots, tags, frame timing and a manifest in a single ZIP, optionally with source .pixel.json files.

**3. No game-scale tilemap or tileset workflow. High priority.** The full environment was rendered as a 192×120 pixel document and scaled at 2×. That works for a fixed-screen game, but extending the valley into a scrolling level requires custom chunking, autotiling and collision metadata. Proposed: tilesets, reusable stamps, bucket fill by tile ID, tilemap layers, autotile rules and a map export suitable for engines.

**4. The procedural FX output is destructive-to-parameters. High priority.** Sparkles, explosion and shockwave are excellent seed-driven starting points, but the current implementation bakes every frame into pixels. Tweaking density, radius, velocity or duration means regenerating the entire layer, and there are few exposed controls beyond effect, seed and ink. Proposed: keep an editable recipe alongside baked cels, expose intensity, lifetime, speed and direction, and support repeatable regeneration.

**5. Effects are fixed around generic loops. Medium priority.** For the game I had to time and remove explosion/pulse frames programmatically to avoid unwanted looping. Proposed: explicit one-shot, looping, ping-pong and hold-last policies, plus effect duration and a preview against arbitrary backgrounds.

**6. Bulk precision authoring is verbose. Medium priority.** Building and adjusting a sprite required many repeated shape commands per frame. The engine correctly applies them in a single atomic batch, but generating lots of coherent art is clunky without reusable symbols and transformations at the asset level. Proposed: named brushes/stamps, layers shared across frames, linked cels, palette remapping across a whole pack, and programmatic templates/prefabs.

**7. Current canvas limits shape the art direction. Medium priority.** 256×256 max per project, eight layers and 32 frames are great for small sprites but restrictive for broad environments, multi-animation characters or deep parallax. The test uses one scaled 192×120 backdrop with four layers and several standalone docs. Proposed: separate resource budgets for tilemaps/background scenes, sprite and effects documents.

**8. Native pixel projects are verbose on disk. Medium priority.** Packed RGBA integers are represented as JSON arrays per pixel per layer and per frame. The 192×120 ambient effect requires full cels even when mostly transparent. Proposed: RLE/sparse rows, deduplicated unchanged cels, PNG-based layer compression or a versioned binary container, while preserving the current import format.

**9. Asset creation was possible via the shared code engine, but the remote MCP connection was not directly available in this session. Integration priority.** The workshop advertises a scoped remote MCP endpoint, but I did not have an authorized Pixel Workshop workspace token or a registered editor MCP tool here. Instead I used the very same Pixel Workshop engine in this repo directly, saving the generators as project source. Proposed: one-click workspace connector/onboarding so an agent can create, inspect and revise project art inside the *same* browser workspace, with scoped auth and no token copied into chat.

**10. Immediate visual review loop can be tighter. Medium priority.** Generated previews and native exports are available, but there is no bulk contact-sheet review of all frames/variants, side-by-side atlas comparison, or in-context game preview built into the workshop. Proposed: multi-asset board, onion-skin across clips, and a preview playground that plays selected frames with sample movement or scene props.

### What worked

The cell-precise drawing engine, layered compositing, additive paint operations, shared animation format and seeded procedural effects are useful, concrete building blocks. Source-backed native project files mean the art stays editable. No image-generation API, external asset service, or mystery textures were needed for the game.

### Verification & boundaries

- tests/stardrop.test.ts validates all ten project documents, animation changes, layer structure and pixel-level determinism.
- The playable route and art gallery intentionally avoid workspace storage: demo visitors do not need a session or overwrite someone's project. Download a native asset and import it into the editor to customize it.
- This is a small, fixed-screen browser arcade prototype, not yet a full tileset-driven engine, mobile app, or multi-level game.
- During review, record build failures, gameplay problems and visual issues here before adding future features.

### Recommended next milestone

Implement **game pack export + named animation clips**, then do another dogfood build with a scrolling level, enemy attack animations and real tiles. Those two features would eliminate a remarkable amount of glue code and surface a wider class of usability problems.
