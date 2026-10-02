# Drawing engine — 2.2.1

This revision ports the drawing behavior from galehouse5/skribbl-io-autodraw commit 950d76b26c9f6f26fd6353becca04ecedd623d8b:
https://github.com/galehouse5/skribbl-io-autodraw

License: Unlicense/public-domain dedication:
https://github.com/galehouse5/skribbl-io-autodraw/blob/950d76b26c9f6f26fd6353becca04ecedd623d8b/LICENSE

Reviewed modules: artist.js, canvas.js, color-palette.js, image-helper.js, non-blocking-processor.js, toolbar.js, index.js, drag-drop-event-listener.js, data-transfer-helper.js, and dom-helper.js.

## Ported behavior

- Fit-image scaling with nearest-neighbor sampling.
- Effective sampling diameter 2.9 pixels for the nominal 4-pixel brush.
- Closest game-palette color caching.
- Horizontal same-color run extraction.
- Most-common pixel color used to fill the canvas; transparent images use white. Fully transparent images are rejected before clearing.
- Background-color lines omitted.
- Lines mode uses long strokes first; Dots mode uses one mark per sample. Ties use stable color grouping and dispersed coordinates.
- Canvas cleared before background fill.
- Pointer-based drawing through the game's normal toolbar and canvas.

The engine is generalized proportionally for all five game brushes: 4, 10, 20, 32, and 40 pixels. It uses local CIELAB nearest-color matching without the reference project's external color-diff dependency.

## Safety differences

The reference's zero-delay command loop is not copied because it can overwhelm current game input handling and cannot provide reliable Pause/Stop. Moves use Fastest 13 ms with no extra gap, Normal 35+5 ms, Slow 80+10 ms. Fastest point marks in all styles use bounded seven-point/50 ms batches, including pure Dots. Short partial batches wait proportionally. The 13 ms move delay remains above the inspected 90Hz input gate and below the sustained eight-command/50 ms drain for two-command strokes. Progress notifications are throttled to ten per second.

The reference's third-party CORS proxy is not used. Local files stay local; website images use direct CORS requests. Dropped HTML is inspected only for a quoted image source and is never inserted into the page.

Turn changes, hidden pages, navigation, manual interaction, and Stop cancel the process. Inputs are limited to 10 MB/20 MP and 60,000 lines. No socket or private game protocol is used.

Lines/Dots is selectable and saved locally. Stop and turn checks cover Clear/Fill preparation as well as strokes; brush availability is checked before clearing. Image search, Wikimedia permissions, preview rendering, and automatic detail reduction are absent. Version is 2.2.1.

## Dot coverage and settings update

Lines geometry is unchanged. Every mark uses the selected brush. With fast fill enabled, Dots merges consecutive interior samples into horizontal strokes. At brush 4 only, same-color boundary points on the same row with gaps no larger than 3 pixels are compacted into horizontal segments. The game's strict radius-2 raster is a 3x3 square, so the union is pixel-identical; color-layer order is retained. The internal compactDots:false option exists for deterministic comparison tests, not user settings. Off retains pure dots. No adaptive larger brush is used.

## Sketch and guarded bucket fills

Sketch labels four-connected palette regions and traces their directed cell-edge contours. Collinear vertices are merged without arbitrary curve simplification. Larger regions are handled first; their outlines use connected pointer movement. A distance-from-boundary seed avoids the outline. Holes have separate closed contours. Tiny or narrow regions use stroke fallback. Sketch starts on white to preserve image margins.

Before each bucket command, the runner reads actual unfiltered canvas pixels, simulates reachability using the game's RGB tolerance (each channel differs by less than 3), and checks every reachable pixel against the planned region mask. Escaping fills or read failures reject the bucket. Contained partial fills are allowed, followed by fallback touch-ups. A single post-fill snapshot is retained for the current region; a fallback is skipped only if its complete Bresenham/hard-circle footprint already has exactly the target RGB value. Any missing pixel retains the stroke. Snapshot read failure retains all fallback strokes. This is a conservative snapshot check, not a guarantee against future game changes or concurrent canvas mutation. The public https://skribbl.io/js/game.js was inspected on 2026-09-09. No private game functions or sockets are used. Pause, Stop and turn checks apply between contour segments and before/after fills.

Run scripts/test-sketch.cjs against both builds. It uses a hard-pixel circular brush, Bresenham segments and tolerance-based flood fill; checks include actual successful buckets, holes, broken-outline fallback, selected brush retention, hybrid command reduction and Stop. All automated browser tests run in Chrome, including Firefox-target bundles; native Firefox and live multiplayer need manual verification.

Inspection of https://skribbl.io/js/game.js confirmed that pointer-down already creates a point command. The old zero-distance pointer-move duplicated it. All styles now use down/up only for point marks. Fastest uses seven dots per 50 ms; Normal uses three per 50 ms with fast fill on or one per 40 ms otherwise; Slow uses one per 90 ms. Game implementation changes may require adjustment. No sockets or internal game functions are invoked.

Settings use the permanent sgDrawSettings key. Valid values migrate from sgDrawSettings202, then sgDrawSettings201, without deleting either legacy key. Controls wait for loading, writes are serialized to preserve the latest change, and storage errors are reported. There is no version-dependent reset or expiry. Browser uninstall/data clearing can still remove the storage.

Run scripts/test-direct-draw.cjs and scripts/test-dot-settings.cjs against source and dist browser targets. The latter covers migration, ordered saves, fresh page sessions, turn/BFCache retention, failed saves, dot counts, rendered image fidelity and Lines invariance. Tests execute in Chrome; native Firefox and live multiplayer still require manual verification.
