"use strict";

// No npm dependencies. Node checks use a minimal readable canvas; --browser also
// exercises the real DOM, native canvas, 90 Hz input gate and 160 commands/s mock.
//   node scripts/test-ultra-adjustments.cjs
//   node scripts/test-ultra-adjustments.cjs --baseline <directory> --browser
// BROWSER may point to a Chrome/Edge executable. Baseline contains unmodified
// instant-planner.js, image-converter.js and draw-runner.js from before the edit.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { performance } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const baselineArg = argv.indexOf("--baseline");
const BASELINE = baselineArg < 0 ? null : path.resolve(argv[baselineArg + 1]);
const artifactArg = argv.indexOf("--artifacts");
const ARTIFACTS = artifactArg < 0 ? null : path.resolve(argv[artifactArg + 1]);
const ENGINE_FILES = ["background-band-encoder.js", "instant-planner.js", "max-optimizer.js", "ultra-optimizer.js", "exact-raster-encoder.js", "image-converter.js"];
const SOURCES = [...ENGINE_FILES, "draw-runner.js"];
const RGB = [
  [255,255,255],[0,0,0],[193,193,193],[80,80,80],[239,19,11],
  [116,11,7],[255,113,0],[194,56,0],[255,228,0],[232,162,0],
  [0,204,0],[0,70,25],[0,255,145],[0,120,93],[0,178,255],
  [0,86,158],[35,31,211],[14,8,101],[163,0,186],[85,0,105],
  [223,105,167],[135,53,84],[255,172,142],[204,119,77],[160,82,45],[99,48,13],
];
const PALETTE = RGB.map((rgb, index) => ({ index, rgb }));

// Semantic probes supplement pixel agreement: a face remains recognizable only
// when its eyes, mouth and outer contour survive the low contrast texture.
function fixture(name, rgb) {
  const width = 800, height = 600, pixels = new Uint8ClampedArray(width * height * 4);
  const colorAt = (x, y) => {
    if (name === "simple") return x >= 210 && x <= 590 && y >= 140 && y <= 460 ? 16 : 0;
    if (name === "specks") {
      if (x >= 210 && x <= 590 && y >= 140 && y <= 460) return 16;
      return x % 12 < 3 && y % 12 < 3 ? 2 : 0;
    }
    if (name === "noise") return ((Math.imul(x + 1, 2654435761) ^ Math.imul(y + 1, 2246822519)) >>> 0) % 26;
    const dx = (x - 400) / 195, dy = (y - 310) / 210, r = dx * dx + dy * dy;
    if (r > 1) return 0;
    if (r > 0.93) return 1;
    if ((x - 330) ** 2 + (y - 255) ** 2 < 19 ** 2 || (x - 470) ** 2 + (y - 255) ** 2 < 19 ** 2) return 1;
    if (x >= 315 && x <= 485 && y >= 386 && y <= 402) return 1;
    if (x >= 390 && x <= 410 && y >= 300 && y <= 345) return 6;
    // Hundreds of distracting dots have less contrast than the defining shape.
    return x % 19 < 6 && y % 17 < 6 ? 2 : 8;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, c = rgb[colorAt(x, y)];
    pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = 255;
  }
  return { name, width, height, pixels };
}

class CanvasShim {
  width = 0;
  height = 0;
  pixels = new Uint8ClampedArray();
  getContext() {
    return {
      fillRect: () => { this.pixels = new Uint8ClampedArray(this.width * this.height * 4).fill(255); },
      drawImage: (image, _x, _y, width, height) => {
        this.pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const sx = Math.min(image.width - 1, Math.floor(x * image.width / width));
          const sy = Math.min(image.height - 1, Math.floor(y * image.height / height));
          const from = (sy * image.width + sx) * 4;
          this.pixels.set(image.pixels.subarray(from, from + 4), (y * width + x) * 4);
        }
      },
      getImageData: () => ({ data: this.pixels }),
      putImageData: ({ data }) => { this.pixels = new Uint8ClampedArray(data); },
    };
  }
}

function plannerTestSource(directory) {
  const source = fs.readFileSync(path.join(directory, "instant-planner.js"), "utf8"), anchor = "globalThis.SG_INSTANT_PLANNER = { plan };";
  assert.ok(source.includes(anchor), 'Planner test bridge anchor changed');
  return source.replace(anchor, 'globalThis.SG_TEST_ENGINE = { rasterize: rasterizeOps, forFootprint: visitFootprint, forFootprintRanges: visitFootprintRanges, finish };\n' + anchor);
}

function loadEngine(directory, exposeInternals = false) {
  const sandbox = { performance, document: { createElement: () => new CanvasShim() } };
  vm.createContext(sandbox);
  for (const file of ENGINE_FILES) if (fs.existsSync(path.join(directory, file)))
    vm.runInContext(exposeInternals && file === "instant-planner.js" ? plannerTestSource(directory) : fs.readFileSync(path.join(directory, file), "utf8"), sandbox, { filename: file });
  return sandbox;
}
function converter(directory) { return loadEngine(directory).SG_IMAGE_CONVERTER; }

function footprintRangesTest() {
  const engine = loadEngine(ROOT, true).SG_TEST_ENGINE;
  const sizes = [5, ...Array.from({ length: 19 }, (_, i) => 4 + i * 2)];
  let compared = 0;
  for (const size of sizes) {
    const dots = [[0,0],[799,0],[0,599],[799,599],[400,300],[0,300],[799,300]]
      .map(point => ({kind:"dot",size,color:1,point}));
    const axes = [[[0,0],[799,0]],[[0,599],[799,599]],[[0,0],[0,599]],[[799,0],[799,599]],[[130,200],[730,200]],[[400,80],[400,520]]];
    const lines = axes.flatMap(points => [points,[...points].reverse()])
      .map(points => ({kind:"line",size,color:1,points}));
    for (const op of [...dots,...lines]) {
      const ranged = new Uint8Array(800 * 600), footprint = new Uint8Array(800 * 600);
      const completed = engine.forFootprintRanges(op, (fixed,low,high,horizontal) => {
        assert.ok(Number.isInteger(fixed) && Number.isInteger(low) && Number.isInteger(high));
        assert.ok(fixed >= 0 && fixed < (horizontal ? 600 : 800));
        assert.ok(low >= 0 && low <= high && high < (horizontal ? 800 : 600));
        for (let along=low;along<=high;along++) ranged[horizontal ? fixed*800+along : along*800+fixed] = 1;
      });
      assert.equal(completed,true);
      engine.forFootprint(op,pixel => { footprint[pixel] = 1; });
      assert.deepEqual(ranged,footprint,`${size}px: interval union differs from its footprint`);
      // Independent stamp/Bresenham replay avoids proving a shared helper only
      // against itself. Native browser checks additionally verify RGBA clipping.
      assert.deepEqual(ranged,replayRaster({background:0,ops:[op]}),`${size}px: ranges differ from the independent hard brush`);
      compared++;
    }
    let visited = 0;
    assert.equal(engine.forFootprintRanges({kind:"dot",size,color:1,point:[400,300]},() => { visited++; return false; }),false);
    assert.equal(visited,1,"Interval visitor ignored its false result");
  }
  for (const op of [
    {kind:"line",size:4,color:1,points:[[10,10],[20,20]]},
    {kind:"line",size:4,color:1,points:[[10,10],[20,10],[20,20]]},
    {kind:"fill",size:4,color:1,point:[10,10]},
  ]) {
    let visited = 0;
    assert.equal(engine.forFootprintRanges(op,() => { visited++; }),null);
    assert.equal(visited,0,"Unsupported geometry reached the interval visitor");
  }
  console.log(`PASS footprint ranges: ${compared} independent brush/range unions across 20 sizes, clipped edges, reversal and visitor stopping`);
}

