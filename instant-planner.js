"use strict";
// INSTANT planner. It keeps the sample grid of the other speeds, but draws each same-color
// region as the outline that seals it plus one bucket fill instead of one stroke per sample
// run. Every command is simulated against a port of the game's hard brush and flood fill
// (https://skribbl.io/js/game.js), so a fill is only planned when it provably stays inside
// its region.
//
// Throughput limits in game.js: the client forwards 8 commands per 50 ms (160/s) and
// accepts one pointermove per 1000/90 ms. A pointerdown makes one dot or bucket command and
// is not rate-limited. The plan therefore minimizes commands and moves together, and the
// runner starts strokes without a dot command whenever that is cheaper.
(() => {
  const W = 800, H = 600, SEND_RATE = 160, MOVE_RATE = 90, SUPER = 3;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
  const stampCache = new Map(), stampRangeCache = new Map();

  // The game's brush paints a pixel when dx² + dy² < floor(size / 2)².
  function stamp(size) {
    let offsets = stampCache.get(size);
    if (!offsets) {
      const c = Math.floor(size / 2), list = [];
      for (let dy = -c; dy <= c; dy++) for (let dx = -c; dx <= c; dx++) if (dx * dx + dy * dy < c * c) list.push(dx, dy);
      stampCache.set(size, (offsets = Int8Array.from(list)));
    }
    return offsets;
  }

  // Both raster visits and prefix queries use rows derived from the native
  // stamp. Cache their extents once per diameter instead of solving each row
  // of the same circle for every safety proposal.
  function stampRanges(size) {
    let ranges = stampRangeCache.get(size);
    if (!ranges) {
      const radius = Math.floor(size / 2), extents = new Int8Array(radius * 2 - 1);
      const offsets = stamp(size);
      for (let i = 0; i < offsets.length; i += 2) {
        const row = offsets[i + 1] + radius - 1;
        extents[row] = Math.max(extents[row], Math.abs(offsets[i]));
      }
      stampRangeCache.set(size, (ranges = { radius, extents }));
    }
    return ranges;
  }

  // Same Bresenham stepping as the game's line routine; every visited point is stamped.
  function walkSegment(x0, y0, x1, y1, visit) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    if (visit(x0, y0) === false) return false;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = err << 1;
      if (-dy < e2) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if (visit(x0, y0) === false) return false;
    }
    return true;
  }

  // Douglas-Peucker keeps every source point within `tolerance` pixels of the polyline.
  function simplify(points, tolerance) {
    if (points.length <= 2) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]], t2 = tolerance * tolerance;
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = points[a], [bx, by] = points[b], vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
      let worst = -1, index = -1;
      for (let i = a + 1; i < b; i++) {
        const px = points[i][0] - ax, py = points[i][1] - ay;
        const t = len2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0, ex = px - t * vx, ey = py - t * vy;
        const d2 = ex * ex + ey * ey;
        if (d2 > worst) { worst = d2; index = i; }
      }
      if (worst > t2) { keep[index] = 1; stack.push([a, index], [index, b]); }
    }
    return points.filter((_, i) => keep[i]);
  }

  function lab(r, g, b) {
    const n = (t) => ((t /= 255) > 0.04045 ? ((t + 0.055) / 1.055) ** 2.4 : t / 12.92);
    r = n(r); g = n(g); b = n(b);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // Each sample cell takes the palette color with the lowest summed ΔE over a 3x3
  // supersample of its area, rather than the color of the single source pixel that the
  // nearest-neighbor grid happens to hit (often an anti-aliased edge pixel). The grid size
  // and positions are unchanged. Without a readable image the converter's runs are used.
  // Ultra Fast caches the same distances and nearest palette choices; it never changes the sample grid,
  // palette, summation order or winner. Its bounded RGB cache avoids unbounded photo allocations.
  function sampleGrid({ image, palette, runs, width: gw, height: gh, background, nearestColors }, accelerated = false) {
    const grid = new Int16Array(gw * gh).fill(background);
    for (const run of runs) if (run.color >= 0) grid.fill(run.color, run.y * gw + run.start, run.y * gw + run.end + 1);
    if (!image || !palette?.length || typeof document === "undefined") return grid;
    let data;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = gw * SUPER;
      canvas.height = gh * SUPER;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return grid;
    }
    const colors = palette.map((p) => ({ index: p.index, lab: lab(...p.rgb) })), cache = new Map(), rowWidth = gw * SUPER;
    const slots = accelerated ? new Map(colors.map((c, i) => [c.index, i])) : null;
    const subLab = new Float64Array(SUPER * SUPER * 3), subColor = new Int16Array(SUPER * SUPER);
    const entries = accelerated ? [] : null;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let n = 0;
        for (let sy = 0; sy < SUPER; sy++) {
          for (let sx = 0; sx < SUPER; sx++, n++) {
            const o = ((y * SUPER + sy) * rowWidth + x * SUPER + sx) * 4, key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
            let entry = cache.get(key);
            if (!entry) {
              const l = lab(data[o], data[o + 1], data[o + 2]);
              let nearest = accelerated && nearestColors?.has(key) ? slots.get(nearestColors.get(key)) : undefined;
              if (nearest === undefined) {
                nearest = 0;
                let best = Infinity;
                colors.forEach((c, i) => {
                  const d = (l[0] - c.lab[0]) ** 2 + (l[1] - c.lab[1]) ** 2 + (l[2] - c.lab[2]) ** 2;
                  if (d < best) { best = d; nearest = i; }
                });
              }
              if (accelerated && cache.size >= 16384) cache.delete(cache.keys().next().value);
              cache.set(key, (entry = { l, nearest }));
              if (accelerated) entry.distances = new Float64Array(colors.length).fill(NaN);
            }
            subLab[n * 3] = entry.l[0];
            subLab[n * 3 + 1] = entry.l[1];
            subLab[n * 3 + 2] = entry.l[2];
            subColor[n] = entry.nearest;
            if (accelerated) entries[n] = entry;
          }
        }
        let chosen = subColor[(n - 1) >> 1], lowest = Infinity;
        for (let i = 0; i < n; i++) {
          const candidate = subColor[i];
          if (subColor.indexOf(candidate) < i) continue;
          const c = colors[candidate].lab;
          let sum = 0;
          for (let j = 0; j < n; j++) {
            if (accelerated) {
              const distances = entries[j].distances;
              if (Number.isNaN(distances[candidate])) distances[candidate] = Math.hypot(subLab[j * 3] - c[0], subLab[j * 3 + 1] - c[1], subLab[j * 3 + 2] - c[2]);
              sum += distances[candidate];
            } else sum += Math.hypot(subLab[j * 3] - c[0], subLab[j * 3 + 1] - c[1], subLab[j * 3 + 2] - c[2]);
          }
          if (sum < lowest) { lowest = sum; chosen = candidate; }
        }
        grid[y * gw + x] = colors[chosen].index;
      }
    }
    return grid;
  }

  function plan(input) {
    return planUltra(input);
  }

  function planGrid(input, grid, tolerances, moveWeights) {
    const { width: gw, height: gh, background, spacing, offsetX, offsetY, brush } = input;
    const cells = gw * gh, size = brush, accelerated = input.accelerated === true;

    // Cell centers use the same rounding as the other speeds; pixels map to their nearest cell.
    const center = (v, offset, max) => Math.max(0, Math.min(max, Math.round((v + offset) * spacing)));
    const cx = Int16Array.from({ length: gw }, (_, x) => center(x, offsetX, W - 1));
    const cy = Int16Array.from({ length: gh }, (_, y) => center(y, offsetY, H - 1));
    const colCell = Int16Array.from({ length: W }, (_, x) => Math.round(x / spacing - offsetX));
    const rowCell = Int16Array.from({ length: H }, (_, y) => Math.round(y / spacing - offsetY));
    const cellOfPixel = (i) => {
      const x = colCell[i % W], y = rowCell[(i / W) | 0];
      return x >= 0 && x < gw && y >= 0 && y < gh ? y * gw + x : -1;
    };
    const pixelTarget = new Uint8Array(W * H).fill(background);
    for (let y = 0; y < H; y++) {
      const row = rowCell[y];
      if (row < 0 || row >= gh) continue;
      for (let x = 0; x < W; x++) {
        const col = colCell[x];
        if (col >= 0 && col < gw) pixelTarget[y * W + x] = grid[row * gw + col];
      }
    }
    const cellPoint = (c) => [cx[c % gw], cy[(c / gw) | 0]];
    const neighborCenter = (x, y) => {
      const px = Math.round((x + offsetX) * spacing), py = Math.round((y + offsetY) * spacing);
      return px >= 0 && px < W && py >= 0 && py < H ? py * W + px : -1;
    };

    // Eight-connected same-color regions (a one-sample diagonal outline stays one stroke),
    // excluding the background that the runner bucket-fills first.
    const regionOf = new Int32Array(cells).fill(-1), regions = [];
    for (let start = 0; start < cells; start++) {
      if (regionOf[start] >= 0 || grid[start] === background) continue;
      const color = grid[start], list = [start], id = regions.length;
      regionOf[start] = id;
      for (let k = 0; k < list.length; k++) {
        const c = list[k], x = c % gw, y = (c / gw) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, n = ny * gw + nx;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && regionOf[n] < 0 && grid[n] === color) { regionOf[n] = id; list.push(n); }
        }
      }
      let interior = 0;
      for (const c of list) {
        const x = c % gw;
        if (x > 0 && x < gw - 1 && c >= gw && c < cells - gw && regionOf[c - 1] === id && regionOf[c + 1] === id && regionOf[c - gw] === id && regionOf[c + gw] === id) interior++;
      }
      regions.push({ id, color, cells: list, interior });
    }
    // Thin outline regions go first (largest first, so their strokes seal wider neighbors for
    // free); the rest go smallest first, so bucket fills stay available for the large interiors.
    regions.sort((a, b) => (a.interior > 0) - (b.interior > 0) || a.cells.length - b.cells.length);

    // Simulated game canvas (palette indices) with an undo log for rejected attempts.
    const canvas = new Uint8Array(W * H), seen = new Uint32Array(W * H), stack = new Int32Array(W * H);
    const near = new Uint32Array((gw + 2) * (gh + 2));
    const leaky = new Uint32Array(W * H);
    let undo = null, seenGen = 0, nearGen = 0, leakyGen = 0;
    // Packed pixel/index undo entries eliminate two boxed numbers per write in Ultra Fast. The log
    // grows geometrically if a region is painted repeatedly; old modes retain their arrays.
    let undoEntries = accelerated ? new Int32Array(4096) : null, undoLength = 0;
    const packedUndo = accelerated ? {} : null;
    const paint = (i, color) => {
      if (canvas[i] === color) return;
      if (accelerated) input.profile.paintedPixels++;
      if (undo) {
        if (accelerated) {
          if (undoLength === undoEntries.length) {
            const next = new Int32Array(undoEntries.length * 2);
            next.set(undoEntries);
            undoEntries = next;
          }
          undoEntries[undoLength++] = (i << 8) | canvas[i];
        } else undo.push(i, canvas[i]);
      }
      canvas[i] = color;
    };
    const rollback = (log) => {
      if (accelerated) {
        for (let k = undoLength - 1; k >= 0; k--) canvas[undoEntries[k] >>> 8] = undoEntries[k] & 255;
        undoLength = 0;
      } else for (let k = log.length - 2; k >= 0; k -= 2) canvas[log[k]] = log[k + 1];
    };
    const forFootprint = (points, visit) => {
      const offsets = stamp(size);
      for (let k = 1; k < points.length; k++) {
        walkSegment(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1], (x, y) => {
          for (let o = 0; o < offsets.length; o += 2) {
            const px = x + offsets[o], py = y + offsets[o + 1];
            if (px >= 0 && px < W && py >= 0 && py < H) visit(py * W + px);
          }
        });
      }
    };
    // A segment is worth drawing when it paints at least one pixel that should have its color.
    const useful = (a, b, color) => {
      let found = false;
      if (accelerated) visitFootprint({ size, points: [a, b] }, (i) => {
        if (canvas[i] !== color && pixelTarget[i] === color) { found = true; return false; }
      });
      else forFootprint([a, b], (i) => { found ||= canvas[i] !== color && pixelTarget[i] === color; });
      return found;
    };
    const draw = (points, color) => forFootprint(points, (i) => paint(i, color));
    // Flood fill with the game's semantics on a palette-only canvas: 4-connected equal pixels.
    function flood(seed, allowed) {
      const color = canvas[seed], gen = ++seenGen, list = [];
      let top = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
      stack[top++] = seed;
      seen[seed] = gen;
      while (top) {
        const p = stack[--top], x = p % W, y = (p / W) | 0;
        if (accelerated) input.profile.floodPixels++;
        if (allowed && !allowed(p)) {
          // Remember the explored area so other seeds in the same open pocket are skipped.
          for (const q of list) leaky[q] = leakyGen;
          for (let k = 0; k < top; k++) leaky[stack[k]] = leakyGen;
          leaky[p] = leakyGen;
          return null;
        }
        list.push(p);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x > 0 && seen[p - 1] !== gen && canvas[p - 1] === color) { seen[p - 1] = gen; stack[top++] = p - 1; }
        if (x < W - 1 && seen[p + 1] !== gen && canvas[p + 1] === color) { seen[p + 1] = gen; stack[top++] = p + 1; }
        if (y > 0 && seen[p - W] !== gen && canvas[p - W] === color) { seen[p - W] = gen; stack[top++] = p - W; }
        if (y < H - 1 && seen[p + W] !== gen && canvas[p + W] === color) { seen[p + W] = gen; stack[top++] = p + W; }
      }
      return { list, box: [x0, y0, x1, y1] };
    }
    const apply = (op) => {
      if (op.kind === "line") draw(op.points, op.color);
      else if (op.kind === "dot") draw([op.point, op.point], op.color);
      else for (const p of flood(op.point[1] * W + op.point[0]).list) paint(p, op.color);
    };

    // Ordered 8-connected chains through the wall cells, preferring straight continuation.
    function chains(wall) {
      const open = new Set(wall), out = [];
      const nexts = (c) => {
        const x = c % gw, y = (c / gw) | 0, list = [];
        for (let k = 0; k < 8; k++) {
          const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && open.has(ny * gw + nx)) list.push([ny * gw + nx, k]);
        }
        return list;
      };
      const walk = (from) => {
        const path = [];
        let cur = from, dir = -1;
        for (;;) {
          const options = nexts(cur);
          if (!options.length) break;
          const score = ([n, k]) => (k === dir ? -2 : 0) + (k < 4 ? -1 : 0) + nexts(n).length * 0.01;
          options.sort((a, b) => score(a) - score(b));
          [cur, dir] = options[0];
          open.delete(cur);
          path.push(cur);
        }
        return path;
      };
      for (const start of wall.slice().sort((a, b) => nexts(a).length - nexts(b).length)) {
        if (!open.has(start)) continue;
        open.delete(start);
        const forward = walk(start), path = [...walk(start).reverse(), start, ...forward];
        const first = path[0], last = path[path.length - 1];
        if (path.length > 3 && Math.abs((first % gw) - (last % gw)) <= 1 && Math.abs(((first / gw) | 0) - ((last / gw) | 0)) <= 1) path.push(first);
        out.push(path);
      }
      return out;
    }

    // Small enclosed holes (cells not 8-reachable from outside the region's box) are cheaper to
    // fill over and redraw than to outline: an outline ring costs several segments per hole.
    const HOLE_LIMIT = 12, holeCache = new Map(), orderCache = new WeakMap(), fullWallCache = new Map();
    function smallHoles(region) {
      if (holeCache.has(region.id)) return holeCache.get(region.id);
      let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
      for (const c of region.cells) {
        const x = c % gw, y = (c / gw) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const bw = x1 - x0 + 3, bh = y1 - y0 + 3, state = new Uint8Array(bw * bh), queue = [];
      for (const c of region.cells) state[((c / gw | 0) - y0 + 1) * bw + (c % gw) - x0 + 1] = 1;
      for (let i = 0; i < state.length; i++) {
        const x = i % bw, y = (i / bw) | 0;
        if ((x === 0 || y === 0 || x === bw - 1 || y === bh - 1) && !state[i]) { state[i] = 2; queue.push(i); }
      }
      while (queue.length) {
        const i = queue.pop(), x = i % bw, y = (i / bw) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, n = ny * bw + nx;
          if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && !state[n]) { state[n] = 2; queue.push(n); }
        }
      }
      const holes = new Set();
      for (let i = 0; i < state.length; i++) {
        if (state[i]) continue;
        const component = [i];
        state[i] = 3;
        for (let k = 0; k < component.length; k++) {
          const x = component[k] % bw, y = (component[k] / bw) | 0;
          for (const [dx, dy] of DIRS) {
            const n = (y + dy) * bw + x + dx;
            if (!state[n]) { state[n] = 3; component.push(n); }
          }
        }
        if (component.length <= HOLE_LIMIT) for (const h of component) holes.add(((h / bw | 0) - 1 + y0) * gw + (h % bw) - 1 + x0);
      }
      holeCache.set(region.id, holes);
      return holes;
    }

    function planRegions(moveWeight, tolerance) {
      // Commands and rate-limited moves are interchangeable through stroke starts (a dot
      // command or a bucket-tool travel move), so plans are compared on one weighted budget.
      const startCost = Math.min(1, moveWeight);
      const cost = (list) => list.reduce((sum, op) => sum + (op.kind === "line" ? (op.free ? 0 : startCost) + (1 + moveWeight) * (op.points.length - 1) : 1), 0);

      // Horizontal or vertical runs over cells that are still wrong; each run is one stroke or a
      // few dots, whichever is cheaper.
      function runOps(list, color) {
        const wrong = accelerated ? null : list.filter((c) => {
          const [x, y] = cellPoint(c);
          return canvas[y * W + x] !== color;
        });
        const build = (vertical) => {
          const key = (c) => (vertical ? (c % gw) * gh + ((c / gw) | 0) : c);
          const line = (c) => (vertical ? c % gw : (c / gw) | 0);
          let sorted;
          if (accelerated) {
            let orders = orderCache.get(list);
            if (!orders) { orders = {}; orderCache.set(list, orders); }
            const direction = vertical ? "vertical" : "horizontal";
            if (!orders[direction]) orders[direction] = list.slice().sort((a, b) => key(a) - key(b));
            sorted = orders[direction].filter((c) => canvas[cy[(c / gw) | 0] * W + cx[c % gw]] !== color);
          } else sorted = wrong.slice().sort((a, b) => key(a) - key(b));
          const out = [];
          for (let i = 0; i < sorted.length;) {
            let j = i + 1;
            while (j < sorted.length && key(sorted[j]) === key(sorted[j - 1]) + 1 && line(sorted[j]) === line(sorted[i])) j++;
            if (accelerated) {
              if (j - i <= startCost + 1 + moveWeight) for (let k = i; k < j; k++) out.push({ kind: "dot", color, size, point: cellPoint(sorted[k]) });
              else out.push({ kind: "line", color, size, points: [cellPoint(sorted[i]), cellPoint(sorted[j - 1])] });
            } else {
              const pts = sorted.slice(i, j).map(cellPoint);
              if (pts.length <= startCost + 1 + moveWeight) for (const p of pts) out.push({ kind: "dot", color, size, point: p });
              else out.push({ kind: "line", color, size, points: [pts[0], pts[pts.length - 1]] });
            }
            i = j;
          }
          return out;
        };
        if (accelerated ? !list.some((c) => canvas[cy[(c / gw) | 0] * W + cx[c % gw]] !== color) : !wrong.length) return [];
        const h = build(false), v = build(true);
        return cost(v) < cost(h) ? v : h;
      }

      function wallsAndFills(region, fullWalls) {
        const { id, color, cells: list } = region, wall = [], holes = smallHoles(region);
        let wallEntry = accelerated && fullWalls ? fullWallCache.get(id) : null;
        if (!wallEntry) for (const c of list) {
          const x = c % gw, y = (c / gw) | 0;
          for (const [dx, dy] of DIRS.slice(0, 4)) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && (regionOf[ny * gw + nx] === id || holes.has(ny * gw + nx))) continue;
            const p = neighborCenter(nx, ny);
            if (p >= 0 && (fullWalls || canvas[p] === background)) { wall.push(c); break; }
          }
        }
        if (accelerated && fullWalls && !wallEntry) {
          wallEntry = { paths: chains(wall), points: new Map() };
          fullWallCache.set(id, wallEntry);
        }
        const out = [];
        const painted = ([x, y]) => canvas[y * W + x] === color;
        let sourcePoints;
        if (wallEntry) {
          if (!wallEntry.points.has(tolerance)) wallEntry.points.set(tolerance, wallEntry.paths.map((path) => simplify(path.map(cellPoint), tolerance)));
          sourcePoints = wallEntry.points.get(tolerance);
        } else sourcePoints = chains(wall).map((path) => simplify(path.map(cellPoint), tolerance));
        for (const originalPoints of sourcePoints) {
          let points = wallEntry ? originalPoints.slice() : originalPoints;
          // Begin on a pixel that already has the color when possible: the runner then starts the
          // stroke with a bucket press that the game ignores, so the start costs no command.
          const last = points.length - 1, closed = last > 1 && points[0][0] === points[last][0] && points[0][1] === points[last][1];
          if (closed && !painted(points[0])) {
            const k = points.findIndex(painted);
            if (k > 0) points = [...points.slice(k, last), ...points.slice(0, k + 1)];
          } else if (!closed && !painted(points[0]) && painted(points[last])) points.reverse();
          if (points.length === 1) {
            if (useful(points[0], points[0], color)) {
              out.push({ kind: "dot", color, size, point: points[0] });
              draw([points[0], points[0]], color);
            }
            continue;
          }
          let current = null;
          for (let k = 1; k < points.length; k++) {
            if (!useful(points[k - 1], points[k], color)) { current = null; continue; }
            if (!current) {
              const [sx, sy] = points[k - 1];
              out.push((current = { kind: "line", color, size, points: [points[k - 1]], free: canvas[sy * W + sx] === color }));
            }
            current.points.push(points[k]);
            draw([points[k - 1], points[k]], color);
          }
        }
        // Each still-unpainted pocket gets one bucket fill if it cannot escape. Slivers in cells
        // touching the region are tolerated (the outline is accurate to `tolerance` pixels);
        // a pocket reaching any farther cell is not filled, and its samples fall back to runs.
        const gen = ++nearGen;
        leakyGen++;
        for (const c of [...list, ...holes]) {
          const x = c % gw, y = (c / gw) | 0;
          for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) near[(y + dy) * (gw + 2) + x + dx] = gen;
        }
        const allowed = (p) => {
          const x = colCell[p % W], y = rowCell[(p / W) | 0];
          return x >= -1 && x <= gw && y >= -1 && y <= gh && near[(y + 1) * (gw + 2) + x + 1] === gen;
        };
        for (const c of list) {
          const [x, y] = cellPoint(c), seed = y * W + x;
          if (canvas[seed] !== background || leaky[seed] === leakyGen) continue;
          const area = flood(seed, allowed);
          if (!area) continue;
          // Fallback rows (one stroke per sample row) are drawn only if the runner's own
          // containment check rejects this bucket on the live canvas.
          const rows = new Map();
          for (const p of area.list) {
            paint(p, color);
            const cell = cellOfPixel(p);
            if (cell >= 0 && regionOf[cell] === id) {
              const [px, py] = cellPoint(cell);
              if (p === py * W + px) {
                const span = rows.get(py);
                rows.set(py, span ? [Math.min(span[0], px), Math.max(span[1], px)] : [px, px]);
              }
            }
          }
          out.push({ kind: "fill", color, size, point: [x, y], box: area.box, count: area.list.length, rows: [...rows].map(([ry, [a, b]]) => [ry, a, b]) });
        }
        // Small background-colored holes were filled over; one dot or short run restores each.
        // Holes of other colors are redrawn by their own regions, which come later.
        for (const op of [...runOps(list, color), ...runOps([...holes].filter((c) => grid[c] === background), background)]) {
          apply(op);
          out.push(op);
        }
        return out;
      }

      canvas.fill(background);
      const ops = [];
      for (const region of regions) {
        const runsPlan = runOps(region.cells, region.color);
        let chosen = runsPlan, chosenCost = cost(runsPlan);
        // Try walls only where neighbors are still open, and a full outline; keep whichever of
        // those and plain sample runs is cheapest. Attempts are simulated, then rolled back.
        if (runsPlan.length && region.cells.length > 2) {
          for (const fullWalls of [false, true]) {
            undo = accelerated ? packedUndo : [];
            const attempt = wallsAndFills(region, fullWalls), log = undo;
            undo = null;
            rollback(log);
            if (cost(attempt) < chosenCost) { chosen = attempt; chosenCost = cost(attempt); }
          }
        }
        chosen.forEach(apply);
        ops.push(...chosen);
      }
      return ops;
    }

    let best = null;
    // Outline tolerance (pixels) and the relative price of a move are searched; the plan that the
    // game's clock finishes soonest is kept.
    for (const tolerance of tolerances) {
      for (const moveWeight of moveWeights) {
        if (accelerated) input.profile.candidatePlans++;
        const result = { ...finish(schedule(planRegions(moveWeight, tolerance)), background, gw, gh), regions: regions.length };
        if (!best || result.seconds < best.seconds || (result.seconds === best.seconds && result.commands < best.commands)) best = result;
      }
    }
    return best;
  }

  // Exact clipped intervals for the union of circular stamps on an axial line.
  // Prefix-mask queries can inspect one interval instead of every covered pixel.
  function axialFootprintRanges(size, ax, ay, bx, by, visit) {
    const horizontal = ay === by, { radius, extents } = stampRanges(size);
    const low = Math.min(horizontal ? ax : ay, horizontal ? bx : by);
    const high = Math.max(horizontal ? ax : ay, horizontal ? bx : by);
    for (let row = 0; row < extents.length; row++) {
      const delta = row - radius + 1, extent = extents[row];
      const fixed = (horizontal ? ay : ax) + delta;
      if (fixed < 0 || fixed >= (horizontal ? H : W)) continue;
      const first = Math.max(0, low - extent);
      const last = Math.min((horizontal ? W : H) - 1, high + extent);
      if (first <= last && visit(fixed, first, last, horizontal) === false) return false;
    }
    return true;
  }

  function visitFootprintRanges(op, visit) {
    const points = op.points || (op.point && [op.point, op.point]);
    if (op.kind === 'fill' || !points || points.length !== 2) return null;
    const [[ax, ay], [bx, by]] = points;
    if (ax !== bx && ay !== by) return null;
    return axialFootprintRanges(op.size, ax, ay, bx, by, visit);
  }

  // A common hard-brush raster is shared by planning and the lossless optimizer. A false
  // visitor result short-circuits predicates; no approximation or geometry reversal is used.
  function visitFootprint(op, visit) {
    const points = op.points || [op.point, op.point], offsets = stamp(op.size);
    for (let k = 1; k < points.length; k++) {
      const [ax, ay] = points[k - 1], [bx, by] = points[k];
      // A straight hard-brush stroke is a union of overlapping stamps. Visit
      // each pixel of that union once; long wide lines otherwise visit the
      // same pixels hundreds of times. Bresenham axial lines are exact here.
      if (ax === bx || ay === by) {
        const horizontal = ay === by, { radius, extents } = stampRanges(op.size);
        const low = Math.min(horizontal ? ax : ay, horizontal ? bx : by);
        const high = Math.max(horizontal ? ax : ay, horizontal ? bx : by);
        for (let row = 0; row < extents.length; row++) {
          const fixed = (horizontal ? ay : ax) + row - radius + 1, extent = extents[row];
          if (fixed < 0 || fixed >= (horizontal ? H : W)) continue;
          const first = Math.max(0, low - extent);
          const last = Math.min((horizontal ? W : H) - 1, high + extent);
          for (let along = first; along <= last; along++) {
            const pixel = horizontal ? fixed * W + along : along * W + fixed;
            if (visit(pixel) === false) return false;
          }
        }
        continue;
      }
      const complete = walkSegment(...points[k - 1], ...points[k], (x, y) => {
        for (let n = 0; n < offsets.length; n += 2) {
          const px = x + offsets[n], py = y + offsets[n + 1];
          if (px >= 0 && px < W && py >= 0 && py < H && visit(py * W + px) === false) return false;
        }
      });
      if (complete === false) return false;
    }
    return true;
  }

  // Only palette-index pixels exist in this simulation. All game palette colors differ by
  // more than its RGB tolerance, so a bucket visits four-connected equal indices. Typed
  // workspaces are allocated once for a replay, rather than arrays of neighbors per pixel.
  function rasterizeOps(ops, background, { annotateStarts = false, annotateFills = false } = {}) {
    const pixels = new Uint8Array(W * H).fill(background), seen = new Uint32Array(W * H);
    const stack = new Int32Array(W * H), replay = [];
    let generation = 0, visits = 0;
    for (const original of ops) {
      const op = { ...original };
      if (op.kind !== 'fill') {
        if (op.kind === 'line' && annotateStarts) {
          const [x, y] = op.points[0];
          op.free = pixels[y * W + x] === op.color;
        }
        visitFootprint(op, (p) => { visits++; pixels[p] = op.color; });
      } else {
        const first = op.point[1] * W + op.point[0], color = pixels[first], mark = ++generation;
        if (color !== op.color) {
          let top = 0, count = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
          stack[top++] = first;
          seen[first] = mark;
          while (top) {
            const p = stack[--top], x = p % W;
            visits++;
            if (annotateFills) {
              const y = (p / W) | 0;
              count++;
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            pixels[p] = op.color;
            if (x && seen[p - 1] !== mark && pixels[p - 1] === color) { seen[p - 1] = mark; stack[top++] = p - 1; }
            if (x < W - 1 && seen[p + 1] !== mark && pixels[p + 1] === color) { seen[p + 1] = mark; stack[top++] = p + 1; }
            if (p >= W && seen[p - W] !== mark && pixels[p - W] === color) { seen[p - W] = mark; stack[top++] = p - W; }
            if (p < W * (H - 1) && seen[p + W] !== mark && pixels[p + W] === color) { seen[p + W] = mark; stack[top++] = p + W; }
          }
          // Changed paint order can change a retained fill's component even when later
          // overpainting restores the same final raster. Match the live runner's exact guard.
          if (annotateFills) { op.box = [x0, y0, x1, y1]; op.count = count; op.exact = true; op.rows = []; }
        } else if (annotateFills) continue;
      }
      replay.push(op);
    }
    return { pixels, ops: replay, visits };
  }

  function planUltra(input) {
    if (!globalThis.SG_ULTRA_OPTIMIZER) throw new Error('Ultra Fast is unavailable. Reload the extension and game page.');
    const started = performance.now(), grid = sampleGrid(input, true), sampledAt = performance.now();
    const profile = { paintedPixels: 0, floodPixels: 0, candidatePlans: 0 };
    // Keep every candidate, tolerance, color and tie-break of Ultra Fast. Optimized data
    // structures accelerate this reference search; a quick candidate is not equivalent.
    const reference = planGrid({ ...input, accelerated: true, profile }, grid, [1, 1.5], [0.25, 0.6, 1, 1.8]);
    const plannedAt = performance.now();
    const engine = { rasterize: rasterizeOps, forFootprint: visitFootprint,
      forFootprintRanges: visitFootprintRanges, finish };
    const optimized = globalThis.SG_ULTRA_OPTIMIZER.optimize(reference, engine);
    const encoded = globalThis.SG_EXACT_RASTER_ENCODER
      ? globalThis.SG_EXACT_RASTER_ENCODER.encode(optimized, engine) : optimized;
    const banded = globalThis.SG_BACKGROUND_BAND_ENCODER
      ? globalThis.SG_BACKGROUND_BAND_ENCODER.encode(encoded, engine) : encoded;
    const result = globalThis.SG_EXACT_RASTER_ENCODER?.refine
      ? globalThis.SG_EXACT_RASTER_ENCODER.refine(banded, engine) : banded;
    const ended = performance.now(), preprocessMs = ended - started;
    const metrics = {
      sourcePixels: input.sourcePixels || input.image?.width * input.image?.height || grid.length,
      sampledPixels: grid.length, supersamplePixels: input.image ? grid.length * SUPER * SUPER : 0,
      rasterPixels: W * H, regions: reference.regions, paletteColors: input.palette.length,
      samplingMs: sampledAt - started, regionPlanningMs: plannedAt - sampledAt,
      preprocessMs, ...profile,
      ...result.optimization,
      pruningMs: result.optimization.optimizationMs,
      optimizationMs: ended - plannedAt,
      ...(result.encoding ? { encoding: result.encoding } : {}),
      ...(result.bandEncoding ? { bandEncoding: result.bandEncoding } : {}),
      optimizedCommands: result.commands,
      optimized: globalThis.SG_ULTRA_OPTIMIZER.describe(result),
    };
    return { ...result, style: 'instant', changed: 0, quality: 'ultra-fast-exact',
      planMs: Math.round(preprocessMs), metrics };
  }

  const MOVE_MS = 1000 / MOVE_RATE + 0.25, TICK_MS = 50, PER_TICK = 8, FILL_MS = 3, SETUP_MS = 150;
  function footprint(op) {
    if (op.kind === "fill") return [op.box[0] - 1, op.box[1] - 1, op.box[2] + 1, op.box[3] + 1];
    const r = Math.floor(op.size / 2), box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of op.points || [op.point]) {
      box[0] = Math.min(box[0], x - r); box[1] = Math.min(box[1], y - r);
      box[2] = Math.max(box[2], x + r); box[3] = Math.max(box[3], y + r);
    }
    return box;
  }
  // Two operations commute when the canvas does not depend on their order: disjoint footprints,
  // or two strokes of the same color.
  const commutes = (a, boxA, b, boxB) => (a.kind !== "fill" && b.kind !== "fill" && a.color === b.color) || boxA[2] < boxB[0] || boxB[2] < boxA[0] || boxA[3] < boxB[1] || boxB[3] < boxA[1];

  // The game forwards 160 commands per second, but a polyline produces only one command per
  // move (90 per second). Before each polyline, pull later dots and fills that commute with every
  // operation they skip, so the send queue does not run dry while lines are drawn.
  function schedule(ops) {
    const n = ops.length, boxes = ops.map(footprint), taken = new Uint8Array(n), out = [], WINDOW = 160;
    let queue = 0;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      const op = ops[i];
      if (op.kind === "line") {
        const segments = op.points.length - 1, deficit = (segments * MOVE_MS * SEND_RATE) / 1000 - segments;
        const skipped = [i];
        for (let j = i + 1; j < n && j < i + WINDOW && queue < deficit; j++) {
          if (taken[j]) continue;
          if (ops[j].kind !== "line" && skipped.every((k) => commutes(ops[j], boxes[j], ops[k], boxes[k]))) {
            taken[j] = 1;
            out.push(ops[j]);
            queue++;
          } else skipped.push(j);
        }
        queue = Math.max(0, queue - deficit);
      } else queue++;
      taken[i] = 1;
      out.push(op);
    }
    return out;
  }

  // Replays a plan on the game's clock: moves at least 1000/90 ms apart, other operations at once
  // (a fill takes a few ms), and queued commands forwarded 8 per 50 ms tick.
  // With `choose`, each open start is decided on the way: a travel move when commands are already
  // waiting to be sent (the queue absorbs the move's time), otherwise a dot command.
  function timeline(ops, background, choose) {
    const produced = background ? [0] : [];
    let t = 0, lastMove = -Infinity, moves = 0, tick = 0, sent = 0;
    const move = () => { t = Math.max(t, lastMove + MOVE_MS); lastMove = t; moves++; };
    const drain = (limit) => {
      for (; tick + TICK_MS <= limit && sent < produced.length; tick += TICK_MS)
        for (let k = 0; k < PER_TICK && sent < produced.length && produced[sent] <= tick + TICK_MS; k++) sent++;
    };
    for (const op of ops) {
      if (op.kind === "fill") { produced.push(t); t += FILL_MS; continue; }
      if (op.kind === "dot") { produced.push(t); continue; }
      if (choose && (op.start === "dot" || op.start === "travel")) {
        drain(Math.max(t, lastMove + MOVE_MS));
        op.start = produced.length - sent >= 2 ? "travel" : "dot";
      }
      if (op.start === "dot") produced.push(t);
      else if (op.start === "travel") move();
      for (let k = 1; k < op.points.length; k++) { move(); produced.push(t); }
    }
    drain(Infinity);
    return { seconds: (SETUP_MS + tick) / 1000, commands: produced.length, moves };
  }

  function finish(ops, background, gw, gh) {
    // Starts: continuing from the previous end point, or pressing the bucket on a pixel that
    // already has the stroke color, costs nothing. Other starts cost a dot command or a
    // bucket-tool travel move; the mix that the timeline finishes soonest is kept.
    let position = null;
    const open = [];
    for (const op of ops) {
      if (op.kind === "line") {
        const [sx, sy] = op.points[0];
        op.start = position && position[0] === sx && position[1] === sy ? "continue" : op.free ? "free" : "dot";
        if (op.start === "dot") open.push(op);
        position = op.points[op.points.length - 1];
      } else position = op.point;
      delete op.free;
    }
    const assign = (travel) => open.forEach((op, i) => { op.start = Math.floor(((i + 1) * travel) / open.length) > Math.floor((i * travel) / open.length) ? "travel" : "dot"; });
    let best = null;
    for (const step of [0, 2, 4, 6, 8, -1]) {
      assign(step < 0 ? 0 : Math.round((open.length * step) / 8));
      const result = timeline(ops, background, step < 0);
      if (!best || result.seconds < best.seconds) best = { ...result, starts: open.map((op) => op.start) };
    }
    open.forEach((op, i) => { op.start = best.starts[i]; });
    return {
      style: "instant",
      background,
      strokes: [],
      ops,
      sampleWidth: gw,
      sampleHeight: gh,
      brushes: [...new Set(ops.filter((op) => op.size).map((op) => op.size))],
      commands: best.commands,
      moves: best.moves,
      seconds: Math.ceil(best.seconds * 10) / 10,
    };
  }

  globalThis.SG_INSTANT_PLANNER = { plan };
})();
