"use strict";

// Dependency-free native-browser comparison. Run before and after an edit:
// node scripts/benchmark-ultra.cjs --source <directory> --out <report.json>
// --reference <report.json> compares Ultra Fast to a saved completed raster.
// --reference-speed max selects the optimized strategy from before its migration.
// --fixtures simple,portrait,multicolor,fractured,detail,windows selects deterministic inputs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { connect, evaluate, launchBrowser, fixture, RGB } = require("./test-ultra-adjustments.cjs");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
}
const SOURCE = path.resolve(option("source", ROOT));
const OUT = option("out", null), REFERENCE = option("reference", null);
const NAMES = option("fixtures", "simple,portrait,multicolor,fractured,detail").split(",");
const SPEEDS = option("speeds", "instant").split(",");
const REFERENCE_SPEED = option("reference-speed", "max");
if (args.includes("--assert-equal") && !REFERENCE) throw new Error("--assert-equal requires --reference before.json; choose its speed with --reference-speed (default: max, the pre-migration optimized plan).");
const IMAGE_DIRECTORY = option("artifacts", null);

function benchmarkFixture(name, rgb, original) {
  if (name === "simple" || name === "portrait") return original(name === "portrait" ? "face" : name, rgb);
  const width = 800, height = 600, pixels = new Uint8ClampedArray(width * height * 4);
  const colorAt = (x,y) => {
    if (name === "multicolor") return x < 80 || x > 720 || y < 80 || y > 520 ? 0 : 1 + Math.floor((x - 80) / 64) % 25;
    if (name === "fractured") return x % 40 >= 8 && x % 40 < 27 && y % 40 >= 8 && y % 40 < 27 ? 1 + (Math.floor(x / 40) + 3 * Math.floor(y / 40)) % 25 : 0;
    if (name === "detail") {
      if (x >= 200 && x < 600 && y >= 160 && y < 440) {
        if (x % 31 < 5 && y % 29 < 5) return 1 + (Math.floor(x/31) + Math.floor(y/29)) % 25;
        if (Math.abs(y - 0.35*x - 140) < 2.5) return 1;
        return 2;
      }
      return 0;
    }
    throw new Error("Unknown fixture " + name);
  };
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    let c;
    if(name==="windows"){
      // A photo-like facade uses continuous RGB tones rather than palette-index
      // input. It tests quantization caches, reflections and many closed regions.
      if(y>=555)c=[90+Math.floor(x/40),95+Math.floor(y/30),85+Math.floor(x/60)];
      else if(x>=155&&x<=680&&y>=85){
        const wx=(x-170)%70,wy=(y-100)%75;
        if(wx>=12&&wx<45&&wy>=12&&wy<52)c=wy<15?[210,220,226]:[40+Math.floor(y*.07),85+Math.floor(x*.06),135+Math.floor(y*.08)];
        else {const grain=((Math.imul(x+1,2654435761)^Math.imul(y+1,2246822519))>>>0)%5-2;c=[230-Math.floor(y*.035)+grain,218-Math.floor(y*.025)+grain,200-Math.floor(y*.018)+grain];}
      }else c=[145+Math.floor(x*.035),190+Math.floor(y*.025),232];
    }else c=rgb[colorAt(x,y)];
    pixels[i]=c[0];pixels[i+1]=c[1];pixels[i+2]=c[2];pixels[i+3]=255;
  }
  return{name,width,height,pixels};
}

function inspectPlan(plan) {
  const byKind={line:0,dot:0,fill:0}, brushes={};
  for(const op of plan.ops||[]) { byKind[op.kind]++; brushes[op.size]=(brushes[op.size]||0)+1; }
  // Earliest legal delivery allows the first send tick and first move at time 0.
  // This bound describes this plan, independently of CPU and rendering overhead.
  const throughputFloorMs=Math.max(Math.max(0,Math.ceil(plan.commands/8)-1)*50,Math.max(0,plan.moves-1)*1000/90);
  return{ops:plan.ops?.length||0,byKind,brushes,commands:plan.commands,moves:plan.moves,seconds:plan.seconds,throughputFloorMs,sampleWidth:plan.sampleWidth,sampleHeight:plan.sampleHeight,sampledPixels:plan.sampleWidth*plan.sampleHeight,background:plan.background,changed:plan.changed||0,optimization:plan.optimization||null,encoding:plan.encoding||null,bandEncoding:plan.bandEncoding||null,metrics:plan.metrics||null};
}

