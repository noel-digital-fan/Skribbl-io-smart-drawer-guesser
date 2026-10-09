"use strict";

// Native Ultra Fast brush controls and clipping. No npm dependencies.
//   node scripts/test-ultra-brushes.cjs
//   node scripts/test-ultra-brushes.cjs --source <isolated directory>
// The faithful game mock keeps its 90 Hz input gate and 8 commands/50 ms queue.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { connect, evaluate, launchBrowser } = require("./test-ultra-adjustments.cjs");
const args = process.argv.slice(2), sourceIndex = args.indexOf("--source");
const SOURCE = sourceIndex < 0 ? path.resolve(__dirname, "..") : path.resolve(args[sourceIndex + 1]);
const SIZES = [5,6,8,4,38,40,34,32,36,30,28,26,24,22,20,18,16,14,12,10];

async function probe(sizes, scale, failure) {
  const canvas = document.querySelector("#game-canvas canvas"), context = canvas.getContext("2d");
  canvas.style.width = 800 * scale + "px"; canvas.style.height = 600 * scale + "px";
  const ops = failure ? [{kind:"dot",color:16,size:sizes[0],point:[400,300]}] : sizes.flatMap((size,index) => {
    const color = 1 + index % 25;
    if (scale === 2) return [{kind:"dot",size,color,point:[80 + index % 5 * 150,80 + Math.floor(index / 5) * 140]}];
    return [[0,0],[799,0],[0,599],[799,599]].map(point => ({kind:"dot",size,color,point}));
  });
  if (scale === 2) { canvas.style.width = "800px"; canvas.style.height = "600px"; }
  let expected;
  if (!failure) {
    for (const op of ops) __sim.exec([0,op.color,op.size,...op.point,...op.point]);
    expected = context.getImageData(0,0,800,600).data;
  }
  if (failure === "preview") document.querySelector(".size-preview .icon").remove();
  if (failure === "controls") for (const element of document.querySelectorAll(".sizes .size")) element.remove();
  if (failure === "wheel") canvas.addEventListener("wheel",event => event.stopImmediatePropagation(),true);
  const done = new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error("Brush probe timed out")),10000);
    document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status", event => {
      const status = JSON.parse(event.detail);
      if (status.id === "brushes" && ["done","error"].includes(status.state)) { clearTimeout(timeout); resolve(status); }
    });
  });
  const start = performance.now();
  document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",{detail:JSON.stringify({action:"draw",id:"brushes",word:"testword",speed:"instant",style:"lines",background:0,strokes:[],ops})}));
  const status = await done;
  let differences = 0;
  if (expected) {
    const actual = context.getImageData(0,0,800,600).data;
    for (let i=0;i<actual.length;i++) if (actual[i] !== expected[i]) differences++;
  }
  return {status,differences,commands:__sim.commands.map(command => [...command]),sent:__sim.sent,dropped:__sim.dropped,clears:__sim.clears,errors:__pageErrors,elapsedMs:performance.now()-start};
}

(async () => {
  const gameDirectory = path.join(__dirname,"instant-benchmark");
  const server = http.createServer((request,response) => {
    const name = request.url === "/" ? "mock-game.html" : request.url === "/mock-game.js" ? "mock-game.js" : null;
    if (!name) return response.writeHead(404).end();
    response.setHeader("Content-Type",name.endsWith("js") ? "text/javascript" : "text/html");
    response.end(fs.readFileSync(path.join(gameDirectory,name)));
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  let browser;
  try {
    browser = await launchBrowser();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const run = async (sizes,scale,failure) => {
      const {targetId} = await browser.client.send("Target.createTarget",{url});
      const targets = await (await fetch(`${browser.base}/json/list`)).json();
      const client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
      try {
        for (let i=0;i<200;i++) {
          if (await evaluate(client,"typeof __sim !== 'undefined'")) break;
          await new Promise(resolve => setTimeout(resolve,10));
          assert.notEqual(i,199,"Mock game did not load");
        }
        await evaluate(client,"window.__pageErrors=[];window.addEventListener('error',event=>__pageErrors.push(event.message));window.addEventListener('unhandledrejection',event=>__pageErrors.push(String(event.reason)));const previousError=console.error;console.error=(...args)=>{__pageErrors.push(args.map(String).join(' '));previousError.apply(console,args);};");
        await evaluate(client,fs.readFileSync(path.join(SOURCE,"draw-runner.js"),"utf8"));
        return await evaluate(client,`(${probe.toString()})(${JSON.stringify(sizes)},${scale},${JSON.stringify(failure)})`);
      } finally { client.close(); await browser.client.send("Target.closeTarget",{targetId}); }
    };
    for (const scale of [2,1,0.5]) {
      const result = await run(SIZES,scale,null);
      assert.equal(result.status.state,"done",result.status.message);
      assert.equal(result.differences,0,`CSS scale ${scale}: brush raster changed`);
      assert.equal(result.dropped,0); assert.deepEqual(result.errors,[]);
      const expectedSizes = scale === 2 ? SIZES : SIZES.flatMap(size => [size,size,size,size]);
      assert.deepEqual(result.commands.map(command => command[2]),expectedSizes,"Game received an incorrect brush size");
      assert.equal(result.sent,result.commands.length,"Brush probe finished before queue delivery");
      console.log(`PASS ${scale === 2 ? "isolated transitions" : `corner clipping at ${800*scale}x${600*scale} CSS`}: ${expectedSizes.length} commands, all RGBA bytes match, zero dropped moves`);
    }
    for (const [sizes,failure] of [[[40],"preview"],[[8],"controls"],[[8],"wheel"],[[7],"invalid"],[[3],"invalid"],[[42],"invalid"]]) {
      const result = await run(sizes,1,failure);
      assert.equal(result.status.state,"error",`${failure}: invalid controls or size reported success`);
      assert.equal(result.clears,0,`${failure}: failure cleared the existing drawing`);
      assert.equal(result.commands.length,0,`${failure}: failure painted a command`);
      assert.deepEqual(result.errors,[]);
      console.log(`PASS ${failure}/${sizes[0]}: rejected before Clear`);
    }
  } finally {
    server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child,"exit"),new Promise(resolve => setTimeout(resolve,5000))]);
      const relative = path.relative(os.tmpdir(),browser.profile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-max-test-"))
        fs.rmSync(browser.profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
