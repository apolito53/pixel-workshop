# Pixel Workshop guided-tour dogfood notes
*2026-11-02 · First product-UX pass · Source-backed findings*

## Why this exercise exists

Stardrop proved that Pixel Workshop can produce real game assets. Authoring a tutorial asks a different question: **Can someone discover and use those capabilities without knowing the implementation?** The new in-app Field Guide is intentionally task-based. Its six chapters and 23 steps cover the first project, drawing, layering, animation, effects, exports, and workspace/MCP access. It highlights real controls and opens the corresponding compact drawers or inspector tabs. All operations described are optional practice, never automatically executed by the guide.

The findings below come from tracing real editor UI code, documenting every workflow as a beginner would encounter it, and writing guide regression tests. They are **not claims from an observed user study**. A live visual/device testing pass and actual user feedback still matter.

## Things that already work

- **Genuinely precise cells.** One grid cell is one output pixel, the guide overlays are not in exported assets, and native PNG export preserves transparency.
- **Fast local feedback.** Edits appear immediately and are queued for persistence; Undo/Redo are meaningful steps. Conflicting remote edits cannot silently replace an in-progress stroke.
- **Shared artwork model.** Static art, animation cels, layered VFX, native project import/export and the MCP drawing engine share the same document concepts. A game pack includes the editable sources, not merely flattened images.
- **Animation and FX are substantial features.** Frame cels, onion skinning, named clips and twelve effects can support real production tasks.
- **Screen-size adaptations exist.** The left drawing drawer handles short/narrow viewports; the right inspector becomes a drawer on narrower screens. The tutorial can reveal the correct control in either layout.
- **Workspaces are separated by design.** Anonymous ID-based private workspaces, optional passwords and scoped MCP tokens avoid treating everyone as one user.

## Usability friction found while authoring the guide

| Priority | Workflow | What the instructions had to explain | Product improvement |
| --- | --- | --- | --- |
| P0 | First-run discovery | New visitors see a workspace gate, then a fairly dense editor with two tool areas and many icons. Nothing previously joined the features into a learning path. | **Shipped in this change:** one-time skippable welcome, persistent Guide button, chapter menu, highlighted real controls, Back/Next and keyboard exits. |
| P1 | Select → Copy → Stamp | Stamp looks like a standalone brush but refuses to work until the user copies a region using the active layer's Selection controls. Grid snapping is in the Draw inspector, not next to the Stamp brush. | A contextual stamp setup panel, "Copy a selection to begin" affordance, stamp preview under cursor, and optional reusable stamp library. |
| P1 | Layer operations | The Layers tab can select, add, hide and delete, but **does not offer inline rename or reorder controls** despite underlying support for renaming layers. Multi-layer artwork gets cumbersome quickly. | Inline rename, reorder, duplicate and lock controls, with a clear active-layer highlight. |
| P1 | Clip authoring | "Clip" means a named range of numbered animation frames. Beginners must manually count and enter first/last frame numbers rather than dragging a timeline range. | Drag-to-select clip ranges, colored clip bands in timeline, preview of each named clip, and clip-boundary warnings when deleting cels. |
| P1 | FX regeneration | An effect is a baked pixel layer **plus** a stored recipe. Regeneration changes only that layer, but also overwrites any handmade pixels inside it. That caveat belongs at the moment of action, not only in a tutorial paragraph. | A non-destructive preview/diff, confirmation when the layer has post-generation edits, duplicate-before-regenerating, and an FX badge in Layers. |
| P1 | Exporting game assets | "PNG", "sprite sheet", "atlas", "tileset" and "game pack" describe different outputs. The standalone sheet and atlas are separate downloads, and the correct combination depends on the user's destination engine. | Export presets ("single image", "animated sprite", "tileset", "game pack"), frame/sheet previews, and a more obvious bundled sheet+atlas option. |
| P1 | Connection to an AI agent | "Copy MCP connection" creates a bearer credential and JSON snippet. This is correct technically but still assumes familiarity with MCP and manually configuring an external client. | Guided, scoped "Connect an agent" flow with clear destination examples, token revocation/rotation, short-lived credentials, and connection health. |
| P2 | Discovering a template | The Moonkeeper cottage and lantern are links buried at the bottom of the *new-canvas dialog*, not recognizable preset cards when someone first opens the editor. | First-project template picker with previews and "Blank", "Character", "Tileset", and "Animated FX" starters. |
| Addressed | Color / alpha | Color selection was buried in the Draw panel, while 24 unexplained starter colors looked like recommendations. An RGB picker also obscured RGBA opacity. | **Shipped in contextual color update:** permanent canvas-toolbar picker; direct hex and opacity controls; clearly separated recent, artwork, deterministic suggested and explicitly saved swatches. Remaining: named saved colors and richer color harmony controls. |
| P2 | Mobile panel switching | Drawing controls slide in from the left; inspector panels slide in from the right. Without the guide, their entry points can look like generic tool buttons. | Persistent icon+label or annotated toggle affordances, context-sensitive panel shortcuts, and an active-tool ribbon that fits very narrow phones. |
| P2 | Understanding autosave | Save status is a small footer message. Busy users might not notice when a queue is paused or a conflict occurred until much later. | Elevated error notification for saves that require action, with concise recovery instructions; keep healthy autosave quiet. |
| P2 | Resource budgets | Eight layers, 32 animation frames, 256×256 canvas limits and an overall animated-pixel budget constrain workflows. Some capacity feedback appears only on the FX screen. | Consistent capacity indicators in canvas creation, frame duplication and layer management, with guidance before reaching limits. |
| P2 | Tilemap workflow | Tileset ZIP exports a numbered static grid, not a level editor. It has no painting with tile IDs in the scene, collisions or autotiling rules. | Native tilemap document type with tileset references, reusable stamps, palette, collision properties and map export. |
| P3 | Help maintenance | Tour targets need selectors scattered throughout a large editor component. If controls move, tour anchors could silently break despite the core engine still working. | Co-locate help metadata with each tool's definition and eventually split the large editor component into focused workbench components. |

