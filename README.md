# Pixel Workshop

[Open the live editor](https://pixel-workshop-nine.vercel.app)

![Original lantern drawn through MCP](artifacts/lantern-preview.png)

A precise pixel-art editor with one TypeScript drawing engine shared by a React browser workspace and MCP tools. Every canvas cell is an actual output pixel. No image-generation API or GPU is needed.

## Run the portable Node version

Requires Node 24 (or Node 22 with TypeScript stripping support). Install dependencies with `pnpm install`, then:

```sh
pnpm build:node
pnpm server
```

Open http://127.0.0.1:4317. The Node service serves the React/Vite build, project API and `/mcp`. Web workspace projects and their undo history are stored atomically under `pixel-data/workspaces/<session-id>/projects/`, with private session metadata alongside them. Set `PIXEL_DATA_DIR` to choose the root. The stand-alone stdio MCP process retains its separately configured local workspace. The Node service binds to loopback; remote hosting still needs an authenticated reverse proxy.

## MCP

For a client that launches a local server, run `node --experimental-strip-types server/stdio.ts` with this repository as its working directory. `PIXEL_DATA_DIR` should point to the same directory used by the browser service. Both processes use revision checks, a file lock, and atomic writes.

Available tools: `create_canvas`, `list_canvases`, `get_canvas`, `paint`, `undo`, `redo`, `export_png`, `export_sprite_sheet`, `generate_effect`. Drawing commands accept a zero-based `frame` index; animation controls are `frame_add`, `frame_delete`, and `set_fps`. The public HTTP `/mcp` endpoint requires an `Authorization: Bearer <workspace-token>` header. Inside the editor, open **Workspace → Copy MCP connection** to get a ready-to-use endpoint/header configuration. This is a secret providing access to that one workspace; keep it private. The stand-alone local stdio process deliberately uses its separate local filesystem and does not need a remote bearer token.

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

The inspector uses four tabs: **Draw** (preview, color palette and collapsible Selection), **Layers**, **FX**, and **Export**. At desktop widths, it remains an always-visible right-hand pane. At **800 CSS pixels or narrower**, the canvas gets the available width and a **Tools** button opens the inspector as a dismissible right-side drawer. The drawer has a close control, an outside-click backdrop, Escape-to-close, focus management, and independent scrolling inside the active tab. The artwork, selected frame, and edit queue are unchanged when closing or reopening it. Keyboard users can switch tabs with Left/Right, Home and End.

On touchscreens (including landscape phones) and narrow viewports (**800 CSS pixels or narrower**), **one finger draws** while **two fingers drag the canvas or pinch to zoom** around the midpoint of the gesture, including when the canvas fits onscreen. Pinching scales smoothly while touching, then snaps to the editor's crisp integer zoom on release. **Fit** recenters the canvas and restores automatic zoom. Landing a second finger cancels a tentative stroke rather than accidentally saving it; touch flood-fill is likewise committed only on release. Browser-level touch scrolling and pinch zoom are disabled inside the art viewport, not elsewhere in the page.

The pixel grid starts enabled. Each checkerboard square and outlined cell corresponds to one output pixel and scales with zoom; the pointer outlines the exact cell being painted. Grid lines appear at 3× zoom and above. The area outside the canvas is plain, so there is no second decorative grid to confuse with the pixel cells.

Painting and session undo/redo update locally immediately. Completed strokes queue in the background and share saves (up to eight edits per request), while each stroke retains its own undo step. Acknowledgements rebase later edits and active stroke previews instead of replacing them. Opening or creating another canvas waits for outstanding saves. PNG and editable-project downloads use the current local canvas, including unsaved edits, and exclude guides.

Failed saves pause the queue without discarding the drawing. Retry uses the same request ID so a lost response cannot duplicate a stroke; conflicting external/MCP edits offer Save a copy. The page warns before leaving with pending edits. The current project and project list refresh every three seconds while idle to reflect MCP edits; polling cannot overwrite queued or active strokes.

Undo and Redo now sit underneath the drawing and grid tools in the left toolbar, rather than in the document bar. On shorter screens the painting tools scroll independently, keeping Undo/Redo reachable; the existing Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts remain available.

## Animation workbench

Every canvas now has a timeline. **Duplicate** adds an editable cel, **Play** previews frames at 4–30 fps, and **Onion** displays translucent neighboring frames. Pencil, fill, shape, selection, copy/paste, undo and layer visibility all operate on the selected frame (layer names and visibility remain shared across frames). The browser exports the current frame as a transparent PNG, the entire animation as a composite PNG sprite sheet, and a separate JSON atlas containing frame rectangles and playback durations. The atlas points to the downloaded `-sheet.png` file.

The **Procedural Effects** panel generates seed-based embers, sparkles or shockwaves. Effects live on their own editable layer across frames. This initial vertical slice rasterizes the effect into pixel cels; re-editable procedural recipes and a richer node/layer compositor remain future extensions. Generation is completely local and costs no AI tokens. MCP agents can also edit frames and generate effects using the same undoable document engine.

## Project format and limits

`.pixel.json` uses `format: "pixel-workshop/1"`, dimensions, palette and bottom-to-top layers. Layer pixels are unsigned packed RGBA values (`0xRRGGBBAA`), with zero fully transparent. Import validates dimensions, colors, layer IDs, and buffer lengths and creates a new project instead of overwriting an existing one.

Canvases support 1–256 pixels per side, eight layers, up to 128 palette colors, and up to twelve undo steps (history is reduced for larger animated documents). The optional `animation` section retains the original base layer pixels as frame 0 and stores additional frame cels by layer ID. Existing static `.pixel.json` imports remain valid. Animation is limited to 32 frames and 900,000 total layer-cells per document. Project listing shows up to 100 hosted projects. Larger canvases remain future work.

## Deploy on Vercel

Import this repository with the Next.js preset. `vercel.json` selects `pnpm run build:vercel`, which builds native Next.js output. The default `build` command remains the Sites/Cloudflare build. Use Node.js 24.x.

Connect a **private Vercel Blob** store to the project in Storage, enabling the `BLOB_READ_WRITE_TOKEN` environment variable for production, preview and development. Redeploy after connecting it. Artwork, layers and undo history persist in Blob, with conditional writes preventing conflicting edits. There is no temporary-filesystem fallback. A missing store produces a setup message in the editor.

The application uses isolated session-specific project prefixes and signed access credentials, and no longer depends on a single shared project namespace. Vercel Deployment Protection is still useful for private/staging deployments but is not the only security boundary. Sites and Vercel use separate stores; share editable `.pixel.json` projects manually between them.

For local native Next.js development, use `pnpm dev:vercel` with the Blob variable configured in your local environment. Native Next.js writes to `.next-native`; Sites/Vinext uses its own build output and `.next` metadata.

## Selection commands

Selections affect the active layer. Press **V**, drag a rectangle, then drag inside it to move; arrows nudge one pixel, Shift+arrows ten. Ctrl/Cmd+C, X and V copy, cut and paste within the editor. Delete clears selected pixels; Escape deselects. Copy/paste preserves the original packed RGBA values, including partial alpha. The selection panel has flip and clipboard controls.

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
```

The HTTP smoke test starts a temporary loopback server using the same hosted MCP handler. It creates a canvas through the official MCP client, paints the 42-command original lantern, inspects its layers and exports the actual PNG under `artifacts/`. The stdio test uses a separate disposable project directory.

The lantern example is original hand-plotted artwork built exclusively with the same drawing commands that MCP exposes. It is also available as an editable project.

![Moonkeeper’s cottage drawn through MCP](artifacts/cottage-preview.png)

Moonkeeper’s cottage is an original 64 × 64, five-layer example painted through 299 MCP commands, including copied and mirrored windows. Open it from New canvas, or find its native PNG, enlarged preview and editable project in `artifacts/`.
