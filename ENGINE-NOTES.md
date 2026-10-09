# Drawing engine — 2.2.1

This revision ports the drawing behavior from galehouse5/skribbl-io-autodraw commit 950d76b26c9f6f26fd6353becca04ecedd623d8b:
https://github.com/galehouse5/skribbl-io-autodraw

License: Unlicense/public-domain dedication:
https://github.com/galehouse5/skribbl-io-autodraw/blob/950d76b26c9f6f26fd6353becca04ecedd623d8b/LICENSE

Reviewed modules: artist.js, canvas.js, color-palette.js, image-helper.js, non-blocking-processor.js, toolbar.js, index.js, drag-drop-event-listener.js, data-transfer-helper.js, and dom-helper.js.

## Ported behavior

### Extension coexistence

The fork keeps extension ID `bpjccmbldjbdpkgaikbejoninpmgaidd`; the original store
extension uses a different ID and separate Chrome storage. Keep the existing
storage keys so installed preferences and learned words survive updates.
`SG_*` modules run in the extension's isolated world.

Shared page identifiers use `skribbl-smart-drawer-guesser-panel` and `ssdg-*` CSS/DOM
names. MAIN-world bridges use `ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request`
and `-draw-status`, with equivalent `-votekick-request`/`-votekick-status` events.
Both ends must change together if the extension's identity is ever changed.
Synthetic canvas/palette pointer IDs are 1937041/1937042.

Image drops and pastes are accepted only inside the visible Draw pane. Alt
shortcuts apply only inside this panel; handled shortcuts stop propagation before
another extension's global shortcut handler. The guesser watches native game
elements and uses a closure-local debounce timer, so another panel's changes do
not start mutual redraw loops. Automation still shares the game's canvas/chat;
users should activate one automated drawer or guesser at a time.

`node scripts/test-panel-experience.cjs` includes a competing-extension fixture
in both loading orders and checks the genuine MAIN-world drawing runner's bridge
isolation, styles, panel ownership, shortcut routing and outside image passthrough.

### Image conversion

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

The reference's zero-delay command loop is not copied because it can overwhelm current game input handling and cannot provide reliable Pause/Stop. Moves use Fastest 13 ms with no extra gap, Normal 35+5 ms, Slow 80+10 ms. Fastest point marks in all styles use bounded seven-point/50 ms batches, including pure Dots. Short partial batches wait proportionally. The 13 ms move delay remains above the inspected 90Hz input gate and below the sustained eight-command/50 ms drain for two-command strokes. Progress notifications are throttled to ten per second. Ultra Fast is described below. No operations are truncated.

The reference's third-party CORS proxy is not used. Local files stay local; website images use direct CORS requests. Dropped HTML is inspected only for a quoted image source and is never inserted into the page.

Turn changes, hidden pages, navigation, manual interaction, and Stop cancel the process. Inputs are limited to 10 MB/20 MP and 60,000 lines. No socket or private game protocol is used.

Lines/Dots is selectable and saved locally. Stop and turn checks cover Clear/Fill preparation as well as strokes; brush availability is checked before clearing. Image search, Wikimedia permissions, preview rendering, and automatic detail reduction are absent. Version is 2.2.1.

## Dot coverage and settings update

Lines geometry is unchanged. Every mark uses the selected brush. With fast fill enabled, Dots merges consecutive interior samples into horizontal strokes. At brush 4 only, same-color boundary points on the same row with gaps no larger than 3 pixels are compacted into horizontal segments. The game's strict radius-2 raster is a 3x3 square, so the union is pixel-identical; color-layer order is retained. The internal compactDots:false option exists for deterministic comparison, not user settings. Dots uses the selected brush.

## Sketch and guarded bucket fills

Sketch labels four-connected palette regions and traces their directed cell-edge contours. Collinear vertices are merged without arbitrary curve simplification. Larger regions are handled first; their outlines use connected pointer movement. A distance-from-boundary seed avoids the outline. Holes have separate closed contours. Tiny or narrow regions use stroke fallback. Sketch starts on white to preserve image margins.

