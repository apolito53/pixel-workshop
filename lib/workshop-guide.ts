import type {InspectorTab} from './inspector-tabs.ts';

/** Pure, versioned guide copy. Each target must map to a visible in-editor data-guide anchor. */
export const GUIDE_VERSION=1;
export type GuideChapterId='start'|'drawing'|'animation'|'effects'|'ui'|'export'|'workspace';
export type GuideScope='all'|GuideChapterId;
export type GuidePanel='none'|'drawing'|InspectorTab;
export type GuideChapter={
 id:GuideChapterId;title:string;subtitle:string;icon:'rocket'|'paint'|'film'|'sparkles'|'package'|'key';
};
export type GuideStep={
 id:string;chapter:GuideChapterId;title:string;body:string;tryIt:string;target:string;panel:GuidePanel;
};

export const GUIDE_CHAPTERS:readonly GuideChapter[]=[
 {id:'start',title:'Start here',subtitle:'Projects, pixels, and safe saving',icon:'rocket'},
 {id:'drawing',title:'Draw & arrange',subtitle:'Tools, color, selections, and layers',icon:'paint'},
 {id:'animation',title:'Bring it to life',subtitle:'Frames, onion skins, and named clips',icon:'film'},
 {id:'effects',title:'Procedural magic',subtitle:'Make and regenerate animated FX',icon:'sparkles'},
 {id:'ui',title:'Make a UI kit',subtitle:'Stretchable frames, states, text, and shared colors',icon:'package'},
 {id:'export',title:'Ship your assets',subtitle:'PNG, SVG, sprite sheets, tiles, and game packs',icon:'package'},
 {id:'workspace',title:'Workspaces & agents',subtitle:'Private projects, MCP, and inspiration',icon:'key'},
];

