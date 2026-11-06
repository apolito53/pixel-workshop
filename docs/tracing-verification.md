# Tracing reference verification

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
