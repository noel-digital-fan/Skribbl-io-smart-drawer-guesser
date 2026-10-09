"use strict";

// Dependency-free regression checks for persisted defaults, image-drop/paste intent,
// editable waiting images and draggable levels. Native image decoding/canvas and Chromium pointer capture
// are exercised; a deterministic converter/runner bridge isolates panel behavior
// from the much longer engine fidelity checks in test-ultra-adjustments.cjs.
//   node scripts/test-panel-experience.cjs
//   node scripts/test-panel-experience.cjs --artifacts <directory>
// BROWSER may point to an installed Chrome/Edge executable; Node 22+ is required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname, "..");
const artifactIndex = process.argv.indexOf("--artifacts");
const ARTIFACTS = artifactIndex < 0 ? null : path.resolve(process.argv[artifactIndex + 1]);
const DEFAULTS = { schemaVersion: 1, style: "sketch", brush: "5", speed: "instant", smartDots: true, autoPaintOnDrop: true };

// Simulate the inherited extension's shared DOM, CSS, bridge and global shortcuts.
// This fixture deliberately keeps its old names; it is not the installed store build.
async function mountPeer(client) {
  await evaluate(client, `window.__peer={requests:[],statuses:[],keys:0,pastes:0,drops:0};
    const peer=document.createElement('section');peer.id='skribbl-guesser-panel';
    peer.innerHTML='<div class="sg-header">Other extension</div><div class="sg-body"><input id="sg-search" class="sg-search"><button id="sg-auto-btn">Auto: OFF</button><div id="sg-list"><button class="sg-word">peer word</button></div><div class="sgd"><button class="sgd-dropzone">Other drop area</button></div></div>';
    document.body.append(peer);
    document.head.append(Object.assign(document.createElement('style'),{textContent:'#skribbl-guesser-panel{position:fixed;top:10px;left:10px;width:240px;background:rgb(12,34,56)}#skribbl-guesser-panel .sg-body{padding:17px}.sg-search{border:9px solid red}.sgd-dropzone{border-radius:0!important}'}));
    window.__peerMarkup=peer.innerHTML;
    document.addEventListener('sg-draw-request',event=>{const request=JSON.parse(event.detail);__peer.requests.push(request);if(request.action==='palette')document.dispatchEvent(new CustomEvent('sg-draw-status',{detail:JSON.stringify({id:request.id,state:'palette',palette:[{index:0,rgb:[255,255,255]}]})}))});
    document.addEventListener('sg-draw-status',event=>__peer.statuses.push(JSON.parse(event.detail)));
    document.addEventListener('keydown',event=>{if(event.altKey&&['a','1','f'].includes(event.key)){__peer.keys++;event.preventDefault()}});
    document.addEventListener('paste',()=>__peer.pastes++);
    document.addEventListener('drop',event=>{if(!peer.contains(event.target)&&!event.target.closest('#game-canvas'))return;__peer.drops++});
  `);
}

