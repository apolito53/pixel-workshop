# Image Finishing

[Open Image Finishing](https://pixel-workshop-nine.vercel.app/finish)

Image Finishing adjusts an existing illustration or photograph with deterministic image processing. It keeps the source image and a separate adjustment recipe, then renders every preview and export from that source. It does not call an image-generation model or convert the source into a pixel-art canvas.

## Browser workflow

Open **Image Finishing** from the editor header, **Finish an image** on the welcome screen, or the direct link above. The welcome-screen workflow does not require a workspace. Upload a PNG, JPEG, or WebP image, adjust its light and color, and compare the original with the edited result. Undo, redo, per-control reset, and reset-all affect the recipe; the source file remains untouched.

The Light, Color, and Detail panels use the controls below. Crop coordinates are measured in original image pixels. A crop changes the output dimensions explicitly and remains reversible. Reusable looks contain adjustments without carrying a previous image's crop into a different illustration.

Export PNG for lossless RGBA pixels and transparency, or JPEG for a flattened image with a chosen background. Export renders at the source resolution, or the chosen crop size. The interactive preview may be smaller for responsiveness; it is never used as the full-resolution export source. Spatial effects account for the preview scale.

Use the editable project download to retain the original image and current recipe together in a `.finish.json` file. Reopening this file restores the source, controls, and crop. It preserves the current recipe, not the complete undo history. Save a preset to reuse a look in this browser, or download the preset to move it elsewhere. Closing the finishing panel retains the current work while the page remains open. Download an editable project before leaving or reloading the page.

Images in the browser finishing workspace are processed locally. They are not automatically saved to the cloud pixel-project store. Presets saved in the browser use local storage. Pixel-art workspace saving, reference tracing, pixel conversion, and existing canvas limits are unchanged.

## Controls

The shared renderer uses the fixed order **crop → light and color → sharpening → blur**. Adjustments are always absolute values in a cumulative recipe, rather than repeated operations on the last exported image.

| Control | Range | Neutral | Meaning |
| --- | --- | --- | --- |
| Exposure | −4 to +4 | 0 | Stops of linear-light exposure; +1 doubles linear light. |
| Brightness | −100 to +100 | 0 | Overall channel brightness. |
| Contrast | −100 to +100 | 0 | Contrast around the midtone. |
| Highlights | −100 to +100 | 0 | A luminance-weighted adjustment favoring lighter tones. |
| Shadows | −100 to +100 | 0 | A luminance-weighted adjustment favoring darker tones. |
| Gamma | 0.2 to 3 | 1 | Midtone adjustment; values above 1 lift midtones. |
| Saturation | −100 to +100 | 0 | Color intensity; −100 removes chroma. |
| Vibrance | −100 to +100 | 0 | Positive values favor less saturated colors. |
| Warmth | −100 to +100 | 0 | Relative cool-to-warm grading, not a Kelvin white-balance value. |
| Tint | −100 to +100 | 0 | Relative green-to-magenta grading. |
| Hue | −180 to +180 | 0 | Hue rotation in degrees. |
| Sharpen | 0 to 100 | 0 | Unsharp masking that preserves the source alpha. |
| Blur | 0 to 20 | 0 | Blur radius in original image pixels, with premultiplied-alpha filtering. |

The image engine accepts up to **24,000,000 pixels**, with at most **16,384 pixels on either side**. The browser accepts source files up to **40 MB** and editable project files up to **56 MB**. Oversized images are rejected with an explanation; they are never silently shrunk. Output uses 8-bit sRGB channels. These are ordinary raster finishing tools; no CMYK proofing or RAW development is performed.

## Agent workflow through MCP

The **`finish_image`** tool exposes the same controls and renderer as the browser. It is available through the local stdio MCP server and the authenticated hosted `/mcp` endpoint. Refresh the MCP client's tool list after updating. Hosted calls retain the existing workspace authorization; the finishing operation itself does not read or modify any pixel-art project.

To adjust an original image, send its PNG bytes as plain base64 without a data-URL prefix:

```json
{
  "png_base64": "<original PNG base64>",
  "name": "Forest illustration",
  "adjustments": {
    "saturation": -18,
    "warmth": 9,
    "shadows": 12,
    "exposure": 0.15
  },
  "crop": null,
  "output": "both"
}
```

`output: "image"` is the default and returns a full-resolution PNG plus dimension and recipe metadata. `output: "project"` returns an embedded editable `.finish.json` resource containing the original image and recipe. `output: "both"` returns both. Choose project-only output when manual continuation matters and a duplicate flattened image is unnecessary.

For an explicit crop, pass an integer rectangle in original coordinates, such as `{"x":100,"y":80,"width":1600,"height":1200}`. A crop must fit entirely inside the source. Omit it for an uncropped new image or pass `null` to clear a saved crop.

An agent can continue an editable project directly:

```json
{
  "project": "<the parsed finishing project object>",
  "adjustments": { "saturation": -10 },
  "crop": null,
  "output": "project"
}
```

The placeholder above represents an object, not a literal string. Supply exactly one of `project` or `png_base64`. With a project, supplied adjustment values replace those keys in its saved recipe while retaining the other saved values. Omitted crop preserves its existing crop; `null` restores the full original dimensions. Repeated requests with the same source and recipe give the same pixels and do not compound earlier edits. The returned project can be opened in the browser, and a browser project with a supported PNG source can be passed back to the agent.

The Node/MCP decoder accepts still PNG sources up to **8 MB**, within the application transport's existing request limit, and shares the 24-megapixel dimension limit. It supports ordinary tagged or untagged sRGB PNG, including indexed images. Custom ICC profiles, non-sRGB transfer characteristics, 16-bit sources, and APNG are rejected with an explicit conversion message. JPEG and WebP remain supported in the browser; convert to an 8-bit sRGB PNG before sending them through MCP. Hosting providers and MCP clients can impose smaller request or response limits; use the local stdio server or browser for files beyond a hosted transport's capacity.

## Implementation and verification

`lib/image-finishing.ts` contains the browser-safe renderer and control definitions. `app/image-finishing.worker.ts` retains the decoded original, serializes rendering, and transfers preview/export buffers. The interface rejects stale results and groups a slider gesture into a single history step. `lib/finishing-project.ts` validates the shared project and preset formats. `lib/finishing-png.ts` checks PNG dimensions before decoding and tags MCP output as sRGB.

The finishing tests verify neutral pixel preservation, source immutability, full-resolution output beyond pixel-art limits, original-coordinate crops, alpha-safe filtering, recipe validation, project interchange, and the hosted/stdio tool paths. Existing pixel-art tests remain part of the release check.
