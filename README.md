# Pixel Workshop

[Open the live editor](https://nova-pixel-workshop.antholito.chatgpt.site)

![Original lantern drawn through MCP](artifacts/lantern-preview.png)

A precise pixel-art editor with one TypeScript drawing engine shared by a React browser workspace and MCP tools. Every canvas cell is an actual output pixel. No image-generation API or GPU is needed.

## Run the portable Node version

Requires Node 24 (or Node 22 with TypeScript stripping support). Install dependencies with `pnpm install`, then:

```sh
pnpm build:node
pnpm server
```

Open http://127.0.0.1:4317. The Node service serves the React/Vite build, project API and `/mcp`. Editable projects and their undo history are saved atomically under `pixel-data/`; change that location with `PIXEL_DATA_DIR`. The server binds to loopback. Remote hosting requires an authenticated reverse proxy; the hosted Site adapter provides that separately.

## MCP

For a client that launches a local server, run `node --experimental-strip-types server/stdio.ts` with this repository as its working directory. `PIXEL_DATA_DIR` should point to the same directory used by the browser service. Both processes use revision checks, a file lock, and atomic writes.

Available tools: `create_canvas`, `list_canvases`, `get_canvas`, `paint`, `undo`, `redo`, `export_png`. The published Site also exposes these tools through its canonical private plugin.

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

## Browser workspace

Pencil, eraser, fill, eyedropper, lines, filled/outlined rectangles and ellipses; palette and custom hex color; layers and visibility; undo/redo; rectangular selections with drag-to-move, copy/paste, horizontal/vertical flips and pixel nudging; grid, fit-to-workspace and integer zoom; true 1×/2× preview; PNG export at native or integer scale; editable project download/import. Keyboard shortcuts: B pencil, E eraser, G fill, I eyedropper, L line, R rectangle, O ellipse, H grid, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.

The pixel grid starts enabled. Each checkerboard square and outlined cell corresponds to one output pixel and scales with zoom; the pointer outlines the exact cell being painted. Grid lines appear at 3× zoom and above. The area outside the canvas is plain, so there is no second decorative grid to confuse with the pixel cells.

Edits autosave. The current project and project list refresh every three seconds while idle to reflect MCP edits. Conflicting edits are rejected and the authoritative canvas reloads. PNG exports exclude the grid and editor checkerboard.

## Project format and limits

`.pixel.json` uses `format: "pixel-workshop/1"`, dimensions, palette and bottom-to-top layers. Layer pixels are unsigned packed RGBA values (`0xRRGGBBAA`), with zero fully transparent. Import validates dimensions, colors, layer IDs, and buffer lengths and creates a new project instead of overwriting an existing one.

V1 supports 1–256 pixels per side, eight layers, up to 128 palette colors and up to twelve undo steps (history is reduced for large multilayer canvases). Project listing shows up to 100 hosted projects. Animation and larger canvases are future work.

## Deploy on Vercel

Import this repository with the Next.js preset. `vercel.json` selects `pnpm run build:vercel`, which builds native Next.js output. The default `build` command remains the Sites/Cloudflare build. Use Node.js 24.x.

Connect a **private Vercel Blob** store to the project in Storage, enabling the `BLOB_READ_WRITE_TOKEN` environment variable for production, preview and development. Redeploy after connecting it. Artwork, layers and undo history persist in Blob, with conditional writes preventing conflicting edits. There is no temporary-filesystem fallback. A missing store produces a setup message in the editor.

This is an owner workspace: keep Vercel Deployment Protection enabled for every domain. The API and `/mcp` share its project namespace and rely on the hosting access boundary. Add application authentication and per-user storage before opening it as a public multi-user service. Sites and Vercel use separate stores; transfer artwork with editable `.pixel.json` files.

For local native Next.js development, use `pnpm dev:vercel` with the Blob variable configured in your local environment. Native Next.js writes to `.next-native`; Sites/Vinext uses its own build output and `.next` metadata.

## Selection commands

Selections affect the active layer. Press **V**, drag a rectangle, then drag inside it to move; arrows nudge one pixel, Shift+arrows ten. Ctrl/Cmd+C, X and V copy, cut and paste within the editor. Delete clears selected pixels; Escape deselects. Copy/paste preserves the original packed RGBA values, including partial alpha. The selection panel has flip and clipboard controls.

MCP uses `{op:"transform",mode:"move"|"copy"|"flip_horizontal"|"flip_vertical",layer,x,y,width,height,x2,y2}`. Destination `x2,y2` is required for move/copy and must fit the entire selection. `{op:"paste",layer,x,y,width,height,pixels:[...]}` accepts row-major packed RGBA pixels. Both replace the entire destination rectangle, including transparent pixels. Moving snapshots the source before clearing, so overlapping moves are exact and undoable.

## Hosting adapter

`app/` wraps the same React editor with the supplied Vite/Vinext Sites runtime. `lib/cloud-store.ts` stores projects in a private R2 bucket using conditional writes. `/mcp` supports Sites discovery plus stateless MCP HTTP JSON-RPC. Sites authenticates and restricts access before forwarding requests. Preserve the Site's owner-private access policy; this prototype uses a single shared project namespace for its owner.

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
