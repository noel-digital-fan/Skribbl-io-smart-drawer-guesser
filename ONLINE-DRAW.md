# Auto Draw — version 2.2.5

## How to use

Brush choices are 4, 5 and 6 px. Skribbl rounds its brush footprint, so 5 px can look the same as 4 px. The requested size is verified before the canvas is cleared.

The Guess and Draw tabs remain available. During your drawing turn:


1. Use the always-visible Draw settings to choose Lines, Dots or Sketch, brush 1 (4 px), 2 (5 px) or 3 (6 px), and a speed. The style is saved with your other drawing settings.
2. Drop a PNG, JPEG, WebP or GIF image onto the game canvas or Draw tab. You can also click the drop area to select a file.
3. Drawing starts automatically after the image is loaded and converted.
4. Use Pause/Resume or Stop when needed.


New installations default to Sketch, brush level 2 (5 px), and Fastest. Existing choices are restored. The three controls are always visible in Draw. The donation button is shared by both tabs. Type text into Draw typed text and press Draw to make a centered, local text image that Auto Draw sends to the game during your drawing turn. Enter adds a centered new line; only the Draw button starts drawing and typed keys remain in that field rather than the game chat. The text field and suggestion filter each have a clear button. Typed text is not uploaded, synced or saved. Draw style, brush and speed use permanent local extension storage, with migration from both older settings keys. They have no expiry and survive refreshes, browser restarts, matches and normal extension updates. Uninstalling the extension or clearing its data removes browser-owned settings.

Dots always uses fast fill. It joins interior samples, then draws boundaries. At both sizes, adjacent same-color boundary dots are joined only where the game's hard brush produces exactly the same pixels. Horizontal or vertical coverage is selected within each color layer to reduce work without changing its raster. It never enlarges the brush. The switch has been removed, and previously saved OFF settings migrate to ON.

Sketch traces connected color shapes, largest first, draws their closed outlines and uses the game's bucket only when a pixel-level check confirms the fill stays inside the intended region. A contained partial fill is allowed; remaining details use touch-up strokes. A touch-up is skipped only if every pixel its brush would paint already has the requested color. Holes remain separate. Open or unsafe areas fall back to strokes. It uses a white canvas so image margins stay neutral. This is geometric tracing, not AI object recognition or an exact imitation of a person's drawing. Simple cartoons work best; photos and tiny details are limited by the palette and brush.

Google Images opens a small separate window for the current drawing word plus cartoon drawing, only when clicked. Repeated clicks focus the same window, and it closes when your drawing turn ends. Results and their scrolling stay in that window, not inside the extension. The button is unavailable until your word is selected. No search API, in-panel gallery, Start button, or converted preview is used. Local images up to 10 MB and 20 megapixels are supported. GIF uses its first frame. Website-image drops work only when the source permits browser access; otherwise save the image and drop the local file. No proxy is used.

Images selected outside your drawing turn are not queued. Switching browser tabs or apps no longer cancels Auto Draw. Browsers may throttle or freeze background tabs, so background speed is not guaranteed. Turn changes, navigation away from the game, and manual drawing/toolbar actions still stop Auto Draw.

## Drawing engine

The engine follows galehouse5/skribbl-io-autodraw at commit 950d76b26c9f6f26fd6353becca04ecedd623d8b:

- Fit the complete image to the 800×600 game canvas.
- Sample at 2.9-pixel spacing for brushes 1/2 (4/5 px) and 4.35-pixel spacing for brush 3 (6 px).
- Convert source colors to the nearest available Skribbl palette color.
- Merge adjacent equal-color pixels into lines, selecting horizontal or vertical coverage when it lowers the estimated drawing time without changing pixels.
- Clear the canvas and fill it with the image's largest color area. Transparent artwork uses white so the subject remains visible.
- Skip lines matching that filled background.
- Lines starts with long strokes and optimizes direction within color layers. Dots compacts interior and boundary samples automatically. Sketch traces connected boundaries and checks enclosed fills. Thin unbranched shapes may use connected centre-lines when no slower; short contour simplifications are accepted only when their hard-brush pixels are identical.