function makeMixedGridFixture(engine) {
  const ops = [];
  for (let row=0;row<3;row++) for (let column=0;column<3;column++) {
    const x0 = 160 + column*55, y0 = 160 + row*55;
    for (let y=1;y<21;y+=3) for (let x=1;x<21;x+=3)
      ops.push({kind:"dot",size:4,color:16,point:[x0+x,y0+y]});
    ops.push({kind:"line",size:4,color:4,points:[[x0+1,y0+1],[x0+19,y0+1]],start:"dot"});
    ops.push({kind:"line",size:4,color:4,points:[[x0+1,y0+1],[x0+1,y0+19]],start:"dot"});
    ops.push({kind:"dot",size:4,color:0,point:[x0+1,y0+1]});
  }
  const replay = engine.rasterize(ops,0,{annotateStarts:true});
  engine.referencePixels = replay.pixels;
  return {...engine.finish(replay.ops,0,267,200),regions:18};
}

function assertMixedBudgets(metrics) {
  assert.ok(!metrics.failure,"Mixed encoder hid an exception");
  assert.ok(metrics.cells <= 512);
  assert.ok(metrics.proposals <= 120001); // The first rejected attempt increments its counter.
  assert.ok(metrics.rangeVisits <= 1000001);
  assert.ok(metrics.pendingVisits <= 800*600*8+1);
  // A footprint is counted after its complete operation. Generated axial
  // operations cover at most one 800x39 strip before the budget rejection.
  assert.ok(metrics.footprintVisits <= 800*600*24+800*39);
  assert.ok(metrics.prefixBytes <= 15382400);
}

function mixedGridTest() {
  const sandbox = loadEngine(ROOT,true), engine = sandbox.SG_TEST_ENGINE;
  const reference = makeMixedGridFixture(engine), before = stable(reference);
  const first = sandbox.SG_BACKGROUND_BAND_ENCODER.encode(reference,engine);
  const second = sandbox.SG_BACKGROUND_BAND_ENCODER.encode(reference,engine);
  assert.equal(first.bandEncoding.mixedEncoding.selected,true,"Mixed fixture did not exercise the complete encoder");
  assert.ok(first.commands < reference.commands,"Mixed encoding did not reduce commands");
  assert.deepEqual(stable(first),stable(second),"Mixed encoding depends on measured time or state from a previous call");
  assert.deepEqual(replayRaster(first),replayRaster(reference),"Mixed grid changed a facet or a white corner");
  assert.deepEqual(stable(reference),before,"Mixed grid mutated the source plan");
  assertMixedBudgets(first.bandEncoding.mixedEncoding);

  // Force a tiny quota only in the isolated VM module. Production limits and
  // the runtime API remain untouched. Verify its transactional rejection,
  // rather than relying on a fixture that happens to exceed the current limits.
  const limited = loadEngine(ROOT,true), anchor = "cells: 512, proposals: 120000";
  const source = fs.readFileSync(path.join(ROOT,"background-band-encoder.js"),"utf8");
  assert.ok(source.includes(anchor),"Mixed budget test anchor changed");
  vm.runInContext(source.replace(anchor,"cells: 512, proposals: 1"),limited,{filename:"isolated-low-budget-band.js"});
  const limitedReference = makeMixedGridFixture(limited.SG_TEST_ENGINE), original = stable(limitedReference);
  const stopped = limited.SG_BACKGROUND_BAND_ENCODER.encode(limitedReference,limited.SG_TEST_ENGINE);
  const metrics = stopped.bandEncoding.mixedEncoding;
  assert.equal(metrics.selected,false); assert.equal(metrics.budgetStops,1);
  assert.ok(!metrics.failure,"Budget exhaustion was reported as an unexpected error");
  assert.deepEqual(stopped.ops,limitedReference.ops,"Budget exhaustion retained a truncated candidate");
  assert.deepEqual(replayRaster(stopped),replayRaster(limitedReference),"Budget exhaustion lost source pixels");
  assert.deepEqual(stable(limitedReference),original,"Budget exhaustion changed the source plan");
  console.log("PASS mixed grids: exact facets/corners, deterministic compression, bounded work and whole-plan fallback on budget exhaustion");
}

function inverseMaskTest() {
  const sandbox = loadEngine(ROOT,true), refine = sandbox.SG_EXACT_RASTER_ENCODER.refine;
  // Obtain the full source plan without this final refinement, in the isolated VM.
  sandbox.SG_EXACT_RASTER_ENCODER.refine = null;
  const reference = sandbox.SG_IMAGE_CONVERTER.convert(fixture("face",RGB),PALETTE,
    {speed:"instant",brush:4,style:"lines",smartDots:true});
  const before = stable(reference), result = refine(reference,sandbox.SG_TEST_ENGINE);
  assert.equal(result.encoding.inverse.selected,"complement","Inverse fixture did not exercise the selected candidate");
  assert.ok(!result.encoding.inverse.failure);
  assert.ok(result.seconds < reference.seconds,"Inverse mask did not improve its modeled drawing cost");
  assert.deepEqual(replayRaster(result),replayRaster(reference),"Inverse mask changed a detail or leaked outside the contour");
  assert.ok(result.encoding.inverse.dotTrials.some(trial => trial.substitutions > 0),"Short-stroke candidate was not exercised");
  assert.deepEqual(stable(reference),before,"Inverse mask mutated the original plan");

  const limited = loadEngine(ROOT,true), anchor = "if (++metrics.footprintWork > N * 32)";
  const source = fs.readFileSync(path.join(ROOT,"exact-raster-encoder.js"),"utf8");
  assert.ok(source.includes(anchor),"Inverse budget test anchor changed");
  vm.runInContext(source.replace(anchor,"if (++metrics.footprintWork > 1)"),limited,{filename:"isolated-low-budget-inverse.js"});
  const stopped = limited.SG_EXACT_RASTER_ENCODER.refine(reference,limited.SG_TEST_ENGINE);
  assert.equal(stopped.encoding.inverse.selected,"reference");
  assert.equal(stopped.encoding.inverse.workBudgetStops,1);
  assert.ok(!stopped.encoding.inverse.failure);
  assert.deepEqual(stopped.ops,reference.ops,"Inverse budget exhaustion retained a truncated drawing");
  assert.equal(stopped.background,reference.background);
  assert.deepEqual(stable(reference),before,"Inverse budget exhaustion changed the source plan");
  console.log("PASS inverse masks: complete detail/contour equality, exact short endpoint stamps and whole-plan fallback on budget exhaustion");
}

// Removing a closed black cell changes the component seen by a retained exact
// gray bucket. A final-pixel proof alone cannot catch its now-stale count.
function makeBandBaseFillFixture(engine) {
  const target = new Uint8Array(800 * 600), ops = [];
  for (let y = 201; y <= 299; y++) for (let x = 201; x <= 299; x++) target[y * 800 + x] = 1;
  for (let y = 201; y <= 299; y++) for (let x = 450; x <= (y < 252 ? 500 : 548); x++) target[y * 800 + x] = 3;
  for (let y = 202; y <= 298; y += 3) ops.push({kind:'line', color:1, size:4, points:[[202,y],[298,y]], start:'dot'});
  ops.push({kind:'fill', color:3, size:4, point:[0,0], box:[0,0,799,599], count:480000-99*99, rows:[], exact:true});
  for (let y = 1; y < 600; y += 3) for (let x = 0; x < 800;) {
    if (target[y*800+x]) { x++; continue; }
    const low = x; while (x < 800 && !target[y*800+x]) x++;
    ops.push({kind:'line', color:0, size:4, points:[[low+1,y],[x-2,y]], start:'dot'});
  }
  const replay = engine.rasterize(ops,0,{annotateStarts:true});
  return {target, reference:{...engine.finish(replay.ops,0,267,200),regions:2}};
}

function bandMetadataTest() {
  const sandbox = loadEngine(ROOT, true), fixture = makeBandBaseFillFixture(sandbox.SG_TEST_ENGINE);
  const optimized = sandbox.SG_BACKGROUND_BAND_ENCODER.encode(fixture.reference, sandbox.SG_TEST_ENGINE);
  assert.equal(optimized.bandEncoding.selected, true, 'Band metadata regression did not exercise the optimized path');
  assert.ok(!optimized.bandEncoding.failure);
  assert.ok(optimized.commands < fixture.reference.commands);
  assert.deepEqual(replayRaster(optimized), replayRaster(fixture.reference), 'Band metadata repair changed the drawing');
  const retained = optimized.ops.find(op => op.kind === 'fill');
  assert.equal(retained.count, 480000); assert.deepEqual(Array.from(retained.box), [0,0,799,599]);
  assert.equal(retained.exact, true); assert.equal(retained.rows.length, 0);
  assert.equal(fixture.reference.ops.find(op => op.kind === 'fill').count, 470199, 'Encoder mutated reference metadata');
  console.log('PASS band encoding: retained exact fill metadata matches its changed component without mutating the reference');
}

