# Pixel Workshop

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

Pencil, eraser, fill, eyedropper, lines, filled/outlined rectangles and ellipses; palette and custom hex color; layers and visibility; undo/redo; grid and zoom; PNG export at native or integer scale; editable project download/import. Keyboard shortcuts: B pencil, E eraser, G fill, I eyedropper, L line, R rectangle, O ellipse, H grid, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.

Edits autosave. The current project and project list refresh every three seconds while idle to reflect MCP edits. Conflicting edits are rejected and the authoritative canvas reloads. PNG exports exclude the grid and editor checkerboard.

## Project format and limits

`.pixel.json` uses `format: "pixel-workshop/1"`, dimensions, palette and bottom-to-top layers. Layer pixels are unsigned packed RGBA values (`0xRRGGBBAA`), with zero fully transparent. Import validates dimensions, colors, layer IDs, and buffer lengths and creates a new project instead of overwriting an existing one.

V1 supports 1–256 pixels per side, eight layers, up to 128 palette colors and up to twelve undo steps (history is reduced for large multilayer canvases). Project listing shows up to 100 hosted projects. Animation, selection transforms and larger canvases are future work.

## Hosting adapter

`app/` wraps the same React editor with the supplied Vite/Vinext Sites runtime. `lib/cloud-store.ts` stores projects in a private R2 bucket using conditional writes. `/mcp` supports Sites discovery plus stateless MCP HTTP JSON-RPC. Sites authenticates and restricts access before forwarding requests. Preserve the Site's owner-private access policy; this prototype uses a single shared project namespace for its owner.

## Verification

```sh
pnpm test
pnpm exec tsc --noEmit
node --experimental-strip-types tests/mcp-smoke.ts
node --experimental-strip-types tests/mcp-smoke.ts --http
```

The HTTP smoke test starts a temporary loopback server using the same hosted MCP handler. It creates a canvas through the official MCP client, paints the 42-command original lantern, inspects its layers and exports the actual PNG under `artifacts/`. The stdio test uses a separate disposable project directory.

The lantern example is original hand-plotted artwork built exclusively with the same drawing commands that MCP exposes. It is also available as an editable project.