Brush choices are 1=4 px, 2=5 px and 3=6 px. Previous larger brush settings migrate to 6 px; other saved settings remain intact. Every mark uses the selected size. The 6 px brush uses the game's normal 4 px preset plus one wheel increment; its size preview is verified before clearing. If verification fails, drawing does not start. Fastest uses the previous 12 ms between moves, with no extra all-command limiter. Single-point marks retain seven-point/50 ms batching without duplicate zero-distance moves. Progress updates are capped at ten per second.

Within a contiguous color/brush layer, collinear marks are merged only when their hard-brush coverage is identical. Shared endpoints can form one path without adding bridge pixels. Fills and conditional touch-ups are never reordered. Sketch compares outline-plus-fill cost with scanlines and skips expensive outlines when even a successful fill cannot recover their cost. No automatic larger brush, speckle removal or lower-resolution mode is introduced.

Command estimates include starting dots, segments, fills and potential Sketch touch-ups. Time estimates take the larger of local pacing and nominal game transmission time; they are not server acknowledgements. Completion reports delivery to the local game; other players may still be receiving it. The extra all-command limiter and final artificial wait were removed after a measured slowdown. Fastest now counts elapsed dot/fill work toward the next move's 12 ms interval instead of always waiting another full 12 ms. Normal and Slow pacing are unchanged.

For 60-second turns, use Fastest; Dots fast fill is always enabled. Estimates use the visible game countdown when available, warn when less than five seconds of headroom remain, and show time left during drawing. Without a readable countdown, the warning threshold is 55 seconds. This is a warning, not automatic detail removal or deadline scheduling. Complex images can still exceed a turn; there is no silent resolution reduction or guaranteed deadline.

The source is necessarily resized and mapped to the game's limited colors and brushes. This is not a lossless image upload. The engine rejects more than 60,000 lines rather than silently reducing detail.

Unlike the previous engine, Auto Draw now clears the game canvas and fills its background before drawing, matching the referenced engine. Do not use it over a drawing you want to keep.

## Privacy and permissions

No image-search API or Wikimedia host permissions are used. Clicking Google Images sends the drawing-word search to Google as a normal browser navigation, subject to Google privacy practices. Local files are decoded and processed on your device and are not uploaded by the extension.

Dropping a website image requests that specific HTTPS image from its source using the browser's normal CORS rules, without credentials, referrer, redirects, or proxy fallback. The source receives ordinary connection information such as your IP address. Private/local addresses, raw SVG, web pages, and unsupported formats are rejected.

The optional learned-word cloud sync remains separate and unchanged. Version is 2.2.5.

## Verification

Run:

    node scripts/test-direct-draw.cjs source/chrome
    node scripts/test-direct-draw.cjs source/firefox
    node scripts/test-direct-draw.cjs dist/chrome
    node scripts/test-direct-draw.cjs dist/firefox
    node scripts/test-dot-settings.cjs dist/chrome
    node scripts/test-dot-settings.cjs dist/firefox
    node scripts/test-draw-optimizer.cjs source/chrome
    node scripts/test-draw-optimizer.cjs source/firefox

The hybrid benchmark compares three fixtures. Run node scripts/test-dot-compaction.cjs to verify exact hard-raster equality with and without level-1 boundary compaction. Sketch tests use hard-pixel brush rasterization and flood-fill tolerance matching the inspected public game script, including closed shapes, holes, deliberate broken outlines and Stop. Run node scripts/test-sketch.cjs against each target. An optional PNG path benchmarks all styles against a 90Hz move gate. Estimates exclude browser/network overhead; Sketch estimates include potential fallback strokes. These are not live-game completion guarantees.

The fixtures verify the separate-tab Google URL, always-visible settings, Sketch/5 px/Fastest defaults, all three brush sizes, local drag/drop, saved settings and continuation across simulated hidden-page events. They run in Chrome even for Firefox-target files. Native Firefox and live background-tab performance still need manual testing.