Before each bucket command, the runner reads actual unfiltered canvas pixels, simulates reachability using the game's RGB tolerance (each channel differs by less than 3), and checks every reachable pixel against the planned region mask. Escaping fills or read failures reject the bucket. Contained partial fills are allowed, followed by fallback touch-ups. A single post-fill snapshot is retained for the current region; a fallback is skipped only if its complete Bresenham/hard-circle footprint already has exactly the target RGB value. Any missing pixel retains the stroke. Snapshot read failure retains all fallback strokes. This is a conservative snapshot check, not a guarantee against future game changes or concurrent canvas mutation. The public https://skribbl.io/js/game.js was inspected on 2026-09-09. No private game functions or sockets are used. Pause, Stop and turn checks apply between contour segments and before/after fills.

Run scripts/test-sketch.cjs against both builds. It uses a hard-pixel circular brush, Bresenham segments and tolerance-based flood fill; checks include actual successful buckets, holes, broken-outline fallback, selected brush retention, hybrid command reduction and Stop. All automated browser tests run in Chrome, including Firefox-target bundles; native Firefox and live multiplayer need manual verification.

Inspection of https://skribbl.io/js/game.js confirmed that pointer-down already creates a point command. The old zero-distance pointer-move duplicated it. All styles now use down/up only for point marks. Fastest uses seven dots per 50 ms; Normal uses three per 50 ms with fast fill on or one per 40 ms otherwise; Slow uses one per 90 ms. Game implementation changes may require adjustment. No sockets or internal game functions are invoked.

Settings use the permanent sgDrawSettings key. Valid values migrate from sgDrawSettings202, then sgDrawSettings201, without deleting either legacy key. Controls wait for loading, writes are serialized to preserve the latest change, and storage errors are reported. There is no version-dependent reset or expiry. Browser uninstall/data clearing can still remove the storage.

Run scripts/test-direct-draw.cjs and scripts/test-dot-settings.cjs against source and dist browser targets. The latter covers migration, ordered saves, fresh page sessions, turn/BFCache retention, failed saves, dot counts, rendered image fidelity and Lines invariance. Tests execute in Chrome; native Firefox and live multiplayer still require manual verification.

## Ultra Fast region planner

### Limits in the game

From https://skribbl.io/js/game.js (inspected 2026-10-02):

- A pointermove is dropped if it arrives less than 1000/90 ms after the previous accepted move. Each accepted move with the brush makes one line command.
- A pointerdown makes one dot command (brush) or one bucket command, with no rate limit. It makes no command when it lands outside the canvas, or when the bucket targets a pixel that already has the selected color.
- The drawer's client forwards queued commands 8 per 50 ms, which is 160 per second.
- Other players request one command per `setInterval(..., 1)` tick. Actual browser cadence varies;
  that interval alone does not establish a fixed 250-command/s maximum.

The previous Ultra Fast sent each sample run as a dot command plus a line command and was already sending at the 160-per-second limit. On the Simpsons family test image that was 6,568 commands and 49 s. Faster local dispatch could not help, so the only lever is fewer commands.

### Plan (instant-planner.js)

1. **Sampling.** The grid is the selected brush's sample grid (2.9 or 4.35 px). Each sample takes the palette color with the lowest summed CIELAB ΔE over a 3×3 supersample of its area, instead of the color of the single source pixel the grid hits. That pixel was often an anti-aliased edge pixel, which produced isolated wrong-color samples.
2. **Regions.** Same-color samples are grouped into eight-connected regions. Thin outline regions are drawn first, because their strokes seal wider neighbors at no extra cost; the remaining regions are drawn smallest first, so bucket fills stay available for the large interior regions drawn last. Every region gets three candidate plans, each simulated on a palette-index port of the game's brush and bucket:
   - sample runs;
   - an outline only where neighbors are still unpainted, plus one bucket per enclosed pocket;
   - a full outline plus buckets.
