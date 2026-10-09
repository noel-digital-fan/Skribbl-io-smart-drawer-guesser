# Auto Draw — version 2.2.5

## How to use

Brush choices are 4, 5 and 6 px. Skribbl rounds its brush footprint, so 5 px can look the same as 4 px. The requested size is verified before the canvas is cleared.

The Guess and Draw tabs remain available. During your drawing turn:


1. Use the always-visible Draw settings to choose Lines, Dots or Sketch, brush 1 (4 px), 2 (5 px) or 3 (6 px), and Slow, Normal, Fastest or Ultra Fast. These settings are saved locally.
2. Drop a PNG, JPEG, WebP or GIF image onto the Draw tab, focus a control in that tab and paste an image with **Ctrl+V** (**Command+V** on Mac), or click **Paste image** to paint immediately with your current settings. **Auto-paint images on drop or paste** is ON by default and can be changed at any time in Draw settings. Canvas drops and image pastes outside this panel are left to the game and other extensions.
3. To adjust before drawing, click the drop area to select a file, or turn automatic image-drop/paste painting OFF. These images open the preview and wait for **Draw image**.
4. Use Pause/Resume or Stop when needed.


New installations default to Sketch, brush level 2 (5 px), Ultra Fast and automatic image-drop painting ON. Existing choices are restored, including an explicitly saved OFF setting. Ultra Fast draws each color region as the outline that seals it plus one bucket fill, keeping the selected brush's sample grid. The canvas background is bucket-filled before the image strokes. The speed choices are Slow, Normal, Fastest and Ultra Fast. Drawing settings are always visible in Draw. Type text into Draw typed text and press Draw to make a centered, local text image that Auto Draw sends to the game during your drawing turn. Enter adds a centered new line; only the Draw button starts drawing and typed keys remain in that field rather than the game chat. The text field and suggestion filter each have a clear button. Typed text is not uploaded, synced or saved. Draw style, brush, speed and automatic image-drop painting use permanent local extension storage, with versioned migration from both older settings keys. They have no expiry and survive refreshes, browser restarts, matches and normal extension updates. Uninstalling the extension or clearing its data removes browser-owned settings.

Outside your turn, drop or paste an image into the Draw panel, or use the file picker,
to add it to **Image queue**. Its adjustment preview opens immediately. Choose **Edit**
beside any entry to reopen it; contrast, saturation, black and white, and levels are retained
separately for each image. **Save changes** closes the editor and keeps the edited image
queued. **Close editor** also closes the editor without removing the queue entry. The remove
button (×) deletes one image and **Clear** deletes them all, releasing their decoded bitmaps.

When automatic painting is ON, the first ready queued image draws at the start of your
next drawing turn, using its saved adjustments and your current drawing settings. Only one
queued image paints automatically per turn; remaining images wait for later turns. An image
that finishes loading after your turn starts can still draw in that turn. With automatic
painting OFF, the queue stays available for editing and waits for you to select an entry and
choose **Draw image** during your turn. Turn changes retain the queue and its edits. Leaving
or reloading the page clears it. Images and queued adjustments live only in page memory;
they are never uploaded or saved in extension storage.

Dots defaults to fast fill, which joins interior samples before drawing boundaries. Previously saved fast-fill choices are retained, including OFF; the panel no longer exposes a separate switch. At all manual brush sizes, adjacent same-color boundary dots are joined only where the game's hard brush produces exactly the same pixels. Horizontal or vertical coverage is selected within each color layer to reduce work without changing its raster. It never enlarges the brush.

Sketch traces connected color shapes, largest first, draws their closed outlines and uses the game's bucket only when a pixel-level check confirms the fill stays inside the intended region. A contained partial fill is allowed; remaining details use touch-up strokes. A touch-up is skipped only if every pixel its brush would paint already has the requested color. Holes remain separate. Open or unsafe areas fall back to strokes. It uses a white canvas so image margins stay neutral. This is geometric tracing, not AI object recognition or an exact imitation of a person's drawing. Simple cartoons work best; photos and tiny details are limited by the palette and brush.

Google Images opens a small separate window for the current drawing word plus cartoon drawing, only when clicked. Repeated clicks focus the same window, and it closes when your drawing turn ends. Results and their scrolling stay in that window, not inside the extension. The button is unavailable until your word is selected. There is no search API or in-panel gallery. Uploaded images have a local adjustment preview and Draw image action. Local images up to 10 MB and 20 megapixels are supported. GIF uses its first frame. Website-image drops work only when the source permits browser access; otherwise save the image and drop the local file. No proxy is used.