function stable(plan) {
  // Processing time is diagnostic; command geometry and strategy must be stable.
  const result = JSON.parse(JSON.stringify(plan));
  // Measured phase times never determine a lossless drawing plan. Optimizer
  // diagnostics contain nested times as well as the converter's phase report.
  const removeTimes = (object) => {
    if (!object || typeof object !== "object") return;
    for (const key of Object.keys(object)) {
      if (/Ms$/.test(key) || key === "phases") delete object[key];
      else removeTimes(object[key]);
    }
  };
  removeTimes(result);
  // This advisory uses actual measured preprocessing, unlike operation choices.
  delete result.budgetMet;
  return result;
}

// Independent replay of the mock game's hard brush and scanline bucket. Ultra
// may encode the same pixels with different operations; legacy plans remain
// byte-for-byte comparisons below. Native browser RGBA checks are definitive.
function replayRaster(plan) {
  const W = 800, H = 600, pixels = new Uint8Array(W * H);
  const stamp = (x, y, size, color) => {
    const r = Math.floor(size / 2), square = r * r;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy >= square) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) pixels[ny * W + nx] = color;
    }
  };
  // Preparation starts with Clear's white canvas and applies the game's bucket.
  // The game's scanline boundary behavior also matters at the last canvas row.
  const ops = plan.background ? [{ kind: "fill", color: plan.background, point: [0,0] }, ...plan.ops] : plan.ops;
  for (const op of ops) {
    if (op.kind === "fill") {
      const [sx, sy] = op.point, own = pixels[sy * W + sx];
      if (own === op.color) { assert.ok(!op.exact, 'Exact encoder emitted an already-painted fill'); continue; }
      const stack = [[sx, sy]], matches = p => p >= 0 && p < pixels.length && pixels[p] === own;
      let count = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
      while (stack.length) {
        const [x, initialY] = stack.pop();
        let y = initialY, p = y * W + x;
        while (y-- >= 0 && matches(p)) p -= W;
        p += W; ++y;
        let left = false, right = false;
        while (y++ < H - 1 && matches(p)) {
          pixels[p] = op.color;
          const actualY = (p / W) | 0;
          count++; x0 = Math.min(x0, x); y0 = Math.min(y0, actualY); x1 = Math.max(x1, x); y1 = Math.max(y1, actualY);
          if (x > 0) { if (matches(p - 1)) { if (!left) { stack.push([x - 1, y]); left = true; } } else left = false; }
          if (x < W - 1) { if (matches(p + 1)) { if (!right) { stack.push([x + 1, y]); right = true; } } else right = false; }
          p += W;
        }
      }
      if (op.exact) {
        assert.equal(op.count, count, 'Exact encoder fill count differs from its live component');
        assert.deepEqual(Array.from(op.box), [x0,y0,x1,y1], 'Exact encoder fill bounds differ from its live component');
      }
      continue;
    }
    const points = op.points || [op.point];
    stamp(...points[0], op.size, op.color);
    for (let i = 1; i < points.length; i++) {
      let [x, y] = points[i - 1]; const [endX, endY] = points[i];
      const dx = Math.abs(endX - x), dy = Math.abs(endY - y), sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = dx - dy;
      while (x !== endX || y !== endY) {
        const twice = error * 2;
        if (twice > -dy) { error -= dy; x += sx; }
        if (twice < dx) { error += dx; y += sy; }
        stamp(x, y, op.size, op.color);
      }
    }
  }
  return pixels;
}

function checkPlan(plan, name) {
  assert.equal(plan.style, "instant", `${name}: Ultra Fast strategy metadata is missing`);
  assert.equal(plan.quality, "ultra-fast-exact", `${name}: lossless Ultra Fast reference is missing`);
  assert.ok(!plan.optimization?.failure && !plan.metrics?.failure, `${name}: optimizer failed silently`);
  assert.ok(!plan.encoding?.failure, `${name}: exact encoder failed silently`);
  assert.ok(!plan.bandEncoding?.failure, `${name}: background band encoder failed silently`);
  assert.ok(!plan.bandEncoding?.mixedEncoding?.failure, `${name}: mixed raster encoder failed silently`);
  assert.ok(!plan.encoding?.inverse?.failure, `${name}: inverse raster encoder failed silently`);
  assert.ok(Array.isArray(plan.ops), `${name}: Ultra Fast must use planned operations`);
  assert.ok(plan.ops.length > 0, `${name}: image collapsed to its background`);
  assert.equal(plan.changed || 0, 0, `${name}: Ultra Fast intentionally changed sampled pixels`);
  assert.ok(plan.brushes.every((size) => size === 5 || Number.isInteger(size) && size >= 4 && size <= 40 && size % 2 === 0), `${name}: unavailable brush`);
  for (const op of plan.ops) {
    assert.ok(["line", "dot", "fill"].includes(op.kind));
    assert.ok(RGB[op.color]);
    for (const [x, y] of op.points || [op.point]) {
      assert.ok(Number.isInteger(x) && x >= 0 && x < 800);
      assert.ok(Number.isInteger(y) && y >= 0 && y < 600);
    }
    if (op.kind === "line") {
      assert.ok(op.points.length >= 2);
      for (let i = 1; i < op.points.length; i++) assert.notDeepEqual(op.points[i], op.points[i - 1], `${name}: redundant zero-length segment`);
    }
  }
}

function nodeTests() {
  footprintRangesTest();
  mixedGridTest();
  bandMetadataTest();
  inverseMaskTest();
  const current = converter(ROOT), images = [fixture("simple", RGB), fixture("face", RGB)];
  const previous = BASELINE ? converter(BASELINE) : null;
  if (BASELINE) {
    const before = converter(BASELINE);
    for (const speed of ["slow", "normal", "fast"]) {
      for (const style of ["lines", "dots", "sketch"]) {
        const options = { speed, style, brush: 4, smartDots: true };
        assert.deepEqual(stable(current.convert(images[0], PALETTE, options)), stable(before.convert(images[0], PALETTE, options)), `${speed}/${style}: legacy output changed`);
      }
    }
    for (const brush of [5, 6]) for (const speed of ["slow", "normal", "fast"]) {
      const options = { speed, style: "dots", brush, smartDots: false };
      assert.deepEqual(stable(current.convert(images[0], PALETTE, options)), stable(before.convert(images[0], PALETTE, options)), `${speed}/${brush}px: legacy dots changed`);
    }
    for (const speed of ["slow", "normal", "fast"]) {
      const options = { speed, style: "lines", brush: 4, smartDots: true };
      assert.deepEqual(stable(current.convert(images[1], PALETTE, options)), stable(before.convert(images[1], PALETTE, options)), `${speed}: complex legacy plan changed`);
    }
    console.log("PASS Slow, Normal and Fastest converter plans match the pre-migration baseline");
  }
  images.push(fixture("specks", RGB));
  if (argv.includes("--stress")) images.push(fixture("noise", RGB));
  for (const image of argv.includes("--controls-only") ? [] : images) {
    const options = { speed: "instant", style: "lines", brush: 4, smartDots: true };
    const start = performance.now(), first = current.convert(image, PALETTE, options);
    const planningMs = performance.now() - start;
    const second = current.convert(image, PALETTE, options);
    if (previous) {
      const migrated = previous.convert(image, PALETTE, { ...options, speed: "max" });
      assert.deepEqual(replayRaster(first), replayRaster(migrated), `${image.name}: Ultra Fast encoding changed the completed raster`);
      for (const key of ["sampleWidth", "sampleHeight"])
        assert.equal(first[key], migrated[key], `${image.name}: Ultra Fast changed sampling ${key}`);
    }
    checkPlan(first, image.name);
    assert.deepEqual(stable(first), stable(second), `${image.name}: Ultra Fast plan is not deterministic`);
    assert.equal(first.changed || 0, 0, "Ultra Fast must keep full detail without simplification");
    console.log(`PASS ${image.name}: deterministic Ultra Fast, ${first.commands} commands, ${first.moves} moves, estimated ${first.seconds}s, planning ${planningMs.toFixed(0)}ms`);
    if (image.name === "simple") assert.ok(planningMs + first.seconds * 1000 < 5000, "Simple image exceeds 5s");
  }
  assert.throws(() => current.convert({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }, PALETTE, { speed: "instant" }), /transparent/);
  console.log("PASS fully transparent images remain rejected");
}