3. **Outlines.** Outlines follow the region's edge samples, simplified with Douglas-Peucker at 1 or 1.5 px. A segment is dropped when it would paint no pixel that still needs its color.
4. **Fills.** A pocket is filled only if the simulated flood stays inside the region and its neighboring samples. Enclosed holes of up to 12 samples are filled over and then redrawn with dots or short runs, which costs less than outlining each hole. Each region keeps the cheapest of the three plans.
5. **Reordering.** Operations whose footprints do not overlap, or same-color strokes, may be reordered. Dots and fills are moved ahead of long polylines so the send queue does not run dry while moves are rate-limited.
6. **Stroke starts.** A stroke can:
   - continue from the previous end point (free);
   - start with a bucket press on a pixel that already has its color (free);
   - start with a bucket-tool travel move (one move, no command);
   - start with a dot (one command).

   The choice is made per stroke on a replay of the game's clock.
7. **Search.** Two outline tolerances and four relative move prices are tried. The plan whose replay finishes first is kept.

### Runner

- Moves are spaced at least 1000/90 + 0.25 ms apart, measured with `performance.now()`. Dots, buckets and tool, color and size changes are sent immediately.
- Before each bucket, the live canvas is flooded with the game's tolerance inside the planned box plus one pixel. If the fill could leave the box or exceed the planned area, the bucket is skipped and the region's sample rows are drawn instead.
- Done is reported after the modeled local send queue drains, based on the measured times at which each command was queued. Remote receipt is not acknowledged.

The planner's simulation and the ported game raster produce identical pixels. Conversions for Slow, Normal and Fastest are byte-identical to the last committed version. An uncommitted Ultra Fast change had made those speeds stop skipping transparent and background samples; that has been restored.

### Measured results

Measured in Edge with scripts/instant-benchmark/run.cjs. Time is until the last command was forwarded to other players. Match is the share of pixels equal to the source's nearest palette color, inside the image.

| Image | Brush | Before: time, commands, match, ΔE | Ultra Fast now: time, commands, match, ΔE |
|---|---|---|---|
| Simpsons family (268×315 PNG) | 4 | 49.4 s, 6,568, 88.0%, 10.08 | 21.6 s, 3,417, 89.8%, 9.20 |
| Homer (190×390 PNG) | 4 | 19.0 s, 2,592, 86.6%, 10.52 | 8.0 s, 1,189, 91.0%, 9.10 |
| Simpsons logo (960×540 PNG) | 4 | 27.2 s, 3,476, 95.0%, 4.36 | 12.7 s, 1,848, 94.6%, 4.26 |
| Cat photo (960×1282 JPEG) | 4 | 66.7 s, 8,949, 78.9%, 14.24 | 24.3 s, 3,658, 85.7%, 12.92 |
| Mona Lisa (960×1431 JPEG) | 4 | 84.7 s, 10,653, 74.1%, 21.72 | 18.7 s, 2,954, 85.5%, 20.70 |
| Simpsons family | 6 | 22.4 s, 3,386, 85.7%, 11.24 | 12.2 s, 1,917, 86.7%, 10.26 |
| Homer | 6 | 9.2 s, 1,345, 86.9%, 11.22 | 4.8 s, 734, 88.8%, 10.13 |
| Simpsons logo | 6 | 13.6 s, 2,023, 93.6%, 5.70 | 7.9 s, 1,199, 92.2%, 5.57 |
| Cat photo | 6 | 27.5 s, 4,186, 77.8%, 14.42 | 12.1 s, 1,820, 84.0%, 13.14 |
| Mona Lisa | 6 | 36.6 s, 5,105, 71.5%, 21.98 | 9.7 s, 1,524, 83.7%, 20.85 |

