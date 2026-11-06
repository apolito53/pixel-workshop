# Tracing reference verification

## MCP exact-copy update — November 6, 2026

MCP v0.3.0 adds `copy_reference`, `compare_reference`, and the `copy_to_layer` import option. Import and browser fitting share one sizing helper; native imports and explicit 1:1 source crops provide a path that never resamples source pixels. Fitted imports explicitly report the original and working dimensions. Integer rounding is accounted for on both axes, including 4096×1 and 1×4096 inputs.

The 130-test suite, TypeScript checks, native Next.js production build and portable Node/Vite build passed. New coverage checks exact raw RGBA copying (including RGB under zero alpha), partial-alpha export fidelity, existing-layer preservation, frame targeting, stale revisions, atomic failures, cell budgets, procedural recipe detachment, undo/redo, fitted imports, native-size rejection, and exact source crops. Comparison distinguishes raw equality from visible equality and identifies the first differing coordinate without returning pixel arrays.

Both official MCP SDK transports, stdio and local HTTP, passed the expanded reference smoke test: 256×384 source, 98,304 exact copied pixels, byte-identical decoded PNG export, and undo back to the earlier one-pixel artwork. Each also passed one-call editable import and reported the 1024×768 → 512×384 fit explicitly. These are deterministic fixtures, not a claim of visually redrawing an ImageGen picture. CI now runs the reference smoke test through both transports.

The standalone stdio workspace remains separate from hosted workspaces. Hosted MCP callers use their normal workspace bearer token. Existing clients must refresh tool discovery; a local server must run the updated checkout. No token changes or workspace migrations are required.

## Original tracing implementation

The tracing feature prepares an image against an explicitly calibrated source grid, then stores the resulting native reference at canvas origin. The drawing grid and prepared reference have exactly the same dimensions. Reference pixels live outside paint layers and artwork export compositing.

## Automated checks

All 123 unit and integration tests passed, along with TypeScript checking, the portable Vite build and the native Next.js production build. Coverage includes straight RGBA preservation, explicit nearest-neighbor calibration with fractional offsets, transparent padding, exact dimension rejection, atomic failures, reference preservation through painting/palette remapping/animation, undo/redo, export exclusion, cell budgets, cropped/grid previews and larger-canvas touch anchors.

The real MCP SDK stdio smoke test imports a 256×384 PNG, inspects a 2×2 native crop at 8×, uses floating-point viewing opacities, paints one cell, and verifies a native PNG with exactly one visible artwork pixel. It also imports the source as a prepared 64×96 reference using 4×4 source pixels per cell. The test is included in the existing CI job. Existing stdio and HTTP lantern smoke tests passed with 12 tools exposed.

The stdio adapter now translates nested JSON-schema objects, number fields and nullable values correctly. Its old scalar-only conversion rejected the new region and alignment options; the SDK smoke test caught this before release.

## Desktop browser checks

In an isolated local preview workspace, the actual benchmark tree crop was loaded as a 256×384 PNG, explicitly prepared to 64×96 using 4×4 spacing, and repositioned by dragging the grid. Numeric offsets updated and were reset before applying. A new canvas was created at the prepared dimensions.

Reference-only view rejected a test drawing click. Overlay mode accepted a single click at native (32,20). The browser-exported PNG was decoded: 64×96, exactly one visible pixel, RGBA (246,218,146,255) at (32,20). The editable-project download preserved the reference and source calibration metadata. Reloading restored them from saved state. Visibility modes, viewing opacity, integer zoom, reference removal and undo were exercised through the UI.

The screenshots use the repository’s existing public lantern artwork: its 384×384 enlarged preview was explicitly calibrated with 8×8 spacing into a 48×48 prepared reference. The editor screenshot shows the underlay with an empty artwork layer; it is not a drawing produced by tracing.

## Scope and limits

Sources are 8-bit or indexed PNG, up to 8 MB, 4096 per side and 4 million source pixels. Prepared canvases are at most 512 per side and remain subject to the shared 900,000-cell document budget. The original source file is not embedded; prepared pixels and calibration metadata are saved. Reupload the original to recalibrate.

Calibration makes the final mapping exact. It does not establish that an AI-generated source has a perfectly regular apparent pixel grid. The alignment preview and prepared-result preview let the artist judge that visually. Mobile layout is responsive and touch geometry is regression-tested; this pass did not include a hands-on mobile browser session.