async function installDefaults() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const digest = require('node:crypto').createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const extensionId = [...digest].map(hex => String.fromCharCode(97 + parseInt(hex, 16))).join('');
  assert.equal(extensionId, 'bpjccmbldjbdpkgaikbejoninpmgaidd', 'Existing extension ID or private bridge identity changed');
  assert.notEqual(extensionId, 'aopikjngihmjcpppacckdkeolpbeflhm', 'Manifest reuses the original store identity');
  assert.equal(manifest.update_url, undefined, 'Fork receives store updates from the original');
  async function installed(reason, initial) {
    const data = structuredClone(initial), listeners = {};
    const local = {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, data[key]])),
      set: async update => Object.assign(data, structuredClone(update)),
      remove: async key => { delete data[key]; },
    };
    const sandbox = { URL, console, chrome: {
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: Object.fromEntries(["onInstalled", "onUpdateAvailable", "onMessage"].map(key => [key, { addListener: callback => { listeners[key] = callback; } }])),
      storage: { local },
    } };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), sandbox);
    await listeners.onInstalled({ reason });
    await new Promise(resolve => setImmediate(resolve));
    return data;
  }
  assert.deepEqual((await installed("install", {})).sgDrawSettings, DEFAULTS, "First installation did not seed drawing defaults");
  const existing = { style: "lines", brush: "4", speed: "slow", smartDots: false, autoPaintOnDrop: false };
  for (const key of ["sgDrawSettings", "sgDrawSettings202", "sgDrawSettings201"]) {
    const result = await installed("install", { [key]: existing });
    assert.deepEqual(result[key], existing, `Install overwrote ${key}`);
    if (key !== "sgDrawSettings") assert.equal(result.sgDrawSettings, undefined, "Install obscured legacy preferences before migration");
  }
  assert.equal((await installed("update", {})).sgDrawSettings, undefined, "Update treated an existing installation as fresh");
  console.log("PASS installation: fresh defaults only; updates and all existing preference keys are preserved");
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint), pending = new Map();
  let next = 0;
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data), entry = pending.get(result.id);
    if (!entry) return;
    pending.delete(result.id); clearTimeout(entry.timer);
    result.error ? entry.reject(new Error(result.error.message)) : entry.resolve(result.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
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
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(file => fs.existsSync(file));
  assert.ok(executable, "Set BROWSER to an installed Chromium browser");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skribbl-panel-test-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Browser did not expose CDP: ${log.slice(-500)}`)), 20000);
    child.once("error", reject);
    child.stderr.on("data", chunk => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  return { client: await connect(endpoint), child, profile, base: endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "") };
}

async function mount(client, initial, options = {}) {
  await evaluate(client, `window.__storage=${JSON.stringify(initial)};window.__writes=[];window.__requests=[];window.__plans=[];window.__errors=[];window.__closed=0;
    window.addEventListener('error',event=>__errors.push(event.message));window.addEventListener('unhandledrejection',event=>__errors.push(String(event.reason)));
    window.chrome={runtime:{getURL:name=>location.origin+'/'+name,sendMessage:(_message,done)=>done?.({ok:true})},storage:{local:{
      get:(keys,done)=>{const result=Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in __storage).map(key=>[key,structuredClone(__storage[key])]));if(done)queueMicrotask(()=>done(result));return Promise.resolve(result)},
      set:(data,done)=>{Object.assign(__storage,structuredClone(data));__writes.push(structuredClone(data));if(done)queueMicrotask(done);return Promise.resolve()}
    }}};
    window.__waitFor=async(check)=>{const began=performance.now();while(!check()){if(performance.now()-began>8000)throw new Error('Panel condition timed out');await new Promise(resolve=>setTimeout(resolve,10))}};
    window.__settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.__change=(selector,value,type='change')=>{const control=document.querySelector(selector);if(control.type==='checkbox')control.checked=value;else control.value=value;control.dispatchEvent(new Event(type,{bubbles:true}))};
    window.__status=status=>document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',{detail:JSON.stringify(status)}));
    window.__turn=async word=>{document.querySelector('#game-word .word').textContent=word;await __waitFor(()=>word?document.querySelector('.ssdg-d-word').textContent.includes(word):!document.querySelector('.ssdg-d-word').textContent.startsWith('Your word:'));await __settle()};
    window.__queueCount=()=>document.querySelectorAll('.ssdg-d-queue-item').length;
    window.__queueReady=name=>document.querySelector('.ssdg-d-queue-item[aria-current=true] .ssdg-d-queue-title')?.textContent===name&&!window.__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1;
    window.__holdPalette=${Boolean(options.holdPalette)};window.__loaded=0;window.__pendingLoad=null;window.__pendingAdjustment=null;
    window.__providePalette=()=>__status({state:'palette',id:'ssdg-d-palette',palette:[{index:0,rgb:[255,255,255]},{index:1,rgb:[0,0,0]},{index:4,rgb:[239,19,11]}]});
    document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',event=>{const request=JSON.parse(event.detail);
      if(request.action==='palette'&&!__holdPalette)__providePalette();
      if(request.action==='draw'){__requests.push(request);__status({state:'drawing',id:request.id,message:'Drawing'});if(!window.__holdDrawing)setTimeout(()=>__status({state:'done',id:request.id,message:'Done'}),20)}
      if(request.action==='stop'&&request.id)__status({state:'done',id:request.id,message:'Stopped'});
    });
    window.SG_IMAGE_CONVERTER={convert:(image,palette,settings)=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);__plans.push({settings:structuredClone(settings),pixel:Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data)});return{style:settings.style,background:0,ops:[{kind:'dot',size:Number(settings.brush),color:1,point:[100,100]}],brushes:[Number(settings.brush)],strokes:[],commands:1,seconds:.01,metrics:{preprocessMs:0}}}};
    window.__transfer=async(name='fixture.png',color=null)=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=180;const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,300,0);gradient.addColorStop(0,'rgb(30,70,100)');gradient.addColorStop(1,'rgb(220,190,160)');context.fillStyle=color||gradient;context.fillRect(0,0,300,180);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],name,{type:'image/png'}));return transfer};
    window.__upload=async(name,color)=>{const input=document.querySelector('.ssdg-d-file');input.files=(await __transfer(name,color)).files;input.dispatchEvent(new Event('change',{bubbles:true}))};
    window.__drop=async(selector='.ssdg-d-dropzone',name,color)=>{if(selector.startsWith('.ssdg-'))document.querySelector('#ssdg-d-draw-tab').click();document.querySelector(selector).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:await __transfer(name,color)}))};
    window.__paste=async(selector='.ssdg-d-dropzone',name='clipboard.png',color)=>{if(selector.startsWith('.ssdg-'))document.querySelector('#ssdg-d-draw-tab').click();const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:await __transfer(name,color)});document.querySelector(selector).dispatchEvent(event);return event.defaultPrevented};
    window.__clipboard=read=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read}});
  `);
  // Browser stylesheet decoding consumes a UTF-8 BOM; textContent injection does not.
  const css = ["styles.css", "auto-draw.css"].map(file => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\uFEFF/, "")).join("\n");
  await evaluate(client, `document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));`);
  for (const file of ["word-catalog.js", "word-library.js", "panel-window.js", "content.js", "image-input.js", "image-adjustments.js", "image-editor.js"]) await evaluate(client, fs.readFileSync(path.join(ROOT, file), "utf8"));
  await evaluate(client, `const createEditor=SG_IMAGE_EDITOR.create;SG_IMAGE_EDITOR.create=(...args)=>(window.__editor=createEditor(...args));
    const loadImage=SG_IMAGE_INPUT.load;SG_IMAGE_INPUT.load=async(...args)=>{const image=await loadImage(...args);__loaded++;const close=image.close.bind(image);let closed=false;image.close=()=>{if(!closed){closed=true;__closed++;close()}};if(window.__holdLoad){window.__pendingLoad={image,signal:args[1]};await new Promise(resolve=>window.__releaseLoad=resolve)}return image};`);
  await evaluate(client, fs.readFileSync(path.join(ROOT, "auto-draw.js"), "utf8"));
  await evaluate(client, "__waitFor(()=>document.querySelector('.ssdg-d-word')?.textContent.includes('testword')&&!document.querySelector('.ssdg-d-speed').disabled)");
}

async function browserTests() {
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#game-canvas canvas{width:800px;height:600px;display:block}</style></head><body><div id="game-word"><span class="word">testword</span></div><div id="game-clock"><span class="text">80</span></div><div id="game-canvas"><canvas width="800" height="600"></canvas></div><div id="game-toolbar">Drawing toolbar</div></body></html>`;
  const server = http.createServer((req, res) => {
    const words = req.url === "/words.txt" ? "cat\ndog\ntest\n" : req.url === "/words-es.txt" ? "gato\nperro\naño\n" : null;
    res.setHeader("Content-Type", words === null ? "text/html;charset=utf-8" : "text/plain;charset=utf-8");
    res.end(words === null ? fixture : words);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser;
  try {
    browser = await launchBrowser();
    async function capture(client, name) {
      if (!ARTIFACTS) return;
      const clip = await evaluate(client, "(()=>{const rect=document.querySelector('#skribbl-smart-drawer-guesser-panel').getBoundingClientRect();return{x:Math.max(0,rect.left-4),y:Math.max(0,rect.top-4),width:Math.min(innerWidth,rect.width+8),height:Math.min(innerHeight-rect.top,rect.height+8),scale:1}})()");
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", clip });
      fs.mkdirSync(ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(ARTIFACTS, name), Buffer.from(screenshot.data, "base64"));
    }
    async function page(initial, task, options) {
      const url = `http://127.0.0.1:${server.address().port}/`;
      const { targetId } = await browser.client.send("Target.createTarget", { url });
      const targets = await (await fetch(`${browser.base}/json/list`)).json();
      const client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
      try {
        await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1500, deviceScaleFactor: 1, mobile: false });
        // A fresh target can briefly report about:blank as complete. Wait for
        // the fixture itself before injecting state that navigation would erase.
        for (let tries = 0; !await evaluate(client, `location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&Boolean(document.querySelector('#game-canvas canvas'))`); tries++) {
          assert.ok(tries < 800, "Panel fixture did not finish navigation");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (options?.peer === 'before') await mountPeer(client);
        await mount(client, initial, options);
        if (options?.peer === 'after') await mountPeer(client);
        await task(client);
        assert.deepEqual(await evaluate(client, "__errors"), [], "Panel reported a browser error");
      } finally { client.close(); await browser.client.send("Target.closeTarget", { targetId }); }
    }

    for (const peer of ['before', 'after']) await page({}, async client => {
      assert.equal(await evaluate(client, "document.querySelectorAll('#skribbl-guesser-panel').length"), 1);
      assert.equal(await evaluate(client, "document.querySelectorAll('#skribbl-smart-drawer-guesser-panel').length"), 1);
      assert.equal(await evaluate(client, "document.querySelector('#skribbl-guesser-panel').innerHTML"), await evaluate(client, "__peerMarkup"), "Own tabs took over the other panel");
      assert.equal(await evaluate(client, "getComputedStyle(document.querySelector('#skribbl-guesser-panel')).backgroundColor"), 'rgb(12, 34, 56)', 'Own theme changed the peer');
      assert.notEqual(await evaluate(client, "getComputedStyle(document.querySelector('#ssdg-search')).borderTopWidth"), '9px', 'Peer theme changed our controls');
      assert.deepEqual(await evaluate(client, "__peer.requests"), [], 'Our palette request reached the peer runner');
      // Use the genuine MAIN-world runner to test both sides of the bridge,
      // without requiring game drawing controls for a palette request.
      await evaluate(client, fs.readFileSync(path.join(ROOT, 'draw-runner.js'), 'utf8'));
      await evaluate(client, `window.__privateStatuses=[];document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',event=>__privateStatuses.push(JSON.parse(event.detail)));
        document.dispatchEvent(new CustomEvent('sg-draw-request',{detail:JSON.stringify({action:'palette',id:'peer'})}));`);
      assert.equal(await evaluate(client, "__peer.requests.length"), 1);
      assert.equal(await evaluate(client, "__privateStatuses.length"), 0, 'Our MAIN runner consumed the old bridge');
      await evaluate(client, `document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',{detail:JSON.stringify({action:'palette',id:'ours'})}))`);
      assert.equal(await evaluate(client, "__privateStatuses.filter(status=>status.id==='ours').length"), 1);
      assert.equal(await evaluate(client, "__peer.statuses.length"), 1, 'Our MAIN runner sent status to the peer');
      await evaluate(client, '__providePalette()');
      assert.equal(await evaluate(client, "__paste('#game-canvas canvas','outside.png')"), false, 'Canvas paste was intercepted');
      assert.equal(await evaluate(client, "__paste('#sg-search','peer.png')"), false, 'Peer paste was intercepted');
      await evaluate(client, "__drop('#game-canvas canvas','outside.png');__pause=new Promise(resolve=>setTimeout(resolve,120));__pause");
      assert.equal(await evaluate(client, "__loaded"), 0, 'Outside images reached our image loader');
      assert.deepEqual(await evaluate(client, "({pastes:__peer.pastes,drops:__peer.drops})"), { pastes: 2, drops: 1 });
      await evaluate(client, `document.querySelector('#sg-search').dispatchEvent(new KeyboardEvent('keydown',{key:'a',altKey:true,bubbles:true,cancelable:true}));
        document.querySelector('#ssdg-d-guess-tab').click();document.querySelector('#ssdg-search').dispatchEvent(new KeyboardEvent('keydown',{key:'f',altKey:true,bubbles:true,cancelable:true}));`);
      assert.equal(await evaluate(client, "__peer.keys"), 1, 'Our shortcut also activated the peer');
      assert.equal(await evaluate(client, "document.activeElement.id"), 'ssdg-search');
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-auto-btn').classList.contains('active')"), false, 'Peer shortcut enabled our Auto Guess');
      await evaluate(client, "__change('.ssdg-d-auto-paint',false);__paste('.ssdg-d-dropzone','own.png');__waitFor(()=>__loaded===1&&!__editor.element.hidden)");
      assert.equal(await evaluate(client, "__peer.pastes"), 2, 'Own image paste reached the peer');
      assert.equal(await evaluate(client, "document.querySelector('#skribbl-guesser-panel').innerHTML"), await evaluate(client, "__peerMarkup"), 'Own actions mutated the peer panel');
    }, { peer });
    console.log('PASS coexistence: both loading orders, separate panels/styles/MAIN bridges, outside drop/paste passthrough and scoped shortcuts');

    await page({}, async client => {
      const defaults = await evaluate(client, `({saved:__storage.sgDrawSettings,style:document.querySelector('.ssdg-d-style').value,brush:document.querySelector('.ssdg-d-brush').value,speed:document.querySelector('.ssdg-d-speed').value,auto:document.querySelector('.ssdg-d-auto-paint').checked,width:document.querySelector('#skribbl-smart-drawer-guesser-panel').getBoundingClientRect().width})`);
      assert.deepEqual(defaults.saved, DEFAULTS); assert.equal(defaults.style, "sketch"); assert.equal(defaults.brush, "5"); assert.equal(defaults.speed, "instant"); assert.equal(defaults.auto, true);
      assert.ok(defaults.width > 280 && defaults.width <= 370, `Panel width ${defaults.width} does not remain compact while increasing space`);
      await capture(client, "draw-settings.png");
      await client.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: false });
      await evaluate(client, "__settle()");
      const narrow = await evaluate(client, "(()=>{const rect=document.querySelector('#skribbl-smart-drawer-guesser-panel').getBoundingClientRect();return{width:rect.width,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}})()");
      assert.ok(narrow.width <= 312 && narrow.left >= 3 && narrow.right <= 317 && narrow.top >= 3 && narrow.bottom <= 637, `Panel escaped compact viewport: ${JSON.stringify(narrow)}`);
      await capture(client, "compact-panel.png");
      await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1500, deviceScaleFactor: 1, mobile: false });
      await evaluate(client, "__settle();document.querySelector('#ssdg-collapse-btn').click();__waitFor(()=>document.querySelector('#skribbl-smart-drawer-guesser-panel').classList.contains('collapsed'))");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-collapse-btn').getAttribute('aria-expanded')"), "false");
      assert.equal(await evaluate(client, "document.querySelector('#skribbl-smart-drawer-guesser-panel .ssdg-body').inert"), true);
      await evaluate(client, "document.querySelector('#ssdg-collapse-btn').click();__waitFor(()=>!document.querySelector('#skribbl-smart-drawer-guesser-panel').classList.contains('collapsed'));document.querySelector('#ssdg-d-guess-tab').click()");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-d-guess-tab').getAttribute('aria-selected')"), "true");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-d-guess-pane').hidden"), false);
      await capture(client, "guess-panel.png");
      await evaluate(client, "document.querySelector('#ssdg-d-draw-tab').click()");
      await evaluate(client, "__change('.ssdg-d-auto-paint',false)");
      assert.equal(await evaluate(client, "__storage.sgDrawSettings.autoPaintOnDrop"), false, "OFF was not saved");
      await evaluate(client, "__change('.ssdg-d-auto-paint',true)");
      assert.equal(await evaluate(client, "__storage.sgDrawSettings.autoPaintOnDrop"), true, "ON was not saved");
    });
    const current = { schemaVersion: 1, style: "lines", brush: "4", speed: "slow", smartDots: false, autoPaintOnDrop: false, extraPreference: "keep" };
    for (const initial of [
      { sgDrawSettings: current },
      { sgDrawSettings: { style: "dots", brush: "6", speed: "normal", smartDots: true } },
      { sgDrawSettings202: { style: "lines", brush: "4", speed: "fast", autoPaintOnDrop: false } },
      { sgDrawSettings201: { style: "dots", brush: "10", speed: "max" } },
      { sgDrawSettings: { style: "lines", brush: "4" } },
    ]) await page(initial, async client => {
      const original = Object.values(initial)[0], result = await evaluate(client, "__storage.sgDrawSettings");
      assert.equal(result.style, original.style); assert.equal(result.brush, original.brush === "10" ? "6" : original.brush);
      assert.equal(result.speed, original.speed === "max" ? "instant" : original.speed || "fast");
      assert.equal(result.autoPaintOnDrop, original.autoPaintOnDrop ?? true); assert.equal(result.schemaVersion, 1);
      if (typeof original.smartDots === "boolean") assert.equal(result.smartDots, original.smartDots, "Saved fast-fill preference was overwritten");
      if (original.extraPreference) assert.equal(result.extraPreference, original.extraPreference);
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-auto-paint').checked"), result.autoPaintOnDrop);
    });
    console.log("PASS preferences: compact wider panel, fresh Sketch/5 px/Ultra Fast/ON, legacy migration, preserved OFF and unknown preferences");

    await page({}, async client => {
      const extraction = await evaluate(client, `(()=>{
        const image=new File(['image'],'copied.png',{type:'image/png'}),text=new File(['text'],'note.txt',{type:'text/plain'});
        const payload=SG_IMAGE_INPUT.fromClipboard({items:[{kind:'string',type:'text/plain',getAsFile:()=>null},{kind:'file',type:'text/plain',getAsFile:()=>text},{kind:'file',type:'image/png',getAsFile:()=>image}],files:[]});
        const fallback=SG_IMAGE_INPUT.fromClipboard({items:[],files:[text,image]});
        const textOnly=SG_IMAGE_INPUT.fromClipboard({items:[{kind:'file',type:'text/plain',getAsFile:()=>text}],files:[text],getData:()=>'<img src="https://example.com/image.png">'});
        const formats=['image/png','image/jpeg','image/webp','image/gif'].map(type=>{const file=new File(['image'],'copied',{type});return SG_IMAGE_INPUT.fromClipboard({files:[file]})?.file===file});
        return{items:payload?.file===image,title:payload?.title,files:fallback?.file===image,textOnly:textOnly===null,formats};
      })()`);
      assert.equal(extraction.items, true, "Clipboard items did not select the image after text entries");
      assert.ok(extraction.title, "Clipboard image has no readable title");
      assert.equal(extraction.files, true, "Clipboard files fallback missed an image after a text file");
      assert.equal(extraction.textOnly, true, "Text/HTML clipboard content was treated as an image");
      assert.deepEqual(extraction.formats, [true, true, true, true], "Clipboard extraction omitted a supported image format");
      const invalidFiles = await evaluate(client, `(async()=>{
        const messages=[];
        for(const file of [new File(['<svg/>'],'copied.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(10485761)],'large.png',{type:'image/png'})]){
          try{const bitmap=await SG_IMAGE_INPUT.load(SG_IMAGE_INPUT.fromClipboard({files:[file]}),new AbortController().signal);bitmap.close();messages.push('accepted')}catch(error){messages.push(error.message)}
        }
        return messages;
      })()`);
      assert.match(invalidFiles[0], /SVG|PNG.*JPEG/i, "Clipboard image loading accepted an unsupported image format");
      assert.match(invalidFiles[1], /1 byte|empty/i, "Clipboard image loading accepted an empty file");
      assert.match(invalidFiles[2], /10 MB|large/i, "Clipboard image loading bypassed its file size limit");
      const plainPaste = await evaluate(client, `(()=>{
        const results=[];
        for(const [type,value] of [['text/plain','cat'],['text/plain','https://example.com/image.png'],['text/html','<img src="https://example.com/image.png">'],['text/uri-list','https://example.com/image.png']]){
          const transfer=new DataTransfer();transfer.setData(type,value);
          const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
          document.querySelector('.ssdg-d-text-input').dispatchEvent(event);results.push(event.defaultPrevented);
        }
        const transfer=new DataTransfer();transfer.items.add(new File(['text'],'note.txt',{type:'text/plain'}));
        const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});document.body.dispatchEvent(event);results.push(event.defaultPrevented);
        return{prevented:results,loaded:__loaded,requests:__requests.length};
      })()`);
      assert.deepEqual(plainPaste, { prevented: [false, false, false, false, false], loaded: 0, requests: 0 }, "Image paste handling interfered with ordinary text/link paste");
      assert.match(await evaluate(client, "document.querySelector('#ssdg-d-auto-paint-label').textContent"), /past/i, "Automatic painting label omits clipboard input");
      const intercepted = await evaluate(client, "__paste('.ssdg-d-text-input','keyboard.png','#224466')");
      assert.equal(intercepted, true, "Image paste was not accepted from the typed-text field");
      await evaluate(client, "__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.deepEqual(await evaluate(client, "({speed:__requests[0].speed,style:__requests[0].style,pixel:__plans[0].pixel,editorHidden:__editor.element.hidden})"), { speed: "instant", style: "sketch", pixel: [34, 68, 102, 255], editorHidden: true }, "Keyboard image paste did not use the drawing defaults and original image pixels");
      await evaluate(client, "__change('.ssdg-d-auto-paint',false);__paste('.ssdg-d-dropzone','preview-paste.png','#884422');__waitFor(()=>!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1)");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Pasted image painted while automatic painting was OFF");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===2&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.deepEqual(await evaluate(client, "__plans[1].pixel"), [136, 68, 34, 255], "Manual drawing lost the pasted preview image");
    });
    console.log("PASS clipboard intent: items/files images, text/HTML/link passthrough, keyboard paste defaults and OFF preview/manual draw");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{await __paste('.ssdg-d-dropzone','waiting-paste.png','#337799');await __waitFor(()=>__queueReady('waiting-paste.png'))})");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Clipboard image painted outside the drawing turn");
      await evaluate(client, "__change('.ssdg-d-monochrome',true);document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__editor.element.hidden);__turn('clipboard-queue');__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      const pixel = await evaluate(client, "__plans[0].pixel");
      assert.ok(pixel[0] === pixel[1] && pixel[1] === pixel[2], "Queued pasted image lost its saved preview adjustments");
      assert.equal(await evaluate(client, "__queueCount()"), 0, "Automatic drawing did not consume the pasted waiting image");
    });
    console.log("PASS clipboard queue: off-turn paste waits, keeps preview edits and draws on the next turn");

    await page({}, async client => {
      await evaluate(client, "(async()=>{const file=(await __transfer('button-paste.png','#446688')).files[0];window.__clipboardReads=0;__clipboard(async()=>{__clipboardReads++;return[{types:['text/plain'],getType:async()=>new Blob(['cat'],{type:'text/plain'})},{types:['image/png'],getType:async type=>{if(type!=='image/png')throw new Error('Wrong MIME type');return file}}]});document.querySelector('.ssdg-d-paste').click();await __waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)})()");
      assert.equal(await evaluate(client, "__clipboardReads"), 1, "Paste image button did not invoke clipboard reading once");
      assert.deepEqual(await evaluate(client, "__plans[0].pixel"), [68, 102, 136, 255], "Paste image button did not paint the image from clipboard items");
      await evaluate(client, "__clipboard(async()=>{throw new DOMException('Clipboard denied','NotAllowedError')});document.querySelector('.ssdg-d-paste').click();__waitFor(()=>/clipboard|paste/i.test(document.querySelector('.ssdg-d-status').textContent)&&document.querySelector('.ssdg-d-stop').disabled)");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Denied clipboard permission painted an image");
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-paste').disabled"), false, "Denied clipboard permission left Paste image disabled");
      await evaluate(client, "__clipboard(async()=>[{types:['text/plain'],getType:async()=>new Blob(['cat'],{type:'text/plain'})}]);document.querySelector('.ssdg-d-paste').click();__waitFor(()=>/image/i.test(document.querySelector('.ssdg-d-status').textContent)&&document.querySelector('.ssdg-d-stop').disabled)");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Text-only clipboard button painted an image");
      await evaluate(client, "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{}});document.querySelector('.ssdg-d-paste').click();__waitFor(()=>/paste|clipboard/i.test(document.querySelector('.ssdg-d-status').textContent)&&document.querySelector('.ssdg-d-stop').disabled)");
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-paste').disabled"), false, "Unavailable clipboard API left Paste image disabled");
    });
    console.log("PASS clipboard button: supported image after text, native decoder pixels, permission errors, text-only clipboard and missing API recovery");

    for (const interruption of ["newer", "draw-preview", "stop", "turn"]) await page({}, async client => {
      if (interruption === "draw-preview") {
        await evaluate(client, "__upload('existing-preview.png','#228855');__waitFor(()=>!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1)");
      }
      await evaluate(client, "(async()=>{window.__oldClipboardFile=(await __transfer('stale-clipboard.png','#aa3322')).files[0];window.__clipboardStarted=false;__clipboard(()=>{__clipboardStarted=true;return new Promise(resolve=>window.__releaseClipboard=()=>resolve([{types:['image/png'],getType:async()=>__oldClipboardFile}]))});document.querySelector('.ssdg-d-paste').click();await __waitFor(()=>__clipboardStarted&&!document.querySelector('.ssdg-d-stop').disabled)})()");
      if (interruption === "newer") {
        await evaluate(client, "__paste('.ssdg-d-dropzone','newer-paste.png','#2255bb');__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      } else if (interruption === "draw-preview") {
        await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      } else if (interruption === "stop") {
        await evaluate(client, "document.querySelector('.ssdg-d-stop').click()");
      } else {
        await evaluate(client, "__turn('changed-before-clipboard-ready')");
      }
      await evaluate(client, "__releaseClipboard();new Promise(resolve=>setTimeout(resolve,350))");
      const drawn = ["newer", "draw-preview"].includes(interruption) ? 1 : 0;
      assert.equal(await evaluate(client, "__requests.length"), drawn, `${interruption} did not discard the stale clipboard read`);
      assert.equal(await evaluate(client, "__loaded"), drawn, `${interruption} decoded a stale clipboard image`);
      assert.equal(await evaluate(client, "__queueCount()"), 0, `${interruption} unexpectedly queued a stale clipboard image`);
      if (interruption === "newer") assert.deepEqual(await evaluate(client, "__plans[0].pixel"), [34, 85, 187, 255], "Late clipboard read replaced the newer pasted image");
      if (interruption === "draw-preview") assert.deepEqual(await evaluate(client, "__plans[0].pixel"), [34, 136, 85, 255], "Late clipboard read replaced the existing preview being drawn");
    });
    console.log("PASS clipboard read races: newer paste, existing preview Draw image, Stop and turn changes discard late reads before image decoding");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{window.__holdLoad=true;await __drop('.ssdg-d-dropzone','older-queued.png','#336699');await __waitFor(()=>!!__pendingLoad&&__queueCount()===1);window.__holdLoad=false;const file=(await __transfer('clipboard-queued.png','#995533')).files[0];window.__clipboardStarted=false;__clipboard(()=>{__clipboardStarted=true;return new Promise(resolve=>window.__releaseClipboard=()=>resolve([{types:['image/png'],getType:async()=>file}]))});document.querySelector('.ssdg-d-paste').click();await __waitFor(()=>__clipboardStarted);__releaseLoad();await __waitFor(()=>!document.querySelector('.ssdg-d-queue-state').textContent.includes('Loading'));__releaseClipboard();await __waitFor(()=>__queueCount()===2&&__queueReady('Clipboard image'))})");
      assert.deepEqual(await evaluate(client, "Array.from(document.querySelectorAll('.ssdg-d-queue-title'),title=>title.textContent)"), ["older-queued.png", "Clipboard image"], "An older queued image finishing its load cancelled or replaced a newer clipboard read");
      assert.equal(await evaluate(client, "__loaded"), 2, "Concurrent queue and clipboard loading did not finish both images");
      assert.equal(await evaluate(client, "Array.from(document.querySelectorAll('.ssdg-d-queue-state')).some(state=>/Loading|error/i.test(state.textContent))"), false, "Concurrent queue and clipboard loading left an image unready");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Concurrent queue and clipboard images painted outside a drawing turn");
    });
    console.log("PASS clipboard and queue concurrency: earlier queued decoding preserves a newer clipboard read and both images become ready");

    await page({}, async client => {
      for (const selector of [".ssdg-d-dropzone", ".ssdg-d-tools"]) {
        const before = await evaluate(client, "__requests.length");
        await evaluate(client, `__drop(${JSON.stringify(selector)}).then(()=>__waitFor(()=>__requests.length>${before}&&!document.querySelector('.ssdg-d-speed').disabled))`);
        assert.deepEqual(await evaluate(client, "({speed:__requests.at(-1).speed,style:__requests.at(-1).style,brush:__plans.at(-1).settings.brush,editorHidden:__editor.element.hidden})"), { speed: "instant", style: "sketch", brush: "5", editorHidden: true });
      }
      await evaluate(client, "__change('.ssdg-d-auto-paint',false);__drop().then(()=>__waitFor(()=>!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1))");
      assert.equal(await evaluate(client, "__requests.length"), 2, "Disabled drop started painting");
      await evaluate(client, "document.querySelector('.ssdg-d-image-cancel').click();__change('.ssdg-d-auto-paint',true);__upload().then(()=>__waitFor(()=>!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1))");
      assert.equal(await evaluate(client, "__requests.length"), 2, "File picker bypassed adjustments");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===3&&!document.querySelector('.ssdg-d-speed').disabled)");
      await evaluate(client, "document.querySelector('.ssdg-d-image-cancel').click();const transfer=new DataTransfer();transfer.items.add(new File(['text'],'note.txt',{type:'text/plain'}));document.querySelector('#game-canvas canvas').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));__waitFor(()=>document.querySelector('.ssdg-d-stop').disabled)");
      assert.equal(await evaluate(client, "__requests.length"), 3, "Non-image file was painted");
    });
    console.log("PASS image intent: panel drops auto-paint; OFF opens preview; file picker awaits Draw image; non-images are rejected");

    await page({}, async client => {
      for (const interrupt of ["off", "stop", "turn"]) {
        await evaluate(client, "window.__holdLoad=true;window.__pendingLoad=null;__drop().then(()=>__waitFor(()=>!!__pendingLoad))");
        await evaluate(client, "__waitFor(()=>!!__pendingLoad)");
        if (interrupt === "off") await evaluate(client, "__change('.ssdg-d-auto-paint',false)");
        if (interrupt === "stop") await evaluate(client, "document.querySelector('.ssdg-d-stop').click()");
        if (interrupt === "turn") await evaluate(client, "document.querySelector('#game-word .word').textContent='nextword';__waitFor(()=>document.querySelector('.ssdg-d-word').textContent.includes('nextword'))");
        await evaluate(client, "window.__holdLoad=false;__releaseLoad();__waitFor(()=>document.querySelector('.ssdg-d-stop').disabled);__settle()");
        assert.equal(await evaluate(client, "__requests.length"), 0, `${interrupt} race still painted`);
        if (interrupt === "off") {
          assert.equal(await evaluate(client, "__editor.element.hidden"), false, "Live OFF did not preserve preview");
          await evaluate(client, "document.querySelector('.ssdg-d-image-cancel').click();__change('.ssdg-d-auto-paint',true)");
        } else {
          assert.equal(await evaluate(client, "__pendingLoad.signal.aborted"), true, `${interrupt} did not abort image input`);
          assert.equal(await evaluate(client, "__editor.element.hidden"), true);
        }
      }
      assert.equal(await evaluate(client, "__closed"), 3, "Cancelled decoded images were not closed");
    });
    console.log("PASS loading races: live OFF previews; Stop and turn changes abort/release active-turn bitmaps");

    await page({}, async client => {
      await evaluate(client, "__turn('')");
      assert.equal(await evaluate(client, "(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['image'],'drag.png',{type:'image/png'}));const event=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});document.querySelector('#ssdg-d-draw-tab').click();document.querySelector('.ssdg-d-dropzone').dispatchEvent(event);return event.defaultPrevented})()"), true, "Outside-turn panel image drag was not accepted");
      await evaluate(client, "__drop('.ssdg-d-dropzone','first.png','#336699');__waitFor(()=>__queueCount()===1&&!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1)");
      assert.match(await evaluate(client, "document.querySelector('.ssdg-d-image-draw').textContent"), /Save changes/i);
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-image-draw').disabled"), false, "Waiting image cannot be saved");
      await evaluate(client, "__change('.ssdg-d-monochrome',true);__change('.ssdg-d-contrast','35','input');__change('.ssdg-d-level-gamma','1.3');__change('.ssdg-d-level-output-black','12');__settle()");
      const firstPixel = await evaluate(client, "Array.from(document.querySelector('.ssdg-d-image-preview').getContext('2d').getImageData(5,5,1,1).data)");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__editor.element.hidden)");
      assert.equal(await evaluate(client, "__queueCount()"), 1, "Saving removed a waiting image");
      await evaluate(client, "__drop('.ssdg-d-dropzone','second.png','#cc3311');__waitFor(()=>__queueCount()===2&&!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1)");
      assert.equal(await evaluate(client, "__editor.getSettings().monochrome"), false, "New waiting image inherited another image's edits");
      await evaluate(client, "__change('.ssdg-d-contrast','-20','input');document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__editor.element.hidden);__upload('third.png','#2244aa');__waitFor(()=>__queueCount()===3&&!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1)");
      assert.equal(await evaluate(client, "__editor.getSettings().contrast"), 0, "File-picker queue image inherited edits");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();document.querySelectorAll('.ssdg-d-queue-edit')[0].click();__settle()");
      assert.deepEqual(await evaluate(client, "({monochrome:__editor.getSettings().monochrome,contrast:__editor.getSettings().contrast})"), { monochrome: true, contrast: 35 }, "Reopening first image lost its adjustments");
      assert.deepEqual(await evaluate(client, "({gamma:__editor.getSettings().levels.RGB.gamma,outputBlack:__editor.getSettings().levels.RGB.outputBlack})"), { gamma: 1.3, outputBlack: 12 }, "Reopening queued image lost its numeric levels");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();document.querySelectorAll('.ssdg-d-queue-edit')[1].click();__settle()");
      assert.deepEqual(await evaluate(client, "({monochrome:__editor.getSettings().monochrome,contrast:__editor.getSettings().contrast})"), { monochrome: false, contrast: -20 }, "Queue edits were not isolated by image");
      const secondPixel = await evaluate(client, "Array.from(document.querySelector('.ssdg-d-image-preview').getContext('2d').getImageData(5,5,1,1).data)");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click()");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Waiting images painted outside the drawing turn");
      assert.match(await evaluate(client, "document.querySelector('.ssdg-d-queue-list').textContent"), /first\.png[\s\S]*second\.png[\s\S]*third\.png/, "Waiting list did not preserve input order");
      await capture(client, "waiting-images.png");
      await evaluate(client, "__turn('queued-first').then(async()=>{await __waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled);await new Promise(resolve=>setTimeout(resolve,700))})");
      assert.deepEqual(await evaluate(client, "__plans[0].pixel"), firstPixel, "Automatic queued image ignored its saved pixel adjustments");
      assert.equal(await evaluate(client, "__requests.length"), 1, "More than one queued image painted in the same turn");
      assert.equal(await evaluate(client, "__queueCount()"), 2, "Automatic drawing consumed the remaining waiting images");
      await evaluate(client, "__turn('queued-second');__waitFor(()=>__requests.length===2&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.deepEqual(await evaluate(client, "__plans[1].pixel"), secondPixel, "Second automatic turn skipped FIFO order or lost edits");
      await evaluate(client, "__turn('').then(async()=>{await __turn('queued-third');await __waitFor(()=>__requests.length===3&&!document.querySelector('.ssdg-d-speed').disabled)})");
      assert.deepEqual(await evaluate(client, "__plans[2].pixel"), [34, 68, 170, 255], "File-picker queue image did not retain its original pixels");
      assert.equal(await evaluate(client, "__queueCount()"), 0);
      await evaluate(client, "__turn('')");
      assert.equal(await evaluate(client, "__closed"), 3, "Completed queued images kept decoded originals alive");
    });
    console.log("PASS editable queue ON: off-turn panel/picker inputs, Save, independent restored edits, native adjusted pixels and one FIFO image per turn");

    await page({ sgDrawSettings: { ...DEFAULTS, autoPaintOnDrop: false } }, async client => {
      await evaluate(client, "__turn('').then(async()=>{await __drop('.ssdg-d-dropzone','keep.png','#226688');await __waitFor(()=>__queueReady('keep.png'));__change('.ssdg-d-contrast','17','input');document.querySelector('.ssdg-d-image-draw').click();await __waitFor(()=>__editor.element.hidden);await __drop('.ssdg-d-dropzone','remove.png','#883322');await __waitFor(()=>__queueReady('remove.png'))})");
      await evaluate(client, "__change('.ssdg-d-contrast','-31','input');document.querySelector('.ssdg-d-image-cancel').click();__waitFor(()=>__editor.element.hidden)");
      assert.equal(await evaluate(client, "__queueCount()"), 2, "Closing the queue editor deleted its image");
      await evaluate(client, "document.querySelectorAll('.ssdg-d-queue-edit')[1].click();__settle()");
      assert.equal(await evaluate(client, "__editor.getSettings().contrast"), -31, "Closing the editor discarded the waiting image's live edits");
      await evaluate(client, "document.querySelectorAll('.ssdg-d-queue-edit')[0].click();__settle()");
      assert.equal(await evaluate(client, "__editor.getSettings().contrast"), 17, "Selecting another queue image discarded its saved contrast");
      await evaluate(client, "__turn('manual-queue').then(()=>new Promise(resolve=>setTimeout(resolve,700)))");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Automatic painting OFF did not keep queued images waiting");
      assert.equal(await evaluate(client, "__editor.element.hidden"), false, "Turn transition closed the selected waiting image");
      assert.equal(await evaluate(client, "__editor.getSettings().contrast"), 17, "Turn transition reset selected waiting edits");
      assert.match(await evaluate(client, "document.querySelector('.ssdg-d-image-draw').textContent"), /Draw image/i);
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.equal(await evaluate(client, "__queueCount()"), 1, "Manual queue draw did not remove only its selected image");
      assert.match(await evaluate(client, "document.querySelector('.ssdg-d-queue-list').textContent"), /remove\.png/);
      await evaluate(client, "__turn('').then(async()=>{document.querySelector('.ssdg-d-queue-remove').click();await __waitFor(()=>__queueCount()===0)})");
      assert.equal(await evaluate(client, "__closed"), 2, "Remove did not release its queued bitmap");
      await evaluate(client, "__turn('').then(async()=>{await __upload('clear-a.png');await __waitFor(()=>__queueReady('clear-a.png'));await __upload('clear-b.png');await __waitFor(()=>__queueReady('clear-b.png'));document.querySelector('.ssdg-d-queue-clear').click();await __waitFor(()=>__queueCount()===0)})");
      assert.equal(await evaluate(client, "__editor.element.hidden"), true, "Clear left a removed queue entry in the editor");
      assert.equal(await evaluate(client, "__closed"), 4, "Clear did not release all waiting bitmaps");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Removing queued images unexpectedly painted");
      assert.ok(await evaluate(client, "__writes.every(write=>!Object.keys(write).some(key=>/queue|image/i.test(key)))"), "Waiting images were persisted to extension storage");
    });
    console.log("PASS editable queue OFF: Save/Cancel preserve waiting images; selected edits survive turns; manual drawing, Remove/Clear and local-only storage");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{await __drop('.ssdg-d-dropzone','toggle-during-adjustment.png','#336699');await __waitFor(()=>__queueReady('toggle-during-adjustment.png'));__change('.ssdg-d-monochrome',true);document.querySelector('.ssdg-d-image-draw').click();await __waitFor(()=>__editor.element.hidden)})");
      await evaluate(client, "const createBitmap=window.createImageBitmap.bind(window);window.__holdAdjustment=true;window.createImageBitmap=async(...args)=>{const bitmap=await createBitmap(...args);if(__holdAdjustment&&args[0] instanceof HTMLCanvasElement){window.__pendingAdjustment=bitmap;await new Promise(resolve=>window.__releaseAdjustment=resolve)}return bitmap};__turn('adjustment-toggle').then(()=>__waitFor(()=>!!__pendingAdjustment))");
      await evaluate(client, "__change('.ssdg-d-auto-paint',false);window.__holdAdjustment=false;__releaseAdjustment();__waitFor(()=>document.querySelector('.ssdg-d-stop').disabled&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Live OFF during adjusted bitmap creation still auto-painted the queue");
      assert.equal(await evaluate(client, "__queueCount()"), 1, "Live OFF during adjustment consumed the queued image");
      assert.equal(await evaluate(client, "__editor.getSettings().monochrome"), true, "Live OFF discarded saved waiting edits");
      await evaluate(client, "document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      const pixel = await evaluate(client, "__plans[0].pixel");
      assert.ok(pixel[0] === pixel[1] && pixel[1] === pixel[2], "Manual OFF draw lost the queued monochrome edit");
      assert.equal(await evaluate(client, "__queueCount()"), 0, "Manual OFF draw after adjustment cancellation did not consume its image");
    });
    console.log("PASS queued adjustment race: turning automatic painting OFF during bitmap creation retains edits and still allows manual Draw image");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{window.__holdLoad=true;await __drop('.ssdg-d-dropzone','late.png');await __waitFor(()=>!!__pendingLoad&&__queueCount()===1);await __turn('late-ready')})");
      assert.equal(await evaluate(client, "__pendingLoad.signal.aborted"), false, "Turn transition aborted an off-turn queued load");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Queued image painted before decoding completed");
      await evaluate(client, "window.__holdLoad=false;__releaseLoad();__waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.equal(await evaluate(client, "__queueCount()"), 0, "Load finishing during the turn remained stranded in the queue");
      await evaluate(client, "__turn('').then(async()=>{window.__holdLoad=true;window.__pendingLoad=null;await __drop('.ssdg-d-dropzone','cancel-loading.png');await __waitFor(()=>!!__pendingLoad&&__queueCount()===1);document.querySelector('.ssdg-d-queue-remove').click();await __waitFor(()=>__queueCount()===0)})");
      assert.equal(await evaluate(client, "__pendingLoad.signal.aborted"), true, "Removing a loading queue entry did not abort decoding");
      await evaluate(client, "(async()=>{window.__holdLoad=false;__releaseLoad();await __settle();await __turn('after-remove');await new Promise(resolve=>setTimeout(resolve,350))})()");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Removed delayed queue load reopened or painted");
      assert.equal(await evaluate(client, "__closed"), 2, "Removed delayed decoded image leaked");
    });
    console.log("PASS queue loading races: off-turn decoding survives turn changes and paints when ready; explicit removal aborts and releases delayed images");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{window.__holdLoad=true;await __drop('.ssdg-d-dropzone','first-loading.png','#4466aa');await __waitFor(()=>!!__pendingLoad&&__queueCount()===1);window.__holdLoad=false;await __drop('.ssdg-d-dropzone','second-ready.png','#aa6644');await __waitFor(()=>__queueReady('second-ready.png'));await __turn('first-ready');await __waitFor(()=>__requests.length===1&&!document.querySelector('.ssdg-d-speed').disabled)})");
      assert.deepEqual(await evaluate(client, "__plans[0].pixel"), [170, 102, 68, 255], "A loading queue head blocked the first ready image");
      assert.equal(await evaluate(client, "__pendingLoad.signal.aborted"), false, "Drawing another queue entry aborted an independent queued load");
      await evaluate(client, "__releaseLoad();new Promise(resolve=>setTimeout(resolve,700))");
      assert.equal(await evaluate(client, "__requests.length"), 1, "Second ready image painted after this turn's automatic queue draw");
      assert.equal(await evaluate(client, "__queueCount()"), 1);
      await evaluate(client, "__turn('remaining-ready');__waitFor(()=>__requests.length===2&&!document.querySelector('.ssdg-d-speed').disabled)");
      assert.deepEqual(await evaluate(client, "__plans[1].pixel"), [68, 102, 170, 255], "Earlier delayed image did not keep its queue position for the next turn");
      assert.equal(await evaluate(client, "__queueCount()"), 0);
      await evaluate(client, "__turn('')");
      assert.equal(await evaluate(client, "__closed"), 2);
    });
    console.log("PASS queue readiness: first ready image can pass loading entries; delayed images remain independent and wait after this turn's automatic draw");

    await page({}, async client => {
      await evaluate(client, "__turn('').then(async()=>{await __drop('.ssdg-d-dropzone','drawing.png');await __waitFor(()=>__queueReady('drawing.png'));await __drop('.ssdg-d-dropzone','remaining.png');await __waitFor(()=>__queueReady('remaining.png'));__change('.ssdg-d-contrast','28','input');document.querySelector('.ssdg-d-image-draw').click();window.__holdDrawing=true;await __turn('queue-interrupted');await __waitFor(()=>__requests.length===1);await __turn('')})");
      assert.equal(await evaluate(client, "__queueCount()"), 1, "Turn end discarded other waiting images");
      await evaluate(client, "document.querySelector('.ssdg-d-queue-edit').click();__settle()");
      assert.equal(await evaluate(client, "__editor.getSettings().contrast"), 28, "Turn end lost the remaining image's edits");
      await evaluate(client, "(async()=>{window.__holdLoad=true;window.__pendingLoad=null;await __drop('.ssdg-d-dropzone','navigation-loading.png');await __waitFor(()=>!!__pendingLoad&&__queueCount()===2);window.dispatchEvent(new Event('pagehide'));await __waitFor(()=>__queueCount()===0)})()");
      assert.equal(await evaluate(client, "__pendingLoad.signal.aborted"), true, "Navigation did not cancel queued decoding");
      assert.equal(await evaluate(client, "__editor.element.hidden"), true, "Navigation retained the queued editor");
      await evaluate(client, "window.__holdLoad=false;__releaseLoad();__settle()");
      assert.equal(await evaluate(client, "__queueCount()"), 0, "Navigation-cancelled loading image returned to the queue");
      assert.equal(await evaluate(client, "__closed"), 3, "Navigation leaked a queued or interrupted bitmap");
      assert.equal(await evaluate(client, "__requests.length"), 1);
    });
    console.log("PASS queue lifecycle: turn interruption retains remaining edited images; navigation clears entries, closes originals and aborts pending decoding");

    for (const interruption of ["none", "off", "stop", "turn"]) await page({}, async client => {
      await evaluate(client, "__drop().then(()=>__waitFor(()=>__loaded===1&&!document.querySelector('.ssdg-d-stop').disabled))");
      assert.equal(await evaluate(client, "__requests.length"), 0, "Image painted without the game palette");
      if (interruption === "off") await evaluate(client, "__change('.ssdg-d-auto-paint',false);__waitFor(()=>!__editor.element.hidden)");
      if (interruption === "stop") await evaluate(client, "document.querySelector('.ssdg-d-stop').click()");
      if (interruption === "turn") await evaluate(client, "document.querySelector('#game-word .word').textContent='nextword';__waitFor(()=>document.querySelector('.ssdg-d-word').textContent.includes('nextword'))");
      await evaluate(client, "__providePalette();__waitFor(()=>document.querySelector('.ssdg-d-stop').disabled);__settle()");
      assert.equal(await evaluate(client, "__requests.length"), interruption === "none" ? 1 : 0, `${interruption} palette wait produced the wrong draw intent`);
      if (interruption === "none") assert.equal(await evaluate(client, "__plans.length"), 1, "Palette readiness converted more than once");
      if (interruption === "off") assert.equal(await evaluate(client, "__editor.element.hidden"), false, "OFF during palette wait did not open preview");
      if (["stop", "turn"].includes(interruption)) assert.equal(await evaluate(client, "__editor.element.hidden"), true, "Cancelled palette wait reopened the image");
    }, { holdPalette: true });
    console.log("PASS palette readiness: deferred colors draw once; OFF previews; Stop/turn races cancel pending auto-paint");

    await page({}, async client => {
      await evaluate(client, "__upload().then(()=>__waitFor(()=>!__editor.element.hidden&&document.querySelector('.ssdg-d-image-preview').width>1))");
      await capture(client, "levels-editor.png");
      if (ARTIFACTS) {
        await evaluate(client, "document.querySelector('.ssdg-d-levels').scrollIntoView({block:'center'});__settle()");
        await capture(client, "levels-controls.png");
      }
      const original = await evaluate(client, "Array.from(document.querySelector('.ssdg-d-image-preview').getContext('2d').getImageData(80,20,1,1).data)");
      const handles = await evaluate(client, "Array.from(document.querySelectorAll('.ssdg-d-level-handle'),handle=>({level:handle.dataset.level,role:handle.getAttribute('role'),label:handle.getAttribute('aria-label')}))");
      assert.deepEqual(handles.map(handle => handle.level), ["inputBlack", "gamma", "inputWhite", "outputBlack", "outputWhite"]);
      assert.ok(handles.every(handle => handle.role === "slider" && handle.label), "Levels lack accessible slider roles or labels");
      async function drag(level, fraction, track = ".ssdg-d-level-input-track") {
        // Scrolling may schedule viewport/ResizeObserver constraints. Measure
        // after those frames so native input uses the settled handle position.
        await evaluate(client, `document.querySelector('.ssdg-d-level-handle[data-level="${level}"]').scrollIntoView({block:'center'});__settle()`);
        const geometry = await evaluate(client, `(()=>{const handle=document.querySelector('.ssdg-d-level-handle[data-level="${level}"]');const h=handle.getBoundingClientRect(),t=document.querySelector('${track}').getBoundingClientRect();return{x:h.left+h.width/2,y:h.top+h.height/2,end:t.left+t.width*${fraction}}})()`);
        assert.equal(await evaluate(client, `document.elementFromPoint(${geometry.x},${geometry.y})?.closest('.ssdg-d-level-handle')?.dataset.level`), level, "Settled level handle is not reachable by native pointer input");
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x, y: geometry.y });
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: geometry.x, y: geometry.y });
        for (const part of [.3, .6, 1]) await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", buttons: 1, x: geometry.x + (geometry.end - geometry.x) * part, y: geometry.y });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: geometry.end, y: geometry.y });
        await evaluate(client, "__settle()");
      }
      await drag("inputBlack", .2);
      assert.ok(await evaluate(client, "__editor.getSettings().levels.RGB.inputBlack>=49&&__editor.getSettings().levels.RGB.inputBlack<=53"), "Dragging black failed to follow pointer");
      const edited = await evaluate(client, "Array.from(document.querySelector('.ssdg-d-image-preview').getContext('2d').getImageData(80,20,1,1).data)");
      assert.notDeepEqual(edited, original, "Level drag did not update native preview pixels");
      await drag("inputWhite", .8); await drag("gamma", .35);
      assert.notEqual(await evaluate(client, "__editor.getSettings().levels.RGB.gamma"), 1, "Gamma drag had no effect");
      await drag("outputBlack", .1, ".ssdg-d-level-output-track"); await drag("outputWhite", .85, ".ssdg-d-level-output-track");
      assert.ok(await evaluate(client, "__editor.getSettings().levels.RGB.outputBlack>0&&__editor.getSettings().levels.RGB.outputWhite<255"), "Output handles did not adjust levels");
      await drag("inputBlack", 1.08);
      assert.ok(await evaluate(client, "__editor.getSettings().levels.RGB.inputBlack<__editor.getSettings().levels.RGB.inputWhite"), "Dragging outside track crossed input limits");
      await evaluate(client, "document.querySelector('.ssdg-d-level-reset').click();__change('.ssdg-d-level-gamma','0.5','input');__settle()");
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-level-gamma').value"), "0.5", "Numeric gamma typing was overwritten");
      assert.equal(await evaluate(client, "Number(document.querySelector('.ssdg-d-level-handle[data-level=gamma]').getAttribute('aria-valuenow'))"), .5, "Numeric input did not update handle");
      await evaluate(client, "__change('.ssdg-d-level-gamma','','input')");
      assert.equal(await evaluate(client, "document.querySelector('.ssdg-d-level-gamma').value"), "", "Empty numeric input could not be typed");
      await evaluate(client, "__change('.ssdg-d-level-gamma','1');__change('.ssdg-d-level-channel','R');__change('.ssdg-d-level-black','42')");
      assert.equal(await evaluate(client, "__editor.getSettings().levels.R.inputBlack"), 42);
      assert.equal(await evaluate(client, "__editor.getSettings().levels.RGB.inputBlack"), 0, "Red adjustment changed master levels");
      await evaluate(client, "__change('.ssdg-d-level-channel','G');document.querySelector('.ssdg-d-level-handle[data-level=inputBlack]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));document.querySelector('.ssdg-d-level-handle[data-level=inputBlack]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}))");
      assert.equal(await evaluate(client, "__editor.getSettings().levels.G.inputBlack"), 11, "Keyboard fine/coarse controls failed");
      await evaluate(client, "document.querySelector('.ssdg-d-level-reset').click();__change('.ssdg-d-level-channel','R')");
      assert.equal(await evaluate(client, "Number(document.querySelector('.ssdg-d-level-black').value)"), 42, "Channel reset affected another channel");
      await evaluate(client, "document.querySelector('.ssdg-d-level-auto').click()");
      assert.ok(await evaluate(client, "__editor.getSettings().levels.R.inputBlack>0&&__editor.getSettings().levels.R.inputWhite<255"), "Auto ignored channel histogram");
      await evaluate(client, "document.querySelector('.ssdg-d-image-reset').click();__settle()");
      assert.deepEqual(await evaluate(client, "Array.from(document.querySelector('.ssdg-d-image-preview').getContext('2d').getImageData(80,20,1,1).data)"), original, "Reset all changed original pixels");
      await evaluate(client, "window.__holdDrawing=true;document.querySelector('.ssdg-d-image-draw').click();__waitFor(()=>__requests.length===1)");
      const before = await evaluate(client, "__editor.getSettings()");
      assert.ok(await evaluate(client, "Array.from(document.querySelectorAll('.ssdg-d-level-handle')).every(handle=>handle.disabled)"), "Handles remained active during drawing");
      await evaluate(client, "const handle=document.querySelector('.ssdg-d-level-handle[data-level=inputBlack]');handle.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));handle.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,pointerId:7,bubbles:true}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:200,pointerId:7,bubbles:true}))");
      assert.deepEqual(await evaluate(client, "__editor.getSettings()"), before, "Disabled levels reacted to input");
      await evaluate(client, "document.querySelector('.ssdg-d-stop').click()");
    });
    console.log("PASS levels: five native pointer drags, clipping, live preview, precise numbers, channel isolation, keyboard, Auto, Reset and disabled safety");
  } finally {
    server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
      const relative = path.relative(os.tmpdir(), browser.profile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-panel-test-")) fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

(async () => { await installDefaults(); await browserTests(); })().catch(error => { console.error(error); process.exitCode = 1; });