Brush 5 matches brush 4 because the game draws both with the same 3×3 stamp. Lower ΔE is better. On the logo, ΔE improves but slightly fewer pixels match the nearest palette color exactly. Planning takes 0.2 to 0.7 s and is not included in the times above.

### Remaining limit

The existing Ultra Fast region-by-region representation needs at least one command per separate color region. At brush level 1, on the test images, that plan alone uses 1,447 (Simpsons family), 1,227 (Simpsons logo), 925 (cat), 575 (Homer) and 528 (Mona Lisa) commands, so at 160 commands per second the Simpsons family cannot finish under 9 s at this detail. Sending faster than the game client would mean bypassing its send queue. Ultra Fast does not do that: it can get the drawer kicked, and other players still replay about 250 commands per second at most. Ultra Fast never removes detail to meet a time.

## Ultra Fast optimizations and image adjustments

The selector stores `instant` in `sgDrawSettings.speed`; saved `max` preferences migrate to it. Ultra Fast preserves the complete raster
selected by Ultra Fast, including its palette, samples, margins, details, outline tolerance and
candidate tie breaks. The previous time-budget merger has been removed. Even its quick plan with
`changed: 0` could differ from Ultra Fast because it selected a different outline variant. The
three other speeds retain their output and timing parameters.

### Pipeline and cost

1. Fit and quantize exactly as Ultra Fast. Ultra Fast reuses the nearest-color cache during supersampling
   and caches CIELAB distances without changing their summation order or tie breaks. The RGB cache
   has a 16,384-entry bound for photos. No resolution or palette reduction is performed.
2. Label the same eight-connected regions and evaluate all eight Ultra Fast candidate plans.
   Cache horizontal/vertical region order, full wall chains and simplified points. A packed typed
   undo log replaces boxed pixel/color pairs. Useful-footprint predicates stop at the first useful
   pixel; the original raster, candidates and choices are unchanged.
3. Run `ultra-optimizer.js` on the complete selected reference plan. Reverse pixel coverage removes
   an operation only when later brush operations overwrite its entire footprint before the next
   fill. Fills form dependency barriers. A 64-operation lookahead favors existing colors and
   shared endpoints, with at most eight candidate dependency checks per head. Reordered operations
   must commute; curves are never reversed or joined through unrelated pixels.
4. Replay each proposed transformation, reconstruct free/continued stroke starts and compare all
   480,000 palette-index pixels with the reference. Accept only an identical raster and a better
   cost (execution estimate, commands, moves, changes, then distance). A rejected optimization or
   optimizer failure retains the complete reference. No operations are truncated to meet a clock.
5. Complete the draw plan before Clear or any drawing event. Execute its colors, tools, sizes and
   points directly. The only image-dependent runtime computation is the necessary live fill/free
   start safety check; it cannot be replaced with a prediction if the real canvas has changed.

After pruning, `exact-raster-encoder.js` tests two alternate background colors, restores omitted
background components with exact guarded fills, and combines safe brush coverage within two
large blocks between fill barriers. Dots can become native large stamps or straight spans.
A spatial index bounds coverage queries, and deterministic proposal/flood budgets discard an
expensive candidate while retaining the complete reference. No time limit truncates the drawing.
Alternate fills allow at most 4 raster canvases of flood visits per candidate; wide-block replay
allows 8 canvases of flood visits, and its mask/coverage/pruning searches allow 16 canvases of
footprint visits across the two blocks. Band candidate footprint work is capped at 8 canvases.
These budgets bound extra search; complete replay and pixel equality still precede acceptance.

`background-band-encoder.js` identifies uniformly colored rectangular cells separated by full
background rows and columns. It retains operations for all irregular/mixed cells, removes only
operations wholly inside uniform cells, paints those cells with wide brushes, and restores
background corridors. The largest brushes can deliberately extend into those corridors; they
cannot touch another cell's foreground. The final raster must match every reference pixel, and
the reconstructed game-clock cost must improve before the candidate is selected.

