"use strict";
// Ultra Fast optimizes its selected region plan. Each accepted change
// must reproduce its complete game raster; no colors, samples or regions are removed.
(() => {
  const WIDTH = 800, HEIGHT = 600, PIXELS = WIDTH * HEIGHT, LOOKAHEAD = 64, CHECKS = 8;

  const firstPoint = (op) => op.kind === "line" ? op.points[0] : op.point;
  const lastPoint = (op) => op.kind === "line" ? op.points[op.points.length - 1] : op.point;

  function counts(plan) {
    let brushOps = 0, dotOps = 0, fillOps = 0, colorChanges = 0, toolChanges = 0, sizeChanges = 0;
    let color = -1, tool = "brush", size = -1, position = [400, 300], cursorDistance = 0;
    let held = false, pointerDowns = 0, pointerUps = 0;
    const selectTool = (next) => { if (tool !== next) { toolChanges++; tool = next; } };
    const press = () => {
      if (held) pointerUps++;
      pointerDowns++;
      held = true;
    };
    const travel = (point) => {
      cursorDistance += Math.hypot(point[0] - position[0], point[1] - position[1]);
      position = point;
    };
    for (const op of plan.ops) {
      if (color !== op.color) { colorChanges++; color = op.color; }
      if (size !== op.size) { sizeChanges++; size = op.size; }
      if (op.kind === "fill") {
        fillOps++;
        selectTool("fill");
        press();
        travel(op.point);
      } else if (op.kind === "dot") {
        dotOps++;
        brushOps++;
        selectTool("brush");
        press();
        travel(op.point);
      } else {
        brushOps++;
        if (op.start === "free" || op.start === "travel") selectTool("fill");
        if (op.start === "travel") { if (!held) press(); }
        else if (op.start !== "continue") press();
        selectTool("brush");
        for (const point of op.points) travel(point);
      }
    }
    if (held) pointerUps++;
    const pointerEvents = pointerDowns + pointerUps + plan.moves;
    return {
      commands: plan.commands,
      moves: plan.moves,
      operations: plan.ops.length,
      brushOps, dotOps, fillOps, colorChanges, toolChanges, sizeChanges,
      pointerDowns, pointerUps, pointerEvents,
      cursorDistance: Math.round(cursorDistance),
      actions: pointerEvents + colorChanges + toolChanges + sizeChanges,
    };
  }

  // A stroke is redundant when every pixel it writes is overwritten later before
  // the next fill. Fills are barriers because their reachable area depends on all
  // preceding pixels. Generations clear coverage in O(1) at each barrier.
  function prune(ops, forFootprint) {
    const covered = new Uint32Array(PIXELS), keep = new Uint8Array(ops.length);
    let generation = 1, removed = 0, visits = 0;
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op.kind === "fill") {
        keep[i] = 1;
        if (++generation === 0x100000000) { covered.fill(0); generation = 1; }
        continue;
      }
      let redundant = true;
      forFootprint(op, (pixel) => {
        visits++;
        if (covered[pixel] !== generation) {
          redundant = false;
          covered[pixel] = generation;
        }
      });
      if (redundant) removed++; else keep[i] = 1;
    }
    return { ops: ops.filter((_, i) => keep[i]), removed, visits };
  }

  function boxes(ops) {
    const result = new Int16Array(ops.length * 4);
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i], base = i * 4;
      if (op.kind === "fill") {
        result.set(op.box, base);
        continue;
      }
      let x0 = WIDTH, y0 = HEIGHT, x1 = -1, y1 = -1;
      const radius = Math.floor(op.size / 2);
      for (const [x, y] of op.points || [op.point]) {
        x0 = Math.min(x0, x - radius); y0 = Math.min(y0, y - radius);
        x1 = Math.max(x1, x + radius); y1 = Math.max(y1, y + radius);
      }
      result.set([x0, y0, x1, y1], base);
    }
    return result;
  }

  // Cursor jumps have no distance-dependent delay in the game. Favor the current
  // color and an existing endpoint, only inside a fixed window of commuting
  // strokes. At most eight dependency checks keep work bounded for dense images.
  function order(ops) {
    const n = ops.length, bounds = boxes(ops), taken = new Uint8Array(n), out = [];
    let previous = null, reordered = 0;
    const commutes = (a, b) => {
      if (ops[a].color === ops[b].color) return true;
      const aa = a * 4, bb = b * 4;
      return bounds[aa + 2] < bounds[bb] || bounds[bb + 2] < bounds[aa]
        || bounds[aa + 3] < bounds[bb + 1] || bounds[bb + 3] < bounds[aa + 1];
    };
    const rank = (op) => {
      const point = firstPoint(op), end = previous && lastPoint(previous);
      return (previous && previous.color === op.color ? 0 : 2)
        + (end && end[0] === point[0] && end[1] === point[1] ? 0 : 1);
    };
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      let chosen = i;
      if (previous && ops[i].kind !== "fill") {
        const headRank = rank(ops[i]);
        let checked = 0, chosenRank = headRank;
        if (headRank > 0) {
          for (let j = i + 1; j < n && j < i + LOOKAHEAD && checked < CHECKS; j++) {
            if (taken[j]) continue;
            if (ops[j].kind === "fill") break;
            const candidateRank = rank(ops[j]);
            if (candidateRank >= chosenRank) continue;
            checked++;
            let safe = true;
            for (let k = i; k < j; k++) {
              if (!taken[k] && !commutes(j, k)) { safe = false; break; }
            }
            if (safe) { chosen = j; chosenRank = candidateRank; }
            if (chosenRank === 0) break;
          }
        }
      }
      taken[chosen] = 1;
      previous = ops[chosen];
      out.push(previous);
      if (chosen !== i) { reordered++; i--; }
    }
    return { ops: out, reordered };
  }

  function better(a, b) {
    const ac = counts(a), bc = counts(b);
    for (const [av, bv] of [
      [a.seconds, b.seconds], [a.commands, b.commands], [a.moves, b.moves],
      [ac.colorChanges, bc.colorChanges], [ac.toolChanges, bc.toolChanges],
      [ac.sizeChanges, bc.sizeChanges], [ac.cursorDistance, bc.cursorDistance],
    ]) {
      if (av !== bv) return av < bv;
    }
    return false;
  }

  function differences(a, b) {
    if (a.length !== b.length) return Math.max(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += a[i] !== b[i];
    return diff;
  }

  function optimize(reference, engine) {
    const started = performance.now(), baseline = counts(reference);
    let chosen = reference, removedOps = 0, attemptedRemovedOps = 0, reorderedOps = 0;
    let footprintVisits = 0, rasterVisits = 0, proposedPixelDiff = 0, failure;
    try {
      const original = engine.rasterize(reference.ops, reference.background);
      // Every later encoder preserves this raster. Keep it in the per-conversion
      // engine, outside the serialized plan, so those stages can reuse it.
      engine.referencePixels = original.pixels;
      rasterVisits += original.visits || 0;
      const pruned = prune(reference.ops, engine.forFootprint);
      attemptedRemovedOps = pruned.removed;
      footprintVisits = pruned.visits;
      const reordered = order(pruned.ops);
      const evaluate = (ops) => {
        const replay = engine.rasterize(ops, reference.background, { annotateStarts: true });
        rasterVisits += replay.visits || 0;
        const diff = differences(original.pixels, replay.pixels);
        proposedPixelDiff += diff;
        if (diff) return null;
        return {
          ...reference,
          ...engine.finish(replay.ops, reference.background, reference.sampleWidth, reference.sampleHeight),
        };
      };
      // Prefer the cheaper transform first; a reorder can lose a free stroke start.
      // Keep the original plan whenever actual reconstructed costs do not improve.
      if (pruned.removed) {
        const candidate = evaluate(pruned.ops);
        if (candidate && better(candidate, chosen)) {
          chosen = candidate;
          removedOps = pruned.removed;
        }
      }
      if (reordered.reordered) {
        const candidate = evaluate(reordered.ops);
        if (candidate && better(candidate, chosen)) {
          chosen = candidate;
          removedOps = pruned.removed;
          reorderedOps = reordered.reordered;
        }
      }
    } catch (error) {
      // An optimizer failure must retain the complete reference, never a partial plan.
      chosen = reference;
      removedOps = 0;
      reorderedOps = 0;
      failure = String(error?.message || error);
    }
    return {
      ...chosen,
      optimization: {
        selected: chosen === reference ? "reference" : "optimized",
        removedOps, attemptedRemovedOps, reorderedOps,
        baselineCommands: reference.commands,
        optimizedCommands: chosen.commands,
        pixelDiff: 0, proposedPixelDiff,
        optimizationMs: Math.round(performance.now() - started),
        footprintVisits, rasterVisits,
        baseline,
        optimized: counts(chosen),
        ...(failure ? { failure } : {}),
      },
    };
  }

  globalThis.SG_ULTRA_OPTIMIZER = { optimize, describe: counts };
})();
