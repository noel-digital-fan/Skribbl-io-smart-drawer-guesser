// Fidelity of the game canvas against the source image, inside the fitted image rectangle
// only (margins are not part of the image). matchPct: pixels equal to the source pixel's
// nearest palette color. meanDE: mean CIELAB ΔE76 between canvas and source. floorDE: the
// same for the palette-quantized source itself (best achievable with the 26 colors).
function measureFidelity(bitmap, palette) {
  const ref = document.createElement("canvas"); ref.width = 800; ref.height = 600;
  const rc = ref.getContext("2d"); rc.fillStyle = "#fff"; rc.fillRect(0, 0, 800, 600);
  const s = Math.min(800 / bitmap.width, 600 / bitmap.height), w = bitmap.width * s, h = bitmap.height * s;
  const x0 = Math.ceil((800 - w) / 2), y0 = Math.ceil((600 - h) / 2), x1 = Math.floor((800 + w) / 2), y1 = Math.floor((600 + h) / 2);
  rc.imageSmoothingQuality = "high"; rc.drawImage(bitmap, (800 - w) / 2, (600 - h) / 2, w, h);
  const src = rc.getImageData(0, 0, 800, 600).data;
  const out = document.querySelector("#game-canvas canvas").getContext("2d").getImageData(0, 0, 800, 600).data;
  const lab = (r, g, b) => { const n = (t) => ((t /= 255) > 0.04045 ? ((t + 0.055) / 1.055) ** 2.4 : t / 12.92); r = n(r); g = n(g); b = n(b); let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883; const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); x = f(x); y = f(y); z = f(z); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; };
  const pl = palette.map((p) => ({ ...p, lab: lab(...p.rgb) }));
  const cache = new Map(), labCache = new Map();
  const L = (r, g, b) => { const k = (r << 16) | (g << 8) | b; let v = labCache.get(k); if (!v) labCache.set(k, (v = lab(r, g, b))); return v; };
  const quant = (r, g, b) => { const k = (r << 16) | (g << 8) | b; let v = cache.get(k); if (v) return v; const l = L(r, g, b); let best = pl[0], bd = 1e9; for (const p of pl) { const d = (l[0] - p.lab[0]) ** 2 + (l[1] - p.lab[1]) ** 2 + (l[2] - p.lab[2]) ** 2; if (d < bd) { bd = d; best = p; } } cache.set(k, best); return best; };
  let match = 0, de = 0, deFloor = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * 800 + x) * 4;
    const q = quant(src[i], src[i + 1], src[i + 2]);
    if (q.rgb[0] === out[i] && q.rgb[1] === out[i + 1] && q.rgb[2] === out[i + 2]) match++;
    const a = L(src[i], src[i + 1], src[i + 2]), o = L(out[i], out[i + 1], out[i + 2]);
    de += Math.hypot(a[0] - o[0], a[1] - o[1], a[2] - o[2]);
    deFloor += Math.hypot(a[0] - q.lab[0], a[1] - q.lab[1], a[2] - q.lab[2]);
    n++;
  }
  return { matchPct: (100 * match) / n, meanDE: de / n, floorDE: deFloor / n };
}
