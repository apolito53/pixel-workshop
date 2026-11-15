// Player-facing release notes, newest first. Add meaningful shipped changes
// here with each production release; keep technical history elsewhere.
export const playerReleaseNotes = {
  workshop: [
    {
      title: 'November 2026',
      changes: [
        'Create canvases up to 1024 pixels per side and use up to 16 layers and 96 animation frames. The editor shows how much room your current canvas has.',
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