Axial brush footprints enumerate each pixel in the union of native brush stamps once. This
preserves the game's circle/rectangle and clipping exactly while avoiding repeatedly visiting
the same pixels along long wide strokes. The reference candidate search remains unchanged.

Let N be sample cells, P palette colors, U distinct RGB values, B boundary points, F pixels visited
by the simulated brush/fills, and A planned operations. Initial quantization is O(N + U*P).
Region growing is O(N); cached region ordering is O(sum n_r log n_r) once rather than once per
candidate. Douglas-Peucker can be O(B^2) in its worst case; retaining the reference algorithm avoids
changing its chosen raster. The fixed eight-candidate search still costs O(F) per candidate; caches
remove repeated sorting and full-wall geometry but do not claim to make the whole search linear.
Lossless pruning/replay is O(F + 800*600), and bounded lookahead is O(A*64*8), not an unbounded
nearest-neighbor search. Working memory includes O(N + 800*600 + A + 16384*P) and the growing packed
undo log. Source decode/supersampling also owns its normal image buffers.

Cursor distance does not impose a travel duration: the game receives coordinate jumps. Reducing
rate-limited move count and transmitted command count matters more than a quadtree or a shorter
geometric route. Spatial/color ordering is accepted only when the measured plan cost improves.

### Browser execution

Ultra Fast caches canvas geometry (invalidated by scroll, resize, ResizeObserver and periodic turn checks),
brush presets, preview and pointer-capture descriptors. Capture methods are restored after every
synchronous dispatch, so ordinary manual input still works. The preflight brush is reused instead
of selecting it again. Live fill checks keep the original RGB tolerance, area/bounds containment
and stroke fallback, with reusable typed workspaces and no neighbor array allocation per pixel.
New synthetic fills have `exact: true`, an empty fallback and recomputed count/bounds. Their
live component must match that complete count and bounding box; unexpected seeds, escaping or
partial components abort with an explicit status error before painting. Standard fill fallback
behavior remains unchanged. All seven used brush sizes are verified before Clear.

Ultra Fast starts without the legacy preparation sleeps. Its move clock uses MessageChannel task yields
until the existing 1000/90 + 0.25 ms gate is satisfied; Windows timer overshoot therefore does not
add an avoidable interval to each move. The timestamp is taken after synchronous dispatch,
retaining the safe input margin even when
listeners or rendering introduce variable latency. A proposed timestamp before dispatch was rejected
by native tests because it could lose moves. Task yields keep Stop/Pause and the game's
50 ms send timer responsive. This spends CPU on precise pacing and exposes `gateTaskYields` for
measurement; it is not a busy loop that blocks the event loop. Legacy timer behavior is unchanged.

### Metrics and verification

The plan returns `metrics`: source/sample/supersample/raster pixel counts, regions, palette size,
initial quantization, sampling, region planning and optimization times, candidate count, simulated
paint/flood work, baseline/optimized operations, brush/fill counts, moves and state changes. Ultra Fast
completion reports preparation, execution, fill checking, gate waiting, queue waiting, pointer
counts, state changes, layout reads, task yields, total time and whether it met five seconds.
`optimizationMs` covers all optimization stages; `pruningMs` identifies the original optimizer
alone. Final operation counts describe the selected drawing, while per-encoder metrics describe
their individual trials. The verified reference raster is reused only inside the conversion
engine and is never added to the serialized draw request.
The UI forwards local image loading time as well. All reported CPU times are diagnostic and never
choose a lower-quality plan or terminate a drawing at five seconds.

Run (Node 22+, installed Chrome/Edge, no npm dependencies):

    node scripts/test-ultra-adjustments.cjs --browser
    node scripts/benchmark-ultra.cjs --out benchmark.json