export const GUIDE_STEPS:readonly GuideStep[]=[
 {id:'project',chapter:'start',title:'Your projects live here',
  body:'Switch between saved canvases using this menu. Each canvas keeps its own layers, animation, and edit history in your private workspace.',
  tryIt:'Open the project menu to see what you already have. Switching projects waits for pending saves.',
  target:'project-list',panel:'none'},
 {id:'new',chapter:'start',title:'Make a new canvas',
  body:'Choose a name and exact pixel dimensions, or try the Moonkeeper cottage and lantern examples. You can also import editable .pixel.json projects.',
  tryIt:'Try a 32 × 32 canvas for your first sprite. The tour never creates or changes a project for you.',
  target:'new-canvas',panel:'none'},
 {id:'pixels',chapter:'start',title:'One square is one pixel',
  body:'Draw directly on the canvas with the pencil. There is no hidden brush resolution: each cell becomes exactly one pixel in the finished PNG.',
  tryIt:'Make a tiny doodle! One finger draws on touchscreens; two fingers pan or pinch-zoom.',
  target:'canvas',panel:'none'},
 {id:'autosave',chapter:'start',title:'Your changes save as you work',
  body:'This status tells you whether the edit queue has saved. Strokes appear immediately and save in the background. If saving fails, the editor retains your edits and offers retry or Save a copy.',
  tryIt:'Watch the status after a stroke. There is no separate Save button for normal edits.',
  target:'save-status',panel:'none'},

 {id:'brushes',chapter:'drawing',title:'Meet your drawing tools',
  body:'Pencil (B), Eraser (E), Fill (G), Eyedropper (I), Line (L), Rectangle (R), Ellipse (O), Select (V), and Stamp (S) live here. The drawer opens on narrow or short screens.',
  tryIt:'Choose a brush. The canvas toolbar shows your active tool and shortcuts still work with the drawer closed.',
  target:'drawing-pencil',panel:'drawing'},
 {id:'undo',chapter:'drawing',title:'Undo without fear',
  body:'Undo and Redo restore complete edit steps. Use Ctrl/Cmd+Z, or Ctrl/Cmd+Shift+Z for Redo. Larger animated documents retain less history.',
  tryIt:'Draw a stroke, undo it, then redo it.',
  target:'drawing-history',panel:'drawing'},
 {id:'color',chapter:'drawing',title:'Your current color, always within reach',
  body:'The color square next to the canvas opens your device’s real color picker. It is always available, even when both drawers are closed. The Draw panel also has exact hex input and an opacity slider; the eyedropper samples colors from the canvas.',
  tryIt:'Click the square beside the canvas and pick a color. You can keep transparency when adjusting the RGB hue.',
  target:'current-color',panel:'none'},
 {id:'quick-colors',chapter:'drawing',title:'Grab a familiar color instantly',
  body:'Quick Colors are a fixed set of 24 everyday drawing colors: black, white, grays, primary and secondary hues, and useful earth tones. They never change or get added to your saved palette automatically. The Quick button beside the canvas opens the same swatches without digging into Draw.',
  tryIt:'Pick Red or Blue. If you lowered opacity first, changing a quick color keeps that opacity. Save a favorite only when you want it stored with your project.',
  target:'quick-colors',panel:'draw'},
 {id:'color-ideas',chapter:'drawing',title:'Colors that respond to your artwork',
  body:'Recently picked colors stay in this browser session. In Your Artwork shows the most-used visible pixels in the selected frame, and Suggested Companions offers highlights, shadows, and harmonies from your selected color and painting. Nothing is saved automatically.',
  tryIt:'Draw with two colors and watch the In Your Artwork swatches change. Use Save current color to keep favorites in your project. Older projects may have original starter swatches, which you can remove.',
  target:'color-ideas',panel:'draw'},
 {id:'select',chapter:'drawing',title:'Select and edit a region',
  body:'Press V and drag a rectangle on the active layer. Drag inside to move it, or use the Selection section to copy, flip, paste, and clear pixels.',
  tryIt:'Try copying a small area and moving it a few pixels.',
  target:'selection',panel:'draw'},
 {id:'stamps',chapter:'drawing',title:'Capture once, stamp many times',
  body:'Press S or choose Stamp, then drag over artwork on the active layer to capture it. The next click places a copy, with a translucent preview under your cursor. Snap to an optional tile grid; transparent areas do not erase existing scenery.',
  tryIt:'Use the Stamp Workbench to save a named tree or rock. Saved stamps follow this workspace across projects in the same browser.',
  target:'stamp-workbench',panel:'draw'},
 {id:'layers',chapter:'drawing',title:'Separate your artwork into layers',
  body:'Select a layer before drawing, hide it with the eye, or delete it to free a slot. Visibility and names apply to every animation frame. Each project supports up to eight layers.',
  tryIt:'Add a layer for highlights or shadows. Hiding a layer does not delete its pixels.',
  target:'layers',panel:'layers'},
 {id:'tracing',chapter:'drawing',title:'Line up a tracing reference',
  body:'Load a PNG in Draw → Tracing Reference. Drag the grid over the source and set its spacing, offsets, and output dimensions. Inspect the prepared nearest-neighbor image, then create a matching canvas or attach to the same-size current canvas. The prepared reference stays locked at (0, 0), with one reference pixel per drawing cell.',
  tryIt:'Try 4 source pixels per cell for artwork enlarged 4×. Switch between Trace overlay, Reference only, and Artwork only. Viewing opacity leaves exported artwork unchanged; the reference is saved in .pixel.json and excluded from PNG, SVG, and sprite-sheet artwork.',
  target:'tracing-reference',panel:'draw'},
 {id:'navigation',chapter:'drawing',title:'Zoom, fit, and move around',
  body:'Use the zoom controls to inspect individual pixels, and Fit to recenter the canvas. On phones and touchscreens, one finger paints while two fingers pan and pinch.',
  tryIt:'Zoom in to see the rigid cell grid at 3× or higher, then press Fit.',
  target:'zoom',panel:'none'},

 {id:'timeline',chapter:'animation',title:'A sprite can have many frames',
  body:'Duplicate the selected frame to make another editable cel. Play previews the frames, FPS controls speed, and Delete removes the selected non-base frame. Maximum: 32 frames.',
  tryIt:'Duplicate a frame and change one pixel on the new frame. The base frame remains untouched.',
  target:'timeline-actions',panel:'none'},
 {id:'onion',chapter:'animation',title:'Onion skin shows nearby frames',
  body:'The translucent neighboring frames are guides, so it is easier to draw movement. They never appear in exported images. Select each frame in the timeline strip to edit it.',
  tryIt:'Turn Onion on, then alternate between two frames you have drawn.',
  target:'timeline-track',panel:'none'},
 {id:'clips',chapter:'animation',title:'Select clip frames visually',
  body:'Choose Select clip range above the timeline, then drag across the frame thumbnails. Selected frames get a gold outline, and Create clip opens the naming fields. Shift-click extends a range; right-click a frame for a quick start. Colored markers show existing clips.',
  tryIt:'Drag a walk sequence, name it, choose its FPS and loop mode, then preview it in Clips.',
  target:'clip-range',panel:'none'},

 {id:'generate',chapter:'effects',title:'Generate an animated effect',
  body:'Choose from twelve procedural effects, including sparkles, fire, snow, smoke, lightning, and shockwaves. A seed makes the result repeatable; generation adds an editable FX layer.',
  tryIt:'Try Sparkles on a small sprite. You need one free layer and enough room in the animation budget.',
  target:'effects',panel:'effects'},
 {id:'regenerate',chapter:'effects',title:'Preview and preserve effects',
  body:'FX layers remember their recipe. Choose one, adjust parameters, then preview before and after for the selected frame. When space allows, regeneration keeps an original hidden backup layer, including every animation cel.',
  tryIt:'Preview a different seed. Applying requires previewing first; if there is no room for a backup, you must explicitly acknowledge overwriting the FX pixels.',
  target:'effects-recipe',panel:'effects'},

 {id:'ui-start',chapter:'ui',title:'Start with Stardrop’s UI',
  body:'Stardrop includes editable panels, buttons, icons, lettering, meters and decorations. In its asset workbench, Edit UI Kit in Workshop creates a set of copies in your current workspace with matching kit IDs and asset keys.',
  tryIt:'After the tour, open Stardrop and choose Edit UI Kit in Workshop. From a preview, Make a New Kit Copy does the same. Each use creates another set of copies.',
  target:'stardrop',panel:'none'},
 {id:'ui-panels',chapter:'ui',title:'Make a resizable panel',
  body:'Open Resizable panel guides. Drag the four gold guides or enter their pixel insets, then change the preview width and height to see the artwork stretch. The optional content overlay shows the saved or drafted insets at that size.',
  tryIt:'Press Save panel guides to apply them to the project. Unapplied drafts stay on this device when you change tabs or projects; use one browser tab per project.',
  target:'ui-panel-guides',panel:'ui'},
 {id:'ui-states',chapter:'ui',title:'Name button states and icons',
  body:'Open Button states & icons, choose the asset type, and save a name with a frame. Click a named thumbnail to select its frame. Icon sets use a compact grid; button assets offer an interactive rest, hover, pressed and disabled preview.',
  tryIt:'For Stardrop, keep the original state and icon names so the game can find them. Extra names are exported but do not automatically add game behavior.',
  target:'ui-state-names',panel:'ui'},
 {id:'ui-text',chapter:'ui',title:'Add editable pixel lettering',
  body:'Open Pixel text to add Tiny Caps on a new layer, or select an existing text layer to update it. Preview its position, spacing, scale and color, then choose Add text layer or Update selected text.',
  tryIt:'Tiny Caps accepts basic Latin, draws lowercase as capitals, and substitutes ? for missing ASCII glyphs. Painting on that layer’s text frame makes it ordinary pixels.',
  target:'ui-text',panel:'ui'},
 {id:'ui-colors',chapter:'ui',title:'Group projects and recolor a kit',
  body:'Under Kit & shared colors, View kit projects & palette shows the members and their asset keys. Review color change shows which projects will be affected before an exact RGB replacement across their layers and frames.',
  tryIt:'After applying, Undo last kit recolor restores the affected projects if they have not changed since the recolor. A stopped batch reports any partial changes.',
  target:'ui-kit-colors',panel:'ui'},
 {id:'ui-preview',chapter:'ui',title:'Preview and export your kit',
  body:'In Kit & shared colors, Preview kit in Stardrop applies matching asset keys to a game preview in the same browser tab. Export this kit downloads a ZIP with editable projects, PNG and SVG sheets, atlases and UI metadata. Save or discard kit drafts first.',
  tryIt:'The preview is local to that tab. Return to Editor restores your project and editing place; Restore Original returns Stardrop to its original artwork.',
  target:'ui-kit-colors',panel:'ui'},
 {id:'ui-load',chapter:'ui',title:'Load a kit into Stardrop',
  body:'Stardrop’s asset workbench has Load UI Kit ZIP. Choose a game pack exported by Pixel Workshop; matching Stardrop asset keys determine where its UI projects appear.',
  tryIt:'After the tour, open Stardrop and load an exported kit. The loader accepts Pixel Workshop’s uncompressed game-pack ZIPs.',
  target:'stardrop',panel:'none'},

 {id:'quickpng',chapter:'export',title:'Export the current frame',
  body:'This button downloads the selected frame as PNG or SVG. Choose the format in the Export tab. SVG preserves crisp pixel shapes and transparency at any size.',
  tryIt:'Choose SVG in Export, then download the current frame. The grid and onion skins are absent.',
  target:'quick-export',panel:'none'},
 {id:'spritesheet',chapter:'export',title:'Take the full animation with you',
  body:'Download the editable .pixel.json, a PNG or SVG sprite sheet for every frame, and the matching JSON atlas with frame positions and named clips. SVG sheets are static; the atlas describes playback.',
  tryIt:'Use the atlas with the matching sprite sheet when importing into a game engine.',
  target:'export',panel:'export'},
 {id:'tiles',chapter:'export',title:'Export a tileset',
  body:'Pick a tile size that divides evenly into your canvas. Tileset ZIP contains PNG and SVG images with matching atlases, coordinate-accurate tile IDs, transparency information, and editable source. This is not yet a full map editor.',
  tryIt:'For a 64 × 64 canvas, try 16px tiles to get a 4 × 4 tileset.',
  target:'tileset',panel:'export'},
 {id:'pack',chapter:'export',title:'Bundle a game asset pack',
  body:'Select up to thirty projects and export one ZIP with editable sources, PNG and SVG sprite sheets, matching animation atlases, and a root manifest. You can edit everything again later.',
  tryIt:'This is the same workflow used to package the art for Stardrop.',
  target:'pack',panel:'export'},

 {id:'workspace',chapter:'workspace',title:'Keep your workspace ID private',
  body:'Your workspace has a random ID and optional password. The Workspace menu lets you copy its ID or switch workspaces. Switching does not delete the original artwork.',
  tryIt:'Store your ID somewhere safe if you need to reopen the workspace on another device.',
  target:'workspace',panel:'none'},
 {id:'mcp',chapter:'workspace',title:'Agents can use the same drawing engine',
  body:'Workspace → Copy MCP connection produces a scoped connection URL and bearer token for an MCP-capable client. The token grants access to this workspace: protect it like a password.',
  tryIt:'Only generate and paste a connection when you intend to connect a trusted tool. The tour never creates a token.',
  target:'workspace',panel:'none'},
 {id:'stardrop',chapter:'workspace',title:'See a complete game made with it',
  body:'Stardrop is a playable proof-of-concept built from native Pixel Workshop assets. Its art gallery includes downloadable, editable characters, environments, and effects.',
  tryIt:'Open Stardrop after the tour and explore its complete downloadable art pack.',
  target:'stardrop',panel:'none'},
];

export function guideSteps(scope:GuideScope):GuideStep[]{
 return scope==='all'?[...GUIDE_STEPS]:GUIDE_STEPS.filter(step=>step.chapter===scope);
}
export function validateGuide():void{
 const chapters=new Set(GUIDE_CHAPTERS.map(c=>c.id)),ids=new Set<string>();
 for(const step of GUIDE_STEPS){
  if(ids.has(step.id)||!chapters.has(step.chapter)||!step.title||!step.body||!step.tryIt||!step.target)
   throw new Error('Invalid workshop guide step: '+step.id);
  ids.add(step.id);
 }
 for(const chapter of chapters)if(!GUIDE_STEPS.some(step=>step.chapter===chapter))
  throw new Error('Guide chapter is empty: '+chapter);
}
