"use strict";

// Dependency-free Chromium checks for resizing, visibility and toolbar restoration.
// Uses real mouse input/pointer capture and the production popup script.
//   node scripts/test-panel-window.cjs
//   node scripts/test-panel-window.cjs --artifacts <directory>
// Node 22+; set BROWSER to a Chromium executable if it is not in a usual location.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname, "..");
const artifactIndex = process.argv.indexOf("--artifacts");
const ARTIFACTS = artifactIndex < 0 ? null : path.resolve(process.argv[artifactIndex + 1]);
const SETTINGS = "guesserSettingsV160";
const PANEL = "#skribbl-smart-drawer-guesser-panel";
const WINDOW_SETTINGS = {
  defaultsV161: true, language: "en", delay: 1200, maxGuesses: 22,
  panelSize: { width: 560, height: 480 }, panelPosition: { left: "400px", top: "250px" },
  panelHidden: false, panelRestorePosition: "off", collapsed: false, unknownPreference: "preserve",
};

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skribbl-panel-window-"));
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

async function mount(client, settings) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
  await evaluate(client, `window.__storage=${JSON.stringify({ [SETTINGS]: settings })};window.__writes=[];window.__errors=[];window.__listeners=[];window.__captures=[];window.__gameClicks=0;
    window.addEventListener('error',event=>__errors.push(event.message));window.addEventListener('unhandledrejection',event=>__errors.push(String(event.reason)));
    document.querySelector('#game-underlay').addEventListener('click',()=>__gameClicks++);
    document.addEventListener('pointerdown',event=>window.__pointerEdge=event.target.closest?.('.ssdg-resize-handle')?.dataset.edge||null,true);
    const capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=function(id){__captures.push({id,edge:this.dataset.edge||window.__pointerEdge});return capture.call(this,id)};
    window.chrome={runtime:{id:'panel-test-extension',getURL:name=>name?location.origin+'/'+name:'chrome-extension://panel-test-extension/',
      getManifest:()=>({version:${JSON.stringify(version)}}),onMessage:{addListener:listener=>__listeners.push(listener),removeListener:listener=>{__listeners=__listeners.filter(item=>item!==listener)}},
      sendMessage:(_message,done)=>{done?.({ok:true});return Promise.resolve({ok:true})}},storage:{local:{
      get:(keys,done)=>{const result=Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in __storage).map(key=>[key,structuredClone(__storage[key])]));if(done)queueMicrotask(()=>done(result));return Promise.resolve(result)},
      set:(data,done)=>{Object.assign(__storage,structuredClone(data));__writes.push(structuredClone(data));if(done)queueMicrotask(done);return Promise.resolve()}
    }}};
    window.__waitFor=async(check)=>{const began=performance.now();while(!check()){if(performance.now()-began>8000)throw new Error('Panel condition timed out');await new Promise(resolve=>setTimeout(resolve,10))}};
    window.__settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.__change=(selector,value,type='change')=>{const control=document.querySelector(selector);if(control.type==='checkbox')control.checked=value;else control.value=value;control.dispatchEvent(new Event(type,{bubbles:true}))};
    window.__send=(action,sender={id:chrome.runtime.id})=>{let reply=null;for(const listener of __listeners)listener({type:'SG_PANEL_VISIBILITY',action},sender,response=>{reply=response});return reply};
    window.__status=status=>document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',{detail:JSON.stringify(status)}));
    document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',event=>{const request=JSON.parse(event.detail);if(request.action==='palette')__status({state:'palette',id:'ssdg-d-palette',palette:[{index:0,rgb:[255,255,255]},{index:1,rgb:[0,0,0]}]});if(request.action==='draw')__status({state:'done',id:request.id,message:'Done'})});
    window.SG_IMAGE_CONVERTER={convert:(_image,_palette,settings)=>({style:settings.style,background:0,ops:[],brushes:[Number(settings.brush)],strokes:[],commands:0,seconds:0,metrics:{preprocessMs:0}})};
  `);
  const css = ["styles.css", "auto-draw.css"].map(file => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\uFEFF/, "")).join("\n");
  await evaluate(client, `document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));`);
  for (const file of ["word-catalog.js", "word-library.js", "panel-window.js", "content.js", "image-input.js", "image-adjustments.js", "image-editor.js", "auto-draw.js"]) {
    await evaluate(client, fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  await evaluate(client, "__waitFor(()=>document.querySelector('#ssdg-hide-btn')&&document.querySelector('.ssdg-d-word')?.textContent.includes('testword'));__settle()");
}

async function geometry(client) {
  return evaluate(client, `(()=>{const panel=document.querySelector('${PANEL}'),rect=panel.getBoundingClientRect();return{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,hidden:panel.hidden,inert:panel.inert,display:getComputedStyle(panel).display,collapsed:panel.classList.contains('collapsed')}})()`);
}
function near(actual, expected, description, tolerance = 2) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${description}: expected ${expected}, got ${actual}`);
}
function inViewport(rect, width, height, description) {
  assert.ok(rect.left >= 3 && rect.top >= 3 && rect.right <= width - 3 && rect.bottom <= height - 3, `${description}: ${JSON.stringify(rect)}`);
}
async function mouse(client, type, x, y, button = "none", buttons = 0) {
  await client.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
}
async function click(client, selector) {
  const point = await evaluate(client, `(()=>{const target=document.querySelector(${JSON.stringify(selector)});target.scrollIntoView({block:'nearest'});const rect=target.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  await mouse(client, "mouseMoved", point.x, point.y);
  await mouse(client, "mousePressed", point.x, point.y, "left", 1);
  await mouse(client, "mouseReleased", point.x, point.y, "left");
  await evaluate(client, "__settle()");
}
async function startDrag(client, selector) {
  const point = await evaluate(client, `(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  await mouse(client, "mouseMoved", point.x, point.y);
  await mouse(client, "mousePressed", point.x, point.y, "left", 1);
  return point;
}
async function drag(client, selector, dx, dy) {
  const point = await startDrag(client, selector);
  for (let step = 1; step <= 3; step++) await mouse(client, "mouseMoved", point.x + dx * step / 3, point.y + dy * step / 3, "left", 1);
  await mouse(client, "mouseReleased", point.x + dx, point.y + dy, "left");
  await evaluate(client, "__settle()");
}
const handle = edge => `.ssdg-resize-handle[data-edge="${edge}"]`;

async function mountPopup(client, mode = "game", pending = null) {
  const html = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const source = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  await evaluate(client, `(async()=>{
    window.__popupEvents=[];document.querySelector('#popup-fixture')?.remove();
    const frame=document.createElement('iframe');frame.id='popup-fixture';frame.style.display='none';frame.srcdoc=${JSON.stringify(html)};
    await new Promise(resolve=>{frame.onload=resolve;document.body.append(frame)});
    const popup=frame.contentWindow;window.__popup=popup;
    popup.addEventListener('error',event=>__errors.push('popup: '+event.message));popup.addEventListener('unhandledrejection',event=>__errors.push('popup: '+String(event.reason)));
    const runtime={id:chrome.runtime.id,getManifest:()=>chrome.runtime.getManifest(),getURL:chrome.runtime.getURL,
      requestUpdateCheck:async()=>{__popupEvents.push({kind:'update-check'});return{status:'no_update'}},
      sendMessage:async message=>{__popupEvents.push({kind:'runtime',message});return{ok:true}}};
    popup.chrome={runtime,tabs:{
      query:(query,done)=>{__popupEvents.push({kind:'query',query});const tabs=${JSON.stringify(mode)}==='none'?[]:[{id:7,url:${JSON.stringify(mode === "unsupported" ? "https://example.com/" : "https://skribbl.io/")}}];if(done)queueMicrotask(()=>done(tabs));return Promise.resolve(tabs)},
      sendMessage:(id,message,options,done)=>{if(typeof options==='function')done=options;__popupEvents.push({kind:'tab-message',id,message});
        if(${JSON.stringify(mode)}==='missing'){if(done){queueMicrotask(()=>{runtime.lastError={message:'Could not establish connection. Receiving end does not exist.'};done();delete runtime.lastError});return}return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))}
        const result=__send(message.action,{id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')});if(done)queueMicrotask(()=>done(result));return Promise.resolve(result)},
    },storage:{local:{get:async()=>(${JSON.stringify(pending ? { pendingExtensionUpdate: pending } : {})})}}};
    popup.close=()=>__popupEvents.push({kind:'close'});popup.eval(${JSON.stringify(source)});
    await __waitFor(()=>popup.document.querySelector('#current-version').textContent===chrome.runtime.getManifest().version);await __settle();
  })()`);
}
async function showMenu(client) {
  await evaluate(client, `(async()=>{__popup.document.querySelector('#restore-menu').click();
    await __waitFor(()=>!__popup.document.querySelector('#restore-menu').disabled&&!__popup.document.querySelector('#panel-message').hidden);await __settle()})()`);
}

async function run() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts.find(entry => entry.js.includes("content.js")).js;
  assert.ok(scripts.indexOf("panel-window.js") >= 0 && scripts.indexOf("panel-window.js") < scripts.indexOf("content.js"), "Manifest must load the panel controller before content.js");
  assert.equal(manifest.action.default_popup, "popup.html", "The existing update popup was removed");
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#game-underlay{position:fixed;inset:0;width:100vw;height:100vh;border:0;background:#edf2f7}#game-word,#game-clock,#game-chat{position:relative}#game-canvas{position:fixed;left:12px;bottom:12px;pointer-events:none}#game-canvas canvas{width:800px;height:600px}#game-chat input{position:fixed;left:12px;top:90px}</style></head><body><button id="game-underlay" aria-label="Game surface"></button><div id="game-word"><span class="word">testword</span><span class="hints">_ _ _</span></div><div id="game-clock"><span class="text">80</span></div><div id="game-canvas"><canvas width="800" height="600"></canvas></div><div id="game-toolbar">Drawing toolbar</div><div id="game-chat"><div class="chat-content"></div><form class="chat-form"><input type="text" id="chat-input" placeholder="Type your guess"><button type="submit">Send</button></form></div></body></html>`;
  const server = http.createServer((req, res) => {
    const words = /^\/words(?:-[a-z]+)?\.txt$/.test(req.url) ? "cat\ndog\ntest\n" : null;
    res.setHeader("Content-Type", words === null ? "text/html;charset=utf-8" : "text/plain;charset=utf-8");
    res.end(words === null ? fixture : words);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser, saved;
  try {
    browser = await launchBrowser();
    async function page(settings, task) {
      const { targetId } = await browser.client.send("Target.createTarget", { url: `http://127.0.0.1:${server.address().port}/` });
      const targets = await (await fetch(`${browser.base}/json/list`)).json();
      const client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
      try {
        await client.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1500, deviceScaleFactor: 1, mobile: false });
        await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        for (let tries = 0; !await evaluate(client, "document.readyState==='complete'"); tries++) { assert.ok(tries < 200); await new Promise(resolve => setTimeout(resolve, 10)); }
        await mount(client, structuredClone(settings));
        await task(client);
        assert.deepEqual(await evaluate(client, "__errors"), [], "Panel or popup reported a browser error");
      } finally { client.close(); await browser.client.send("Target.closeTarget", { targetId }); }
    }
    async function capture(client, name) {
      if (!ARTIFACTS) return;
      const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(ARTIFACTS, name), Buffer.from(screenshot.data, "base64"));
    }

    await page(WINDOW_SETTINGS, async client => {
      const initial = await geometry(client);
      near(initial.width, 560, "Restored width"); near(initial.height, 480, "Restored height");
      near(initial.left, 400, "Restored x"); near(initial.top, 250, "Restored y");
      assert.deepEqual(await evaluate(client, "Array.from(document.querySelectorAll('.ssdg-resize-handle'),node=>node.dataset.edge).sort()"), ["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
      for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
        const before = await geometry(client), dx = edge.includes("e") ? 45 : edge.includes("w") ? -45 : 0, dy = edge.includes("s") ? 35 : edge.includes("n") ? -35 : 0;
        await drag(client, handle(edge), dx, dy);
        const after = await geometry(client);
        near(after.width, before.width + (dx ? 45 : 0), `${edge} width`);
        near(after.height, before.height + (dy ? 35 : 0), `${edge} height`);
        near(after.left, before.left + (edge.includes("w") ? -45 : 0), `${edge} left`);
        near(after.top, before.top + (edge.includes("n") ? -35 : 0), `${edge} top`);
        inViewport(after, 1600, 1500, `${edge} resize escaped viewport`);
      }
      const captures = await evaluate(client, "__captures.map(item=>item.edge).filter(Boolean)");
      for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) assert.ok(captures.includes(edge), `${edge} resize did not capture its pointer`);
      const before = await geometry(client);
      await drag(client, `${PANEL} .ssdg-title`, 60, 50);
      const after = await geometry(client);
      near(after.left, before.left + 60, "Header drag x"); near(after.top, before.top + 50, "Header drag y");
      near(after.width, before.width, "Header drag changed width"); near(after.height, before.height, "Header drag changed height");
      saved = await evaluate(client, `__storage.${SETTINGS}`);
      near(saved.panelSize.width, after.width, "Saved width"); near(saved.panelSize.height, after.height, "Saved height");
      near(parseFloat(saved.panelPosition.left), after.left, "Saved x"); near(parseFloat(saved.panelPosition.top), after.top, "Saved y");
      assert.equal(saved.unknownPreference, "preserve"); assert.equal(saved.delay, 1200); assert.equal(saved.maxGuesses, 22);
      await capture(client, "panel-resized.png");
    });
    await page(saved, async client => {
      const rect = await geometry(client);
      near(rect.width, saved.panelSize.width, "Reload width"); near(rect.height, saved.panelSize.height, "Reload height");
      near(rect.left, parseFloat(saved.panelPosition.left), "Reload x"); near(rect.top, parseFloat(saved.panelPosition.top), "Reload y");
    });
    console.log("PASS resize: eight native pointer edges/corners, pointer capture, header drag, saved dimensions/position and reload");

    await page(WINDOW_SETTINGS, async client => {
      const initial = await geometry(client);
      assert.equal(await evaluate(client, `document.querySelector('${handle("se")}').getAttribute('role')`), "button");
      await evaluate(client, `document.querySelector('${handle("se")}').focus()`);
      for (const [key, code, modifiers] of [["ArrowRight", "ArrowRight", 0], ["ArrowDown", "ArrowDown", 8]]) {
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
      }
      await evaluate(client, "__settle()");
      const keyed = await geometry(client);
      near(keyed.width, initial.width + 10, "Keyboard horizontal resize"); near(keyed.height, initial.height + 50, "Shift keyboard vertical resize");
      let point = await startDrag(client, handle("se"));
      await mouse(client, "mouseMoved", point.x + 35, point.y + 25, "left", 1);
      await evaluate(client, `document.querySelector('${PANEL}').releasePointerCapture(__captures.at(-1).id)`);
      await mouse(client, "mouseMoved", point.x + 35, point.y + 25, "left", 1);
      const lost = await geometry(client);
      await mouse(client, "mouseMoved", point.x + 100, point.y + 100, "left", 1);
      await mouse(client, "mouseReleased", point.x + 100, point.y + 100, "left");
      near((await geometry(client)).width, lost.width, "Lost capture left a resizing gesture");
      near((await geometry(client)).height, lost.height, "Lost capture left a resizing gesture height");
      point = await startDrag(client, handle("se"));
      await mouse(client, "mouseMoved", point.x + 25, point.y + 20, "left", 1);
      await evaluate(client, "window.dispatchEvent(new Event('blur'));__settle()");
      const blurred = await geometry(client);
      await mouse(client, "mouseMoved", point.x + 100, point.y + 100, "left", 1);
      await mouse(client, "mouseReleased", point.x + 100, point.y + 100, "left");
      near((await geometry(client)).width, blurred.width, "Blur left a resizing gesture");
      point = await startDrag(client, handle("se"));
      await mouse(client, "mouseMoved", point.x + 20, point.y + 15, "left", 1);
      await evaluate(client, "__send('hide');__settle()");
      const hiddenSize = await evaluate(client, `structuredClone(__storage.${SETTINGS}.panelSize)`);
      await mouse(client, "mouseMoved", point.x + 180, point.y + 180, "left", 1);
      await mouse(client, "mouseReleased", point.x + 180, point.y + 180, "left");
      await evaluate(client, "__send('restore');__settle()");
      const restored = await geometry(client);
      near(restored.width, hiddenSize.width, "Hide during resize continued the old gesture");
      near(restored.height, hiddenSize.height, "Hide during resize continued the old height gesture");
      const touch = await evaluate(client, `(()=>{const rect=document.querySelector('${handle("se")}').getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touch.x, y: touch.y, id: 11 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touch.x + 35, y: touch.y + 30, id: 11 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await evaluate(client, "__settle()");
      const touched = await geometry(client);
      near(touched.width, restored.width + 35, "Native touch resize width"); near(touched.height, restored.height + 30, "Native touch resize height");
      assert.equal(await evaluate(client, `document.querySelector('${PANEL}').classList.contains('ssdg-window-interacting')`), false, "Touch cancellation left the panel interacting");
    });
    console.log("PASS input: keyboard fine/coarse resize, lost capture, blur, hide during resize and native touch cancellation");

    await page(WINDOW_SETTINGS, async client => {
      await drag(client, handle("e"), -2000, 0);
      let rect = await geometry(client);
      assert.ok(rect.width >= 279 && rect.width <= 320, `Minimum width was not usable: ${rect.width}`);
      await drag(client, handle("s"), 0, -2000);
      rect = await geometry(client);
      assert.ok(rect.height >= 179 && rect.height <= 220, `Minimum height was not usable: ${rect.height}`);
      await drag(client, handle("e"), 820, 0); await drag(client, handle("s"), 0, 700);
      rect = await geometry(client);
      assert.ok(rect.width > 1000 && rect.height > 800, `Resizing has an arbitrary maximum: ${JSON.stringify(rect)}`);
      await drag(client, handle("se"), 2500, 2500);
      rect = await geometry(client); inViewport(rect, 1600, 1500, "Large resize");
      assert.ok(rect.width <= 1592 && rect.height <= 1492);
      for (const viewport of [{ width: 320, height: 640 }, { width: 220, height: 160 }]) {
        await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
        await evaluate(client, "__settle()");
        const small = await geometry(client);
        inViewport(small, viewport.width, viewport.height, "Viewport shrink");
        assert.ok(small.width <= viewport.width - 8 && small.height <= viewport.height - 8);
      }
      await capture(client, "panel-small-viewport.png");
    });
    await page({ ...WINDOW_SETTINGS, panelSize: { width: "NaN", height: -400 }, panelPosition: { left: "Infinitypx", top: "bad" }, panelRestorePosition: "middle" }, async client => {
      const rect = await geometry(client); inViewport(rect, 1600, 1500, "Invalid persisted geometry");
      assert.ok(rect.width >= 280 && rect.height >= 180);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-restore-position').value"), "off");
    });
    console.log("PASS bounds: usable minima, expansion beyond 1000 px, viewport limits, tiny viewports and invalid saved geometry");

    await page(WINDOW_SETTINGS, async client => {
      const expanded = await geometry(client);
      await click(client, "#ssdg-collapse-btn");
      let collapsed = await geometry(client);
      assert.equal(collapsed.collapsed, true); assert.equal(collapsed.hidden, false);
      assert.ok(collapsed.height < 100, `Collapse did not reduce the panel to its header: ${collapsed.height}`);
      near(collapsed.left, expanded.left, "Collapse button moved panel x"); near(collapsed.top, expanded.top, "Collapse button moved panel y");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-collapse-btn').getAttribute('aria-expanded')"), "false");
      assert.equal(await evaluate(client, `document.querySelector('${PANEL} .ssdg-body').inert`), true);
      await drag(client, handle("e"), 100, 0);
      collapsed = await geometry(client);
      near(collapsed.width, expanded.width + 100, "Collapsed horizontal resize"); assert.ok(collapsed.height < 100);
      const storedHeight = await evaluate(client, `__storage.${SETTINGS}.panelSize.height`);
      near(storedHeight, expanded.height, "Collapsed resize overwrote expanded height");
      await click(client, "#ssdg-collapse-btn");
      const restored = await geometry(client);
      near(restored.height, expanded.height, "Expanded height after collapsed resize"); near(restored.width, expanded.width + 100, "Expanded width after collapsed resize");
      await click(client, "#ssdg-hide-btn");
      const hidden = await geometry(client);
      assert.equal(hidden.hidden, true); assert.equal(hidden.inert, true); assert.equal(hidden.display, "none");
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.panelHidden`), true);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-panel-restore')"), null, "OFF restore position created a hotspot");
      assert.equal(await evaluate(client, "document.querySelectorAll('[id=skribbl-smart-drawer-guesser-panel]').length"), 1, "Hide removed or duplicated the panel");
      await mouse(client, "mouseMoved", expanded.left + 80, expanded.top + 90);
      await mouse(client, "mousePressed", expanded.left + 80, expanded.top + 90, "left", 1);
      await mouse(client, "mouseReleased", expanded.left + 80, expanded.top + 90, "left");
      assert.equal(await evaluate(client, "__gameClicks"), 1, "Hidden panel intercepted a game click");
      const keys = await evaluate(client, `(()=>{const input=document.querySelector('#chat-input');input.focus();return['f','a','1'].map(key=>{const event=new KeyboardEvent('keydown',{key,altKey:true,bubbles:true,cancelable:true});input.dispatchEvent(event);return{prevented:event.defaultPrevented,focused:document.activeElement.id}})})()`);
      for (const entry of keys) { assert.equal(entry.prevented, false, "Hidden panel intercepted a shortcut"); assert.equal(entry.focused, "chat-input", "Hidden panel stole focus"); }
      const writeCount = await evaluate(client, "__writes.length");
      const status = await evaluate(client, "__send('status')");
      assert.equal(status.ok, true); assert.equal(status.hidden, true);
      assert.equal(await evaluate(client, "__writes.length"), writeCount, "A status message wrote settings");
      for (const sender of [{}, { id: "other-extension" }]) {
        await evaluate(client, `__send('restore',${JSON.stringify(sender)})`);
        assert.equal((await geometry(client)).hidden, true, "An untrusted sender restored the panel");
      }
      await evaluate(client, "__send('restore');__settle()");
      const visible = await geometry(client);
      assert.equal(visible.hidden, false); assert.equal(visible.inert, false); assert.equal(visible.collapsed, false);
      near(visible.width, restored.width, "Restore width"); near(visible.height, restored.height, "Restore height");
      near(visible.left, restored.left, "Hide button moved panel x"); near(visible.top, restored.top, "Hide button moved panel y");
      await evaluate(client, "__send('toggle');__settle()"); assert.equal((await geometry(client)).hidden, true);
      await evaluate(client, "__send('toggle');__settle()"); assert.equal((await geometry(client)).hidden, false);
      await click(client, "#ssdg-d-guess-tab");
      await evaluate(client, "__change('#ssdg-search','dog','input')");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-search').value"), "dog");
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.unknownPreference`), "preserve");
      await evaluate(client, "__send('hide');__send('restore');__settle()");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-d-guess-tab').getAttribute('aria-selected')"), "true", "Restore changed the active tab");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-search').value"), "dog", "Restore lost the search state");
      saved = await evaluate(client, `__send('hide');__waitFor(()=>__storage.${SETTINGS}.panelHidden).then(()=>structuredClone(__storage.${SETTINGS}))`);
    });
    await page(saved, async client => {
      assert.equal((await geometry(client)).hidden, true, "Hidden preference did not survive reload");
      await evaluate(client, "__send('restore');__settle()"); assert.equal((await geometry(client)).hidden, false);
    });
    await page({ ...WINDOW_SETTINGS, collapsed: true, panelHidden: true }, async client => {
      await evaluate(client, "__send('restore');__settle()");
      const restored = await geometry(client);
      assert.equal(restored.hidden, false); assert.equal(restored.collapsed, true); assert.ok(restored.height < 100);
      await click(client, "#ssdg-collapse-btn");
      near((await geometry(client)).height, WINDOW_SETTINGS.panelSize.height, "Restore lost collapsed expanded height");
    });
    console.log("PASS visibility: distinct collapse/hide, collapsed width, retained size, click-through, inert focus, trusted commands and persisted hidden state");

    for (const corner of ["top-right", "top-left", "bottom-right", "bottom-left"]) await page(WINDOW_SETTINGS, async client => {
      await evaluate(client, `__change('#ssdg-restore-position',${JSON.stringify(corner)});__send('hide');__settle()`);
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.panelRestorePosition`), corner, "Restore position was not saved");
      const hotspot = await evaluate(client, `(()=>{const node=document.querySelector('#ssdg-panel-restore'),r=node.getBoundingClientRect(),style=getComputedStyle(node);return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,opacity:Number(style.opacity),label:node.getAttribute('aria-label')}})()`);
      assert.ok(hotspot.label && hotspot.width <= 24 && hotspot.height <= 24 && hotspot.width >= 12, `Restore hotspot is not discreet/accessibly named: ${JSON.stringify(hotspot)}`);
      assert.equal(hotspot.opacity, 0, "Idle hotspot was visible");
      if (corner.includes("left")) assert.ok(hotspot.left <= 12); else assert.ok(hotspot.right >= 1588);
      if (corner.includes("top")) assert.ok(hotspot.top <= 12); else assert.ok(hotspot.bottom >= 1488);
      await mouse(client, "mouseMoved", hotspot.left + hotspot.width / 2, hotspot.top + hotspot.height / 2);
      await evaluate(client, "new Promise(resolve=>setTimeout(resolve,180))");
      assert.ok(await evaluate(client, "Number(getComputedStyle(document.querySelector('#ssdg-panel-restore')).opacity)") > 0, "Hovered hotspot did not become visible");
      await mouse(client, "mouseMoved", 800, 1000);
      await evaluate(client, "document.querySelector('#ssdg-panel-restore').focus();new Promise(resolve=>setTimeout(resolve,180))");
      assert.ok(await evaluate(client, "Number(getComputedStyle(document.querySelector('#ssdg-panel-restore')).opacity)") > 0, "Focused hotspot did not become visible");
      await click(client, "#ssdg-panel-restore"); assert.equal((await geometry(client)).hidden, false);
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-panel-restore')"), null, "Visible panel retained a game-covering hotspot");
    });
    console.log("PASS hotspots: all four saved corners, small hidden idle target, hover/focus reveal and restore");

    await page({ ...WINDOW_SETTINGS, panelHidden: true }, async client => {
      const settingsBeforePopup = await evaluate(client, `structuredClone(__storage.${SETTINGS})`);
      const writesBeforePopup = await evaluate(client, "__writes.length");
      await mountPopup(client, "game");
      assert.equal((await geometry(client)).hidden, true, "Opening the toolbar popup restored the panel before Show menu was clicked");
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='query'||event.kind==='tab-message').length"), 0,
        "Opening the toolbar popup queried or messaged the active tab");
      assert.deepEqual(await evaluate(client, `__storage.${SETTINGS}`), settingsBeforePopup, "Opening the toolbar popup changed saved menu settings");
      assert.equal(await evaluate(client, "__writes.length"), writesBeforePopup, "Opening the toolbar popup wrote settings");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#panel-message').hidden"), true, "Opening the toolbar popup attempted to show the menu");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#current-version').textContent"), manifest.version);
      await showMenu(client);
      await evaluate(client, `__waitFor(()=>!__storage.${SETTINGS}.panelHidden)`);
      assert.equal((await geometry(client)).hidden, false, "Show menu did not restore the panel");
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='query').length"), 1, "Show menu did not query the active tab exactly once");
      const messages = await evaluate(client, "__popupEvents.filter(event=>event.kind==='tab-message')");
      assert.equal(messages.length, 1); assert.equal(messages[0].id, 7); assert.equal(messages[0].message.type, "SG_PANEL_VISIBILITY"); assert.equal(messages[0].message.action, "restore");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#panel-message').textContent"), "Menu shown. Your settings are preserved.");
      await evaluate(client, "__popup.document.querySelector('#check-update').click();__waitFor(()=>!__popup.document.querySelector('#check-update').disabled)");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#status-title').textContent"), "Up to date");
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='update-check').length"), 1, "Popup update checking stopped working");
      await evaluate(client, `(async()=>{__send('hide');await __waitFor(()=>__storage.${SETTINGS}.panelHidden);await __settle()})()`);
      await mountPopup(client, "game", { version: "9.0.0" });
      assert.equal((await geometry(client)).hidden, true, "Opening the update-ready popup restored the panel");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#check-update').dataset.action"), "apply");
      await evaluate(client, "__popup.document.querySelector('#check-update').click()");
      assert.equal(await evaluate(client, "__popupEvents.some(event=>event.kind==='runtime'&&event.message.type==='APPLY_EXTENSION_UPDATE')"), true, "Popup apply-update action stopped working");
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='query'||event.kind==='tab-message').length"), 0, "Applying an update attempted to restore the menu");
      assert.equal((await geometry(client)).hidden, true, "Applying an update restored the panel");
    });
    for (const mode of ["unsupported", "none", "missing"]) await page({ ...WINDOW_SETTINGS, panelHidden: true }, async client => {
      await mountPopup(client, mode);
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='query'||event.kind==='tab-message').length"), 0, "Opening the popup attempted to reach a game tab");
      await showMenu(client);
      assert.equal((await geometry(client)).hidden, true);
      if (mode !== "missing") assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='tab-message').length"), 0, "Popup messaged an unsupported/missing tab");
      else assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='tab-message').length"), 4, "Show menu did not retry a missing receiver");
      assert.equal(await evaluate(client, "__popupEvents.filter(event=>event.kind==='query').length"), 1, "Show menu did not query the active tab exactly once");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#panel-message').hidden"), false, "Restore failure did not show guidance");
      assert.equal(await evaluate(client, "__popup.document.querySelector('#check-update').disabled"), false, "Restore failure disabled update controls");
    });
    console.log("PASS toolbar: opening popup preserves hidden menu/settings, Show menu restores active game, update/check/apply UI and unsupported/missing receivers remain supported");

    await page({ ...WINDOW_SETTINGS, panelRestorePosition: "bottom-left" }, async client => {
      const start = await startDrag(client, handle("se"));
      await mouse(client, "mouseMoved", start.x + 45, start.y + 35, "left", 1);
      await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));__settle()");
      const stopped = await geometry(client);
      await mouse(client, "mouseMoved", start.x + 180, start.y + 150, "left", 1);
      await mouse(client, "mouseReleased", start.x + 180, start.y + 150, "left");
      const after = await geometry(client);
      near(after.width, stopped.width, "pagehide left an active resize"); near(after.height, stopped.height, "pagehide left an active resize height");
      await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));__settle()");
      const before = await geometry(client); await drag(client, handle("e"), 50, 0);
      near((await geometry(client)).width, before.width + 50, "pageshow failed to reactivate resize");
      for (let index = 0; index < 3; index++) await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));__settle()");
      const again = await geometry(client); await drag(client, handle("e"), 30, 0);
      near((await geometry(client)).width, again.width + 30, "Repeated lifecycle duplicated drag handlers");
      await evaluate(client, "__send('hide');__settle()");
      assert.equal(await evaluate(client, "document.querySelectorAll('#ssdg-panel-restore').length"), 1);
      await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));__settle()");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-panel-restore')"), null, "pagehide retained the hotspot");
      await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));__settle()");
      assert.equal(await evaluate(client, "document.querySelectorAll('#ssdg-panel-restore').length"), 1, "pageshow failed to restore one hotspot");
      await click(client, "#ssdg-panel-restore"); assert.equal((await geometry(client)).hidden, false);
    });
    console.log("PASS lifecycle: resize cancellation, pageshow reactivation, repeated cycles without duplication and hidden hotspot cleanup");

    await page(WINDOW_SETTINGS, async client => {
      const before = await geometry(client);
      await evaluate(client, `__storage.${SETTINGS}={...__storage.${SETTINGS},
        panelSize:{width:777,height:555},panelHidden:true,minHints:4,externalPreference:'keep'};
        __change('#ssdg-delay','1700');
        __waitFor(()=>__storage.${SETTINGS}.delay===1700);__settle()`);
      const saved = await evaluate(client, `__storage.${SETTINGS}`);
      assert.deepEqual(saved.panelSize, { width: 777, height: 555 }, "An unrelated local save overwrote another tab's dimensions");
      assert.equal(saved.panelHidden, true, "An unrelated local save overwrote another tab's hidden preference");
      assert.equal(saved.minHints, 4, "An unrelated local save overwrote another tab's hint threshold");
      assert.equal(saved.externalPreference, "keep", "Saving removed a setting added by another tab");
      const after = await geometry(client);
      near(after.width, before.width, "Another tab's saved size changed this active tab's width");
      near(after.height, before.height, "Another tab's saved size changed this active tab's height");
      assert.equal(after.hidden, false, "Another tab's hidden preference hid this active menu");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-min-hints').value"), "0",
        "Another tab's saved hint threshold changed this active tab's selection");
      await evaluate(client, `__change('#ssdg-delay','1900');__waitFor(()=>__storage.${SETTINGS}.delay===1900)`);
      assert.deepEqual(await evaluate(client, `({size:__storage.${SETTINGS}.panelSize,hidden:__storage.${SETTINGS}.panelHidden,hints:__storage.${SETTINGS}.minHints})`),
        { size: { width: 777, height: 555 }, hidden: true, hints: 4 }, "Repeated unrelated saves restored stale tab preferences");
    });

    await page(WINDOW_SETTINGS, async client => {
      await evaluate(client, `window.__failedSettingsWrites=0;const originalSet=chrome.storage.local.set;
        chrome.storage.local.set=async(data,done)=>{
          if(Object.hasOwn(data,${JSON.stringify(SETTINGS)})&&!__failedSettingsWrites){
            __failedSettingsWrites++;throw new Error('Simulated settings write failure');
          }
          return originalSet(data,done);
        };
        __change('#ssdg-min-hints','3');__waitFor(()=>__failedSettingsWrites===1);__settle()`);
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.minHints`), 0, "A failed write unexpectedly updated storage");
      assert.equal(await evaluate(client, "document.querySelector('#ssdg-min-hints').value"), "3", "A failed save lost the current selection");
      await evaluate(client, `__change('#ssdg-delay','2100');__waitFor(()=>__storage.${SETTINGS}.delay===2100)`);
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.minHints`), 3, "A later unrelated save did not retry the unsaved hint threshold");
      assert.equal(await evaluate(client, "__failedSettingsWrites"), 1, "The failure fixture did not remain bounded to one write");
    });

    await page(WINDOW_SETTINGS, async client => {
      await evaluate(client, `window.__pendingSettingsWrites=0;window.__concurrentSettingsWrites=0;
        window.__settingsWriteOrder=[];const originalSet=chrome.storage.local.set;
        chrome.storage.local.set=async(data,done)=>{
          if(!Object.hasOwn(data,${JSON.stringify(SETTINGS)}))return originalSet(data,done);
          __pendingSettingsWrites++;__concurrentSettingsWrites=Math.max(__concurrentSettingsWrites,__pendingSettingsWrites);
          try{
            if(!__settingsWriteOrder.length)await new Promise(resolve=>window.__releaseSettingsWrite=resolve);
            __settingsWriteOrder.push(data.${SETTINGS}.panelHidden);
            return await originalSet(data,done);
          }finally{__pendingSettingsWrites--;}
        };
        __send('hide');__waitFor(()=>typeof __releaseSettingsWrite==='function')`);
      await evaluate(client, "__send('restore');__send('hide');__send('restore');__settle()");
      assert.equal((await geometry(client)).hidden, false, "Queued saves delayed the latest visibility command");
      assert.equal(await evaluate(client, "__pendingSettingsWrites"), 1, "Another settings write started before the pending one completed");
      await evaluate(client, `__releaseSettingsWrite();__waitFor(()=>__settingsWriteOrder.length===4&&__pendingSettingsWrites===0)`);
      assert.deepEqual(await evaluate(client, "__settingsWriteOrder"), [true, false, true, false], "Rapid visibility changes persisted out of order");
      assert.equal(await evaluate(client, "__concurrentSettingsWrites"), 1, "Settings saves overlapped within the tab");
      assert.equal(await evaluate(client, `__storage.${SETTINGS}.panelHidden`), false, "Storage retained an earlier visibility command");
      assert.deepEqual(await evaluate(client, `__storage.${SETTINGS}.panelSize`), WINDOW_SETTINGS.panelSize, "Queued visibility writes lost menu dimensions");
    });
    console.log("PASS storage: unrelated saves preserve external tab preferences, active tabs stay independent, failed writes retry dirty state and rapid visibility saves remain ordered");
  } finally {
    server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
      const relative = path.relative(os.tmpdir(), browser.profile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-panel-window-")) fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
