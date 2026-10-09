"use strict";

// Benchmarks the real image converter against generated fixtures. The canvas
// shim implements only the nearest-neighbor draw/read operations the converter
// uses, so timings measure conversion. Draw time is the converter's model of
// local pacing and game input throughput; it is not a live game acknowledgement.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");


const paletteRgb = [
  [255, 255, 255], [0, 0, 0], [193, 193, 193], [80, 80, 80],
  [239, 19, 11], [116, 11, 7], [255, 113, 0], [194, 56, 0],
  [255, 228, 0], [232, 162, 0], [0, 204, 0], [0, 70, 25],
  [0, 255, 145], [0, 120, 93], [0, 178, 255], [0, 86, 158],
  [35, 31, 211], [14, 8, 101], [163, 0, 186], [85, 0, 105],
  [223, 105, 167], [135, 53, 84], [255, 172, 142], [204, 119, 77],
  [160, 82, 45], [99, 48, 13],
].map((rgb, index) => ({ index, rgb }));

const converter = require("./test-ultra-adjustments.cjs").converter(path.resolve(__dirname, ".."));

function fixture(name, width, height, colorAt) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = paletteRgb[colorAt(x, y)].rgb;
      const offset = (y * width + x) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = 255;
    }
  }
  return { name, width, height, pixels };
}

const fixtures = [
  fixture("simple silhouette", 800, 600, (x, y) =>
    x > 225 && x < 575 && y > 120 && y < 485 ? 16 : 0),
  fixture("large filled regions", 800, 600, (x, y) =>
    x < 190 || x > 610 ? 0 : y < 105 || y > 495 ? 8 : 14),
  fixture("many colors", 800, 600, (x, y) => ((x >> 5) + (y >> 5) * 3) % 26),
  fixture("fine checker detail", 800, 600, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 16 : 0),
  fixture("disconnected marks", 800, 600, (x, y) =>
    (x % 37 < 8 && y % 31 < 7) ? (1 + Math.floor(x / 37 + y / 31) % 25) : 0),
  fixture("complex palette noise", 800, 600, (x, y) =>
    ((Math.imul(x + 1, 2654435761) ^ Math.imul(y + 1, 2246822519)) >>> 0) % 26),
  fixture("wide color bands", 800, 600, (x) => 1 + Math.floor(x / 60) % 13),
];

const options = { brush: 4, style: "lines", smartDots: true };
console.log("Fixture                         Fastest ops         INSTANT brushes / ops / ms       Strategy   Draw est.");
console.log("-".repeat(88));
for (const image of fixtures) {
  const results = {};
  for (const speed of ["fast", "instant"]) {
    const started = performance.now();
    const output = converter.convert(image, paletteRgb, { ...options, speed });
    results[speed] = { ...output, conversionMs: performance.now() - started };
  }
  const fast = results.fast;
  const instant = results.instant;
  if (instant.brushes.some((brush) => brush !== 5 && (!Number.isInteger(brush) || brush < 4 || brush > 40 || brush % 2 !== 0))) {
    throw new Error(`INSTANT used an unavailable brush for ${image.name}`);
  }
  const fastText = `${fast.commands} ops / ${fast.conversionMs.toFixed(1)} ms`;
  const instantText = `${(instant.brushes.join("/") || "none")}px · ${instant.commands} ops / ${instant.conversionMs.toFixed(1)} ms`;
  console.log(`${image.name.padEnd(31)} ${fastText.padEnd(19)} ${instantText.padEnd(27)} ${(instant.style || "lines").padEnd(10)} ${instant.seconds}s (model)`);
  console.log(`  grid ${instant.sampleWidth}x${instant.sampleHeight}; segments ${instant.moves ?? instant.strokes.reduce((sum, stroke) => sum + Math.max(1, stroke.points.length - 1), 0)}, fills ${(instant.ops || instant.strokes).filter(stroke => stroke.kind === "fill" || stroke.tool === "fill").length}, fallback strokes ${instant.strokes.filter(stroke => stroke.fallbackFor !== undefined).length}`);
}
console.log("Draw estimates model local event pacing, not live-game or network completion.");
