"use strict";

// Run the shipped panel in Chromium against local, simulated runner events.
// No Skribbl connections are made. Node 22+ and Chrome/Edge are sufficient.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname, "..");

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
      const id = ++next, timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`CDP ${method} timed out`));
      }, 20000);
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
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(file => fs.existsSync(file));
  assert.ok(executable, "Set BROWSER to an installed Chrome/Edge browser");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skribbl-votekick-ui-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "about:blank"],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Browser did not start: ${log.slice(-500)}`)), 20000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.stderr.on("data", chunk => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  return { child, profile, client: await connect(endpoint),
    base: endpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "") };
}

async function main() {
  const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div id="game-word"><div class="hints">___</div></div><div id="game-clock"><span class="text">80</span></div>
    <div id="game-players"><div class="player"><span class="player-name me">Tester (You)</span></div></div>
    <div id="game-canvas"><canvas width="800" height="600"></canvas></div><div id="game-toolbar"></div>
    <div id="game-chat"><div class="chat-content"></div></div></body></html>`;
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url.endsWith(".txt") ? "text/plain;charset=utf-8" : "text/html;charset=utf-8");
    res.end(req.url.endsWith(".txt") ? "cat\ndog\ncow\n" : fixture);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser, client;
  try {
    browser = await launchBrowser();
    const { targetId } = await browser.client.send("Target.createTarget", { url: `http://127.0.0.1:${server.address().port}/` });
    const targets = await (await fetch(`${browser.base}/json/list`)).json();
    client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
    await evaluate(client, `window.__waitFor=async(check)=>{const began=performance.now();while(!check()){
      if(performance.now()-began>8000)throw new Error('Votekick UI condition timed out');await new Promise(resolve=>setTimeout(resolve,10))}};
      window.__errors=[];window.addEventListener('error',event=>__errors.push(event.message));
      window.addEventListener('unhandledrejection',event=>__errors.push(String(event.reason)));
      window.__storage={};window.chrome={runtime:{getURL:name=>location.origin+'/'+name,
        sendMessage:(_message,done)=>done?.({ok:true})},storage:{local:{
        get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in __storage).map(key=>[key,structuredClone(__storage[key])])),
        set:async data=>Object.assign(__storage,structuredClone(data))}}};
      window.__request=[];document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-request',event=>__request.push(JSON.parse(event.detail)));
      window.__online=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>__online});
      document.addEventListener('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-request',event=>{if(JSON.parse(event.detail).action==='palette')
        document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-draw-status',{detail:JSON.stringify({state:'palette',id:'ssdg-d-palette',palette:[{index:0,rgb:[255,255,255]},{index:1,rgb:[0,0,0]}]})}))});
      window.__snapshot=(users,room={})=>document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status',{detail:JSON.stringify({
        type:'snapshot',connected:true,lobbyId:'test-room',lobbyType:1,automatic:true,capacity:8,occupied:users.length,
        availableSlots:Math.max(0,8-users.length),users,...room})}));
      window.__state=(state,message,running)=>document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status',{detail:JSON.stringify({type:'status',state,message,running})}));
      window.__users=[{id:1,name:'Me',isSelf:true},{id:2,name:'Owner',isOwner:true},{id:3,name:'Admin',isAdmin:true},
        {id:4,name:'Same name'},{id:5,name:'Same name'},{id:6,name:'<img src=x onerror=window.__injected=true>'}]
        .map(user=>({isSelf:false,isOwner:false,isAdmin:false,...user}));
      __waitFor(()=>document.readyState==='complete');`);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const content = manifest.content_scripts.find(entry => entry.js.includes("content.js"));
    for (const file of content.css) await evaluate(client,
      `document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\uFEFF/, ""))}}));`);
    for (const file of content.js) await evaluate(client, fs.readFileSync(path.join(ROOT, file), "utf8"));
    // The UI must request its own initial snapshot after the asynchronously mounted panel exists.
    await evaluate(client, "__waitFor(()=>__request.some(request=>request.action==='snapshot'))");
    const hidden = "document.querySelector('#ssdg-votekick').hidden&&document.querySelector('#ssdg-votekick').getBoundingClientRect().height===0";
    assert.ok(await evaluate(client, hidden), "Votekick must start completely hidden before lobby detection");
    assert.ok(await evaluate(client, "document.querySelector('#ssdg-votekick-join').disabled"), "Unknown lobby allowed Start");
    for (const lobbyType of [null, 0, "1", true, 2]) {
      await evaluate(client, `__snapshot(__users,{lobbyType:${JSON.stringify(lobbyType)}})`);
      assert.ok(await evaluate(client, hidden), `Votekick was visible for lobby type ${JSON.stringify(lobbyType)}`);
      await evaluate(client, "document.querySelector('#ssdg-votekick form').dispatchEvent(new Event('submit',{cancelable:true}));");
      assert.equal(await evaluate(client, "__request.filter(request=>request.action==='start').length"), 0,
        "A hidden public/unknown form submitted Start");
    }
    await evaluate(client, "__snapshot(__users,{lobbyType:undefined})");
    assert.ok(await evaluate(client, hidden), "Missing lobby type assumed a private lobby");
    await evaluate(client, "__snapshot(__users)");
    assert.ok(!await evaluate(client, hidden), "Confirmed private lobby did not reveal Votekick");

    assert.ok(await evaluate(client, "Boolean(document.querySelector('details#ssdg-votekick'))"), "Votekick section did not mount");
    const selector = "#ssdg-votekick-target";
    const start = "#ssdg-votekick .ssdg-v-join", stop = "#ssdg-votekick .ssdg-v-stop";
    const options = await evaluate(client, `Array.from(document.querySelector(${JSON.stringify(selector)}).options,option=>({value:option.value,text:option.textContent}))`);
    assert.deepEqual(options.filter(option => option.value).map(option => option.value), ["4", "5", "6"]);
    assert.notEqual(options.find(option => option.value === "4").text, options.find(option => option.value === "5").text,
      "Duplicate names need distinguishable options");
    assert.equal(await evaluate(client, "Boolean(window.__injected)"), false, "Player name executed HTML");
    assert.equal(await evaluate(client, "document.querySelectorAll('#ssdg-votekick input').length"), 0,
      "Automatic voting retained a manual session count");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-votekick-room').textContent"), "Lobby: 6/8 players · 2 open slots");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-votekick-help').textContent"),
      "Your vote counts first. Bots use open slots only as needed, then leave.");
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value='5';
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));
      __snapshot(__users,{lobbyType:0,helperRejectionCode:100})`);
    assert.ok(await evaluate(client, hidden), "Public transition left the Votekick section visible");
    assert.ok(await evaluate(client, `document.querySelector(${JSON.stringify(start)}).disabled`),
      "Public transition retained an enabled Votekick button");
    assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), "",
      "Public transition retained a private player selection");
    await evaluate(client, "__snapshot(__users,{lobbyType:1,helperRejectionCode:null})");
    assert.ok(!await evaluate(client, hidden), "Returning to a private lobby did not reveal Votekick");
    assert.ok(!await evaluate(client, "document.querySelector('#ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status').textContent.includes('code 100')"),
      "Public rejection hint persisted in a private-room snapshot");
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value='5';
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));
      __snapshot(__users,{capacity:6,occupied:6,availableSlots:0})`);
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status').textContent"),
      "Lobby full: only your vote will be cast.");
    assert.ok(await evaluate(client, `!document.querySelector(${JSON.stringify(start)}).disabled`),
      "A full lobby prevented casting the user's own vote");
    await evaluate(client, `document.querySelector(${JSON.stringify(start)}).click()`);
    const request = await evaluate(client, "__request.at(-1)");
    assert.deepEqual(request, { action: "start", targetId: 5 });
    await evaluate(client, "__state('voting','Casting your vote.',true)");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status').textContent"), "Casting your vote.",
      "The full-lobby hint replaced running progress");
    assert.ok(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).disabled&&document.querySelector(${JSON.stringify(start)}).disabled&&!document.querySelector(${JSON.stringify(stop)}).disabled`),
      "Running controls did not lock selection or enable Stop");
    await evaluate(client, `document.querySelector(${JSON.stringify(stop)}).click()`);
    assert.equal((await evaluate(client, "__request.at(-1)")).action, "stop");
    await evaluate(client, "__state('stopped','Stopped. Bots left.',false)");
    await evaluate(client, "__snapshot(__users.map(user=>user.id===5?{...user,name:'Renamed player'}:user),{capacity:10,occupied:6,availableSlots:4})");
    assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), "5",
      "Roster/capacity updates lost the selected player ID");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-votekick-target').selectedOptions[0].textContent"), "Renamed player (#5)");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-votekick-room').textContent"), "Lobby: 6/10 players · 4 open slots");
    await evaluate(client, `__snapshot(__users,{capacity:null,occupied:6,availableSlots:null});
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status').textContent"),
      "Your vote will be cast; room capacity is unavailable.");
    assert.equal(await evaluate(client, "document.querySelector('#ssdg-votekick-room').textContent"), "Lobby: 6 players · capacity unavailable");
    assert.ok(await evaluate(client, `!document.querySelector(${JSON.stringify(start)}).disabled`),
      "Unknown capacity prevented casting the user's own vote");
    await evaluate(client, `document.querySelector(${JSON.stringify(start)}).click()`);
    assert.deepEqual(await evaluate(client, "__request.at(-1)"), { action: "start", targetId: 5 },
      "Automatic start included a manual count");
    await evaluate(client, "__state('joining','Adding one bot in an open slot.',true)");
    await evaluate(client, `document.querySelector(${JSON.stringify(stop)}).click()`);
    await evaluate(client, "__state('stopped','Stopped. Bots left.',false);__snapshot(__users.filter(user=>user.id!==5))");
    assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), "",
      "Departed selection silently changed to another player");
    assert.ok(await evaluate(client, `document.querySelector(${JSON.stringify(start)}).disabled`));
    for (const room of [
      { connected: false, lobbyId: null }, { lobbyId: null }, { lobbyType: null }, { lobbyType: 0 },
    ]) {
      await evaluate(client, `__snapshot(__users,${JSON.stringify(room)})`);
      assert.ok(await evaluate(client, hidden), `Unavailable room ${JSON.stringify(room)} remained visible`);
      await evaluate(client, "__snapshot(__users)");
      assert.ok(!await evaluate(client, hidden), "Rejoining private lobby did not restore Votekick");
    }
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value='4';
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));
      __snapshot(__users,{lobbyId:'another-private-room'})`);
    assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), "",
      "Switching private rooms retained a prior room's player selection");
    await evaluate(client, "document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status',{detail:JSON.stringify({type:'snapshot',connected:true,users:null,lobbyType:1})}))");
    assert.ok(await evaluate(client, hidden), "Malformed replacement snapshot retained private visibility");
    await evaluate(client, "__snapshot(__users);__online=false;window.dispatchEvent(new Event('offline'))");
    assert.ok(await evaluate(client, hidden), "Offline state retained private visibility");
    await evaluate(client, "__online=true;window.dispatchEvent(new Event('online'));__snapshot(__users)");
    assert.ok(!await evaluate(client, hidden), "Restored private connection remained hidden");
    await evaluate(client, `document.dispatchEvent(new CustomEvent('ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status',{detail:'{bad json'}));
      document.querySelector('details#ssdg-votekick').open=true`);
    await evaluate(client, "__waitFor(()=>document.querySelector('#ssdg-d-draw-tab')&&document.querySelector('#ssdg-votekick').parentElement.matches('.ssdg-body'))");
    const before = await evaluate(client, "document.querySelector('details#ssdg-votekick').getBoundingClientRect().height");
    assert.ok(before > 0, "Votekick is not visible in Guess tab");
    await evaluate(client, "document.querySelectorAll('.ssdg-d-tabs button')[1].click()");
    assert.ok(await evaluate(client, "document.querySelector('details#ssdg-votekick').getBoundingClientRect().height>0"),
      "Votekick disappeared in Draw tab");
    await client.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate(client, `(()=>{const panel=document.querySelector('#skribbl-smart-drawer-guesser-panel').getBoundingClientRect();
      const section=document.querySelector('#ssdg-votekick').getBoundingClientRect();return section.width<=panel.width&&section.width>0})()`),
      "Votekick overflowed the narrow panel");
    await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");
    assert.equal(await evaluate(client, "Boolean(document.querySelector('#ssdg-votekick'))"), false, "Navigation left stale controls");
    await evaluate(client, "window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));__snapshot(__users)");
    assert.equal(await evaluate(client, "document.querySelectorAll('#ssdg-votekick').length"), 1, "Cached restoration duplicated/missed controls");
    assert.deepEqual(await evaluate(client, "__errors"), []);
    console.log("PASS Votekick browser UI: private-only visibility, initial/public/unknown/malformed/offline states, leave/rejoin/switch transitions, protected targets, private start/stop, full/unknown capacity, occupancy updates, both tabs, narrow layout and cached restoration");
  } finally {
    client?.close(); server.close();
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
      const relative = path.relative(os.tmpdir(), browser.profile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(browser.profile).startsWith("skribbl-votekick-ui-"))
        fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
