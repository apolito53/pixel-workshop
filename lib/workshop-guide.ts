import type {InspectorTab} from './inspector-tabs.ts';

/** Pure, versioned guide copy. Each target must map to a visible in-editor data-guide anchor. */
export const GUIDE_VERSION=1;
export type GuideChapterId='start'|'drawing'|'animation'|'effects'|'export'|'workspace';
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
 {id:'export',title:'Ship your assets',subtitle:'PNG, sprite sheets, tiles, and game packs',icon:'package'},
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
 {id:'color',chapter:'drawing',title:'Choose a color that makes sense',
  body:'Current Color lives right beside your canvas. Open it for an RGB picker, opacity and hex/RGBA control. The Suggested group adapts to visible colors in this frame, Recently Chosen remembers your picks, and Saved holds only colors you intentionally pin. Older preset colors are labeled separately.',
  tryIt:'Pick a new color, draw a few pixels and notice the suggestions adapt. Save a favorite without changing existing artwork.',
  target:'palette',panel:'none'},
 {id:'select',chapter:'drawing',title:'Select, move, copy, stamp',
  body:'Press V and drag a rectangle on the active layer. Drag inside to move; copy, flip, paste, or clear it in the Selection section. Copy first, then use Stamp (S) to paint that region repeatedly.',
  tryIt:'Open Selection, copy a small shape, and try Stamp. Optional 8, 16, or 32px grid snapping helps with tiles.',
  target:'selection',panel:'draw'},
 {id:'layers',chapter:'drawing',title:'Separate your artwork into layers',
  body:'Select a layer before drawing, hide it with the eye, or delete it to free a slot. Visibility and names apply to every animation frame. Each project supports up to eight layers.',
  tryIt:'Add a layer for highlights or shadows. Hiding a layer does not delete its pixels.',
  target:'layers',panel:'layers'},
 {id:'navigation',chapter:'drawing',title:'Zoom, fit, and move around',
  body:'Use the zoom controls to inspect individual pixels, and Fit to recenter the canvas. On phones and touchscreens, one finger paints while two fingers pan and pinch.',
  tryIt:'Zoom in to see the rigid cell grid at 3× or higher, then press Fit.',
  target:'zoom',panel:'none'},

 {id:'timeline',chapter:'animation',title:'A sprite can have many frames',
  body:'Duplicate the selected frame to make another editable cel. Play previews the frames, FPS controls speed, and Delete removes the selected non-base frame. Maximum: 32 frames.',
  tryIt:'Duplicate a frame and change one pixel on the new frame. The base frame remains untouched.',
  target:'timeline-actions',panel:'none'},
 {id:'onion',chapter:'animation',title:'Onion skin shows nearby frames',
  body:'The translucent neighboring frames are guides, so it is easier to draw movement. They never appear in exported PNGs. Select each frame in the timeline strip to edit it.',
  tryIt:'Turn Onion on, then alternate between two frames you have drawn.',
  target:'timeline-track',panel:'none'},
 {id:'clips',chapter:'animation',title:'Name the motions in your sprite',
  body:'Clips assign names like idle, walk, or attack to frame ranges. Each clip has its own FPS and loop, once, or ping-pong playback. Sprite-atlas exports include these clips.',
  tryIt:'Create a walk clip, then use its Play button to preview just that range.',
  target:'clips',panel:'animation'},

 {id:'generate',chapter:'effects',title:'Generate an animated effect',
  body:'Choose from twelve procedural effects, including sparkles, fire, snow, smoke, lightning, and shockwaves. A seed makes the result repeatable; generation adds an editable FX layer.',
  tryIt:'Try Sparkles on a small sprite. You need one free layer and enough room in the animation budget.',
  target:'effects',panel:'effects'},
 {id:'regenerate',chapter:'effects',title:'Revisit the recipe later',
  body:'Effect layers remember their kind, seed, color, speed, opacity, and horizontal drift. Select an existing generated layer and regenerate it after tweaking those settings.',
  tryIt:'Be careful: regeneration preserves all other layers but replaces manual pixel changes inside the selected FX layer.',
  target:'effects-recipe',panel:'effects'},

 {id:'quickpng',chapter:'export',title:'Export the current frame',
  body:'This button downloads a transparent PNG of the selected frame. The Export tab provides more formats, including layered source projects and complete animations.',
  tryIt:'Export a PNG and see that the grid and onion skins are absent.',
  target:'quick-export',panel:'none'},
 {id:'spritesheet',chapter:'export',title:'Take the full animation with you',
  body:'Download the editable .pixel.json, a PNG sprite sheet for every frame, or a separate JSON atlas with frame positions and named clips. These are separate files.',
  tryIt:'Use the atlas with the matching sprite sheet when importing into a game engine.',
  target:'export',panel:'export'},
 {id:'tiles',chapter:'export',title:'Export a tileset',
  body:'Pick a tile size that divides evenly into your canvas. Tileset ZIP contains PNG, coordinate-accurate tile IDs, transparency information, and editable source. This is not yet a full map editor.',
  tryIt:'For a 64 × 64 canvas, try 16px tiles to get a 4 × 4 tileset.',
  target:'tileset',panel:'export'},
 {id:'pack',chapter:'export',title:'Bundle a game asset pack',
  body:'Select up to thirty projects and export one ZIP with editable sources, RGBA sprite sheets, animation atlases, and a root manifest. You can edit everything again later.',
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