Add `--baseline <directory>` to the tests for exact legacy plan/command comparison for the unchanged speeds. Use benchmark
`--source <directory>` before changes, then `--reference before.json --reference-speed instant --assert-equal` afterward to
compare native paced rasters to the saved Ultra Fast result. Reports include exact pixel differences,
SHA-256, processing/execution/delivery times, commands, brush/fill operations, regions, pointer and
DOM actions. See scripts/benchmark-speed-max-results.json for the measured before/after summary. Test cases
include a simple shape, a textured portrait, color bands, 300 disconnected multicolor blocks and
fine details. Generated fixtures are deterministic and are not evidence of live multiplayer timing.

The final migration benchmark is in `scripts/benchmark-ultra-results.json`: all five decoded
ImageBitmap outputs equal their pre-migration optimized reference with zero dropped movements.
Current total times were 531 ms (simple), 11,786 ms (portrait), 1,431 ms (bands), 17,096 ms
(300 blocks) and 3,047 ms (fine details). Slow/Normal/Fastest plans and commands match the snapshot.
Native editor tests verify preview without drawing, real neutral-gray palette restriction,
fractional gamma entry, reset/re-upload/cancel and automatic typed-text drawing.

Historical native ImageBitmap measurements before the migration (milliseconds, one measured run per case on 2026-10-02). The former Max column is now the Ultra Fast strategy:

| Fixture | Ultra preprocessing | Ultra execution | Ultra total | Max preprocessing | Max execution | Max total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 473 | 307 | 785 | 400 | 168 | 573 |
| Textured portrait | 772 | 11,499 | 12,276 | 636 | 11,358 | 11,998 |
| Color bands | 1,144 | 739 | 1,888 | 972 | 522 | 1,498 |
| 300 separate blocks | 1,193 | 22,252 | 23,449 | 961 | 16,418 | 17,384 |
| Fine details | 550 | 2,699 | 3,254 | 497 | 2,563 | 3,063 |

Totals include approximately 3-5 ms of ImageBitmap decoding. All five results have zero RGBA
pixel differences, zero dropped moves, all commands sent and no optimizer failure. Every fixture
processes 56,650 sample cells, 509,850 supersamples and compares the complete 480,000-pixel raster.
These references have no completely overwritten strokes to prune: command and move counts remain
unchanged. The gains come from preprocessing, fewer state changes and precise safe dispatch.

| Fixture | Commands | Moves | Brush operations | Fills | Final foreground regions | Color changes Ultra → Max | Actions Ultra → Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 6 | 4 | 1 | 1 | 1 | 2 → 2 | 18 → 17 |
| Textured portrait | 1,801 | 408 | 1,776 | 5 | 500 | 110 → 23 | 4,089 → 4,001 |
| Color bands | 68 | 35 | 23 | 10 | 21 | 20 → 20 | 147 → 146 |
| 300 separate blocks | 2,140 | 1,334 | 506 | 300 | 491 | 436 → 321 | 3,988 → 3,872 |
| Fine details | 395 | 126 | 389 | 2 | 206 | 161 → 58 | 1,077 → 973 |

Brush operations count planned lines and dots; commands count the game's resulting marks,
including background preparation. Actions count observed pointer events and control selections.
`metrics.regions` counts sampled eight-connected foreground regions; the benchmark's final
foreground regions count four-connected components of the rendered raster. These distinct counts
can differ because of brush footprints and resampled edges. Timings depend on browser/hardware;
the fixture operations and output are deterministic.

### Image editor

`image-editor.js` owns preview/settings UI; `image-adjustments.js` owns deterministic RGBA
transforms and bounded LUT caches. Loading a bitmap opens the editor without computing regions
or dispatching a draw. Preview updates coalesce through requestAnimationFrame and fit 640×420;
the original histogram fits 512×512. No drawn result is read from CSS filters.

Draw image renders edits once at source resolution, then decodes a temporary bitmap before
conversion so the converter receives its normal ImageBitmap input. Neutral edits reuse the
original bitmap directly, preserving previous resampling exactly. Level tables apply master RGB,
then channel levels, then contrast; luminance-based saturation or monochrome follow. Saturation
is inactive in monochrome and its setting is retained for switching back to color.
Pure RGBA transforms preserve alpha. Monochrome additionally restricts conversion to the real
palette's neutral RGB entries. Full drawing plans are generated before Clear.

