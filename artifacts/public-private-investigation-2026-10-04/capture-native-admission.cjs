"use strict";

// Bounded, opt-in native UI admission comparison. No votes/chat/gameplay.
// Node 22+, Chrome/Edge; --live permits one public match and one invitation,
// then one new private room and one invitation. No retries or proxy changes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const ROOT = path.resolve(__dirname, "../..");
const utilities = fs.readFileSync(path.join(ROOT, "scripts/test-votekick-ui.cjs"), "utf8")
  .split("async function main() {")[0];
const sandbox = { require, process, console, WebSocket, setTimeout, clearTimeout,
  __dirname: path.join(ROOT, "scripts") };
vm.runInNewContext(utilities + "\nthis.browserTools={launchBrowser,evaluate};", sandbox);
const { launchBrowser, evaluate } = sandbox.browserTools;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const aliases = new Map();
function alias(value, kind) {
  if (typeof value !== "string" || value === "") return value;
  const key = kind + ":" + value;
  if (!aliases.has(key)) aliases.set(key, kind + "-" + (1 + [...aliases.keys()].filter(k => k.startsWith(kind + ":")).length));
  return aliases.get(key);
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "skribbl.io" && url.search) url.search = "?" + alias(url.search.slice(1), "room");
    else if (url.searchParams.has("sid")) url.searchParams.set("sid", alias(url.searchParams.get("sid"), "engine"));
    return url.href;
  } catch { return "[unparsed URL]"; }
}
function headers(source = {}) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (lower === "cookie" || lower === "set-cookie") result[lower] = { present: true, values: "omitted" };
    else if (["origin", "referer"].includes(lower)) result[lower] = safeUrl(String(value));
    else if (["sec-websocket-key", "sec-websocket-accept"].includes(lower)) result[lower] = "[fresh handshake value omitted]";
    else if (["content-type", "user-agent", "sec-ch-ua", "sec-ch-ua-platform", "sec-ch-ua-mobile", "sec-fetch-site",
      "sec-fetch-mode", "sec-fetch-dest", "sec-websocket-version", "upgrade", "connection", "server",
      "access-control-allow-origin", "access-control-allow-credentials", "retry-after"].includes(lower)) result[lower] = value;
  }
  return result;
}
function roomShape(value) {
  const text = String(value);
  return { length: text.length, alphanumeric: /^[A-Za-z0-9]+$/.test(text), trailingDigits: text.match(/\d+$/)?.[0].length || 0 };
}
function snapshot(value) {
  return { id: alias(value.id, "room"), roomShape: roomShape(value.id), type: value.type,
    me: value.me, owner: value.owner, settings: value.settings, users: (value.users || []).map(user => ({ id: user.id, flags: user.flags })) };
}
function frame(payload, direction) {
  if (payload === "2" || payload === "3" || payload === "40" || payload === "41") return { text: payload };
  try {
    if (payload.startsWith("0{")) {
      const data = JSON.parse(payload.slice(1)); data.sid = alias(data.sid, "engine");
      return { text: "0" + JSON.stringify(data) };
    }
    if (payload.startsWith("40{")) {
      const data = JSON.parse(payload.slice(2)); data.sid = alias(data.sid, "socket");
      return { text: "40" + JSON.stringify(data) };
    }
    if (!payload.startsWith("42[")) return null;
    const [event, data] = JSON.parse(payload.slice(2));
    if (event === "login") return { text: "42" + JSON.stringify([event, { ...data, join: alias(data.join, "room"), code: data.code === undefined ? undefined : "[omitted]" }]) };
    if (event === "joinerr" || event === "reason") return { text: "42" + JSON.stringify([event, data]) };
    if (event === "data" && data?.id === 10) return { text: "42" + JSON.stringify([event, { id: 10, data: snapshot(data.data) }]), reduced: true };
    // Other players' chat/drawing/gameplay and unrelated broadcasts are discarded.
    if (direction === "sent") return { unexpectedApplicationEmission: true, event, packetId: data?.id };
  } catch { return { parseFailure: true, size: payload.length }; }
  return null;
}
async function connectWithEvents(endpoint, onEvent) {
  const socket = new WebSocket(endpoint), pending = new Map();
  let ordinal = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method) { onEvent(message.method, message.params); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { send(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++ordinal, timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); }, close() { socket.close(); } };
}
const hook = `(() => {
  const probe = window.__probe = { records: [], blocked: [] };
  let factory;
  Object.defineProperty(window, 'io', {configurable:true, get:()=>factory, set:value=>{
    factory = new Proxy(value, {apply(target, thisArg, args) {
      if (probe.records.length) throw new Error('Diagnostic permits one game socket per page.');
      const socket = Reflect.apply(target, thisArg, [args[0], {...args[1],reconnection:false}]);
      const record = {socket, uri:args[0], options:args[1], outcome:null, room:null, users:new Set()};
      probe.records.push(record);
      const emit = socket.emit;
      socket.emit = function(event, ...parameters) {
        if (event !== 'login') { probe.blocked.push({event,packetId:parameters[0]?.id}); return this; }
        if (record.loginSent) { probe.blocked.push({event:'repeat-login'}); return this; }
        record.loginSent = true;
        record.login = parameters[0]; return Reflect.apply(emit, this, [event,...parameters]);
      };
      socket.on('connect',()=>{record.socketId=socket.id;record.engineId=socket.io.engine?.id;});
      socket.on('joinerr',code=>{record.outcome={joinerr:code};});
      socket.on('connect_error',()=>{record.outcome={connectError:true};});
      socket.on('data',packet=>{
        if(packet?.id===10){record.room=packet.data;record.users=new Set(packet.data.users.map(user=>user.id));record.outcome={joined:true};}
        else if(packet?.id===1)record.users.add(packet.data.id);
        else if(packet?.id===2)record.users.delete(packet.data.id);
        else if(packet?.id===12 && String(packet.data?.id)==='1' && record.room)record.room.settings[1]=packet.data.val;
      });
      return socket;
    }});
  }});
  window.__probeSummary = () => probe.records.map(record=>({
    outcome:record.outcome,room:record.room?.id,type:record.room?.type,me:record.room?.me,
    owner:record.room?.owner,capacity:Number(record.room?.settings?.[1]),occupied:record.users.size,
    uri:record.uri,path:record.options?.path,socketId:record.socketId,engineId:record.engineId,
    login:record.login,connected:record.socket.connected
  }));
  window.__closeProbe = () => probe.records.forEach(record=>record.socket.close());
})();`;
async function main() {
  if (!process.argv.includes("--live")) {
    console.log("No network activity. Add --live for four bounded native login attempts; application emissions other than login are blocked."); return;
  }
  const language = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : "3";
  if (!/^\d+$/.test(language) || Number(language) > 27) throw new Error("Invalid language ID");
  const report = { date: "2026-10-04", startedAtUtc: new Date().toISOString(), language: Number(language),
    method: "Native page UI; one socket/login per page; automatic reconnection disabled; login-only emitter guard; same browser/network; four maximum sessions", sessions: [], results: {} };
  let browser;
  const clients = [], tasks = [];
  async function page(label, url) {
    const session = { label, requests: [], websocketEvents: [], errors: [] }; report.sessions.push(session);
    const { targetId } = await browser.client.send("Target.createTarget", { url: "about:blank" });
    const targets = await (await fetch(browser.base + "/json/list")).json();
    let client;
    const tracked = new Map(), gameWebSockets = new Set(), extraHeaders = new Map();
    const append = (type, data) => session.websocketEvents.push({ type, ...data });
    client = await connectWithEvents(targets.find(target => target.id === targetId).webSocketDebuggerUrl, (method, params) => {
      if (method === "Network.requestWillBeSent") {
        const request = params.request;
        if (!/^https:\/\/(?:[^/]+\.)?skribbl\.io\//.test(request.url)) return;
        if (![/\/api\/play(?:$|\?)/, /\/js\/(?:game|socket\.io)\.js/, /^https:\/\/skribbl\.io\/(?:\?.*)?$/].some(pattern=>pattern.test(request.url))) return;
        const row = { method:request.method, url:safeUrl(request.url), type:params.type, headers:headers(request.headers), time:params.timestamp };
        if (request.postData) {
          const body = new URLSearchParams(request.postData);
          row.body = body.has("id") ? "id=" + alias(body.get("id"), "room") : request.postData;
        }
        if (extraHeaders.has(params.requestId)) row.wireHeaders = extraHeaders.get(params.requestId);
        tracked.set(params.requestId,row); session.requests.push(row);
      } else if (method === "Network.requestWillBeSentExtraInfo") {
        const sanitized = headers(params.headers);
        extraHeaders.set(params.requestId,sanitized);
        if (tracked.has(params.requestId)) tracked.get(params.requestId).wireHeaders = sanitized;
      } else if (method === "Network.responseReceived" && tracked.has(params.requestId)) {
        Object.assign(tracked.get(params.requestId), { status:params.response.status, responseHeaders:headers(params.response.headers) });
      } else if (method === "Network.loadingFinished" && tracked.get(params.requestId)?.url.endsWith("/api/play")) {
        tasks.push(client.send("Network.getResponseBody", {requestId:params.requestId}).then(result=>{
          tracked.get(params.requestId).responseBody = safeUrl(result.body.trim());
        }).catch(error=>session.errors.push(error.message)));
      } else if (method === "Network.webSocketCreated") {
        const endpoint = new URL(params.url);
        if (endpoint.protocol !== "wss:" || !endpoint.hostname.endsWith(".skribbl.io") || !/^\/\d+\/$/.test(endpoint.pathname)) return;
        gameWebSockets.add(params.requestId); append("created", {id:params.requestId,url:safeUrl(params.url)});
      }
      else if (method === "Network.webSocketWillSendHandshakeRequest" && gameWebSockets.has(params.requestId)) append("handshake-request", {id:params.requestId,time:params.timestamp,headers:headers(params.request.headers)});
      else if (method === "Network.webSocketHandshakeResponseReceived" && gameWebSockets.has(params.requestId)) append("handshake-response", {id:params.requestId,time:params.timestamp,status:params.response.status,headers:headers(params.response.headers)});
      else if ((method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") && gameWebSockets.has(params.requestId)) {
        const direction = method.endsWith("Sent") ? "sent" : "received";
        const reduced = frame(params.response.payloadData, direction);
        if (reduced) append(direction,{id:params.requestId,time:params.timestamp,...reduced});
      } else if (method === "Network.webSocketClosed" && gameWebSockets.has(params.requestId)) append("closed", {id:params.requestId,time:params.timestamp});
      else if (method === "Network.webSocketFrameError" && gameWebSockets.has(params.requestId)) session.errors.push(params.errorMessage);
    });
    clients.push(client);
    await client.send("Network.enable"); await client.send("Page.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", {source:hook});
    await client.send("Page.navigate", {url});
    await waitFor(client, "typeof io==='function' && Boolean(document.querySelector('.button-play')) && document.readyState==='complete'", 20000);
    return client;
  }
  async function waitFor(client, condition, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (await evaluate(client, condition)) return; } catch {}
      await pause(100);
    }
    throw new Error("Native page or admission condition timed out");
  }
  async function login(client, name, create) {
    await evaluate(client, `document.querySelector('#home .input-name').value=${JSON.stringify(name)};
      document.querySelector('#home .container-name-lang select').value=${JSON.stringify(language)};
      document.querySelector(${JSON.stringify(create ? ".button-create" : ".button-play")}).click();`);
    await waitFor(client, "__probe.records.some(record=>record.outcome!==null)");
    const raw = (await evaluate(client, "__probeSummary()"))[0];
    const result = {...raw, room:alias(raw.room,"room"),roomShape:raw.room?roomShape(raw.room):undefined,
      socketId:alias(raw.socketId,"socket"),engineId:alias(raw.engineId,"engine"),
      login:raw.login ? {...raw.login,join:alias(raw.login.join,"room"),code:raw.login.code===undefined?undefined:"[omitted]"} : undefined};
    return {raw,result};
  }
  try {
    browser = await launchBrowser();
    report.browser = await browser.client.send("Browser.getVersion");
    const publicPage = await page("public-primary", "https://skribbl.io/");
    const primary = await login(publicPage,"Research Alpha",false);
    report.results.publicPrimary = primary.result; console.log("Public primary:",JSON.stringify(primary.result));
    if (primary.raw.outcome.joined && primary.raw.type===0) {
      await pause(12500);
      const current = (await evaluate(publicPage,"__probeSummary()"))[0];
      report.results.publicBeforeInvite = {occupied:current.occupied,capacity:current.capacity,connected:current.connected};
      if (current.connected && current.occupied < current.capacity) {
        const invited = await page("public-invitation", "https://skribbl.io/?" + encodeURIComponent(primary.raw.room));
        const peer = await login(invited,"Research Beta",false);
        report.results.publicInvite = peer.result; console.log("Public invitation:",JSON.stringify(peer.result));
        report.results.publicDistinctEngineSessions = Boolean(primary.raw.engineId && peer.raw.engineId && primary.raw.engineId !== peer.raw.engineId);
        report.results.publicDistinctSocketSessions = Boolean(primary.raw.socketId && peer.raw.socketId && primary.raw.socketId !== peer.raw.socketId);
        await evaluate(invited,"__closeProbe()");
      } else report.results.publicInviteSkipped = "Primary disconnected or no free slot; no retry";
    }
    await evaluate(publicPage,"__closeProbe()");
    await pause(12500);
    const privatePage = await page("private-create", "https://skribbl.io/");
    const privatePrimary = await login(privatePage,"Research Owner",true);
    report.results.privatePrimary = privatePrimary.result; console.log("Private creator:",JSON.stringify(privatePrimary.result));
    if (privatePrimary.raw.outcome.joined && privatePrimary.raw.type===1) {
      await pause(12500);
      const invited = await page("private-invitation", "https://skribbl.io/?" + encodeURIComponent(privatePrimary.raw.room));
      const peer = await login(invited,"Research Guest",false);
      report.results.privateInvite = peer.result; console.log("Private invitation:",JSON.stringify(peer.result));
      report.results.privateDistinctEngineSessions = Boolean(privatePrimary.raw.engineId && peer.raw.engineId && privatePrimary.raw.engineId !== peer.raw.engineId);
      report.results.privateDistinctSocketSessions = Boolean(privatePrimary.raw.socketId && peer.raw.socketId && privatePrimary.raw.socketId !== peer.raw.socketId);
      await evaluate(invited,"__closeProbe()");
    }
    await evaluate(privatePage,"__closeProbe()");
  } catch (error) { report.error = error.message; process.exitCode = 1; }
  finally {
    for (const client of clients) {
      try {
        const blocked = await evaluate(client,"(()=>{__closeProbe();return __probe.blocked})()");
        report.sessions[clients.indexOf(client)].blockedApplicationEmissions = blocked;
      } catch {}
    }
    await Promise.allSettled(tasks);
    report.finishedAtUtc = new Date().toISOString();
    report.sentNonLoginApplicationFrames = report.sessions.flatMap(s=>s.websocketEvents).filter(e=>e.unexpectedApplicationEmission).length;
    fs.writeFileSync(path.join(__dirname,"native-admission-capture.json"),JSON.stringify(report,null,2)+"\n");
    console.log("Saved sanitized capture; non-login application frames sent:", report.sentNonLoginApplicationFrames);
    clients.forEach(client=>client.close());
    if (browser) {
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([once(browser.child,"exit"),pause(5000)]);
      const resolved = path.resolve(browser.profile), relative = path.relative(path.resolve(os.tmpdir()),resolved);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(resolved).startsWith("skribbl-votekick-ui-"))
        fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