function rasterRegions(pixels, background) {
  const width=800,height=600,cells=width*height,seen=new Uint8Array(cells),queue=new Int32Array(cells);
  let foregroundRegions=0,totalRegions=0;
  for(let seed=0;seed<cells;seed++){
    if(seen[seed])continue;
    const at=seed*4,r=pixels[at],g=pixels[at+1],b=pixels[at+2];
    totalRegions++;if(r!==background[0]||g!==background[1]||b!==background[2])foregroundRegions++;
    let head=0,tail=1;queue[0]=seed;seen[seed]=1;
    while(head<tail){const p=queue[head++],x=p%width,y=(p/width)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy,n=ny*width+nx;if(nx<0||nx>=width||ny<0||ny>=height||seen[n])continue;
        const k=n*4;if(pixels[k]===r&&pixels[k+1]===g&&pixels[k+2]===b){seen[n]=1;queue[tail++]=n;}
      }
    }
  }
  return{totalRegions,foregroundRegions};
}

function summarize(before, after) {
  const compact = (result) => {
    if (!result) return null;
    const { pixels, png, ...data } = result;
    return data;
  };
  const names = [...new Set(after.results.map((result) => result.name))];
  return {
    method: "Native Chromium browser, deterministic 800x600 palette fixtures, unchanged mock 90 Hz move gate and 8 commands/50ms queue. Raster equality compares all RGBA pixels with the completed baseline Ultra Fast drawing.",
    timing: "ImageBitmap decoding is reported separately when imageLoadMs is present; early Canvas measurements excluded it. PNG generation and fixture construction are excluded. Execution includes actual mock queue drain, not remote-player acknowledgement.",
    cases: names.map((name) => ({
      fixture: name,
      beforeUltra: compact(before.results.find((result) => result.name === name && result.speed === "instant")),
      beforeMax: compact(before.results.find((result) => result.name === name && result.speed === "max")),
      afterUltra: compact(after.results.find((result) => result.name === name && result.speed === "instant")),
      afterMax: compact(after.results.find((result) => result.name === name && result.speed === "max")),
    })),
  };
}

function hooks() {
  const canvas=document.querySelector("#game-canvas canvas"),toolbar=document.querySelector("#game-toolbar"),context=canvas.getContext("2d");
  const metrics={pointerdown:0,pointermove:0,pointerup:0,pointercancel:0,wheel:0,colorSelections:0,colorChanges:0,sizeSelections:0,sizeChanges:0,toolSelections:0,toolChanges:0,clear:0,rectReads:0,captureWrites:0,readCalls:0,readPixels:0,readMs:0};
  let color=1,size=4,tool="Brush";
  for(const kind of ["pointerdown","pointermove","pointerup","pointercancel","wheel"])canvas.addEventListener(kind,()=>metrics[kind]++,true);
  toolbar.addEventListener("pointerdown",event=>{const el=event.target.closest(".color");if(el){metrics.colorSelections++;if(el.colorIndex!==color){metrics.colorChanges++;color=el.colorIndex;}}},true);
  toolbar.addEventListener("click",event=>{
    const el=event.target.closest(".tool,.size");if(!el)return;
    if(el.classList.contains("size")){metrics.sizeSelections++;const next=el.size.size;if(next!==size){metrics.sizeChanges++;size=next;}return;}
    const next=el.dataset.tooltip;if(next==="Clear"){metrics.clear++;return;}
    if(next==="Brush"||next==="Fill"){metrics.toolSelections++;if(next!==tool){metrics.toolChanges++;tool=next;}}
  },true);
  const originalRect=canvas.getBoundingClientRect.bind(canvas);
  canvas.getBoundingClientRect=()=>{metrics.rectReads++;return originalRect();};
  const originalRead=context.getImageData.bind(context);
  context.getImageData=(...args)=>{const start=performance.now();metrics.readCalls++;metrics.readPixels+=Math.abs(args[2]*args[3]);try{return originalRead(...args);}finally{metrics.readMs+=performance.now()-start;}};
  const originalDefine=Object.defineProperty;
  Object.defineProperty=(target,key,descriptor)=>{if(target===canvas&&["setPointerCapture","releasePointerCapture"].includes(key))metrics.captureWrites++;return originalDefine(target,key,descriptor);};
  return metrics;
}