The original remains immutable. Reset, new upload, Cancel and turn changes have explicit bitmap
ownership; superseded temporary bitmaps are closed. Numeric controls permit intermediate typing
and normalize on commit. Input/output white remains above black and gamma is bounded. Auto uses
0.5% histogram tails and retains flat images. Editing does not silently change a source or settings
for a later upload. Metrics include image adjustment CPU time in preprocessing, while user editing
wait time is excluded. Native tests cover the preview-to-draw path and source reset.

### Five-second limit

The public game script (https://skribbl.io/js/game.js, checked 2026-10-03) still accepts moves at
90 Hz and sends eight commands per 50 ms (160/s). With C commands and M moves, the current plan
has an optimistic floor of max((ceil(C/8)-1)*0.05, max(0,M-1)/90) seconds, with the
first send tick optimistically at time zero. Its sustained send rate is C/160 seconds approximately.
Preprocessing, the unknown send phase, rendering and network overhead add to this floor. This is
a bound for that plan, not a proof that every possible lossless encoding
needs C commands. Fewer than five seconds requires reducing the full-quality representation itself
to fewer than roughly 800 commands and 450 moves, with additional headroom for processing.

Before the additional encoders, the textured portrait needed 1,801 commands: transmission alone
needed about 11.3 seconds. The 300-block fixture needed 1,334 moves: the input gate alone needed
about 14.8 seconds. The upload comparison uses decoded ImageBitmap inputs; canvas and bitmap resampling
can choose different edge pixels, so references must use the same input type. These cases do not
meet five seconds. Ultra Fast completes them without discarding pixels,
and the UI reports the target overrun. Native tests compare the final result byte for byte with
Ultra Fast; the previous simplified Max had lost 13,874 portrait pixels and 91,825 fragmented pixels.

The new exact encoders change that representation through safe larger-brush coverage and
deliberate overpainting followed by restoration. They are evaluated against the complete reference
raster. The audit in `scripts/benchmark-ultra-encoder-results.json` records their measured savings
and every selected plan's optimistic send/move floor. Faster color lookup, a worker, or batching
DOM calls cannot remove a selected plan's remaining floor. Sending moves faster than the input
gate or painting directly on the local canvas would not deliver the same accepted drawing to the
game. A universal five-second full-quality guarantee is still not established; overruns remain
reported explicitly and every detail is completed.

### Initial exact-encoding verification (2026-10-03)

The measured pipeline is Ultra Fast reference planning, exact pruning/reordering, alternate
background/wide-brush search, and partial background-band encoding. The inverse-mask prototype
was not integrated: its native candidates were rejected by complete pixel verification and
added processing without a demonstrated speed benefit. It cannot be used to claim five seconds.

| Deterministic fixture | Before total (ms) | Final total (ms) | Final commands / moves | Different RGBA pixels |
| --- | ---: | ---: | ---: | ---: |
| Simple | 627 | 400 | 6 / 4 | 0 |
| Textured portrait | 12,016 | 11,288 | 1,717 / 432 | 0 |
| Multicolor | 1,372 | 954 | 68 / 35 | 0 |
| 300 fragmented blocks | 16,650 | 13,707 | 1,812 / 1,086 | 0 |
| Fine details | 3,100 | 2,816 | 395 / 126 | 0 |
| Photo-like facade | 3,406 | 3,196 | 381 / 239 | 0 |

Totals include native ImageBitmap decoding, processing, execution and actual mock send-queue
delivery. These are single measured runs, not timing guarantees or measurements of the uploaded
photograph. All six final rasters match the saved reference byte for byte; all commands were
delivered, zero moves were dropped, and no browser errors or optimizer failures occurred. Four
fixtures meet five seconds. The two remaining plans have optimistic throughput floors of
10,700 ms (portrait) and 12,056 ms (fragmented), so those plans cannot meet it through faster local
dispatch alone. This does not establish a minimum for every possible full-quality encoding.

`scripts/benchmark-ultra-encoder-results.json` contains the complete compact comparison, stage
metrics, hashes, throughput floors and earlier rejected trials. Native controls and Node checks
also verify unchanged Slow/Normal/Fast plans/events, determinism, stored Max migration, grayscale,
levels/contrast/saturation, seven brush sizes at two CSS scales, exact fill metadata after
overpainting, unsafe fills, recent manual input and cancellation.

### Further exact compression (2026-10-03)

Ultra Fast now verifies every even native diameter from 4 through 40, plus the existing
5 px brush. It selects a nearby public preset and uses normal wheel increments, checking
each transition before Clear. The three other speeds keep their previous controls and
command sequences. No permission, socket, queue or input-gate change is required.

The band encoder additionally handles complete cells containing multiple colors. It paints
the main color, restores exact rectangular facets, then restores shared background corridors
and corner pixels. Eight color caches use at most 15.4 MB of row/column prefixes. Safety
queries use exact axial intervals derived from the same cached native stamps as the pixel
rasterizer; circle extents are computed once per diameter. Spatial buckets score only pending
background pixels. Limits of 512 cells, 120,000 proposals, 1,000,000 intervals, 24 raster-sized
footprint passes and eight raster-sized pending-pixel passes reject the whole candidate.
The previous partial encoder remains available when a complete grid cannot be encoded.

The exact-raster encoder's final refinement considers inverse masks for a dense small-detail
color within a larger shape. Original marks that seal the outside boundary are retained and
restored after the outside bucket; additional reference marks repair any remaining detail.
The complete raster is checked after restoration and pruning, and bucket counts/bounds are
recomputed for the resulting order. Three deterministic alternatives can replace short axial
lines with exactly equivalent endpoint stamps. The queue/move timeline chooses the fastest.
Cheap guards skip simple plans and selected band encodings; at most two backgrounds, 6,000
reference operations and 32 raster-sized footprint passes bound this refinement. Exhaustion
retains the entire prior plan. It never truncates a drawing or selects a measured-time-dependent
approximation.

Latest native ImageBitmap measurements include decoding, all processing and actual mock queue
delivery. The previous column is the initial exact-encoding revision above. All six outputs
retain every reference RGBA pixel and deliver every command, with no dropped moves or errors.

| Deterministic fixture | Previous total (ms) | Latest total (ms) | Commands / moves | Different pixels |
| --- | ---: | ---: | ---: | ---: |
| Simple | 400 | 573 | 6 / 4 | 0 |
| Textured portrait | 11,288 | 8,373 | 1,103 / 547 | 0 |
| Multicolor | 954 | 1,248 | 68 / 35 | 0 |
| 300 fragmented blocks | 13,707 | 7,342 | 945 / 410 | 0 |
| Fine details | 2,816 | 3,139 | 395 / 126 | 0 |
| Photo-like facade | 3,196 | 3,657 | 381 / 239 | 0 |

These single runs vary with browser scheduling and hardware. Four unchanged command plans
remain below five seconds. The two newly compressed plans still exceed it: their optimistic
throughput floors are 6,850 ms (portrait) and 5,900 ms (fragmented). Those floors describe the
selected representations; they do not establish a minimum for every lossless strategy.
The unavailable attached photograph has not been measured.

`scripts/benchmark-ultra-additional-results.json` records this full comparison, acceptance
status, hashes, stage costs and work counters. The 380 independent interval/brush probes,
native 20-size controls and clipping tests, complete six-case raster comparison, legacy/editor
checks and forced mixed/inverse budget-exhaustion tests all pass. The expanded default Node
test includes the inverse-mask check; `--inverse-only` and `--mixed-only` run its focused checks.