## Guide implementation decisions

**Non-destructive:** Opening, skipping or finishing the tour does not create or modify assets. A "try it" prompt simply invites the person to use the real app. The guide never requests or generates workspace tokens. Normal drawing shortcuts remain available while the walkthrough is open; project creation and game-pack dialogs temporarily suspend the guide and return to the current step when closed.

**Adaptive:** Steps programmatically reveal the relevant inspector tab or drawing drawer. Highlights use actual DOM anchor geometry, with viewport-safe cards, a compact-screen dock, and a fallback when contextual controls (such as a not-yet-created effect recipe) are unavailable.

**Accessible:** Chapter selection, step progress, Back/Next, Escape, focusable dialog content and reduced-motion styles. The existing drawer focus traps stand aside during the guided tour. The guide can be opened again from the header.

**Small-first:** The person can begin with "Start here" or choose any chapter. The 22-stop all-features tour is explicitly optional.

## Verification and next round

Automated tests check that every guide target exists, every chapter has useful steps, no artwork/credentials are modified by the guide component, and card placement works at desktop and phone sizes. GitHub Actions runs tests, TypeScript and a production build; Vercel provides the deploy preview. These checks **cannot substitute for real screenshot/interaction testing**, particularly on 320px phones and at high browser zoom.

Next recommended dogfood task: recruit a fresh browser session and ask someone to create a sprite, duplicate a frame, make a named clip, generate sparkles, regenerate safely, and export a game pack **without verbal assistance**. Record their first hesitation at every step; prioritize friction they actually encounter over theoretical UI additions.

**Most valuable immediate follow-up:** stamp discoverability and clip-range selection. Those required the most conceptual explanation while writing the tour.

---

## Contextual palette feedback (2026-11-02)

A direct review from the person commissioning the tool exposed a gap the first tutorial pass underweighted: **the real color picker was buried in inspector menus, while 24 default swatches looked like random color recommendations.** This was a first-order issue in one of the editor's most frequently used interactions, not simply another advanced feature to explain.

**Implemented:** promote a direct native color picker into the canvas toolbar; add in-inspector hex and opacity controls; show recently selected colors separately from colors sampled from visible artwork; generate deterministic, labeled companion hues from the selected color and dominant visible artwork color; keep the saved project palette as an explicit user choice. Blank new projects no longer inherit the historical 24 default colors. Older project palettes remain intact and can shed the original starter set without deleting subsequent additions. The in-app Field Guide now distinguishes current color from optional suggestions and explains how palette persistence works.

**Design constraints:** suggesting must not modify project state, interfere with undo/redo, falsely imply that random colors belong to an artwork, or mutate previously saved documents. Art-derived colors follow the active frame, use only visible composite pixels, and ignore effectively transparent cells. This intentionally stops short of AI image analysis or automatic palette replacement.

**Further exploration:** editable/preset palette names, smarter gamut-aware suggestions, a palette-importer for ASE/GPL, user-selectable color harmony strategies, and optional project-wide dominant-color analysis across animation frames. These are not included in the current change.

### Legacy starter colors, second usability pass

A user opening an old canvas would still have seen twenty-four automatic starter swatches under the heading "Saved project colors", even though new canvases started empty. This contradicted the redesigned interface and the user's original complaint. The old swatches are now preserved in a **collapsed, clearly labeled legacy section**. Saved favorites show only deliberately pinned colors; a starter swatch can be pinned without removing the original legacy record. The user can explicitly discard the starter set if they no longer want it, and no painted pixels are touched.
