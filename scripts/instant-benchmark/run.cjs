"use strict";
// End-to-end Auto Draw benchmark in a real browser against mock-game.html, a port of the drawing
// code of https://skribbl.io/js/game.js (90 Hz move gate, hard brush, bucket, and the
// 8-commands-per-50 ms send queue). It runs the extension's own converter and MAIN-world runner.
//
//   npm install --no-save puppeteer-core
//   node scripts/instant-benchmark/run.cjs [--speed instant] [--style lines] [--brush 4] [--out dir] image ...
//
// Set BROWSER to a Chrome or Edge executable if neither default path exists. Reported times:
// "local" is when the runner reported completion, "network" when the mock game forwarded the last
// command, which is what other players wait for. Fidelity is measured inside the image rectangle
// (metric.js). Live multiplayer timing still depends on the network.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const puppeteer = require("puppeteer-core");

const args = process.argv.slice(2), option = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const speed = option("speed", "instant"), style = option("style", "lines"), brush = option("brush", "4"), outDir = option("out", null);
const images = args;
if (!images.length) throw new Error("Pass one or more image files.");
const root = path.join(__dirname, "..", "..");
const browserPath = process.env.BROWSER || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!browserPath) throw new Error("No browser found; set BROWSER.");
if (outDir) fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  for (const file of images) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800 });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(pathToFileURL(path.join(__dirname, "mock-game.html")).href);
    for (const f of ["background-band-encoder.js", "ultra-optimizer.js", "exact-raster-encoder.js", "instant-planner.js", "image-converter.js", "draw-runner.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, f), "utf8") });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "metric.js"), "utf8") });
    const type = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
    const dataUrl = `data:image/${type};base64,` + fs.readFileSync(file).toString("base64");
    const r = await page.evaluate(async (dataUrl, speed, style, brush) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const bitmap = await createImageBitmap(img);
      const palette = Array.from(document.querySelectorAll("#game-toolbar .colors .color")).map((el) => ({ index: el.colorIndex, rgb: getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number) }));
      const t0 = performance.now();
      const plan = SG_IMAGE_CONVERTER.convert(bitmap, palette, { style, brush, speed, smartDots: true });
      const planMs = performance.now() - t0;
      const done = new Promise((resolve) => document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status", (e) => {
        const d = JSON.parse(e.detail);
        if (d.id === "bench" && (d.state === "done" || d.state === "error")) resolve(d);
      }));
      const t1 = performance.now();
      // Same request shape as auto-draw.js.
      document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request", { detail: JSON.stringify({ action: "draw", id: "bench", word: "testword", background: plan.background, strokes: plan.strokes, ...(plan.ops ? { ops: plan.ops } : {}), speed, style, smartDots: true }) }));
      const status = await done;
      const localMs = performance.now() - t1;
      while (__sim.sent < __sim.commands.length) await new Promise((r) => setTimeout(r, 20));
      const networkMs = (__sim.sends.length ? __sim.sends[__sim.sends.length - 1].at : t1) - t1;
      return { status: status.state, message: status.message, planMs, localMs, networkMs, commands: __sim.commands.length, moves: __sim.moves, dropped: __sim.dropped, estimate: plan.seconds, ...measureFidelity(bitmap, palette), png: document.querySelector("#game-canvas canvas").toDataURL("image/png") };
    }, dataUrl, speed, style, brush);
    if (outDir) fs.writeFileSync(path.join(outDir, path.basename(file).replace(/\.\w+$/, "") + `-${speed}-${style}-${brush}.png`), Buffer.from(r.png.split(",")[1], "base64"));
    console.log(`${path.basename(file).padEnd(22)} ${r.status.padEnd(5)} plan ${r.planMs.toFixed(0).padStart(4)} ms  local ${(r.localMs / 1000).toFixed(2).padStart(6)} s  network ${(r.networkMs / 1000).toFixed(2).padStart(6)} s  estimate ${String(r.estimate).padStart(5)} s  commands ${String(r.commands).padStart(5)}  moves ${String(r.moves).padStart(5)} (dropped ${r.dropped})  match ${r.matchPct.toFixed(2)}%  ΔE ${r.meanDE.toFixed(2)} (palette floor ${r.floorDE.toFixed(2)})${r.status === "done" ? "" : "  " + r.message}`);
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
