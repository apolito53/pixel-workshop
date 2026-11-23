// Player-facing release notes, newest first. Add meaningful shipped changes
// here with each production release; keep technical history elsewhere.
export const playerReleaseNotes = {
  workshop: [
    {
      title: 'November 2026',
      changes: [
        'Open Guide → Build a sprite stack to practice on a little brass lantern. Pick a window, repaint it and watch the light change in the orbit preview.',
        'Build a 3D sprite by painting horizontal slices. Rotate the stack and click a visible pixel to jump to its slice and layer.',
        'Save your favorite view and export the slices as PNG sheets, with an editable copy of the stack included.',
        'Open Image Finishing to adjust the light, color, and detail of artwork or photos at full resolution, with before/after comparison and reversible edits.',
        'Crop, save reusable looks, and download an editable finishing project or a finished PNG or JPEG. Agents can use the same controls through MCP.',
        'Small drawings now use only the space around their pixels. Paint beyond their edges or erase them and the stored bounds adjust automatically.',
        'Keep up to 64 layers and 96 frames on canvases up to 1024 pixels per side. Held drawings share space until you edit them.',
        'Reorder layers, rename them and organize them in collapsible folders.',
        'Use Wind animation in Effects to pin a drawing, preview its sway and bake the loop into editable frames.',
        'Create or reopen your workspace from the portable editor’s start screen.',
        'Turn an image into pixel art with Pixel-ify, and refresh the preview as you adjust its settings.',
        'Bring in a tracing reference, align its grid, and create a matching canvas.',
        'Find this What’s new list on the workspace screen and in the editor.',
      ],
    },
    {
      title: 'More from the workshop',
      changes: [
        'Explore the Field Guide for a tour of drawing, animation, effects, and exporting.',
        'Create animation clips, reuse stamps, and export artwork as PNG or SVG sheets.',
        'Build and preview a custom interface for Stardrop: A Moonkeeper Tale.',
      ],
    },
  ],
  moonkeeper: [
    {
      title: 'November 2026',
      changes: [
        'Catch up on Stardrop changes with this new What’s new link.',
        'Edit the game’s interface in Pixel Workshop, then preview your custom kit in the game.',
        'Download the game’s editable artwork, PNG and SVG sheets, or the complete asset pack.',
      ],
    },
  ],
} as const;

export type ReleaseNotesEdition = keyof typeof playerReleaseNotes;
