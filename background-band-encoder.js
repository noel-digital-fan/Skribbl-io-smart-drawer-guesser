"use strict";
// A lossless alternative for rectangular regions separated by full background
// corridors. Paint with native wide brushes, then restore the corridors. Every
// candidate is replayed against the reference before it can replace that plan.
(() => {
  const W = 800, H = 600, N = W * H, SIZES = Array.from({ length: 19 }, (_, index) => 40 - index * 2);
  const runs = (counts, empty) => {
    const result = [];
    for (let start = 0; start < counts.length;) {
      if ((counts[start] === 0) !== empty) { start++; continue; }
      let end = start + 1;
      while (end < counts.length && (counts[end] === 0) === empty) end++;
      result.push([start, end - 1]); start = end;
    }
    return result;
  };
  function equal(a, b) {
    for (let p = 0; p < a.length; p++) if (a[p] !== b[p]) return false;
    return true;
  }
  function encodePartial(reference, engine) {
    const started = performance.now(), metrics = { selected: false, cells: 0,
      corridorStrokes: 0, pixelDiff: 0, footprintVisits: 0, budgetStops: 0,
      baselineCommands: reference.commands };
    let best = reference, failure;
    let exhausted = false;
    const footprint = (op, visit) => engine.forFootprint(op, (p) => {
      if (++metrics.footprintVisits > W * H * 8) { exhausted = true; return false; }
      return visit(p);
    });
    try {
      const target = engine.referencePixels || engine.rasterize(reference.ops, reference.background).pixels;
      const rowCounts = new Uint16Array(H), columnCounts = new Uint16Array(W);
      for (let p = 0; p < target.length; p++) if (target[p] !== reference.background) {
        rowCounts[(p / W) | 0]++; columnCounts[p % W]++;
      }
      const rows = runs(rowCounts, false), columns = runs(columnCounts, false);
      const rowGaps = runs(rowCounts, true), columnGaps = runs(columnCounts, true);
      // Only uniform grid cells are candidates. Irregular/mixed regions retain
      // their complete original operations, including the fine edge colors.
      if (!rows.length || !columns.length || rows.length * columns.length > 4096
        || !rowGaps.length || !columnGaps.length) return result();
      const cells = [], cellIds = new Int16Array(W * H).fill(-1);
      for (const [y0, y1] of rows) for (const [x0, x1] of columns) {
        const color = target[y0 * W + x0];
        if (color === reference.background) continue;
        let uniform = true;
        for (let y = y0; y <= y1 && uniform; y++) for (let x = x0; x <= x1; x++)
          if (target[y * W + x] !== color) { uniform = false; break; }
        if (!uniform) continue;
        const id = cells.length;
        cells.push({ color, x0, x1, y0, y1 });
        for (let y = y0; y <= y1; y++) cellIds.fill(id, y * W + x0, y * W + x1 + 1);
      }
      metrics.cells = cells.length;
      if (!cells.length) return result();
      // Mixed colors and irregular edges retain their original operations.
      // Remove only operations wholly contained in a uniform candidate cell.
      const base = reference.ops.filter((op) => {
        const point = op.point || op.points[0], id = cellIds[point[1] * W + point[0]];
        if (id < 0) return true;
        const cell = cells[id];
        if (op.kind === "fill") return op.box[0] < cell.x0 || op.box[1] < cell.y0
          || op.box[2] > cell.x1 || op.box[3] > cell.y1;
        let contained = true;
        footprint(op, (p) => { if (cellIds[p] !== id) { contained = false; return false; } });
        return !contained;
      });
      if (exhausted) { metrics.budgetStops++; return result(); }
      if (base.length === reference.ops.length) return result();
      const baseReplay = engine.rasterize(base, reference.background, { annotateFills: true });
      const pixels = baseReplay.pixels, ops = [...baseReplay.ops];
      const paint = (op) => {
        footprint(op, (p) => { pixels[p] = op.color; });
        ops.push(op);
      };
      for (const { color, x0, x1, y0, y1 } of cells) {
        const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
        let candidate;
        for (const size of SIZES) {
          const radius = Math.floor(size / 2), extent = radius - 1;
          // A single dot is cheaper than a line when its exact disk contains
          // the entire rectangle. Otherwise cover it with parallel long lines.
          const dx = Math.max(cx - x0, x1 - cx), dy = Math.max(cy - y0, y1 - cy);
          const proposed = [];
          if (dx * dx + dy * dy < radius * radius) {
            proposed.push({ kind: "dot", color, size, point: [cx, cy] });
          } else {
            const horizontal = x1 - x0 >= y1 - y0;
            const low = horizontal ? y0 : x0, high = horizontal ? y1 : x1;
            const width = extent * 2 + 1;
            let position = high - low + 1 <= width ? Math.floor((low + high) / 2) : low + extent;
            for (;;) {
              const points = horizontal ? [[x0, position], [x1, position]] : [[position, y0], [position, y1]];
              proposed.push({ kind: "line", color, size, points });
              if (position + extent >= high) break;
              position = Math.min(position + width, high - extent);
            }
          }
          let safe = true;
          for (const op of proposed) {
            footprint(op, (p) => {
              // Overspray is permitted only in corridors that will be restored.
              if (target[p] !== color && rowCounts[(p / W) | 0] && columnCounts[p % W]) {
                safe = false; return false;
              }
            });
            if (exhausted) { metrics.budgetStops++; return result(); }
            if (!safe) break;
          }
          if (safe) { candidate = proposed; break; }
        }
        if (!candidate) return result();
        for (const op of candidate) paint(op);
        if (exhausted) { metrics.budgetStops++; return result(); }
        // No candidate can justify growing the queue beyond the reference.
        if (ops.length >= reference.commands) return result();
      }
      const restore = (gaps, horizontal) => {
        for (const [low, high] of gaps) {
          let touched = false;
          for (let v = low; v <= high && !touched; v++) {
            for (let u = 0; u < (horizontal ? W : H); u++) {
              const p = horizontal ? v * W + u : u * W + v;
              if (pixels[p] !== reference.background) { touched = true; break; }
            }
          }
          if (!touched) continue;
          const size = SIZES.find((value) => Math.floor(value / 2) * 2 - 1 <= high - low + 1);
          if (!size) return false;
          const extent = Math.floor(size / 2) - 1, width = extent * 2 + 1;
          let position = low + extent;
          for (;;) {
            paint({ kind: "line", color: reference.background, size, points: horizontal
              ? [[0, position], [W - 1, position]] : [[position, 0], [position, H - 1]] });
            metrics.corridorStrokes++;
            if (exhausted) return false;
            if (position + extent >= high) break;
            position = Math.min(position + width, high - extent);
          }
        }
        return true;
      };
      if (!restore(rowGaps, true) || !restore(columnGaps, false) || !equal(target, pixels)) {
        if (exhausted) metrics.budgetStops++; return result();
      }
      // Starts and game queue costs are rebuilt for the actual new order.
      const replay = engine.rasterize(ops, reference.background, { annotateStarts: true, annotateFills: true });
      if (!equal(target, replay.pixels)) return result();
      const candidate = { ...reference, ...engine.finish(replay.ops, reference.background,
        reference.sampleWidth, reference.sampleHeight) };
      if (candidate.seconds < reference.seconds || (candidate.seconds === reference.seconds
        && candidate.commands < reference.commands)) {
        best = candidate; metrics.selected = true;
      }
    } catch (error) {
      best = reference; failure = String(error?.message || error);
    }
    return result();
    function result() {
      return { ...best, bandEncoding: { ...metrics, optimizedCommands: best.commands,
        encodingMs: Math.round(performance.now() - started), ...(failure ? { failure } : {}) } };
    }
  }
  const SMALL_FIRST = [...SIZES].reverse();
  const MIXED_LIMITS = { cells: 512, proposals: 120000, pixels: N * 24, pending: N * 8,
    ranges: 1000000, cacheColors: 8 };
  const MIXED_BUDGET = Symbol("background band encoder budget");

  function rectangles(target, box, include) {
    const out = [];
    let previous = new Map();
    for (let y = box.y0; y <= box.y1; y++) {
      const next = new Map();
      for (let x = box.x0; x <= box.x1;) {
        const start = x, color = target[y * W + x++];
        while (x <= box.x1 && target[y * W + x] === color) x++;
        if (!include(color)) continue;
        const key = `${start}:${x - 1}:${color}`;
        let rectangle = previous.get(key);
        if (!rectangle) {
          rectangle = { x0: start, x1: x - 1, y0: y, y1: y, color };
          out.push(rectangle);
        } else rectangle.y1 = y;
        next.set(key, rectangle);
      }
      previous = next;
    }
    return out;
  }

  function encodeMixed(reference, engine) {
    const started = performance.now(), metrics = { selected: false, cells: 0, facetOps: 0,
      restoreOps: 0, crossOps: 0, proposals: 0, footprintVisits: 0, rangeVisits: 0,
      prefixBytes: 0, pendingVisits: 0, pixelDiff: 0, budgetStops: 0, baselineCommands: reference.commands };
    let best = reference;
    const phase = name => {
      const ended = performance.now();
      metrics[name + "Ms"] = Math.round(ended - phaseStarted);
      phaseStarted = ended;
    };
    let phaseStarted = started;
    try {
      if (!engine.forFootprintRanges) return result();
      const target = engine.referencePixels || engine.rasterize(reference.ops, reference.background).pixels;
      const rowCounts = new Uint16Array(H), columnCounts = new Uint16Array(W);
      for (let p = 0; p < N; p++) if (target[p] !== reference.background) {
        rowCounts[(p / W) | 0]++; columnCounts[p % W]++;
      }
      const rowBands = runs(rowCounts, false), columnBands = runs(columnCounts, false);
      // Decline before allocating caches if this is not a separated grid.
      if (rowBands.length < 2 || columnBands.length < 2
        || rowBands.length * columnBands.length > MIXED_LIMITS.cells) return result();
      const rowGaps = runs(rowCounts, true), columnGaps = runs(columnCounts, true);
      const cells = [], cellIds = new Int16Array(N).fill(-1), facetCounts = new Uint32Array(256);
      for (const [y0, y1] of rowBands) for (const [x0, x1] of columnBands) {
        const counts = new Uint32Array(256);
        let left = W, right = -1, top = H, bottom = -1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const color = target[y * W + x];
          if (color === reference.background) continue;
          counts[color]++;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        if (right < 0) continue;
        const dominant = counts.reduce((own, count, index) => count > counts[own] ? index : own, 0);
        const id = cells.length;
        for (let y = top; y <= bottom; y++) cellIds.fill(id, y * W + left, y * W + right + 1);
        for (let color = 0; color < counts.length; color++) if (color !== dominant)
          facetCounts[color] += counts[color];
        cells.push({ x0: left, x1: right, y0: top, y1: bottom, dominant });
      }
      metrics.cells = cells.length;
      if (!cells.length) return result();
      phase("detection");

      // Cache only the most frequent facet colors and the background. Two
      // optional axes for each of eight colors use at most 15.4 MB in total.
      const frequent = [...facetCounts.keys()].filter(color => facetCounts[color])
        .sort((a, b) => facetCounts[b] - facetCounts[a] || a - b)
        .slice(0, MIXED_LIMITS.cacheColors - 1);
      const cacheColors = new Set([reference.background, ...frequent]), prefixes = new Map();
      const pixels = new Uint8Array(N).fill(reference.background), ops = [];
      function footprint(op, visitor) {
        let visits = 0;
        const answer = engine.forFootprint(op, p => { visits++; return visitor(p); });
        metrics.footprintVisits += visits;
        if (metrics.footprintVisits > MIXED_LIMITS.pixels) { metrics.budgetStops++; throw MIXED_BUDGET; }
        return answer;
      }
      function prefix(color, horizontal) {
        const key = `${color}:${horizontal}`, stride = horizontal ? W + 1 : H + 1;
        if (prefixes.has(key)) return prefixes.get(key);
        const data = new Uint16Array((horizontal ? H : W) * stride);
        for (let fixed = 0; fixed < (horizontal ? H : W); fixed++) {
          let count = 0;
          for (let along = 0; along < (horizontal ? W : H); along++) {
            const p = horizontal ? fixed * W + along : along * W + fixed;
            count += target[p] !== reference.background && target[p] !== color;
            data[fixed * stride + along + 1] = count;
          }
        }
        prefixes.set(key, data); metrics.prefixBytes += data.byteLength;
        return data;
      }
      function safe(op, predicate, base = false) {
        if (++metrics.proposals > MIXED_LIMITS.proposals) { metrics.budgetStops++; throw MIXED_BUDGET; }
        if ((op.points || [op.point]).some(([x, y]) => x < 0 || x >= W || y < 0 || y >= H)) return false;
        if (base || !cacheColors.has(op.color)) {
          let answer = true;
          footprint(op, p => { if (!predicate(p)) { answer = false; return false; } });
          return answer;
        }
        const answer = engine.forFootprintRanges(op, (fixed, low, high, horizontal) => {
          if (++metrics.rangeVisits > MIXED_LIMITS.ranges) { metrics.budgetStops++; throw MIXED_BUDGET; }
          const data = prefix(op.color, horizontal), stride = horizontal ? W + 1 : H + 1;
          return data[fixed * stride + high + 1] === data[fixed * stride + low];
        });
        return answer === true;
      }
      function apply(op) {
        footprint(op, p => { pixels[p] = op.color; }); ops.push(op);
      }

      for (let id = 0; id < cells.length; id++) {
        const cell = cells[id], { x0, x1, y0, y1, dominant } = cell;
        const own = [];
        let a = W, b = H, c = -1, d = -1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (target[y * W + x] !== dominant) continue;
          own.push([x, y]); a = Math.min(a, x); c = Math.max(c, x);
          b = Math.min(b, y); d = Math.max(d, y);
        }
        const mx = Math.floor((a + c) / 2), my = Math.floor((b + d) / 2);
        const centers = [[Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)]];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) centers.push([mx + dx, my + dy]);
        let base, baseScore = Infinity;
        for (const point of centers) {
          let distance = 0;
          for (const [x, y] of own) distance = Math.max(distance, (x - point[0]) ** 2 + (y - point[1]) ** 2);
          for (const size of SMALL_FIRST) {
            if (distance >= Math.floor(size / 2) ** 2) continue;
            const op = { kind: "dot", color: dominant, size, point };
            if (!safe(op, p => target[p] === reference.background || cellIds[p] === id, true)) continue;
            let score = 0;
            footprint(op, p => {
              if (target[p] === reference.background) score += rowCounts[(p / W) | 0] && columnCounts[p % W] ? 1 : 0.001;
            });
            if (score < baseScore) { baseScore = score; base = op; }
            break;
          }
        }
        if (!base) return result();
        apply(base);
        const facets = rectangles(target, cell, color => color !== dominant && color !== reference.background);
        facets.sort((a, b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) - (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1));
        for (const facet of facets) {
          let needed = false;
          for (let y = facet.y0; y <= facet.y1 && !needed; y++) for (let x = facet.x0; x <= facet.x1; x++) {
            if (pixels[y * W + x] !== facet.color) { needed = true; break; }
          }
          if (!needed) continue;
          const generated = rectangleOps(facet, p => target[p] === facet.color || target[p] === reference.background);
          if (!generated) return result();
          for (const op of generated) { apply(op); metrics.facetOps++; }
        }
      }
      phase("baseAndFacets");

      function rectangleOps(rectangle, predicate) {
        const width = rectangle.x1 - rectangle.x0 + 1, height = rectangle.y1 - rectangle.y0 + 1;
        const sizes = rectangle.color === reference.background ? SIZES : SMALL_FIRST;
        const x = Math.floor((rectangle.x0 + rectangle.x1) / 2), y = Math.floor((rectangle.y0 + rectangle.y1) / 2);
        for (const size of sizes) {
          const radius = Math.floor(size / 2);
          for (const cx of [x, x - 1, x + 1]) for (const cy of [y, y - 1, y + 1]) {
            const dx = Math.max(Math.abs(cx - rectangle.x0), Math.abs(rectangle.x1 - cx));
            const dy = Math.max(Math.abs(cy - rectangle.y0), Math.abs(rectangle.y1 - cy));
            if (dx * dx + dy * dy >= radius * radius) continue;
            const op = { kind: "dot", color: rectangle.color, size, point: [cx, cy] };
            if (safe(op, predicate)) return [op];
          }
        }
        const horizontal = width >= height;
        const low = horizontal ? rectangle.y0 : rectangle.x0, high = horizontal ? rectangle.y1 : rectangle.x1;
        const lengthLow = horizontal ? rectangle.x0 : rectangle.y0, lengthHigh = horizontal ? rectangle.x1 : rectangle.y1;
        const generated = [];
        for (let position = low; position <= high;) {
          let chosen;
          for (const size of sizes) {
            const radius = Math.floor(size / 2), extent = radius - 1;
            const preferred = Math.min(position + extent, Math.max(position, high - extent)), centers = [preferred];
            for (let shift = 1; shift <= extent; shift++) centers.push(preferred - shift, preferred + shift);
            for (const center of centers) {
              if (center - extent > position || center + extent < position) continue;
              const far = Math.max(Math.abs(position - center), Math.abs(Math.min(high, center + extent) - center));
              let cap = extent;
              while (cap * cap + far * far >= radius * radius) cap--;
              const first = lengthLow + cap, last = lengthHigh - cap;
              if (first > last) continue;
              const points = horizontal ? [[first, center], [last, center]] : [[center, first], [center, last]];
              const op = { kind: "line", color: rectangle.color, size, points };
              if (safe(op, predicate)) { chosen = { op, next: center + extent + 1 }; break; }
            }
            if (chosen) break;
          }
          if (!chosen) return null;
          generated.push(chosen.op); position = chosen.next;
        }
        return generated;
      }

      for (const [low, high] of rowGaps) {
        const generated = rectangleOps({ x0: 0, x1: W - 1, y0: low, y1: high, color: reference.background }, p => target[p] === reference.background);
        if (!generated) return result();
        for (const op of generated) { apply(op); metrics.restoreOps++; }
      }
      for (const [low, high] of columnGaps) {
        const generated = rectangleOps({ x0: low, x1: high, y0: 0, y1: H - 1, color: reference.background }, p => target[p] === reference.background);
        if (!generated) return result();
        for (const op of generated) { apply(op); metrics.restoreOps++; }
      }
      phase("corridors");
      // Pending background pixels are sparse after corridor painting. Spatial
      // buckets score each safe circle using those pixels instead of visiting
      // hundreds of already-correct pixels for every candidate.
      const bucketSize = 40, bucketColumns = Math.ceil(W / bucketSize), bucketRows = Math.ceil(H / bucketSize);
      const pending = Array.from({ length: bucketColumns * bucketRows }, () => []);
      for (let p = 0; p < N; p++) if (target[p] === reference.background && pixels[p] !== target[p]) {
        pending[Math.floor((p / W) / bucketSize) * bucketColumns + Math.floor((p % W) / bucketSize)].push(p);
      }
      function pendingCoverage(op) {
        const [x, y] = op.point, radius = Math.floor(op.size / 2), radiusSquared = radius * radius;
        const x0 = Math.max(0, Math.floor((x - radius + 1) / bucketSize));
        const x1 = Math.min(bucketColumns - 1, Math.floor((x + radius - 1) / bucketSize));
        const y0 = Math.max(0, Math.floor((y - radius + 1) / bucketSize));
        const y1 = Math.min(bucketRows - 1, Math.floor((y + radius - 1) / bucketSize));
        let coverage = 0;
        for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
          for (const p of pending[by * bucketColumns + bx]) {
            if (++metrics.pendingVisits > MIXED_LIMITS.pending) {
              metrics.budgetStops++; throw MIXED_BUDGET;
            }
            if (pixels[p] === target[p]) continue;
            const dx = p % W - x, dy = ((p / W) | 0) - y;
            if (dx * dx + dy * dy < radiusSquared) coverage++;
          }
        }
        return coverage;
      }
      for (const [ya, yb] of rowGaps) for (const [xa, xb] of columnGaps) {
        const mx = Math.floor((xa + xb) / 2), my = Math.floor((ya + yb) / 2);
        let bestCross, bestCoverage = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          for (const size of SIZES) {
            const op = { kind: "dot", color: reference.background, size, point: [mx + dx, my + dy] };
            if (!safe(op, p => target[p] === reference.background)) continue;
            const coverage = pendingCoverage(op);
            if (coverage > bestCoverage) { bestCross = op; bestCoverage = coverage; }
            break;
          }
        }
        if (bestCross && bestCoverage) { apply(bestCross); metrics.restoreOps++; metrics.crossOps++; }
      }
      phase("crossings");

      for (let p = 0; p < N; p++) {
        if (pixels[p] === target[p]) continue;
        if (target[p] !== reference.background) return result();
        const px = p % W, py = (p / W) | 0;
        let bestOp, bestScore = 0;
        for (const size of [6, 4]) {
          const extent = Math.floor(size / 2) - 1;
          for (let dy = -extent; dy <= extent; dy++) for (let dx = -extent; dx <= extent; dx++) {
            const op = { kind: "dot", color: reference.background, size, point: [px + dx, py + dy] };
            let coverage = 0, legal = true;
            footprint(op, point => {
              if (target[point] !== reference.background) { legal = false; return false; }
              if (pixels[point] !== target[point]) coverage++;
            });
            if ((op.point[0] < 0 || op.point[0] >= W || op.point[1] < 0 || op.point[1] >= H)) legal = false;
            if (legal && coverage > bestScore) { bestScore = coverage; bestOp = op; }
          }
        }
        for (const horizontal of [true, false]) for (let shift = -1; shift <= 1; shift++) {
          const center = (horizontal ? py : px) + shift;
          if (center < 1 || center > (horizontal ? H : W) - 2) continue;
          const at = (along, delta) => horizontal ? (center + delta) * W + along : along * W + center + delta;
          const limit = horizontal ? W : H;
          let low = horizontal ? px : py, high = low;
          const legal = along => { for (let delta = -1; delta <= 1; delta++) if (target[at(along, delta)] !== reference.background) return false; return true; };
          if (!legal(low)) continue;
          while (low > 0 && legal(low - 1)) low--;
          while (high < limit - 1 && legal(high + 1)) high++;
          if (high - low < 2) continue;
          const points = horizontal ? [[low + 1, center], [high - 1, center]] : [[center, low + 1], [center, high - 1]];
          const op = { kind: "line", color: reference.background, size: 4, points };
          if (!safe(op, point => target[point] === reference.background)) continue;
          let coverage = 0;
          footprint(op, point => { if (pixels[point] !== target[point]) coverage++; });
          if (coverage / 1.8 > bestScore) { bestScore = coverage / 1.8; bestOp = op; }
        }
        if (!bestOp) return result();
        apply(bestOp); metrics.restoreOps++;
        if (ops.length > reference.commands) return result();
      }
      phase("repairs");
      if (!equal(target, pixels)) return result();
      const replay = engine.rasterize(ops, reference.background, { annotateStarts: true, annotateFills: true });
      if (!equal(target, replay.pixels)) return result();
      const prepared = { ...reference, ...engine.finish(replay.ops, reference.background, reference.sampleWidth, reference.sampleHeight) };
      phase("proof");
      const candidate = globalThis.SG_ULTRA_OPTIMIZER
        ? globalThis.SG_ULTRA_OPTIMIZER.optimize(prepared, { ...engine, forFootprint: footprint }) : prepared;
      phase("pruning");
      if (metrics.budgetStops) return result();
      if (candidate.optimization?.failure) throw new Error(candidate.optimization.failure);
      metrics.candidateCommands = candidate.commands; metrics.candidateMoves = candidate.moves;
      metrics.candidateSeconds = candidate.seconds;
      if (candidate.seconds < reference.seconds || candidate.seconds === reference.seconds && candidate.commands < reference.commands) {
        best = { ...candidate, optimization: reference.optimization }; metrics.selected = true;
      }
    } catch (error) {
      if (error === MIXED_BUDGET) metrics.budgetStops = Math.max(1, metrics.budgetStops);
      else metrics.failure = String(error?.message || error);
    }
    return result();
    function result() {
      return { ...best, mixedEncoding: { ...metrics, encodingMs: Math.round(performance.now() - started), optimizedCommands: best.commands } };
    }
  }
  function encode(reference, engine) {
    const started = performance.now(), mixed = encodeMixed(reference, engine);
    if (mixed.mixedEncoding.selected) {
      const { mixedEncoding, ...plan } = mixed;
      return { ...plan, bandEncoding: { selected: true, cells: mixedEncoding.cells,
        baselineCommands: reference.commands, optimizedCommands: plan.commands,
        pixelDiff: 0, mixedEncoding, encodingMs: Math.round(performance.now() - started) } };
    }
    const partial = encodePartial(reference, engine);
    return { ...partial, bandEncoding: { ...partial.bandEncoding,
      mixedEncoding: mixed.mixedEncoding, encodingMs: Math.round(performance.now() - started) } };
  }
  globalThis.SG_BACKGROUND_BAND_ENCODER = { encode };
})();