function adjustmentTests() {
  const sandbox = { Uint8ClampedArray, Uint32Array, Float64Array, document: { createElement: () => new CanvasShim() } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "image-adjustments.js"), "utf8"), sandbox);
  const editor = sandbox.SG_IMAGE_ADJUSTMENTS;
  const bytes = new Uint8ClampedArray(1024);
  for (let i=0;i<256;i++) bytes.set([i,i*73%256,i*37%256,i],i*4);
  const identity = new Uint8ClampedArray(bytes);
  assert.equal(editor.transformRGBA(identity,editor.defaults()),identity);
  assert.deepEqual(identity,bytes,"Neutral settings changed RGBA bytes");
  const apply = (pixels,settings) => Array.from(editor.transformRGBA(new Uint8ClampedArray(pixels),settings));
  const colors=[255,0,0,19,0,255,0,128,0,0,255,0];
  assert.deepEqual(apply(colors,{monochrome:true}),[54,54,54,19,182,182,182,128,18,18,18,0]);
  assert.deepEqual(apply(colors,{monochrome:true,saturation:200}),[54,54,54,19,182,182,182,128,18,18,18,0],"Monochrome must ignore saturation");
  assert.deepEqual(apply(colors,{saturation:0}),[54,54,54,19,182,182,182,128,18,18,18,0]);
  assert.deepEqual(apply([64,64,64,77],{levels:{RGB:{gamma:2}}}),[128,128,128,77]);
  assert.deepEqual(apply([32,128,224,81],{levels:{RGB:{inputBlack:32,inputWhite:224}}}),[0,128,255,81]);
  assert.deepEqual(apply([128,128,128,91],{levels:{R:{outputWhite:128}}}),[64,128,128,91]);
  assert.deepEqual(apply([0,255,64,151],{contrast:-100}),[128,128,128,151]);
  const saturated=apply([200,100,40,181],{saturation:200,contrast:60});
  assert.equal(saturated[3],181);assert.ok(saturated[0]>saturated[2]);
  const robust=editor.normalize({contrast:Infinity,saturation:999,levels:{R:{inputBlack:255,inputWhite:-10,gamma:0,outputBlack:255,outputWhite:-10}}});
  assert.equal(robust.contrast,0);assert.equal(robust.saturation,200);
  assert.ok(robust.levels.R.inputWhite>robust.levels.R.inputBlack);
  assert.ok(robust.levels.R.outputWhite>robust.levels.R.outputBlack);
  assert.equal(robust.levels.R.gamma,0.1);
  assert.throws(()=>editor.transformRGBA(new Uint8Array(4),{}),/RGBA/);
  assert.throws(()=>editor.transformRGBA(new Uint8ClampedArray(3),{}),/RGBA/);
  const hist=editor.histogram({width:3,height:1,pixels:new Uint8ClampedArray(colors)});
  assert.equal(hist.count,2);assert.equal(hist.R[255],1);assert.equal(hist.G[255],1);assert.equal(hist.B[255],0);
  const bins=new Uint32Array(256);bins[40]=100;bins[180]=100;bins[0]=1;bins[255]=1;
  const auto=editor.autoLevels({RGB:bins},"RGB");assert.equal(auto.inputBlack,40);assert.equal(auto.inputWhite,180);
  const flat=new Uint32Array(256);flat[90]=100;
  assert.deepEqual(JSON.parse(JSON.stringify(editor.autoLevels({RGB:flat}))),JSON.parse(JSON.stringify(editor.defaults().levels.RGB)));
  const source={width:2,height:1,pixels:new Uint8ClampedArray([30,80,190,81,230,20,100,255])},original=new Uint8ClampedArray(source.pixels);
  const settings={contrast:25,levels:{RGB:{gamma:1.4}}};
  const first=editor.render(source,settings),second=editor.render(source,settings);
  assert.deepEqual(first.pixels,second.pixels,"Repeated rendering accumulated previous adjustments");
  assert.deepEqual(source.pixels,original,"Rendering altered the immutable source image");
  assert.deepEqual(editor.render(source,editor.defaults()).pixels,original,"Reset did not restore the source pixels");
  assert.throws(()=>editor.render({width:5000,height:5000,pixels:new Uint8ClampedArray(4)},{}),/20 million/);
  console.log("PASS image adjustments: neutral RGBA identity, grayscale/alpha, levels/gamma/channels, contrast/saturation, safe clamps, histogram/Auto, original-source rendering");
}