Switching browser tabs or apps no longer cancels Auto Draw. Browsers may throttle or freeze background tabs, so background speed is not guaranteed. Turn changes, navigation away from the game, and manual drawing/toolbar actions still stop Auto Draw. Waiting images survive turn changes; navigation away clears them.

## Drawing engine

The engine follows galehouse5/skribbl-io-autodraw at commit 950d76b26c9f6f26fd6353becca04ecedd623d8b:

- Fit the complete image to the 800×600 game canvas.
- Sample at 2.9-pixel spacing for brushes 1/2 (4/5 px) and 4.35-pixel spacing for brush 3 (6 px).
- Convert source colors to the nearest available Skribbl palette color.
- Merge adjacent equal-color pixels into lines, selecting horizontal or vertical coverage when it lowers the estimated drawing time without changing pixels.
- Clear the canvas and fill it with the image's largest color area. Transparent artwork uses white so the subject remains visible.
- Skip lines matching that filled background.
- Lines starts with long strokes and optimizes direction within color layers. Dots compacts interior and boundary samples automatically. Sketch traces connected boundaries and checks enclosed fills. Thin unbranched shapes may use connected centre-lines when no slower; short contour simplifications are accepted only when their hard-brush pixels are identical.

Manual brush choices are 4 px, 5 px and 6 px. Ultra Fast keeps the selected brush's sample grid, choosing each sample's color by the lowest color difference over its area. Its exact encoders can use larger native brushes when the complete final raster remains identical (see ENGINE-NOTES.md). The game exposes every even diameter from 4 to 40 through its normal wheel increments; Ultra Fast verifies the requested sizes before clearing. Its estimate replays the plan on the game's limits; it cannot account for network delay. If brush verification fails, drawing does not start. Fastest uses the previous 12 ms move pacing, with no extra all-command limiter. Ultra Fast spaces moves by the game's 1000/90 ms gate and sends dots and fills without waiting. Single-point marks retain seven-point/50 ms batching without duplicate zero-distance moves. Progress updates are capped at ten per second.

Within a contiguous color/brush layer, collinear marks are merged only when their hard-brush coverage is identical. Shared endpoints can form one path without adding bridge pixels. Fills and conditional touch-ups are never reordered. Sketch compares outline-plus-fill cost with scanlines and skips expensive outlines when even a successful fill cannot recover their cost. Ultra Fast only reorders operations whose footprints cannot affect each other.

Command estimates include starting dots, segments, fills and potential Sketch touch-ups. Time estimates take the larger of local pacing and nominal game transmission time; they are not server acknowledgements. Completion reports delivery to the local game; other players may still be receiving it. The extra all-command limiter and final artificial wait were removed after a measured slowdown. Fastest now counts elapsed dot/fill work toward the next move's 12 ms interval instead of always waiting another full 12 ms. Normal and Slow pacing are unchanged.

Ultra Fast reports done after the modeled send queue drains, including a tick for its unknown phase; it does not receive an acknowledgement from other players. Its current region-by-region plan is bounded by the game's 160 commands per second, so some detailed plans take longer than five seconds. Dots fast fill starts enabled unless an existing preference turns it off. Estimates use the visible game countdown when available, warn when less than five seconds of headroom remain, and show time left during drawing. Without a readable countdown, the warning threshold is 55 seconds. This is a warning, not automatic detail removal or deadline scheduling. Complex images can still exceed a turn; there is no silent resolution reduction or guaranteed deadline.

The source is necessarily resized and mapped to the game's limited colors and brushes. This is not a lossless image upload. The engine rejects more than 60,000 lines rather than silently reducing detail.

Unlike the previous engine, Auto Draw now clears the game canvas and fills its background before drawing, matching the referenced engine. Do not use it over a drawing you want to keep.

The speed selector contains Slow, Normal, Fastest and Ultra Fast. Saved Speed Max selections migrate to Ultra Fast, which preserves the previous full-quality raster
and optimizes repeated calculation, proven redundant brush operations, independent operation order
and browser dispatch. It does not reduce resolution, merge colors or omit regions. Live fill safety
checks remain necessary. Diagnostic plan metrics include processing; the panel shows estimated
drawing time and warns when a full-quality plan may not fit the remaining turn. Input and send limits can make a five-second target unreachable for the current plan;
the drawing still completes with every detail. Existing speed choices and saved settings retain
their behavior.

