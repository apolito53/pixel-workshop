# UI Kit v1 workflow review — 2026-11-04

The goal was to exercise the Stardrop UI assets in the real workshop, then identify the next obstacles to an efficient design loop. The live pass used the previously imported Moonstone Frames, Twilight Buttons and Keeper’s Instruments projects. It changed only unsaved guide drafts, inspected controls and the existing kit palette, and visited the tab-local Stardrop preview. The earlier v1 pass also saved a sample slice, recolored the eight copied assets, exercised text and named states, and confirmed that the editor reported an export. The actual ZIP was not manually re-imported because the browser download capture timed out; the project’s automated pack test covers export, reading and applying the resulting sources.

## Highest priority: drafts can vanish while the status says saved

On Moonstone Frames, the saved left slice was 10 px. Entering 11 showed the new guide while the footer still said “All changes saved.” Switching to Draw and back to UI restored 10 without a warning. The draft is local to the mounted UI panel, while the existing save status represents the artwork save queue. That distinction is easy to miss in an editor where normal strokes autosave.

Keep UI drafts when changing tabs, show an explicit unsaved indicator, and either save or confirm before abandoning them. An intentional discard should be available, and the save indicator should account for both pending drafts and pending server edits. Drafts in the text, named-frame and kit-assignment fields deserve the same review.

## Highest priority: returning from a preview loses the editing context

Previewing the copied kit worked and the game reported eight edited assets. Following Stardrop’s Pixel Workshop link returned to “The little lantern,” rather than the Moonstone Frames project from which the preview was launched. The UI tab, selected frame and section were also no longer in place. The Stardrop “Edit UI Kit in Workshop” action creates a new set of copies on every use, so it is not a reliable return path to the same kit.

Provide a clear return-to-editor action that restores the original project and editing context. Separate reopening an existing kit from deliberately making a new copy, and make the local, tab-scoped nature of the preview visible at the point of use.

## Kit operations need a safer, more comprehensible home

The kit is identified by a raw ID inside one project’s inspector. Related projects otherwise appear in the ordinary flat project menu. There is no kit overview to see membership, missing or duplicated asset keys, or which project supplies a particular game element. Reopening Stardrop’s kit repeatedly creates additional similarly named projects, making the correct group harder to find.

Color replacement currently applies an exact RGB change across every layer and frame of each matching project. It has no before-and-after preview or list of affected projects, and Undo is per project; an interrupted batch can leave a partial result. A kit overview with named groups and a reversible batch preview would make these operations much easier to trust. The existing per-project undo is useful, but it is not a single kit-wide undo.

## The panel preview cannot answer the content-fit question yet

The live preview shows the stretched artwork, but changing the content inset from 14 to 20 left the preview pixels unchanged. There is no safe-area overlay or sample label to show where content will land. Stardrop reads the panel’s slice for its border image and uses content-inset-derived padding on the menu, subject to minimum padding; other panel uses do not automatically consume the content insets.

Overlay the content region on the resizable preview, allow sample text or an icon inside it, and make it clear which consuming component applies the insets. Side-by-side small, normal and large examples would reveal cramped content and distorted borders sooner.

## Named states and icons are still frame editing in disguise

Twilight Buttons exposes a useful state preview, but changing or naming artwork still involves the frame selector and timeline. The additional “focus” entry from the earlier test is preserved and exported, yet Stardrop uses its four expected button-state names; adding an entry does not give the game a new interaction. If a named preview state is missing, the preview falls back to rest without explaining that fallback.

Keeper’s Instruments contains sixteen named icons. In the inspector they form a single vertical list about 732 px tall, before the other UI sections, which is especially cumbersome in a phone drawer. A compact icon grid, obvious missing-state indicators, direct navigation between named entries and a clearer mapping from names to game usage would make the set feel like a UI kit instead of a long animation.

## Text needs a better first-use and editing experience

On the 16×16 icon canvas, opening Pixel text starts with “STARDROP,” which does not fit and leaves Add text layer disabled. There is no live text placement preview; position is specified numerically, and the result appears after applying it. Existing hand-drawn Stardrop lettering is ordinary pixels, so it cannot become editable text merely by selecting it. Tiny Caps is the only built-in font; it accepts basic Latin, draws lowercase as capitals and substitutes a question mark for unsupported ASCII glyphs.

Start with text that fits the current canvas, preview it before applying, and provide direct positioning and alignment. Additional fonts, editable font assets and a clearer notice before painting detaches a text recipe would broaden what the tool can produce.

## Export and integration still have sharp edges

The workshop ZIP carries editable projects, PNG and SVG sheets, atlases and UI metadata. Stardrop’s loader accepts the uncompressed ZIPs produced by the workshop, not arbitrary recompressed ZIPs. Asset keys control where projects are applied; a project with an unrecognized key is ignored, and duplicate recognized keys cause an error. These rules are not obvious before preview or export.

Validate and explain the game mapping before leaving the editor, show exactly which assets will be used or ignored, and provide direct named-icon exports where useful. Supporting common ZIP compression would make repackaged kits less fragile. The automated round-trip is valuable, but a reliable hands-on downloaded-file re-import check remains outstanding.

## Suggested next target

Make the editor-to-preview-to-editor loop safe and continuous first: retain drafts, give truthful save feedback, and return to the same project and kit. Then add a kit overview and reversible recolor preview. Those changes address the most consequential workflow interruptions before expanding the font library or adding more component types.
