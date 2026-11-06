# Pixel Workshop

[Open the live editor](https://pixel-workshop-nine.vercel.app)

[**Play Stardrop: A Moonkeeper Tale**](https://pixel-workshop-nine.vercel.app/play/moonkeeper) · A small arcade game using ten native, editable Pixel Workshop assets (sprites, cels, environment art, and seeded effects). In-game art workbench exports every asset as `.pixel.json` or a sprite sheet. [Production notes and feature wishlist](docs/stardrop-production-notes.md).

![Original lantern drawn through MCP](artifacts/lantern-preview.png)

A precise pixel-art editor with one TypeScript drawing engine shared by a React browser workspace and MCP tools. Every canvas cell is an actual output pixel. No image-generation API or GPU is needed.

## In-app Field Guide

Once you create or open a workspace, a **Guide** button appears in the editor header. On first visit, a skippable introduction offers an interactive tour. Choose the complete 33-stop walkthrough or one of seven chapters: **Start here**, **Draw & arrange**, **Bring it to life**, **Procedural magic**, **Make a UI kit**, **Ship your assets**, or **Workspaces & agents**.

The guide highlights the actual controls and, on compact layouts, opens the drawing drawer or appropriate inspector tab for you. Use **Back**, **Next**, **Chapters**, or **Close**; Escape also closes it. Short optional “try it” prompts explain real workflows without automatically changing your artwork, exporting files, or issuing agent tokens. Opening a project or export dialog temporarily hides the guide and returns to the same step when the dialog closes. You can reopen the guide at any time. Read the [guide-driven UX audit](docs/tutorial-ux-audit.md) for the prioritized improvements we uncovered while teaching every feature.

## Run the portable Node version

Requires Node 24 (or Node 22 with TypeScript stripping support). Install dependencies with `pnpm install`, then:

```sh
pnpm build:node
pnpm server
```

Open http://127.0.0.1:4317. The Node service serves the React/Vite build, project API and `/mcp`. Web workspace projects and their undo history are stored atomically under `pixel-data/workspaces/<session-id>/projects/`, with private session metadata alongside them. Set `PIXEL_DATA_DIR` to choose the root. The stand-alone stdio MCP process retains its separately configured local workspace. The Node service binds to loopback; remote hosting still needs an authenticated reverse proxy.

## MCP

For a client that launches a local server, run `node --experimental-strip-types server/stdio.ts` with this repository as its working directory. `PIXEL_DATA_DIR` should point to the same directory used by the browser service. Both processes use revision checks, a file lock, and atomic writes.

Available tools: `create_canvas`, `list_canvases`, `get_canvas`, `import_reference`, `paint`, `undo`, `redo`, `export_png`, `export_svg`, `export_sprite_sheet`, `generate_effect`, `regenerate_effect`. Recipes are persisted on FX layers and returned by `get_canvas`. Drawing commands accept a zero-based `frame` index; animation controls are `frame_add`, `frame_delete`, and `set_fps`. The public HTTP `/mcp` endpoint requires an `Authorization: Bearer <workspace-token>` header. Inside the editor, open **Workspace → Copy MCP connection** to get a ready-to-use endpoint/header configuration. This is a secret providing access to that one workspace; keep it private. The stand-alone local stdio process deliberately uses its separate local filesystem and does not need a remote bearer token.

Example drawing batch (use the ID and revision returned by `create_canvas`):

```json
{
  "id": "<canvas-id>",
  "revision": 0,
  "commands": [
    { "op": "rect", "x": 4, "y": 4, "width": 16, "height": 20, "color": "#e7ad72" },
    { "op": "line", "x": 4, "y": 4, "x2": 19, "y2": 23, "color": "#fff5df" },
    { "op": "add_layer", "id": "details", "name": "Details" },
    { "op": "pixel", "layer": "details", "x": 12, "y": 10, "color": "#201d2b" }
  ]
}
```

Coordinates are integer, zero-based and bounded by the canvas. Operations include pixels, lines, rectangles, ellipses, flood fill, clear, palette changes, and layer administration. A drawing batch either completes fully or leaves the document unchanged. MCP paint/get returns an enlarged nearest-neighbor PNG preview. `export_png` defaults to the exact native dimensions with an RGBA transparent background.

## Private workspaces

Every browser visitor begins by **creating a workspace** (no account or email required) or **opening an existing one**. New workspaces receive a cryptographically random `pw_...` session ID. A password is optional; a passwordless ID acts as an unguessable invite key, so treat it like a secret. Optional passwords are salted and hashed with PBKDF2-SHA256. The server issues an HTTP-only, signed cookie valid for up to 90 days to remember the current workspace on that browser. Reopen a workspace on another device using its ID and optional password.

All browser API calls and remote MCP tool calls are authorized on the server. The backing storage namespace is always `workspaces/<session-id>/projects/`; the server never trusts a project ID or client-side filter for ownership, and unauthorized requests do not fall through to shared storage. Password-protected sessions require a valid signed cookie or bearer token after successful authentication. **Workspace → Switch workspace** clears the current cookie without deleting saved artwork. Lost IDs/passwords cannot be automatically recovered.

## Browser workspace

The inspector uses five tabs: **Draw** (preview, color palette, stamps and collapsible Selection), **Layers**, **FX**, **Clips**, and **Export**. At desktop widths, it remains an always-visible right-hand pane. At **800 CSS pixels or narrower**, the canvas gets the available width and a **Tools** button opens the inspector as a dismissible right-side drawer. The drawer has a close control, an outside-click backdrop, Escape-to-close, focus management, and independent scrolling inside the active tab. The artwork, selected frame, and edit queue are unchanged when closing or reopening it. Keyboard users can switch tabs with Left/Right, Home and End.

On touchscreens (including landscape phones) and narrow viewports (**800 CSS pixels or narrower**), **one finger draws** while **two fingers drag the canvas or pinch to zoom** around the midpoint of the gesture, including when the canvas fits onscreen. Pinching scales smoothly while touching, then snaps to the editor's crisp integer zoom on release. **Fit** recenters the canvas and restores automatic zoom. Landing a second finger cancels a tentative stroke rather than accidentally saving it; touch flood-fill is likewise committed only on release. Browser-level touch scrolling and pinch zoom are disabled inside the art viewport, not elsewhere in the page.

The pixel grid starts enabled. Each checkerboard square and outlined cell corresponds to one output pixel and scales with zoom; the pointer outlines the exact cell being painted. Grid lines appear at 3× zoom and above. The area outside the canvas is plain, so there is no second decorative grid to confuse with the pixel cells.

Painting and session undo/redo update locally immediately. Completed strokes queue in the background and share saves (up to eight edits per request), while each stroke retains its own undo step. Acknowledgements rebase later edits and active stroke previews instead of replacing them. Opening or creating another canvas waits for outstanding saves. PNG, SVG, and editable-project downloads use the current local canvas, including unsaved edits, and exclude guides.

Failed saves pause the queue without discarding the drawing. Retry uses the same request ID so a lost response cannot duplicate a stroke; conflicting external/MCP edits offer Save a copy. The page warns before leaving with pending edits. The current project and project list refresh every three seconds while idle to reflect MCP edits; polling cannot overwrite queued or active strokes.

Undo and Redo remain beneath the drawing controls on roomy screens; on short or narrow screens the drawing tools move into a left-hand drawer, keeping history and a quick color well reachable. The existing Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts remain available.

## Tracing reference and grid alignment

![Reference grid calibration over an enlarged lantern](docs/images/tracing-alignment.png)

[Editor view](docs/images/tracing-editor.png) · [Verification notes](docs/tracing-verification.md)

Open **Draw → Tracing Reference → Load reference PNG**. The alignment dialog shows the original image with a draggable green grid and a separate prepared-image preview. Set output width/height (up to 512 each), source pixels per cell, and grid offsets. **Keep cells square** links horizontal/vertical spacing; uncheck it to calibrate a source that has been stretched. **Fit full image into output** chooses spacing for the current output size; square cells preserve aspect ratio with transparent padding if needed. **Reset to native file pixels** returns to 1:1 when the source fits.

A generated or enlarged image may have several file pixels per apparent art pixel. For a 256×384 image with 4× enlarged pixels, choose a 64×96 output and spacing 4×4, then drag/nudge the grid until its boundaries follow the artwork. There is no automatic assumption that generated art has a regular pixel lattice. The grid becomes visible at three display pixels per cell; zoom the source to inspect smaller cells. Source zoom affects viewing only.

**Create matching tracing canvas** makes a blank artwork layer at the prepared dimensions. **Use on current canvas** requires an exact dimension match and preserves existing artwork. Applying performs one deterministic nearest-neighbor conversion, sampling each cell center. Out-of-image samples become transparent. The prepared reference is then fixed at canvas `(0,0)`, one prepared pixel per drawing cell. Its source dimensions, spacing and offsets are retained as calibration metadata. Reupload the original PNG to recalibrate; the original full-resolution file is not embedded.

Use **Trace overlay**, **Reference only**, or **Artwork only**, plus separate reference/artwork viewing opacities. The canvas-footer **Trace** toggle quickly compares artwork and overlay. Reference-only view pauses painting. The underlay shares the artwork's canvas transform through zoom, scroll, and touch pan/pinch. PNG, SVG, sprite-sheet and tileset artwork omit it; editable `.pixel.json` and native projects in game packs preserve it. Adding, replacing or removing a reference is undoable.

PNG uploads may be up to 8 MB, 4096 pixels per side and 4 million source pixels (8-bit or indexed PNG). Source dimensions above the output limit must be explicitly prepared in the dialog; attaching a mismatched image never silently stretches the canvas.

MCP agents use **`import_reference`** with `png_base64` and an optional name. Omit `id`/`revision` to create a matching blank canvas; provide both to attach to an existing canvas. Optional `alignment` contains `{width,height,offsetX,offsetY,cellWidth,cellHeight}` in the same source-pixel coordinates used by the dialog. Omit alignment for literal native-pixel import. `get_canvas` supports `view:"overlay"|"reference"|"artwork"`, `referenceOpacity`, `artworkOpacity`, `grid`, integer `scale` and a native `region:{x,y,width,height}` for close-ups. Previews default to overlay when a reference exists. Browser and MCP tracing use the same compositor. `paint` accepts `{op:"reference_set",reference:null}` to remove the underlay, or a prepared `{name,width,height,pixels}` reference to attach one. Artwork export tools continue to return artwork only.

## Color workbench

**Current color is always visible beside the canvas, alongside a Quick palette button.** Click its color swatch to open your operating system's color picker without opening the right inspector. On compact screens it remains a clickable square. The Draw panel provides exact `#RRGGBB`/`#RRGGBBAA` entry and an **Opacity** slider; selecting another RGB hue preserves the current alpha.

The Draw panel separates five kinds of colors instead of mixing fixed swatches, recommendations, and saved favorites:

- **Quick colors:** 24 familiar, fixed swatches grouped into neutrals, basic spectrum colors, and earth/accents. These are always available, never random, and never saved automatically. You can select them directly in Draw or open the **Quick** palette next to the main canvas picker; they change RGB hue without resetting your brush opacity.
- **Recently picked:** the last eight colors chosen in this editor session, not saved to the project.
- **In your artwork:** the most-used visible colors in the selected animation frame, refreshed as pixels change. Hidden layers and transparent pixels do not contribute.
- **Suggested companions:** deterministic highlights, shadows, nearby hues, a complement, and an artwork-aware accent. Each suggestion is labeled with its purpose; no random color generator or network service is involved.
- **Saved project colors:** explicit swatches stored with this canvas's `.pixel.json`. Click **Save current color** to keep one, or remove the selected saved swatch. Neither the recent colors nor the suggestions are ever saved automatically.

**New blank canvases start with no saved palette.** Existing canvases retain every saved color, including the 24 original default swatches if they came from the older editor. The Draw panel now keeps those 24 automatic swatches in a **collapsed Original starter swatches** section, separate from the favorites you explicitly save. You can expand them, pin one as a favorite, or optionally remove the original set without touching its painted pixels or any colors you added. Removing a palette swatch does not erase pixels already painted with that color. The underlying project format is unchanged.

## Animation workbench

Every canvas now has a timeline. **Duplicate** adds an editable cel, **Play** previews frames at 4–30 fps, and **Onion** displays translucent neighboring frames. To make a clip, choose **Select clip range** and drag across timeline frames, or Shift-click an endpoint. Click **Create clip** to name the selected span, adjust FPS and loop/once/ping-pong behavior; right-clicking a frame opens clip setup immediately. Existing named clips appear as colored markers beneath their frames, and **Edit range** loads their boundaries. You can still enter precise frame numbers in the Clips inspector. Click a clip’s ▶ control to preview that specific sequence; the atlas export now includes clip names, ranges, modes and playback frame indices. Pencil, fill, shape, selection, copy/paste, undo and layer visibility all operate on the selected frame (layer names and visibility remain shared across frames). In **Export → Format**, choose **PNG** or **SVG**. Both the header button and **Current frame** download the selected frame in that format; **Sprite sheet** exports every frame at native dimensions. **Animation atlas JSON** points to the matching `-sheet.png` or `-sheet.svg` and contains frame rectangles, playback durations and named clips.

The **Procedural Effects** panel offers twelve seeded generators: **embers, sparkles, bubbles, falling leaves, fire, smoke, explosions, shockwaves, lightning, rain, snow, and arcane swirls**. Choose from grouped presets, read their descriptions, and optionally apply a suggested color. Each effect becomes its own editable animation layer across frames, preserving existing artwork. Generation is completely local and costs no AI tokens. MCP's `generate_effect` tool supports the same twelve kinds through the shared pixel engine. Generated effects rasterize into editable pixel cels **and retain their procedural recipe** on the FX layer. The FX tab can select an existing generated layer, reload its seed, color, speed, opacity and horizontal drift, and compare the selected frame **before and after** without modifying the project. Applying regeneration requires a fresh preview. When resource limits allow, it preserves the entire original FX layer, including every frame, as a hidden non-regenerable backup. With no available backup, explicit confirmation is required; manual changes *inside the original FX layer* are replaced. Other layers and named clip metadata remain intact. Node compositing and custom particle physics remain future extensions.

## SVG exports

Choose **Export → Format → SVG · vector**, then **Current frame SVG** or **Sprite sheet SVG**. The header export button follows this choice. Frame size changes the SVG's display dimensions while its native `viewBox` remains unchanged, so it can be resized again in design tools. Sprite sheets always use native dimensions to match their atlas coordinates.

SVGs contain real vector rectangles, with neighboring same-color pixels merged where possible. Visible layers are composited exactly like PNG; transparent pixels are omitted and partial alpha is retained. They preserve the pixel-art silhouette, including its stepped edges. Grid lines, onion skins and selection guides are excluded. SVG exports are static images or static sprite sheets; `.pixel.json` remains the format for retaining original layers, animation cels and effect recipes.

The authenticated API supports `GET /api/pixel/projects/<id>/svg?frame=0&scale=1`. MCP provides `export_svg` with `id`, optional zero-based `frame`, and integer `scale` from 1–16. It returns an embedded `image/svg+xml` text resource plus download metadata. `export_sprite_sheet` accepts optional `format: "svg"` and returns SVG text with a matching atlas; its default remains PNG. Both use the same workspace authorization as other exports.

Stardrop's art workbench has an **SVG SHEET** download for every asset. Game packs and tileset ZIPs include both PNG and SVG images, each with its own matching atlas. Game-pack manifests retain existing `sheet`/`atlas` PNG paths and add `svgSheet`/`svgAtlas` paths.

## Project format and limits

`.pixel.json` uses `format: "pixel-workshop/1"`, dimensions, palette and bottom-to-top layers. Layer pixels are unsigned packed RGBA values (`0xRRGGBBAA`), with zero fully transparent. Import validates dimensions, colors, layer IDs, and buffer lengths and creates a new project instead of overwriting an existing one.

Canvases support 1–512 pixels per side, eight layers, up to 128 palette colors, up to 32 named animation clips and up to twelve undo steps (history is reduced for larger animated documents). The optional `animation` section retains the original base layer pixels as frame 0 and stores additional frame cels by layer ID. Its optional `clips` array keeps named frame ranges, clip FPS and playback behavior. Each layer can also carry an optional validated `effect` recipe; older files without these fields remain valid. Existing static `.pixel.json` imports remain valid. Animation is limited to 32 frames. All documents share a 900,000-cell budget counting every layer, every frame, and one prepared reference buffer when present. Project listing shows up to 100 hosted projects.


## Game production exports

Open **Export → Export game pack ZIP** to choose up to 30 canvases from the current private workspace. The downloaded ZIP contains each editable `.pixel.json`, composited PNG and SVG sprite sheets, matching JSON atlases (including named animation clips) and a root `manifest.json` with paths and dimensions. This is a portable deliverable for any game engine. Workspace access checks apply to every project fetched; no public shared file store is used.

The same Export panel offers **Tileset ZIP** for a uniform grid (e.g. 16 × 16). The selected frame is split into deterministic row-major tile IDs with exact sheet coordinates and transparent-cell detection; it includes PNG and SVG tile images, matching atlas JSON files and editable source. Canvas dimensions must be multiples of the chosen tile size. This is a tileset export, *not yet* a full tilemap/layout editor with collision rules or autotiling.

The playable [Stardrop proof-of-concept](https://pixel-workshop-nine.vercel.app/play/moonkeeper) now includes a one-click download of its ten editable original assets as a game pack, with native animation clips tagged on the character, collectibles, enemies and VFX. See [the dogfood notes](docs/stardrop-production-notes.md) for workflow findings and remaining feature priorities.

## Deploy on Vercel

Import this repository with the Next.js preset. `vercel.json` selects `pnpm run build:vercel`, which builds native Next.js output. The default `build` command remains the Sites/Cloudflare build. Use Node.js 24.x.

Connect a **private Vercel Blob** store to the project in Storage, enabling the `BLOB_READ_WRITE_TOKEN` environment variable for production, preview and development. Redeploy after connecting it. Artwork, layers and undo history persist in Blob, with conditional writes preventing conflicting edits. There is no temporary-filesystem fallback. A missing store produces a setup message in the editor.

The application uses isolated session-specific project prefixes and signed access credentials, and no longer depends on a single shared project namespace. Vercel Deployment Protection is still useful for private/staging deployments but is not the only security boundary. Sites and Vercel use separate stores; share editable `.pixel.json` projects manually between them.

For local native Next.js development, use `pnpm dev:vercel` with the Blob variable configured in your local environment. Native Next.js writes to `.next-native`; Sites/Vinext uses its own build output and `.next` metadata.

## Selection commands

Selections affect the active layer. Press **V**, drag a rectangle, then drag inside it to move; arrows nudge one pixel, Shift+arrows ten. Ctrl/Cmd+C, X and V copy, cut and paste within the editor. Delete clears selected pixels; Escape deselects. Copy/paste preserves the original packed RGBA values, including partial alpha. **Stamp (S)** is now a first-class capture-and-place tool: choose it and drag across artwork to capture the current layer, then place as many copies as you like. A translucent pixel-accurate preview follows your cursor, and optional 8-, 16- and 32-pixel grid snapping is right beside the canvas. Transparent source pixels leave existing art untouched. The Draw tab includes a gallery for naming and saving up to 12 reusable stamps per workspace, available across canvases in the same browser. Saved stamp snippets use bounded local browser storage keyed to the private workspace ID; they are *not* silently added to the project's native file. Each placement is undoable. The selection panel has flip and clipboard controls.

MCP uses `{op:"transform",mode:"move"|"copy"|"flip_horizontal"|"flip_vertical",layer,x,y,width,height,x2,y2}`. Destination `x2,y2` is required for move/copy and must fit the entire selection. `{op:"paste",layer,x,y,width,height,pixels:[...]}` accepts row-major packed RGBA pixels. Both replace the entire destination rectangle, including transparent pixels. Moving snapshots the source before clearing, so overlapping moves are exact and undoable.

## Hosting adapter

`app/` wraps the same editor with Vite/Vinext Sites runtime. `lib/cloud-store.ts` stores projects in private R2 using conditional writes; native Vercel uses private Blob. Both stores require workspace credentials on **all** public project API and remote MCP requests. The legacy `projects/` namespace is preserved but no longer exposed by public routes.

## Recovering pre-session artwork

**No legacy project is deleted or automatically assigned to the first visitor.** Existing artwork remains in the old `projects/` Blob/R2 prefix, which the new browser/API cannot access. This avoids gifting everybody's former shared assets to whichever browser opens the site first.

For Vercel Blob, an authorized owner can selectively migrate projects from a trusted local machine with `BLOB_READ_WRITE_TOKEN` already set in the local environment. First create your target workspace in the editor and copy its session ID. Then:

```sh
node --experimental-strip-types scripts/migrate-legacy.ts --list
node --experimental-strip-types scripts/migrate-legacy.ts --workspace pw_YOUR_SESSION_ID --ids project-id-1,project-id-2
```

The script copies **only the explicitly named project IDs**, retains their undo history, and leaves the originals untouched. Do not run it from an untrusted machine or publish your storage token. The R2/local-file equivalent can be recovered by an administrator from preserved objects or by importing downloaded `.pixel.json` files.

## Verification

```sh
pnpm test
pnpm exec tsc --noEmit
node --experimental-strip-types tests/mcp-smoke.ts
node --experimental-strip-types tests/mcp-smoke.ts --http
node --experimental-strip-types tests/mcp-smoke.ts --http --cottage
node --experimental-strip-types tests/mcp-reference-smoke.ts
```

The HTTP smoke test starts a temporary loopback server using the same hosted MCP handler. It creates a canvas through the official MCP client, paints the 42-command original lantern, inspects its layers and exports the actual PNG under `artifacts/`. The stdio test uses a separate disposable project directory.

The lantern example is original hand-plotted artwork built exclusively with the same drawing commands that MCP exposes. It is also available as an editable project.

![Moonkeeper’s cottage drawn through MCP](artifacts/cottage-preview.png)

Moonkeeper’s cottage is an original 64 × 64, five-layer example painted through 299 MCP commands, including copied and mirrored windows. Open it from New canvas, or find its native PNG, enlarged preview and editable project in `artifacts/`.