During your drawing turn, file-picker images and drops with automatic painting OFF open an adjustment preview before
conversion. Choose Draw image to start drawing. Drops with automatic painting ON start
conversion and drawing as soon as image loading and the game palette are ready. Turning the
setting OFF while loading keeps the image in the preview. Stop or a turn change cancels an
image loaded during your active drawing turn. Images added while waiting remain queued
through turn changes; removing an image, Clear, or leaving the page cancels their loading.
Black and white maps to the real game's neutral gray palette; it is not just a preview CSS filter.
Contrast (-100 to 100), saturation (0 to 200%), and levels are applied to the decoded original
pixels. Levels provide a histogram, master RGB and per-channel controls, input black/white,
gamma, output black/white, Auto and Reset. Five handles can be dragged directly below the
histogram and output gradient; their positions stay synchronized with the numeric values.
Arrow keys provide fine adjustment, Shift provides larger steps, and Home/End reach the
allowed limits. Each channel retains separate levels. Reset all restores the original; Cancel closes the
image without drawing. New uploads start with neutral adjustments. Typed text retains its
immediate drawing flow. A queued original remains available through editor changes and turns
until drawn, removed, cleared, or navigation. For images selected during your turn, a new image,
Cancel, or turn change closes the original; temporary edited images are closed after replacement. Interactive editing time is not
included in processing/execution metrics. Full-quality photographs can still exceed five seconds.

## Privacy and permissions

No image-search API or Wikimedia host permissions are used. Clicking Google Images sends the drawing-word search to Google as a normal browser navigation, subject to Google privacy practices. Local files are decoded and processed on your device and are not uploaded by the extension.

The **Paste image** button uses the extension's `clipboardRead` permission to read
image data only when clicked. Keyboard image pastes use the browser's normal paste
event; ordinary text and copied links keep their normal behavior. Clipboard images
remain on your device and use the same 10 MB / 20 MP limits as files. Reload the
extension and game page after updating. If the button cannot access the clipboard,
press **Ctrl+V** (**Command+V** on Mac) on the game page. Stop, a replacement image,
a turn change, or leaving the page cancels a pending clipboard read.

Dropping a website image requests that specific HTTPS image from its source using the browser's normal CORS rules, without credentials, referrer, redirects, or proxy fallback. The source receives ordinary connection information such as your IP address. Private/local addresses, raw SVG, web pages, and unsupported formats are rejected.

The optional learned-word cloud sync remains separate and unchanged. Version is 2.2.5.

## Verification

From the extension directory, with Node 22+ and Chrome or Edge installed, run:

    node scripts/test-panel-experience.cjs
    node scripts/test-ultra-adjustments.cjs --browser
    node scripts/test-ultra-brushes.cjs

Run `node scripts/instant-benchmark/run.cjs` (see its header) to measure Ultra Fast end to end
against a port of the game's drawing code, including delivery time and fidelity. Run
`node scripts/benchmark-instant.cjs` to compare conversion time, command counts and modeled
draw duration across six generated fixture types. Modeled duration is not a live-game
completion guarantee; browser and network overhead can change it.

Run `node scripts/test-ultra-adjustments.cjs --browser` for Ultra Fast planning, image adjustments, visual-feature preservation,
conversion plus simulated delivery, exact Ultra Fast pixel equality, move-gate acceptance, unsafe-fill fallback
and cancellation. It uses Node 22+ and an installed Chrome/Edge with no npm dependencies. Add
`--baseline <directory>` to compare the three unchanged speeds and the optimized Ultra Fast migration against pre-change source files.

Run `node scripts/test-panel-experience.cjs` for first-install defaults, preservation and migration
of existing preferences, the saved automatic image-drop toggle, immediate panel drops,
keyboard image pastes, clipboard button reads and failures, preserved text pastes,
file-picker preview, off-turn queue editing, per-image settings, FIFO auto-paint once per turn,
manual queued drawing with automatic painting OFF, delayed loads, removal/navigation cleanup,
Stop/turn-change cancellation, and native pointer/keyboard level controls.
It checks all five handles, numeric synchronization, channel isolation, Reset, Auto and disabled
states in a real Chromium DOM with native image decoding and canvas previews. A deterministic
converter/runner bridge isolates panel behavior; the Ultra Fast suite checks real drawing fidelity.
Add `--artifacts <directory>` to save panel, compact-viewport and image-editor screenshots.

The fixtures verify the separate-tab Google URL, always-visible settings, Sketch/5 px/Ultra Fast defaults, all three brush sizes, local drag/drop, saved settings and continuation across simulated hidden-page events. They run in Chrome even for Firefox-target files. Native Firefox and live background-tab performance still need manual testing.