async function runFixture(name,speed,makeFixture,oldFixture,rgb,installHooks) {
  const image=makeFixture(name,rgb,oldFixture),source=document.createElement("canvas");source.width=image.width;source.height=image.height;
  source.getContext("2d").putImageData(new ImageData(image.pixels,image.width,image.height),0,0);
  const palette=rgb.map((rgb,index)=>({index,rgb}));
  // Encoding constructs the input fixture before timing; only real image decoding
  // belongs to input loading. This preserves the exact fixture pixels.
  const blob=await new Promise(resolve=>source.toBlob(resolve,"image/png"));
  const start=performance.now(),bitmap=await createImageBitmap(blob),imageLoadMs=performance.now()-start;
  const processingStart=performance.now(),plan=SG_IMAGE_CONVERTER.convert(bitmap,palette,{speed,brush:4,style:"lines",smartDots:true}),preprocessingMs=performance.now()-processingStart;
  bitmap.close();
  const counts=installHooks();
  const done=new Promise(resolve=>document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status",event=>{const status=JSON.parse(event.detail);if(status.id==="measure"&&["done","error"].includes(status.state))resolve(status);}));
  const executionStart=performance.now();
  document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request",{detail:JSON.stringify({action:"draw",id:"measure",word:"testword",speed,style:"lines",background:plan.background,strokes:plan.strokes,ops:plan.ops,planMetrics:{...plan.metrics,imageLoadMs,preprocessMs:preprocessingMs},smartDots:true})}));
  const status=await done,localMs=performance.now()-executionStart;
  while(__sim.sent<__sim.commands.length)await new Promise(resolve=>setTimeout(resolve,10));
  const executionMs=Math.max(localMs,(__sim.sends.at(-1)?.at||executionStart)-executionStart);
  // Snapshot counts before the final raster read: the snapshot itself is a metric,
  // not drawing work. Returned raw pixels are compared outside the browser.
  const measured={...counts};
  measured.totalActions=measured.pointerdown+measured.pointermove+measured.pointerup+measured.pointercancel+measured.wheel+measured.colorSelections+measured.sizeSelections+measured.toolSelections+measured.clear;
  const data=document.querySelector("#game-canvas canvas").getContext("2d").getImageData(0,0,800,600).data;
  let binary="";for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
  return{name,speed,inputType:"ImageBitmap",status,imageLoadMs,preprocessingMs,executionMs,totalMs:executionStart-start+executionMs,commands:__sim.commands.length,sent:__sim.sent,moves:__sim.moves,dropped:__sim.dropped,counts:measured,plan,pixels:btoa(binary),png:document.querySelector("#game-canvas canvas").toDataURL("image/png"),errors:window.__pageErrors};
}

module.exports={rasterRegions,benchmarkFixture,summarize};
if(require.main===module)(async()=>{
  const server=http.createServer((req,res)=>{const file=req.url==="/mock-game.js"?"mock-game.js":req.url==="/"?"mock-game.html":null;if(!file){res.writeHead(404).end();return;}res.setHeader("Content-Type",file.endsWith("js")?"text/javascript":"text/html");res.end(fs.readFileSync(path.join(__dirname,"instant-benchmark",file)));});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  let browser;const report={source:SOURCE,date:new Date().toISOString(),results:[]};
  try{
    browser=await launchBrowser();const url=`http://127.0.0.1:${server.address().port}/`;
    for(const name of NAMES)for(const speed of SPEEDS){
      const{targetId}=await browser.client.send("Target.createTarget",{url});
      const targets=await(await fetch(`${browser.base}/json/list`)).json(),client=await connect(targets.find(target=>target.id===targetId).webSocketDebuggerUrl);
      let result;
      try{
        for(let i=0;i<200;i++){if(await evaluate(client,"typeof __sim !== 'undefined'"))break;await new Promise(resolve=>setTimeout(resolve,10));assert.notEqual(i,199,"Mock game did not load");}
        await evaluate(client,"window.__pageErrors=[];window.addEventListener('error',e=>__pageErrors.push(e.message));window.addEventListener('unhandledrejection',e=>__pageErrors.push(String(e.reason)));const originalError=console.error;console.error=(...args)=>{__pageErrors.push(args.map(String).join(' '));originalError.apply(console,args);};");
        for(const file of["background-band-encoder.js","instant-planner.js","max-optimizer.js","ultra-optimizer.js","exact-raster-encoder.js","image-converter.js","draw-runner.js"])if(fs.existsSync(path.join(SOURCE,file)))await evaluate(client,fs.readFileSync(path.join(SOURCE,file),"utf8"));
        result=await evaluate(client,`(${runFixture.toString()})(${JSON.stringify(name)},${JSON.stringify(speed)},${benchmarkFixture.toString()},${fixture.toString()},${JSON.stringify(RGB)},${hooks.toString()})`);
      }finally{client.close();await browser.client.send("Target.closeTarget",{targetId});}
      assert.ok(!result.plan.optimization?.failure && !result.plan.metrics?.failure, `${name}/${speed}: optimizer silently fell back after an error`);
      assert.ok(!result.plan.encoding?.failure, `${name}/${speed}: exact encoder silently fell back after an error`);
      assert.ok(!result.plan.bandEncoding?.failure, `${name}/${speed}: background band encoder silently fell back after an error`);
      assert.ok(!result.plan.bandEncoding?.mixedEncoding?.failure, `${name}/${speed}: mixed raster encoder silently fell back after an error`);
      assert.ok(!result.plan.encoding?.inverse?.failure, `${name}/${speed}: inverse raster encoder silently fell back after an error`);
      result.plan=inspectPlan(result.plan);
      const pixels=Buffer.from(result.pixels,"base64");result.hash=crypto.createHash("sha256").update(pixels).digest("hex");
      result.regions=rasterRegions(pixels,RGB[result.plan.background]);
      if(IMAGE_DIRECTORY){fs.mkdirSync(IMAGE_DIRECTORY,{recursive:true});fs.writeFileSync(path.join(IMAGE_DIRECTORY,`${name}-${speed}.png`),Buffer.from(result.png.split(",")[1],"base64"));}
      delete result.png;
      report.results.push(result);
      if(OUT)fs.writeFileSync(path.resolve(OUT),JSON.stringify(report,null,2));
      console.log(`${name.padEnd(12)} ${speed.padEnd(7)} decode ${result.imageLoadMs.toFixed(1).padStart(4)}ms preprocessing ${result.preprocessingMs.toFixed(0).padStart(5)}ms execution ${result.executionMs.toFixed(0).padStart(6)}ms total ${result.totalMs.toFixed(0).padStart(6)}ms commands ${String(result.commands).padStart(5)} moves ${String(result.moves).padStart(5)} fills ${String(result.plan.byKind.fill).padStart(4)} colors ${String(result.counts.colorChanges).padStart(4)} tools ${String(result.counts.toolChanges).padStart(4)} actions ${String(result.counts.totalActions).padStart(6)} dropped ${result.dropped} hash ${result.hash.slice(0,12)}`);
      assert.equal(result.status.state,"done",`${name}/${speed}: ${result.status.message}`);assert.equal(result.sent,result.commands);assert.equal(result.dropped,0);assert.deepEqual(result.errors,[]);
    }
    const reference=REFERENCE?JSON.parse(fs.readFileSync(path.resolve(REFERENCE),"utf8")):null;
    for(const result of report.results.filter(result=>result.speed==="instant"&&reference)){
      const ref=reference.results.find(other=>other.name===result.name&&other.speed===REFERENCE_SPEED);
      if(args.includes("--assert-equal"))assert.ok(ref,`${result.name}: missing completed ${REFERENCE_SPEED} reference`);
      if(!ref)continue;
      const expected=Buffer.from(ref.pixels,"base64"),actual=Buffer.from(result.pixels,"base64");let difference=0;
      for(let i=0;i<actual.length;i+=4)if(actual[i]!==expected[i]||actual[i+1]!==expected[i+1]||actual[i+2]!==expected[i+2]||actual[i+3]!==expected[i+3])difference++;
      result.pixelDifferences=difference;console.log(`${result.name}: Ultra Fast versus saved ${REFERENCE_SPEED}: ${difference} differing pixels (${(100*difference/(800*600)).toFixed(3)}%)`);
      if(args.includes("--assert-equal"))assert.equal(difference,0,`${result.name}: Ultra Fast raster differs from the saved reference`);
    }
    if(OUT)fs.writeFileSync(path.resolve(OUT),JSON.stringify(report,null,2));
  }finally{
    server.close();if(browser){try{await browser.client.send("Browser.close");}catch{browser.child.kill();}browser.client.close();if(browser.child.exitCode===null)await Promise.race([once(browser.child,"exit"),new Promise(resolve=>setTimeout(resolve,5000))]);const relative=path.relative(os.tmpdir(),browser.profile);if(!relative.startsWith("..")&&!path.isAbsolute(relative)&&path.basename(browser.profile).startsWith("skribbl-max-test-"))fs.rmSync(browser.profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
