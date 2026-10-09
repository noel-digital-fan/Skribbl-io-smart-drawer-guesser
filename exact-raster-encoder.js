"use strict";
// Alternative encodings of an existing game raster. Every candidate retains all
// 800x600 palette pixels. Synthetic fills require the runner's exact:true guard:
// a live canvas mismatch must abort, never draw an approximate stroke fallback.
(() => {
  const W = 800, H = 600, N = W * H, WIDE = [40, 32, 20, 10, 6];

  function equal(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function better(a, b) {
    for (const [left, right] of [[a.seconds, b.seconds], [a.commands, b.commands],
      [a.moves, b.moves], [a.ops.length, b.ops.length]]) {
      if (left !== right) return left < right;
    }
    return false;
  }

  function workspace(engine, metrics, floodLimit = N * 4) {
    const pixels = new Uint8Array(N), seen = new Uint32Array(N), queue = new Int32Array(N);
    let generation = 0, floodWork = 0;
    // A typed flood workspace is reused throughout each replay. The optional
    // target predicate permits only pixels of the required final background.
    const fill = (point, color, target) => {
      const seed = point[1] * W + point[0], own = pixels[seed];
      if (own === color) return { count: 0 };
      let head = 0, tail = 1, x0 = W, y0 = H, x1 = -1, y1 = -1;
      if (++generation === 0x100000000) { seen.fill(0); generation = 1; }
      queue[0] = seed; seen[seed] = generation;
      while (head < tail) {
        if (++floodWork > floodLimit) { metrics.floodBudgetStops++; return null; }
        const p = queue[head++], x = p % W, y = (p / W) | 0;
        metrics.floodVisits++;
        if (target && target[p] !== color) return null;
        pixels[p] = color;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x && seen[p - 1] !== generation && pixels[p - 1] === own) { seen[p - 1] = generation; queue[tail++] = p - 1; }
        if (x < W - 1 && seen[p + 1] !== generation && pixels[p + 1] === own) { seen[p + 1] = generation; queue[tail++] = p + 1; }
        if (p >= W && seen[p - W] !== generation && pixels[p - W] === own) { seen[p - W] = generation; queue[tail++] = p - W; }
        if (p < N - W && seen[p + W] !== generation && pixels[p + W] === own) { seen[p + W] = generation; queue[tail++] = p + W; }
      }
      return { box: [x0, y0, x1, y1], count: tail };
    };
    const apply = (original, strict = false) => {
      const op = { ...original };
      if (op.kind === "fill") {
        const area = fill(op.point, op.color);
        if (!area) return false;
        if (!area.count) return null;
        op.box = area.box; op.count = area.count;
        if (strict) { op.exact = true; op.rows = []; }
      } else {
        if (op.kind === "line") {
          const [x, y] = op.points[0];
          op.free = pixels[y * W + x] === op.color;
        }
        engine.forFootprint(op, (p) => { metrics.brushVisits++; pixels[p] = op.color; });
      }
      return op;
    };
    return { pixels, fill, apply, reset: (background) => pixels.fill(background) };
  }

  function alternate(reference, target, background, engine, metrics) {
    const scratch = workspace(engine, metrics), ops = [];
    scratch.reset(background);
    for (const original of reference.ops) {
      if (original.color === background) continue;
      const op = scratch.apply(original, true);
      if (op === false) return null;
      if (op) ops.push(op);
    }
    // The original planner omitted its initial background. Restore each exact
    // component only when it cannot reach a pixel of another final color.
    const size = reference.brushes?.[0] || reference.ops[0]?.size || 4;
    for (let p = 0; p < N; p++) {
      if (target[p] !== reference.background || scratch.pixels[p] === reference.background) continue;
      const point = [p % W, (p / W) | 0], area = scratch.fill(point, reference.background, target);
      if (!area) return null;
      if (area.count) ops.push({ kind: "fill", color: reference.background, size, point,
        box: area.box, count: area.count, rows: [], exact: true });
    }
    if (!equal(target, scratch.pixels)) return null;
    return finish(reference, ops, background, engine, target, metrics);
  }

  function finish(reference, ops, background, engine, target, metrics) {
    // Rebuild free/continue/travel starts from the actual new paint order.
    const replay = engine.rasterize(ops, background, { annotateStarts: true });
    metrics.replays++;
    if (!equal(target, replay.pixels)) { metrics.rejectedPixels++; return null; }
    return { ...reference, ...engine.finish(replay.ops, background,
      reference.sampleWidth, reference.sampleHeight) };
  }

  function bounds(op) {
    const r = Math.floor(op.size / 2) - 1, b = [W, H, -1, -1];
    for (const [x, y] of op.points || [op.point]) {
      b[0] = Math.min(b[0], x - r); b[1] = Math.min(b[1], y - r);
      b[2] = Math.max(b[2], x + r); b[3] = Math.max(b[3], y + r);
    }
    return b;
  }

  function prune(ops, engine) {
    const covered = new Uint8Array(N), kept = [];
    for (let i = ops.length - 1; i >= 0; i--) {
      let needed = false;
      engine.forFootprint(ops[i], (p) => { if (!covered[p]) { needed = true; covered[p] = 1; } });
      if (needed) kept.push(ops[i]);
    }
    return kept.reverse();
  }

  // Expand only strokes whose complete larger stamp is already the expected
  // color. Added strokes go after their source block; covered source operations
  // can then disappear without changing the canvas before its next bucket.
  function widenBlock(block, expected, engine, metrics, budget) {
    const forFootprint = (op, visit) => engine.forFootprint(op, (p) => {
      if (budget.exhausted) return false;
      if (++metrics.wideFootprintVisits > N * 16) { budget.exhausted = true; return false; }
      return visit(p);
    });
    const marks = new Uint32Array(N), selectedPixels = new Uint8Array(N), removed = new Uint8Array(block.length);
    const originalBounds = block.map(bounds), checkedOps = new Uint32Array(block.length), added = [];
    const TILE = 16, COLS = Math.ceil(W / TILE), buckets = Array.from({ length: COLS * Math.ceil(H / TILE) }, () => []);
    let generation = 0, proposals = 0, remaining = block.length;
    const tiles = (box, visit) => {
      const x0 = Math.floor(Math.max(0, box[0]) / TILE), x1 = Math.floor(Math.min(W - 1, box[2]) / TILE);
      const y0 = Math.floor(Math.max(0, box[1]) / TILE), y1 = Math.floor(Math.min(H - 1, box[3]) / TILE);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(buckets[y * COLS + x]);
    };
    for (let i = 0; i < block.length; i++) tiles(originalBounds[i], (bucket) => bucket.push(i));
    const propose = (op) => {
      if (++proposals > 4096 || added.length >= 512) return false;
      metrics.wideCandidates++;
      let safe = true;
      forFootprint(op, (p) => {
        metrics.maskVisits++;
        if (expected[p] !== op.color) { safe = false; return false; }
      });
      if (!safe || budget.exhausted) return false;
      const box = bounds(op), mark = ++generation, newlyCovered = [];
      forFootprint(op, (p) => { marks[p] = mark; });
      if (budget.exhausted) return false;
      let coveredCost = 0;
      tiles(box, (bucket) => {
        for (const i of bucket) {
          if (budget.exhausted) return;
          if (removed[i] || checkedOps[i] === mark) continue;
          checkedOps[i] = mark;
          let covered = true;
          forFootprint(block[i], (p) => {
            if (!selectedPixels[p] && marks[p] !== mark) { covered = false; return false; }
          });
          if (covered) {
            newlyCovered.push(i);
            coveredCost += block[i].kind === "line" ? block[i].points.length - 1
              + (block[i].start === "dot" ? 1 : 0) : 1;
          }
        }
      });
      const newCost = op.kind === "line" ? op.points.length : 1;
      if (coveredCost <= newCost || budget.exhausted) return false;
      forFootprint(op, (p) => { selectedPixels[p] = 1; });
      if (budget.exhausted) return false;
      for (const i of newlyCovered) { removed[i] = 1; remaining--; }
      added.push(op);
      metrics.wideAccepted++;
      return true;
    };
    // Dense same-row/column dots often need just one line. Candidate footprints
    // must still be exactly the expected color, including all pixels between dots.
    const spans = (vertical) => {
      const groups = new Map();
      for (const op of block) {
        if (op.kind !== "dot") continue;
        const along = vertical ? 1 : 0, fixed = op.point[1 - along], size = op.size === 5 ? 4 : op.size;
        const key = op.color + ":" + size + ":" + fixed;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ op, along, size });
      }
      for (const group of groups.values()) {
        group.sort((a, b) => a.op.point[a.along] - b.op.point[b.along]);
        for (let start = 0; start < group.length;) {
          let end = start + 1;
          const first = group[start], reach = 2 * Math.floor(first.size / 2) - 1;
          while (end < group.length && group[end].op.point[first.along] - group[end - 1].op.point[first.along] <= reach) end++;
          if (end - start >= 3) propose({ kind: "line", color: first.op.color, size: first.size,
            points: [first.op.point, group[end - 1].op.point], start: "dot" });
          start = end;
          if (!remaining || proposals >= 2048 || added.length >= 512 || budget.exhausted) return;
        }
      }
    };
    spans(false);
    if (remaining && !budget.exhausted) spans(true);
    // Distribute center proposals across the whole source block. A fixed front
    // prefix misses interiors when source operations begin along their borders.
    const centerCount = Math.min(2048, block.length);
    for (let k = 0; k < centerCount && remaining && proposals < 4096 && added.length < 512 && !budget.exhausted; k++) {
      const original = block[Math.floor((k + 0.5) * block.length / centerCount)];
      const a = original.points?.[0] || original.point, b = original.points?.[original.points.length - 1] || a;
      const point = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
      for (const size of WIDE) {
        if (size <= original.size) continue;
        if (propose({ kind: "dot", color: original.color, size, point })) break;
        if (proposals >= 4096 || added.length >= 512 || budget.exhausted) break;
      }
    }
    if (budget.exhausted) return null;
    if (!added.length) return block;
    const result = prune([...block, ...added], { forFootprint });
    if (budget.exhausted) return null;
    return result.length < block.length ? result : block;
  }

  function wide(reference, target, engine, metrics) {
    const blocks = [], ops = reference.ops;
    for (let start = 0; start < ops.length;) {
      if (ops[start].kind === "fill") { start++; continue; }
      let end = start + 1;
      while (end < ops.length && ops[end].kind !== "fill") end++;
      if (end - start >= 8) blocks.push({ start, end });
      start = end;
    }
    blocks.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const selected = new Set(blocks.slice(0, 2).map((b) => b.start));
    if (!selected.size) return null;
    const scratch = workspace(engine, metrics, N * 8), candidate = [];
    const budget = { exhausted: false };
    scratch.reset(reference.background);
    let changed = false;
    for (let start = 0; start < ops.length;) {
      if (ops[start].kind === "fill") {
        const op = scratch.apply(ops[start++]);
        if (op === false) return null;
        if (op) candidate.push(op);
        continue;
      }
      let end = start + 1;
      while (end < ops.length && ops[end].kind !== "fill") end++;
      const block = ops.slice(start, end);
      for (const op of block) if (scratch.apply(op) === false) return null;
      const result = selected.has(start) ? widenBlock(block, scratch.pixels, engine, metrics, budget) : block;
      if (!result) { metrics.wideBudgetStops++; return null; }
      if (result !== block) changed = true;
      candidate.push(...result);
      start = end;
    }
    return changed ? finish(reference, candidate, reference.background, engine, target, metrics) : null;
  }

  function encode(reference, engine) {
    const started = performance.now(), metrics = { backgroundCandidates: 0, wideCandidates: 0,
      replays: 0, rejectedPixels: 0, floodVisits: 0, floodBudgetStops: 0,
      brushVisits: 0, maskVisits: 0, wideAccepted: 0, wideFootprintVisits: 0, wideBudgetStops: 0 };
    let best = reference, selected = "reference", failure;
    try {
      const target = engine.referencePixels || engine.rasterize(reference.ops, reference.background).pixels;
      if (!engine.referencePixels) metrics.replays++;
      const counts = new Uint32Array(256), commands = new Uint32Array(256);
      for (const color of target) counts[color]++;
      for (const op of reference.ops) commands[op.color] += op.kind === "line" ? op.points.length - 1 + 1 : 1;
      const backgrounds = Array.from({ length: 256 }, (_, color) => color)
        .filter((color) => color !== reference.background && counts[color] >= N / 100 && commands[color] >= 8)
        .sort((a, b) => commands[b] - commands[a] || counts[b] - counts[a] || a - b).slice(0, 2);
      for (const background of backgrounds) {
        metrics.backgroundCandidates++;
        const result = alternate(reference, target, background, engine, metrics);
        if (result && better(result, best)) { best = result; selected = "background"; }
      }
      const result = wide(best, target, engine, metrics);
      if (result && better(result, best)) { best = result; selected = selected === "background" ? "background+wide" : "wide"; }
    } catch (error) {
      best = reference; selected = "reference"; failure = String(error?.message || error);
    }
    return { ...best, encoding: { ...metrics, selected, pixelDiff: 0,
      baselineCommands: reference.commands, optimizedCommands: best.commands,
      removedOps: reference.ops.length - best.ops.length,
      encodingMs: Math.round(performance.now() - started), ...(failure ? { failure } : {}) } };
  }

  // Inverse masks help when many small detail stamps perforate a much larger
  // primary-colored shape. No image names or fixed palette colors are used.
  // The complete raster and live-fill metadata are proven again after pruning.
  function encodeInverse(reference, engine) {
    const SIZES = Array.from({ length: 19 }, (_, index) => 40 - index * 2);
    // Chessboard distance is a conservative erosion of every native circular
    // brush. The zero-distance pixels must keep the alternate or source background.
    function clearance(target, background, originalBackground, onlyColor) {
      const distance = new Uint16Array(N);
      let largest = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          if (onlyColor === undefined ? target[p] === background || target[p] === originalBackground : target[p] !== onlyColor) continue;
          let d = 1000;
          if (x) d = Math.min(d, distance[p - 1] + 1);
          if (y) {
            d = Math.min(d, distance[p - W] + 1);
            if (x) d = Math.min(d, distance[p - W - 1] + 1);
            if (x < W - 1) d = Math.min(d, distance[p - W + 1] + 1);
          }
          distance[p] = d;
        }
      }
      for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
          const p = y * W + x;
          if (!distance[p]) continue;
          let d = distance[p];
          if (x < W - 1) d = Math.min(d, distance[p + 1] + 1);
          if (y < H - 1) {
            d = Math.min(d, distance[p + W] + 1);
            if (x) d = Math.min(d, distance[p + W - 1] + 1);
            if (x < W - 1) d = Math.min(d, distance[p + W + 1] + 1);
          }
          distance[p] = d;
          largest = Math.max(largest, d);
        }
      }
      return { distance, largest };
    }

    // Adjacent identical safe-center runs are one band. Propose its center rather
    // than evaluating the same long footprint at every individual raster row.
    function spans(distance, radius, vertical, longOnly) {
      const fixedLimit = vertical ? W : H, alongLimit = vertical ? H : W;
      const previous = new Map(), finished = [];
      for (let fixed = 0; fixed < fixedLimit; fixed++) {
        const present = new Map();
        for (let along = 0; along < alongLimit;) {
          const p = vertical ? along * W + fixed : fixed * W + along;
          if (distance[p] < radius) { along++; continue; }
          const low = along++;
          while (along < alongLimit && distance[vertical ? along * W + fixed : fixed * W + along] >= radius) along++;
          const high = along - 1;
          if (longOnly && high - low + 1 < radius * 4) continue;
          const key = low * (alongLimit + 1) + high;
          const band = previous.get(key);
          if (band) { band.last = fixed; previous.delete(key); present.set(key, band); }
          else present.set(key, { low, high, first: fixed, last: fixed, vertical });
        }
        for (const band of previous.values()) finished.push(band);
        previous.clear();
        for (const [key, band] of present) previous.set(key, band);
      }
      for (const band of previous.values()) finished.push(band);
      const result = [], diameter = radius * 2 - 1;
      for (const band of finished) {
        const width = band.last - band.first + 1;
        const centers = width === 1 ? 1 : Math.ceil((width - 1) / diameter) + 1;
        for (let k = 0; k < centers; k++) {
          const fixed = centers === 1 ? band.first : Math.round(band.first + k * (width - 1) / (centers - 1));
          result.push({ ...band, fixed, area: (band.high - band.low + diameter) * diameter });
        }
      }
      result.sort((a, b) => b.area - a.area || Number(a.vertical) - Number(b.vertical)
        || a.fixed - b.fixed || a.low - b.low || a.high - b.high);
      return result;
    }

    function mesh(reference, target, background, primary, engine, metrics) {
      const needed = new Uint8Array(N);
      let remaining = 0;
      for (let p = 0; p < N; p++) if (target[p] === primary) { needed[p] = 1; remaining++; }
      // Existing primary-colored strokes remain in their source order. Their
      // exact footprints restore thin boundary pixels that a safe mesh cannot cover.
      for (const op of reference.ops) {
        if (op.color !== primary || op.kind === "fill") continue;
        engine.forFootprint(op, (p) => { if (needed[p]) { needed[p] = 0; remaining--; } });
      }
      const eroded = clearance(target, background, reference.background), ops = [];
      const scoreBudget = N * 24, proposalBudget = 32768;
      let scoreWork = 0, proposals = 0, exhausted = false;
      const offer = (op, minimumGain) => {
        if (proposals++ >= proposalBudget || ops.length >= 1536 || scoreWork >= scoreBudget) { exhausted = true; return false; }
        metrics.meshCandidates++;
        let gain = 0;
        const done = engine.forFootprint(op, (p) => {
          metrics.maskVisits++;
          if (++scoreWork > scoreBudget) { exhausted = true; return false; }
          gain += needed[p];
        });
        if (!done || gain < minimumGain) return false;
        engine.forFootprint(op, (p) => { if (needed[p]) { needed[p] = 0; remaining--; } });
        ops.push(op); metrics.meshAccepted++;
        return true;
      };
      // Long corridors in both axes are considered before isolated residuals.
      // This avoids turning a regular perforated region into one stroke per hole.
      for (const longOnly of [true, false]) {
        for (const size of SIZES) {
          if (!remaining || exhausted || proposals >= proposalBudget - 512) break;
          const radius = Math.floor(size / 2);
          if (radius > eroded.largest) continue;
          const candidates = [...spans(eroded.distance, radius, false, longOnly),
            ...spans(eroded.distance, radius, true, longOnly)];
          candidates.sort((a, b) => b.area - a.area || Number(a.vertical) - Number(b.vertical)
            || a.fixed - b.fixed || a.low - b.low);
          for (const band of candidates) {
            if (!remaining || exhausted || proposals >= proposalBudget - 512) break;
            const a = band.vertical ? [band.fixed, band.low] : [band.low, band.fixed];
            const b = band.vertical ? [band.fixed, band.high] : [band.high, band.fixed];
            const op = band.low === band.high ? { kind: "dot", color: primary, size, point: a }
              : { kind: "line", color: primary, size, points: [a, b], start: "dot" };
            offer(op, longOnly ? Math.max(12, Math.floor(band.area / 10)) : 1);
          }
        }
        if (!remaining || exhausted || proposals >= proposalBudget - 512) break;
      }
      // Exact, bounded small-stamp completion. A required pixel may be painted by
      // any safe neighboring center, rather than requiring its own center to fit.
      for (let p = 0; p < N && remaining && !exhausted; p++) {
        if (!needed[p]) continue;
        const x = p % W, y = (p / W) | 0;
        let done = false;
        for (let dy = -1; dy <= 1 && !done; dy++) for (let dx = -1; dx <= 1 && !done; dx++) {
          const sx = x + dx, sy = y + dy;
          if (sx < 0 || sx >= W || sy < 0 || sy >= H || eroded.distance[sy * W + sx] < 2) continue;
          done = offer({ kind: "dot", color: primary, size: 4, point: [sx, sy] }, 1);
        }
      }
      metrics.trials.push({ background, primary, meshOps: ops.length, uncoveredPixels: remaining,
        proposals, scoreWork, sizes: ops.reduce((counts, op) => {
          counts[op.size] = (counts[op.size] || 0) + 1; return counts;
        }, {}) });
      metrics.uncoveredPixels += remaining;
      if (exhausted) metrics.meshBudgetStops++;
      return remaining ? null : ops;
    }

    // Restore a feature only with stamps wholly contained in its final color.
    // Choosing a nearby safe center also covers boundary pixels whose own center
    // cannot accept a native brush. A failure rejects this proposal as a whole.
    function patch(target, pixels, color, brush, engine, metrics) {
      const { distance } = clearance(target, 0, 0, color);
      let scoreWork = 0, accepted = 0;
      const budget = N * 2;
      for (let p = 0; p < N; p++) {
        if (target[p] !== color || pixels[p] === color) continue;
        const x = p % W, y = (p / W) | 0;
        let best = null, gain = 0;
        for (const size of [10, 6, 4]) {
          const radius = Math.floor(size / 2);
          for (let dy = -radius + 1; dy < radius; dy++) {
            for (let dx = -radius + 1; dx < radius; dx++) {
              if (dx * dx + dy * dy >= radius * radius) continue;
              const sx = x + dx, sy = y + dy;
              if (sx < 0 || sx >= W || sy < 0 || sy >= H || distance[sy * W + sx] < radius) continue;
              const op = { kind: "dot", color, size, point: [sx, sy] };
              let corrected = 0;
              const done = engine.forFootprint(op, (pixel) => {
                if (++scoreWork > budget) return false;
                if (pixels[pixel] !== color) corrected++;
              });
              if (!done) { metrics.repairBudgetStops++; return false; }
              if (corrected > gain) { best = op; gain = corrected; }
            }
          }
          if (best) break;
        }
        if (!best || ++accepted > 256) return false;
        brush(best);
        metrics.repairStrokes++;
      }
      return true;
    }

    function replay(reference, target, background, primary, painted, engine, metrics) {
      // These original detail marks help seal the outer contour. Permit the
      // outside bucket to cross only their known pixels, then restore them.
      const retained = new Set(), repairable = new Uint8Array(N);
      for (const original of reference.ops) {
        if (original.color !== background || original.kind === "fill") continue;
        let touches = false;
        engine.forFootprint(original, p => {
          if (target[p] !== background) return;
          const x = p % W, y = (p / W) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H
              && target[ny * W + nx] === reference.background) touches = true;
          }
        });
        if (touches) {
          retained.add(original);
          engine.forFootprint(original, p => { if (target[p] === background) repairable[p] = 1; });
        }
      }
      metrics.retainedBoundaryOps = retained.size;
      metrics.repairableBoundaryPixels = repairable.reduce((sum, pixel) => sum + pixel, 0);
      const canvasBackground = background;
      const pixels = engine.rasterize([], canvasBackground).pixels, ops = [];
      const queue = new Int32Array(N), seen = new Uint32Array(N);
      let floodWork = 0, generation = 0;
      const reject = (reason) => {
        metrics.trials[metrics.trials.length - 1].rejected = reason;
        return null;
      };
      // Game palette colors exceed the bucket's RGB tolerance. Their equal-index
      // four-connected area is shared with the runner's strict live fill check.
      // Validate a restoration before painting any part of it.
      const fill = (point, color, targetOnly) => {
        const seed = point[1] * W + point[0], own = pixels[seed];
        if (own === color) return { count: 0 };
        let head = 0, tail = 1, x0 = W, y0 = H, x1 = -1, y1 = -1;
        if (++generation === 0x100000000) { generation = 1; seen.fill(0); }
        queue[0] = seed; seen[seed] = generation;
        while (head < tail) {
          if (++floodWork > N * 4) { metrics.floodBudgetStops++; return null; }
          const p = queue[head++], x = p % W, y = (p / W) | 0;
          metrics.floodVisits++;
          if (targetOnly && target[p] !== color
            && !(color === reference.background && repairable[p])) return null;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (x && seen[p - 1] !== generation && pixels[p - 1] === own) { seen[p - 1] = generation; queue[tail++] = p - 1; }
          if (x < W - 1 && seen[p + 1] !== generation && pixels[p + 1] === own) { seen[p + 1] = generation; queue[tail++] = p + 1; }
          if (p >= W && seen[p - W] !== generation && pixels[p - W] === own) { seen[p - W] = generation; queue[tail++] = p - W; }
          if (p < N - W && seen[p + W] !== generation && pixels[p + W] === own) { seen[p + W] = generation; queue[tail++] = p + W; }
        }
        for (let i = 0; i < tail; i++) pixels[queue[i]] = color;
        return { box: [x0, y0, x1, y1], count: tail };
      };
      const brush = (original) => {
        const op = { ...original };
        let needed = false;
        engine.forFootprint(op, (p) => { if (target[p] === op.color && pixels[p] !== op.color) { needed = true; return false; } });
        if (!needed) { metrics.noopStrokes++; return; }
        engine.forFootprint(op, (p) => { pixels[p] = op.color; metrics.brushVisits++; });
        ops.push(op);
      };
      for (const op of painted) brush(op);
      for (const original of reference.ops) {
        if (original.color === background && !retained.has(original) || original.color === primary && original.kind === "fill") continue;
        if (original.kind !== "fill") { brush(original); continue; }
        const area = fill(original.point, original.color, false);
        if (!area) return reject("reference-fill-budget");
        if (area.count) ops.push({ ...original, box: area.box, count: area.count, rows: [], exact: true });
      }
      const size = reference.brushes?.[0] || 4;
      // The mesh can leave several current colors inside a previously uniform
      // feature bucket. Its original outline still seals the feature; restore
      // each remaining component only when its entire reachable area is exact.
      const unsafeColors = new Set();
      for (let p = 0; p < N; p++) {
        const color = target[p];
        if (color === background || color === primary || color === reference.background || pixels[p] === color) continue;
        if (unsafeColors.has(color)) continue;
        const point = [p % W, (p / W) | 0], area = fill(point, color, true);
        if (!area) { unsafeColors.add(color); continue; }
        if (!area.count) return reject("empty-feature-fill");
        ops.push({ kind: "fill", color, size, point, box: area.box, count: area.count, rows: [], exact: true });
      }
      for (const color of unsafeColors) {
        if (!patch(target, pixels, color, brush, engine, metrics)) return reject("feature-repair-" + color);
      }
      for (let p = 0; p < N; p++) {
        if (target[p] !== reference.background || pixels[p] === reference.background) continue;
        const point = [p % W, (p / W) | 0], area = fill(point, reference.background, true);
        if (!area || !area.count) return reject("background-fill");
        ops.push({ kind: "fill", color: reference.background, size, point,
          box: area.box, count: area.count, rows: [], exact: true });
      }
      for (let round = 0; round < 8; round++) {
        for (const original of reference.ops) {
          if (original.kind !== "fill" && (original.color !== background || retained.has(original))) brush(original);
        }
        if (equal(pixels, target)) break;
        const wrongDetail = new Uint8Array(N);
        let added = 0;
        for (let p = 0; p < N; p++) if (target[p] === background && pixels[p] !== background) wrongDetail[p] = 1;
        for (const original of reference.ops) {
          if (original.color !== background || original.kind === "fill" || retained.has(original)) continue;
          let hit = false;
          engine.forFootprint(original, p => { if (wrongDetail[p]) { hit = true; return false; } });
          if (hit) { retained.add(original); added++; }
        }
        if (!added) break;
        metrics.detailRepairOps = (metrics.detailRepairOps || 0) + added;
      }
      if (!equal(pixels, target)) {
        metrics.rejectedPixels++;
        const wrong = {};
        let count = 0;
        for (let p = 0; p < N; p++) if (pixels[p] !== target[p]) {
          count++; const key = target[p] + ":" + pixels[p]; wrong[key] = (wrong[key] || 0) + 1;
        }
        Object.assign(metrics.trials[metrics.trials.length - 1], { rejectedPixelDiff: count, wrongColors: wrong });
        return reject("final-pixels");
      }
      const proof = engine.rasterize(ops, canvasBackground, { annotateStarts: true, annotateFills: true });
      metrics.replays++;
      if (!equal(proof.pixels, target)) { metrics.rejectedPixels++; return reject("replay-pixels"); }
      const candidate = { ...reference, ...engine.finish(proof.ops, canvasBackground, reference.sampleWidth, reference.sampleHeight) };
      const compact = globalThis.SG_ULTRA_OPTIMIZER.optimize(candidate, engine);
      if (metrics.footprintWork > N * 32) throw budgetStop;
      if (compact.optimization?.failure) throw new Error(compact.optimization.failure);
      const fixed = engine.rasterize(compact.ops, compact.background, { annotateStarts: true, annotateFills: true });
      metrics.replays++;
      if (!equal(fixed.pixels, target)) return reject("compact-pixels");
      const result = { ...candidate, ...engine.finish(fixed.ops, compact.background, reference.sampleWidth, reference.sampleHeight) };
      let best = result;
      // A short axial line is exactly two endpoint stamps when their spans
      // meet even at the narrowest circle row. Compare three bounded start
      // policies: fewer gated moves can justify one extra dot command.
      for (const starts of [["dot"], ["dot", "travel"], ["dot", "travel", "free", "continue"]]) {
        const altered = [];
        let substitutions = 0;
        for (const op of result.ops) {
          if (op.kind !== "line" || op.points.length !== 2 || !starts.includes(op.start)) {
            altered.push({ ...op }); continue;
          }
          const [a, b] = op.points, radius = Math.floor(op.size / 2), axial = a[0] === b[0] || a[1] === b[1];
          let minExtent = radius - 1;
          while (minExtent * minExtent + (radius - 1) * (radius - 1) >= radius * radius) minExtent--;
          if (!axial || Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 2 * minExtent + 1) {
            altered.push({ ...op }); continue;
          }
          substitutions++;
          for (const point of op.points) altered.push({ kind: "dot", color: op.color, size: op.size, point });
        }
        if (!substitutions) continue;
        const replay = engine.rasterize(altered, result.background, { annotateStarts: true, annotateFills: true });
        metrics.replays++;
        if (!equal(replay.pixels, target)) continue;
        const trial = { ...result, ...engine.finish(replay.ops, result.background, result.sampleWidth, result.sampleHeight) };
        metrics.dotTrials ??= [];
        metrics.dotTrials.push({ starts, substitutions, commands: trial.commands, moves: trial.moves, seconds: trial.seconds });
        if (better(trial, best)) best = trial;
      }
      metrics.trials[metrics.trials.length - 1].compact = {
        commands: best.commands, moves: best.moves, seconds: best.seconds, ops: best.ops.length };
      return best;
    }


    const started = performance.now(), metrics = { backgroundCandidates: 0, meshCandidates: 0,
      meshAccepted: 0, meshBudgetStops: 0, maskVisits: 0, uncoveredPixels: 0,
      brushVisits: 0, floodVisits: 0, floodBudgetStops: 0, rejectedPixels: 0, replays: 0, trials: [],
      noopStrokes: 0, repairStrokes: 0, repairBudgetStops: 0, footprintWork: 0, workBudgetStops: 0 };
    let best = reference, selected = "reference", failure;
    const budgetStop = Symbol("inverse-mask-footprint-budget"), forFootprint = engine.forFootprint;
    engine = { ...engine, forFootprint(op, visit) {
      return forFootprint(op, p => {
        if (++metrics.footprintWork > N * 32) throw budgetStop;
        return visit(p);
      });
    } };
    try {
      const counts = new Uint32Array(256), commands = new Uint32Array(256), dots = new Uint32Array(256);
      for (const op of reference.ops) {
        commands[op.color] += op.kind === "line" ? op.points.length : 1;
        if (op.kind === "dot") dots[op.color]++;
      }
      // A low-command drawing cannot pay for an inverse-mask search or improve
      // the required command throughput enough to justify changing its encoding.
      if (reference.commands >= 128 && reference.seconds > 4 && reference.ops.length <= 6000 && !reference.bandEncoding?.selected) {
        const target = engine.referencePixels || engine.rasterize(reference.ops, reference.background).pixels;
        if (!engine.referencePixels) metrics.replays++;

        for (const color of target) counts[color]++;
        const backgrounds = Array.from({ length: 256 }, (_, c) => c)
          .filter((c) => c !== reference.background && dots[c] >= 96 && counts[c] >= N / 100 && counts[c] <= commands[c] * 48)
          .sort((a, b) => commands[b] - commands[a] || counts[b] - counts[a] || a - b).slice(0, 2);
        for (const background of backgrounds) {
          const primary = Array.from({ length: 256 }, (_, c) => c)
            .filter((c) => c !== background && c !== reference.background && counts[c])
            .sort((a, b) => counts[b] - counts[a] || a - b)[0];
          if (primary === undefined || counts[primary] < N / 100 || counts[primary] < 2 * counts[background]) continue;
          metrics.backgroundCandidates++;
          const painted = mesh(reference, target, background, primary, engine, metrics);
          if (!painted) continue;
          const candidate = replay(reference, target, background, primary, painted, engine, metrics);
          if (candidate && better(candidate, best)) { best = candidate; selected = "complement"; break; }
        }
      }
    } catch (error) {
      best = reference; selected = "reference";
      if (error === budgetStop) metrics.workBudgetStops++;
      else failure = String(error?.message || error);
    }
    return { plan: best, metrics: { ...metrics, selected, pixelDiff: 0,
      baselineCommands: reference.commands, optimizedCommands: best.commands,
      removedOps: reference.ops.length - best.ops.length,
      encodingMs: Math.round(performance.now() - started), ...(failure ? { failure } : {}) } };
  }


  function refine(reference, engine) {
    const { plan, metrics } = encodeInverse(reference, engine);
    return { ...plan, optimization: reference.optimization,
      encoding: { ...reference.encoding, inverse: metrics } };
  }

  globalThis.SG_EXACT_RASTER_ENCODER = { encode, optimize: encode, refine };
})();