// Minimal Chrome DevTools Protocol client uses WebSocket included in Node 22.
async function connect(endpoint) {
  const socket = new WebSocket(endpoint), pending = new Map();
  let next = 0;
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data);
    if (!result.id) return;
    const waiter = pending.get(result.id);
    if (!waiter) return;
    pending.delete(result.id);
    clearTimeout(waiter.timer);
    result.error ? waiter.reject(new Error(result.error.message)) : waiter.resolve(result.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 60000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function launchBrowser() {
  const executable = process.env.BROWSER || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((file) => fs.existsSync(file));
  assert.ok(executable, "Set BROWSER to an installed Chromium browser for --browser tests");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skribbl-max-test-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Browser did not expose CDP: ${log.slice(-500)}`)), 20000);
    child.once("error", reject);
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const client = await connect(endpoint);
  return { client, child, profile, base: endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "") };
}

async function browserTests() {
  const gameDirectory = path.join(__dirname, "instant-benchmark");
  const server = http.createServer((req, res) => {
    const file = req.url === "/mock-game.js" ? "mock-game.js" : req.url === "/" ? "mock-game.html" : null;
    if (!file) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith("js") ? "text/javascript" : "text/html");
    res.end(fs.readFileSync(path.join(gameDirectory, file)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}/`;
    async function page(directory, task) {
      const { targetId } = await browser.client.send("Target.createTarget", { url });
      const targets = await (await fetch(`${browser.base}/json/list`)).json();
      const client = await connect(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
      try {
        for (let i = 0; i < 200; i++) {
          if (await evaluate(client, "typeof window.__sim !== 'undefined'")) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
          assert.notEqual(i, 199, "Mock game did not load");
        }
        await evaluate(client, "window.__pageErrors = []; window.addEventListener('error', e => __pageErrors.push(e.message)); window.addEventListener('unhandledrejection', e => __pageErrors.push(String(e.reason))); const originalError=console.error; console.error=(...args)=>{__pageErrors.push(args.map(String).join(' '));originalError.apply(console,args);};");
        for (const file of SOURCES) if (fs.existsSync(path.join(directory, file))) await evaluate(client, fs.readFileSync(path.join(directory, file), "utf8"));
        return await task(client);
      } finally { client.close(); await browser.client.send("Target.closeTarget", { targetId }); }
    }

    const browserFixtures = argv.includes("--controls-only") ? [] : ["simple", "face"];
    for (const name of browserFixtures) {
      const result = await page(ROOT, (client) => evaluate(client, `(${async function(name, rgb, makeFixture) {
        const image = makeFixture(name, rgb), source = document.createElement("canvas");
        source.width = image.width; source.height = image.height;
        source.getContext("2d").putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
        const palette = rgb.map((rgb, index) => ({ index, rgb }));
        // Fast independent visual reference: the existing Ultra Fast operations
        // replay through the real mock brush and bucket. Runtime throughput is
        // measured separately by benchmark-ultra.cjs against the paced runner.
        const ultra = SG_IMAGE_CONVERTER.convert(source, palette, { speed: "instant", brush: 4, style: "lines", smartDots: true });
        document.querySelector('[data-tooltip="Clear"]').click();
        __sim.exec([1,ultra.background,400,300]);
        for(const op of ultra.ops){
          if(op.kind==='fill')__sim.exec([1,op.color,...op.point]);
          else if(op.kind==='dot')__sim.exec([0,op.color,op.size,...op.point,...op.point]);
          else for(let i=1;i<op.points.length;i++)__sim.exec([0,op.color,op.size,...op.points[i-1],...op.points[i]]);
        }
        const reference = document.querySelector('#game-canvas canvas').getContext('2d').getImageData(0,0,800,600).data;
        const start = performance.now();
        const plan = SG_IMAGE_CONVERTER.convert(source, palette, { speed: "instant", brush: 4, style: "lines", smartDots: true });
        const planningMs = performance.now() - start;
        const done = new Promise((resolve) => document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status", (event) => {
          const status = JSON.parse(event.detail);
          if (status.id === "ultra-test" && ["done", "error"].includes(status.state)) resolve(status);
        }));
        document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request", { detail: JSON.stringify({ action: "draw", id: "ultra-test", word: "testword", speed: "instant", style: "lines", background: plan.background, strokes: plan.strokes, ops: plan.ops, smartDots: true }) }));
        const status = await done, completedMs = performance.now() - start;
        while (__sim.sent < __sim.commands.length) await new Promise((resolve) => setTimeout(resolve, 10));
        const deliveredMs = Math.max(completedMs, (__sim.sends.at(-1)?.at || start) - start);
        const data = document.querySelector("#game-canvas canvas").getContext("2d").getImageData(0, 0, 800, 600).data;
        const probes = (name === "noise" ? [] : name !== "face" ? [[400,300,16],[100,100,0]] : [[330,255,1],[470,255,1],[400,393,1],[400,310,6],[400,104,1],[209,310,1],[100,100,0]]).map(([x,y,c]) => ({ x, y, expected: c, rgb: Array.from(data.subarray((y*800+x)*4, (y*800+x)*4+3)), source: Array.from(image.pixels.subarray((y*800+x)*4, (y*800+x)*4+3)) }));
        let same = 0, intersection = 0, union = 0, primaryIntersection = 0, primaryUnion = 0, pixelDifferences = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = image.pixels, foreground = a[i] !== 255 || a[i+1] !== 255 || a[i+2] !== 255;
          const painted = data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255;
          if (foreground && painted) intersection++;
          if (foreground || painted) union++;
          const main=rgb[16], wasPrimary=main.every((v,k)=>a[i+k]===v), isPrimary=main.every((v,k)=>data[i+k]===v);
          if(wasPrimary&&isPrimary)primaryIntersection++;
          if(wasPrimary||isPrimary)primaryUnion++;
          if (a[i] === data[i] && a[i+1] === data[i+1] && a[i+2] === data[i+2]) same++;
          if(reference[i]!==data[i]||reference[i+1]!==data[i+1]||reference[i+2]!==data[i+2]||reference[i+3]!==data[i+3])pixelDifferences++;
        }
        return { status, planningMs, completedMs, deliveredMs, commands: __sim.commands.length, moves: __sim.moves, dropped: __sim.dropped, sent: __sim.sent, plan, probes, pixelDifferences, match: same / (800*600), silhouetteIoU: intersection / union, primaryIoU: primaryIntersection/primaryUnion, errors: __pageErrors, png: document.querySelector("#game-canvas canvas").toDataURL("image/png"), source: source.toDataURL("image/png") };
      }.toString()})(${JSON.stringify(name)}, ${JSON.stringify(RGB)}, ${fixture.toString()})`));
      if (ARTIFACTS) {
        fs.mkdirSync(ARTIFACTS, { recursive: true });
        fs.writeFileSync(path.join(ARTIFACTS, `${name}-ultra.png`), Buffer.from(result.png.split(",")[1], "base64"));
        fs.writeFileSync(path.join(ARTIFACTS, `${name}-source.png`), Buffer.from(result.source.split(",")[1], "base64"));
      }
      assert.equal(result.status.state, "done", `${name}: ${result.status.message}`);
      assert.ok(!result.plan.optimization?.failure && !result.plan.metrics?.failure, `${name}: optimizer failed silently`);
      assert.ok(!result.plan.encoding?.failure, `${name}: exact encoder failed silently`);
      assert.ok(!result.plan.bandEncoding?.failure, `${name}: background band encoder failed silently`);
      assert.ok(!result.plan.bandEncoding?.mixedEncoding?.failure, `${name}: mixed raster encoder failed silently`);
      assert.ok(!result.plan.encoding?.inverse?.failure, `${name}: inverse raster encoder failed silently`);
      if (name === "simple") assert.ok(result.deliveredMs < 5000, `${name}: planning + delivery took ${result.deliveredMs.toFixed(0)}ms`);
      assert.equal(result.pixelDifferences, 0, `${name}: Ultra Fast differs from its exact planned raster by ${result.pixelDifferences} pixels`);
      assert.equal(result.dropped, 0, `${name}: input gate dropped moves`);
      assert.equal(result.sent, result.commands, `${name}: game still has unsent commands`);
      assert.deepEqual(result.errors, [], `${name}: browser errors`);
      console.log(`Browser ${name}: plan ${result.planningMs.toFixed(0)}ms, total ${result.deliveredMs.toFixed(0)}ms, ${result.commands} commands, silhouette IoU ${result.silhouetteIoU.toFixed(3)}, match ${(result.match*100).toFixed(1)}%, changed ${result.plan.changed ?? 0}`);
      for (const probe of result.probes) if (JSON.stringify(probe.rgb) !== JSON.stringify(RGB[probe.expected])) console.log("Missing feature", probe);
      if (["simple","face"].includes(name)) assert.ok(result.silhouetteIoU > 0.94, `${name}: silhouette IoU ${result.silhouetteIoU}`);
      if (name === "specks") assert.ok(result.primaryIoU > 0.94, `${name}: primary shape IoU ${result.primaryIoU}`);
      for (const probe of result.probes) {
        assert.deepEqual(probe.source, RGB[probe.expected], `${name}: fixture probe is incorrectly specified`);
        assert.deepEqual(probe.rgb, RGB[probe.expected], `${name}: defining feature missing at (${probe.x},${probe.y})`);
      }
      console.log(`PASS browser ${name}: exact Ultra Fast raster, complete delivery in ${result.deliveredMs.toFixed(0)}ms`);
    }

    const legacyRequest = { action: "draw", id: "legacy-test", word: "testword", speed: "normal", style: "lines", background: 0, strokes: [{ color: 16, brush: 4, points: [[100,100],[140,100],[140,140]] }, { color: 1, brush: 4, points: [[200,200],[200,200]] }], smartDots: true };
    const execute = (client, request) => evaluate(client, `(${async function(request) {
      const done = new Promise((resolve) => document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status", (e) => { const d=JSON.parse(e.detail); if(d.id===request.id && ["done","error"].includes(d.state)) resolve(d); }));
      document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request", { detail: JSON.stringify(request) }));
      const status = await done;
      return { state: status.state, commands: __sim.commands, dropped: __sim.dropped, clears: __sim.clears, errors: __pageErrors };
    }.toString()})(${JSON.stringify(request)})`);
    if (BASELINE) for (const speed of ["slow", "normal", "fast", "instant"]) {
      const request = { ...legacyRequest, speed };
      const before = await page(BASELINE, (client) => execute(client, request));
      const after = await page(ROOT, (client) => execute(client, request));
      assert.deepEqual(after, before, `${speed}: runner commands changed`);
      assert.equal(after.state, "done");
      console.log(`PASS browser legacy ${speed}: exact baseline command sequence`);
    }
    if (BASELINE) {
      const instantRequest = { ...legacyRequest, speed: "instant", strokes: [], ops: [
        { kind: "line", color: 16, size: 4, start: "dot", points: [[100,100],[140,100],[140,140]] },
        { kind: "dot", color: 1, size: 4, point: [200,200] },
      ] };
      const before = await page(BASELINE, (client) => execute(client, { ...instantRequest, speed: "max" }));
      const after = await page(ROOT, (client) => execute(client, instantRequest));
      assert.deepEqual(after, before, "Ultra Fast: previous optimized command sequence changed");
      assert.equal(after.state, "done");
      console.log("PASS browser legacy instant: exact baseline operations");
    }

    for (const size of [10,20,32,40]) {
      const request={...legacyRequest,speed:"instant",strokes:[],ops:[{kind:"dot",color:16,size,point:[400,300]}]};
      const drawn=await page(ROOT,client=>execute(client,request));
      assert.equal(drawn.state,"done");assert.equal(drawn.dropped,0);assert.equal(drawn.commands.at(-1)[2],size);assert.deepEqual(drawn.errors,[]);
    }
    const missingPreview=await page(ROOT,async client=>{
      await evaluate(client,"document.querySelector('.size-preview .icon').remove();");
      return execute(client,{...legacyRequest,speed:"instant",strokes:[],ops:[{kind:"dot",color:16,size:40,point:[400,300]}]});
    });
    assert.equal(missingPreview.state,"error");assert.equal(missingPreview.clears,0,"Invalid brush preview cleared the player's drawing");assert.equal(missingPreview.commands.length,0);
    console.log("PASS browser wide brushes: supported presets accepted, missing preview rejected before Clear");
    for (const scale of [1, 0.5]) {
      const corners = await page(ROOT, client => evaluate(client, `(${async function(scale) {
        const canvas = document.querySelector('#game-canvas canvas'), context = canvas.getContext('2d');
        canvas.style.width = 800 * scale + 'px'; canvas.style.height = 600 * scale + 'px';
        const ops = [];
        for (const size of [4,5,6,10,20,32,40]) for (const point of [[0,0],[799,0],[0,599],[799,599]])
          ops.push({ kind: 'dot', size, color: 1 + size % 25, point });
        for (const op of ops) __sim.exec([0,op.color,op.size,...op.point,...op.point]);
        const expected = context.getImageData(0,0,800,600).data;
        const done = new Promise(resolve => document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status', event => {
          const status = JSON.parse(event.detail); if (status.id === 'corners' && ['done','error'].includes(status.state)) resolve(status);
        }));
        document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',{ detail: JSON.stringify({ action:'draw',id:'corners',word:'testword',speed:'instant',style:'lines',background:0,strokes:[],ops }) }));
        const status = await done, actual = context.getImageData(0,0,800,600).data;
        let differences = 0; for (let i=0;i<actual.length;i++) if (actual[i] !== expected[i]) differences++;
        return { status, differences, dropped:__sim.dropped, commands:__sim.commands.length, errors:__pageErrors };
      }.toString()})(${scale})`));
      assert.equal(corners.status.state, 'done', corners.status.message);
      assert.equal(corners.differences, 0, `CSS scale ${scale}: brush edge clipping or coordinate mapping changed raster`);
      assert.equal(corners.dropped, 0); assert.equal(corners.commands, 28); assert.deepEqual(corners.errors, []);
    }
    console.log('PASS browser clipping: all seven brush sizes preserve corner pixels at 800x600 and 400x300 CSS sizes');

    async function mountUI(client,initialSpeed="instant") {
      const css = ["styles.css", "auto-draw.css"].map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
      await evaluate(client, `document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));`);
      await evaluate(client, `window.__settings={style:'dots',brush:'6',speed:${JSON.stringify(initialSpeed)},smartDots:true};window.__writes=[];window.__requests=[];window.chrome={runtime:{sendMessage:(_message,done)=>done?.({ok:true})},storage:{local:{get:(_keys,done)=>done({sgDrawSettings:__settings}),set:(data,done)=>{__writes.push(data);__settings=data.sgDrawSettings;done?.();}}}};const panel=document.createElement('div');panel.id='skribbl-smart-drawer-guesser-panel';panel.innerHTML='<div class="ssdg-body"><span>Guesser</span></div>';document.body.append(panel);document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',event=>{const request=JSON.parse(event.detail);if(request.action==='draw')__requests.push(request)});window.__waitFor=async(check)=>{const start=performance.now();while(!check()){if(performance.now()-start>10000)throw new Error('UI condition timed out');await new Promise(resolve=>setTimeout(resolve,10))}};window.__upload=async(name='fixture.png')=>{const image=document.createElement('canvas');image.width=300;image.height=180;const context=image.getContext('2d');for(let i=0;i<3;i++){context.fillStyle=['#ef130b','#00cc00','#231fd3'][i];context.fillRect(i*100,0,100,180)}const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],name,{type:'image/png'}));const input=document.querySelector('.ssdg-d-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};`);
      for (const file of ["image-input.js","image-adjustments.js","image-editor.js","auto-draw.js"]) await evaluate(client,fs.readFileSync(path.join(ROOT,file),"utf8"));
      await evaluate(client,"__waitFor(()=>document.querySelector('.ssdg-d-word')?.textContent.includes('testword'))");
    }
    for (const initialSpeed of ["max","slow","normal","fast","instant"]) {
      const ui=await page(ROOT,async client=>{
        await mountUI(client,initialSpeed);
        return evaluate(client,`(${function(){
          const select=document.querySelector('.ssdg-d-speed');
          const restored={speed:select.value,style:document.querySelector('.ssdg-d-style').value,brush:document.querySelector('.ssdg-d-brush').value,writes:__writes.length};
          const options=Array.from(select.options,option=>({value:option.value,text:option.textContent}));
          select.value='instant';select.dispatchEvent(new Event('change',{bubbles:true}));const saved=structuredClone(__settings);
          select.value='normal';select.dispatchEvent(new Event('change',{bubbles:true}));
          return{restored,options,saved,last:__settings,errors:__pageErrors};
        }.toString()})()`);
      });
      assert.deepEqual(ui.options.map(option=>option.value),["slow","normal","fast","instant"]);
      assert.equal(ui.options.at(-1).text,"Ultra Fast");
      assert.deepEqual(ui.restored,{speed:initialSpeed==="max"?"instant":initialSpeed,style:"dots",brush:"6",writes:1});
      assert.deepEqual(ui.saved,{schemaVersion:1,speed:"instant",style:"dots",brush:"6",smartDots:true,autoPaintOnDrop:true});
      assert.deepEqual(ui.last,{schemaVersion:1,speed:"normal",style:"dots",brush:"6",smartDots:true,autoPaintOnDrop:true});
      assert.deepEqual(ui.errors,[]);
    }
    console.log("PASS browser settings: four speeds, saved Max migrates to Ultra Fast");

    const editorFlow=await page(ROOT,async client=>{
      await mountUI(client);
      if (ARTIFACTS) {
        await client.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1500, deviceScaleFactor: 1, mobile: false });
        await evaluate(client, "__upload().then(()=>__waitFor(()=>!document.querySelector('.ssdg-d-image-editor').hidden&&document.querySelector('.ssdg-d-image-preview').width>1))");
        const capture = await client.send("Page.captureScreenshot", { format: "png" });
        fs.mkdirSync(ARTIFACTS, { recursive: true });
        fs.writeFileSync(path.join(ARTIFACTS, "image-editor.png"), Buffer.from(capture.data, "base64"));
      }
      return evaluate(client,`(${async function(){
        const query=selector=>document.querySelector(selector),pixel=()=>Array.from(query('.ssdg-d-image-preview').getContext('2d').getImageData(20,20,1,1).data);
        await __upload();await __waitFor(()=>!query('.ssdg-d-image-editor').hidden&&query('.ssdg-d-image-preview').width>1);
        const initial=pixel(),before=__sim.commands.length;
        const change=(selector,value)=>{const input=query(selector);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
        change('.ssdg-d-level-gamma','');const editableEmpty=query('.ssdg-d-level-gamma').value;
        change('.ssdg-d-level-gamma',0.5);const editableFraction=query('.ssdg-d-level-gamma').value;
        change('.ssdg-d-contrast',45);change('.ssdg-d-saturation',60);change('.ssdg-d-level-gamma',1.5);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const edited=pixel(),noDraw=__requests.length;
        query('.ssdg-d-image-reset').click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const restored=pixel();
        change('.ssdg-d-monochrome',true);change('.ssdg-d-contrast',15);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const monochrome=pixel(),saturationDisabled=query('.ssdg-d-saturation').disabled;
        const finished=new Promise(resolve=>document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>{const status=JSON.parse(event.detail);if(['done','error'].includes(status.state))resolve(status)}));
        query('.ssdg-d-image-draw').click();const status=await finished;
        const request=__requests.at(-1),colors=Array.from(new Set([request.background,...request.ops.map(op=>op.color)]));
        const drawCount=__requests.length;
        query('.ssdg-d-image-reset').click();const saturationAfterReset=!query('.ssdg-d-saturation').disabled;
        await __upload('new.png');await __waitFor(()=>!query('.ssdg-d-image-editor').hidden&&query('.ssdg-d-image-preview').width>1);
        const fresh={monochrome:query('.ssdg-d-monochrome').checked,contrast:query('.ssdg-d-contrast').value,gamma:query('.ssdg-d-level-gamma').value,pixel:pixel()};
        query('.ssdg-d-image-cancel').click();
        const cancelled=query('.ssdg-d-image-editor').hidden&&__requests.length===drawCount;
        query('.ssdg-d-text-input').value='Hi';
        const textDone=new Promise(resolve=>document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>{const result=JSON.parse(event.detail);if(['done','error'].includes(result.state))resolve(result)}));
        query('.ssdg-d-text-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));const textStatus=await textDone;
        return{initial,edited,restored,monochrome,saturationDisabled,saturationAfterReset,editableEmpty,editableFraction,before,noDraw,status,colors,speed:request.speed,fresh,cancelled,textStatus,textEditorHidden:query('.ssdg-d-image-editor').hidden,textDraws:__requests.length-drawCount,errors:__pageErrors};
      }.toString()})()`);
    });
    assert.equal(editorFlow.before,0,"Upload drew on game canvas before confirmation");
    assert.equal(editorFlow.noDraw,0,"Changing adjustments started drawing");
    assert.notDeepEqual(editorFlow.edited,editorFlow.initial,"Preview ignored adjustments");
    assert.equal(editorFlow.editableEmpty, "", "Typing an empty numeric field replaced its text early");
    assert.equal(editorFlow.editableFraction, "0.5", "Fractional gamma could not be entered");
    assert.deepEqual(editorFlow.restored,editorFlow.initial,"Reset failed to restore original pixels");
    assert.equal(editorFlow.monochrome[0],editorFlow.monochrome[1]);assert.equal(editorFlow.monochrome[1],editorFlow.monochrome[2]);
    assert.equal(editorFlow.saturationDisabled, true);
    assert.equal(editorFlow.saturationAfterReset, true);
    assert.equal(editorFlow.status.state,"done",editorFlow.status.message);
    assert.equal(editorFlow.speed,"instant");assert.ok(editorFlow.colors.every(color=>color>=0&&color<=3),"Monochrome drawing used a colored palette entry");
    assert.deepEqual(editorFlow.fresh,{monochrome:false,contrast:"0",gamma:"1",pixel:editorFlow.initial});
    assert.equal(editorFlow.cancelled,true);assert.equal(editorFlow.textStatus.state,"done",editorFlow.textStatus.message);
    assert.equal(editorFlow.textEditorHidden,true);assert.equal(editorFlow.textDraws,1);assert.deepEqual(editorFlow.errors,[]);
    console.log("PASS browser editor: preview before draw, actual adjusted grayscale plan, Reset, new upload, Cancel, typed-text automatic draw");

    const automaticDrop=await page(ROOT,async client=>{
      await mountUI(client);
      return evaluate(client,`(${async function(){
        const image=document.createElement('canvas');image.width=300;image.height=180;
        const context=image.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,300,180);
        context.fillStyle='#231fd3';context.fillRect(75,45,150,90);
        const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'automatic.png',{type:'image/png'}));
        const finished=new Promise(resolve=>document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>{
          const status=JSON.parse(event.detail);if(['done','error'].includes(status.state))resolve(status);
        }));
        const canvas=document.querySelector('#game-canvas canvas');
        canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        const status=await finished;
        return{status,requests:__requests.length,editorHidden:document.querySelector('.ssdg-d-image-editor').hidden,
          commands:__sim.commands.length,dropped:__sim.dropped,
          center:Array.from(canvas.getContext('2d').getImageData(400,300,1,1).data).slice(0,3),errors:__pageErrors};
      }.toString()})()`);
    });
    assert.equal(automaticDrop.status.state,"done",automaticDrop.status.message);
    assert.equal(automaticDrop.requests,1);assert.equal(automaticDrop.editorHidden,true);
    assert.ok(automaticDrop.commands>0);assert.equal(automaticDrop.dropped,0);
    assert.deepEqual(automaticDrop.center,RGB[16]);assert.deepEqual(automaticDrop.errors,[]);
    console.log("PASS browser automatic image drop: real converter/runner paints canvas without confirmation, zero dropped moves");

    const queuedDrop=await page(ROOT,async client=>{
      await mountUI(client);
      return evaluate(client,`(${async function(){
        const query=selector=>document.querySelector(selector);
        query('#game-word .word').textContent='';
        await __waitFor(()=>!query('.ssdg-d-word').textContent.startsWith('Your word:'));
        const image=document.createElement('canvas');image.width=300;image.height=180;
        const context=image.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,300,180);
        context.fillStyle='#231fd3';context.fillRect(75,45,150,90);
        const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'queued.png',{type:'image/png'}));
        query('#game-canvas canvas').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        await __waitFor(()=>query('.ssdg-d-queue-item')&&!query('.ssdg-d-image-editor').hidden&&query('.ssdg-d-image-preview').width>1);
        query('.ssdg-d-monochrome').checked=true;query('.ssdg-d-monochrome').dispatchEvent(new Event('input',{bubbles:true}));
        query('.ssdg-d-image-draw').click();
        const before={requests:__requests.length,queued:document.querySelectorAll('.ssdg-d-queue-item').length};
        const finished=new Promise(resolve=>document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>{
          const status=JSON.parse(event.detail);if(['done','error'].includes(status.state))resolve(status);
        }));
        query('#game-word .word').textContent='testword';
        const status=await finished,request=__requests.at(-1);
        const colors=Array.from(new Set([request.background,...request.ops.map(op=>op.color)]));
        return{before,status,requests:__requests.length,queued:document.querySelectorAll('.ssdg-d-queue-item').length,
          colors,dropped:__sim.dropped,center:Array.from(query('#game-canvas canvas').getContext('2d').getImageData(400,300,1,1).data).slice(0,3),errors:__pageErrors};
      }.toString()})()`);
    });
    assert.deepEqual(queuedDrop.before,{requests:0,queued:1});
    assert.equal(queuedDrop.status.state,"done",queuedDrop.status.message);
    assert.equal(queuedDrop.requests,1);assert.equal(queuedDrop.queued,0);assert.equal(queuedDrop.dropped,0);
    assert.ok(queuedDrop.colors.every(color=>color>=0&&color<=3));
    assert.equal(queuedDrop.center[0],queuedDrop.center[1]);assert.equal(queuedDrop.center[1],queuedDrop.center[2]);
    assert.ok(queuedDrop.center[0]<255);assert.deepEqual(queuedDrop.errors,[]);
    console.log("PASS browser queued drop: saved grayscale edits paint through real converter/runner on the next turn");

    // An unsafe planned fill must use its bounded sample rows instead of flooding
    // the white canvas. A subsequent normal operation must still be drawable.
    const fallback = await page(ROOT, (client) => execute(client, {
      ...legacyRequest, speed: "instant", strokes: [], ops: [
        { kind: "fill", color: 16, size: 4, point: [110,110], box: [100,100,120,120], count: 441, rows: [[110,100,120]] },
        { kind: "dot", color: 1, size: 4, point: [200,200] },
      ],
    }));
    assert.equal(fallback.state, "done");
    assert.ok(fallback.commands.every((command) => command[0] === 0), "Unsafe fill flooded canvas");
    assert.deepEqual(fallback.errors, []);
    console.log("PASS browser unsafe fill uses bounded strokes");

    const exactUnsafe=await page(ROOT,client=>execute(client,{
      ...legacyRequest,id:"exact-unsafe",speed:"instant",strokes:[],ops:[
        {kind:"fill",color:16,size:4,point:[110,110],box:[100,100,120,120],count:441,rows:[],exact:true},
      ],
    }));
    assert.equal(exactUnsafe.state,"error","Unsafe exact fill reported success");
    assert.equal(exactUnsafe.commands.length,0,"Unsafe exact fill painted or silently fell back");
    assert.deepEqual(exactUnsafe.errors,[]);
    const invalidExact=await page(ROOT,client=>execute(client,{
      ...legacyRequest,id:"exact-invalid",speed:"instant",strokes:[],ops:[
        {kind:"fill",color:16,size:4,point:[110,110],box:[100,100,120,120],count:441,rows:[[110,100,120]],exact:true},
      ],
    }));
    assert.equal(invalidExact.state,"error");assert.equal(invalidExact.clears,0,"Invalid exact fill cleared the player's drawing");
    for (const [name, overrides, initialColor] of [
      ["count", { count: 70 }, 1],
      ["bounds", { box: [105,105,115,115] }, 1],
      ["already-painted", {}, 16],
    ]) {
      const mismatch = await page(ROOT, client => execute(client, {
        ...legacyRequest, id: "exact-" + name, speed: "instant", strokes: [], ops: [
          { kind: "dot", color: initialColor, size: 10, point: [110,110] },
          { kind: "fill", color: 16, size: 4, point: [110,110], box: [106,106,114,114], count: 69, rows: [], exact: true, ...overrides },
        ],
      }));
      assert.equal(mismatch.state, "error", `${name}: exact fill silently accepted a different live component`);
      assert.equal(mismatch.commands.length, 1, `${name}: exact fill added paint after the initial dot`);
      assert.ok(mismatch.commands.every(command => command[0] === 0), `${name}: unsafe bucket command emitted`);
      assert.deepEqual(mismatch.errors, []);
    }
    const alreadyPainted = await page(ROOT, client => execute(client, {
      ...legacyRequest, id: "standard-already-painted", speed: "instant", strokes: [], ops: [
        { kind: "dot", color: 16, size: 10, point: [110,110] },
        { kind: "fill", color: 16, size: 4, point: [110,110], box: [106,106,114,114], count: 69, rows: [] },
      ],
    }));
    assert.equal(alreadyPainted.state, "done"); assert.equal(alreadyPainted.commands.length, 1);
    console.log("PASS browser exact fills: count/bounds/paint mismatches stop with error, malformed data rejected before Clear, standard done-fill still skips");
    const bandRepaired = await page(ROOT, async client => {
      await evaluate(client, plannerTestSource(ROOT));
      return evaluate(client, `(${async function(makeFixture) {
        const fixture = makeFixture(SG_TEST_ENGINE), plan = SG_BACKGROUND_BAND_ENCODER.encode(fixture.reference, SG_TEST_ENGINE);
        for (const op of fixture.reference.ops) {
          if (op.kind === 'fill') __sim.exec([1,op.color,...op.point]);
          else if (op.kind === 'dot') __sim.exec([0,op.color,op.size,...op.point,...op.point]);
          else for (let i=1;i<op.points.length;i++) __sim.exec([0,op.color,op.size,...op.points[i-1],...op.points[i]]);
        }
        const context = document.querySelector('#game-canvas canvas').getContext('2d'), expected = context.getImageData(0,0,800,600).data;
        const done = new Promise(resolve => document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status', event => {
          const status = JSON.parse(event.detail); if (status.id === 'band-metadata' && ['done','error'].includes(status.state)) resolve(status);
        }));
        document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',{ detail:JSON.stringify({action:'draw',id:'band-metadata',word:'testword',speed:'instant',style:'lines',background:plan.background,strokes:[],ops:plan.ops}) }));
        const status = await done, actual = context.getImageData(0,0,800,600).data;
        let differences = 0; for (let i=0;i<actual.length;i++) if (actual[i] !== expected[i]) differences++;
        return {status,differences,selected:plan.bandEncoding.selected,fill:plan.ops.find(op=>op.kind==='fill'),dropped:__sim.dropped,errors:__pageErrors};
      }.toString()})(${makeBandBaseFillFixture.toString()})`);
    });
    assert.equal(bandRepaired.selected, true); assert.equal(bandRepaired.fill.count, 480000);
    assert.equal(bandRepaired.status.state, 'done', bandRepaired.status.message);
    assert.equal(bandRepaired.differences, 0, 'Band repaired metadata differs from native original operations');
    assert.equal(bandRepaired.dropped, 0); assert.deepEqual(bandRepaired.errors, []);
    console.log('PASS browser band metadata: retained strict fill completes and every RGBA byte matches the original native drawing');

    // A user move immediately before max must not make the game's existing 90 Hz
    // clock discard the first planned segment when preparation no longer sleeps.
    const recentMove = await page(ROOT, (client) => evaluate(client, `(${async function() {
      const canvas=document.querySelector('#game-canvas canvas'),rect=canvas.getBoundingClientRect();
      const pointer=(type,x)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:33,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:rect.left+x,clientY:rect.top+100}));
      const done=new Promise(resolve=>document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>{const status=JSON.parse(event.detail);if(status.id==='recent-move'&&['done','error'].includes(status.state))resolve(status);}));
      pointer('pointerdown',100);pointer('pointermove',120);pointer('pointerup',120);
      document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',{detail:JSON.stringify({action:'draw',id:'recent-move',word:'testword',speed:'instant',style:'lines',background:0,strokes:[],ops:[{kind:'line',size:4,color:1,start:'dot',points:[[300,300],[500,300]]}]})}));
      const status=await done;
      return{status,dropped:__sim.dropped,end:Array.from(canvas.getContext('2d').getImageData(500,300,1,1).data).slice(0,3),errors:__pageErrors};
    }.toString()})()`));
    assert.equal(recentMove.status.state, "done");
    assert.equal(recentMove.dropped, 0, "Recent manual move made the game discard the first Ultra Fast segment");
    assert.deepEqual(recentMove.end, RGB[1]);
    assert.deepEqual(recentMove.errors, []);
    console.log("PASS browser recent user move preserves first Ultra Fast segment");

    const cancelled = await page(ROOT, (client) => evaluate(client, `(${async function() {
      const states=[]; let stopScheduled=false;
      const done=new Promise(resolve=>document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",event=>{
        const status=JSON.parse(event.detail); if(status.id!=="cancel-test")return;
        states.push(status.state);
        if(status.state==="drawing"&&/Drawing /.test(status.message)&&!stopScheduled) {
          stopScheduled=true;
          setTimeout(()=>document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",{detail:JSON.stringify({action:"stop",id:status.id})})),0);
        }
        if(["done","error"].includes(status.state))resolve(status);
      }));
      const ops=Array.from({length:500},(_,i)=>({kind:"dot",size:4,color:1,point:[100+i%100*5,100+Math.floor(i/100)*5]}));
      document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",{detail:JSON.stringify({action:"draw",id:"cancel-test",word:"testword",speed:"max",style:"lines",background:0,strokes:[],ops})}));
      const status=await done;
      const stopCommands=__sim.commands.length;
      await new Promise(resolve=>setTimeout(resolve,100));
      return {status,states,stopCommands,finalCommands:__sim.commands.length,errors:__pageErrors};
    }.toString()})()`));
    assert.equal(cancelled.status.state, "error");
    assert.match(cancelled.status.message, /stopped/i);
    assert.equal(cancelled.stopCommands, cancelled.finalCommands);
    assert.ok(cancelled.finalCommands < 500, "Cancellation arrived after all dots were drawn");
    assert.deepEqual(cancelled.errors, []);
    console.log("PASS browser cancellation stops queued work");
  } finally {
    server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
      // Only remove the isolated, newly created browser profile inside temp.
      const relative = path.relative(os.tmpdir(), browser.profile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-max-test-")) fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

module.exports = { connect, evaluate, launchBrowser, fixture, RGB, converter, stable };
if (require.main === module) (async () => {
  if (argv.includes("--geometry-only")) { footprintRangesTest(); return; }
  if (argv.includes("--mixed-only")) { mixedGridTest(); return; }
  if (argv.includes("--inverse-only")) { inverseMaskTest(); return; }
  adjustmentTests();
  nodeTests();
  if (argv.includes("--browser")) await browserTests();
  else console.log("Browser delivery, feature, cancellation and fallback checks: run again with --browser");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
