"use strict";

// Opt-in live admission diagnostic: one public connection and at most two
// ordinary invitation attempts. It sends login only, never votes or chat.
// Run: node scripts/diagnose-votekick-admission.cjs --live
// Add --lang <native language ID> to choose a quieter public language.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");

// Reuse the existing browser fixture's launch and CDP utilities without running
// its UI test or opening a multiplayer connection from an ordinary test run.
const utilities = fs.readFileSync(path.join(__dirname, "test-votekick-ui.cjs"), "utf8")
  .split("async function main() {")[0];
const sandbox = { require, process, console, WebSocket, setTimeout, clearTimeout, __dirname };
vm.runInNewContext(utilities + "\nthis.browserTools={connect,evaluate,launchBrowser};", sandbox);
const { connect, evaluate, launchBrowser } = sandbox.browserTools;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const setup = `(() => {
  window.__admission = { sockets: [], votesSent: 0 };
  window.__ready = async () => {
    const began = Date.now();
    while (typeof io !== 'function') {
      if (Date.now() - began > 15000) throw new Error('The native Socket.IO client did not load.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  window.__lookup = async body => {
    const response = await fetch('/api/play', {
      method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body, credentials: 'same-origin', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Room lookup returned HTTP ' + response.status);
    const endpoint = new URL((await response.text()).trim());
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.skribbl.io')
      || !/^\\d+$/.test(endpoint.port)) throw new Error('Unexpected native endpoint.');
    return {uri:endpoint.protocol+'//'+endpoint.hostname,path:'/'+endpoint.port+'/'};
  };
  window.__join = async (endpoint, room, name, language = '0', avatar = [0,0,0,-1]) => {
    const socket = io(endpoint.uri, {
      transports: ['websocket','polling'], path: endpoint.path,
      closeOnBeforeunload: false, forceNew: true, multiplex: false,
      reconnection: false, timeout: 8000
    });
    __admission.sockets.push(socket);
    const emit = socket.emit;
    socket.emit = function(event, ...args) {
      if (event !== 'login') throw new Error('Live diagnostic blocked a non-login emission.');
      return Reflect.apply(emit, this, [event, ...args]);
    };
    const users = new Set();
    const record = {socket,users,result:null,room:null,type:null,capacity:null,socketId:null,engineId:null};
    socket.on('data', packet => {
      if (packet?.id === 10) {
        record.room = packet.data.id; record.type = packet.data.type;
        record.capacity = Number(packet.data.settings?.[1]);
        for (const user of packet.data.users || []) users.add(user.id);
      } else if (packet?.id === 1) users.add(packet.data.id);
      else if (packet?.id === 2) users.delete(packet.data.id);
      else if (packet?.id === 12 && String(packet.data?.id) === '1') {
        const capacity = Number(packet.data.val);
        if (Number.isInteger(capacity) && capacity >= 2 && capacity <= 20) record.capacity = capacity;
      }
    });
    const outcome = await new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => finish({timeout:true}), 10000);
      function finish(value) {
        if (finished) return;
        finished = true; clearTimeout(timer); resolve(value);
      }
      socket.on('data', packet => {if (packet?.id === 10) finish({joined:true});});
      socket.on('joinerr', code => finish({joinerr:code}));
      socket.on('connect_error', () => finish({connectError:true}));
      socket.on('disconnect', () => finish({disconnected:true}));
      socket.on('connect', () => {
        record.socketId = socket.id; record.engineId = socket.io.engine?.id || null;
        socket.emit('login', {join:room,create:0,name,lang:language,avatar:avatar.slice()});
      });
    });
    record.result = outcome;
    if (!outcome.joined) socket.close();
    __admission.latest = record;
    return { ...outcome, lobbyType:record.type, occupied:users.size,
      capacity:record.capacity, socketId:record.socketId,
      engineId:record.engineId };
  };
  window.__close = () => { for (const socket of __admission.sockets) socket.close(); };
})();`;

async function main() {
  if (!process.argv.includes("--live")) {
    console.log("This diagnostic makes live joins. Run with --live to inspect admission; it sends no votes.");
    return;
  }
  const langIndex = process.argv.indexOf("--lang");
  const language = langIndex === -1 ? "0" : process.argv[langIndex + 1];
  assert.ok(typeof language === "string" && /^\d+$/.test(language)
    && Number(language) <= 27, "--lang requires a native language ID from 0 to 27");
  let browser;
  const clients = [], contexts = [];
  const summary = { votesSent: 0, language: Number(language), waitBeforeInviteMs: 12000 };
  async function page(contextId) {
    const { targetId } = await browser.client.send("Target.createTarget", {
      url: "https://skribbl.io/", ...(contextId ? { browserContextId: contextId } : {})
    });
    const targets = await (await fetch(`${browser.base}/json/list`)).json();
    const client = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
    clients.push(client);
    for (let remaining = 60; remaining > 0; remaining--) {
      try { if (await evaluate(client, "typeof io === 'function'")) break; } catch {}
      await pause(250);
    }
    await evaluate(client, setup);
    await evaluate(client, "__ready()");
    return client;
  }
  async function cookies() {
    const { cookies } = await browser.client.send("Storage.getCookies");
    return cookies.filter(cookie => cookie.domain === "skribbl.io" || cookie.domain.endsWith(".skribbl.io"))
      .map(cookie => ({ name:cookie.name, domain:cookie.domain, httpOnly:cookie.httpOnly }));
  }
  try {
    browser = await launchBrowser();
    const client = await page();
    summary.cookieMetadataBefore = await cookies();
    await evaluate(client, `(async()=>{window.__endpoint = await __lookup(${JSON.stringify('lang='+language)})})()`);
    const primary = await evaluate(client, `__join(__endpoint,'','Probe Alpha',${JSON.stringify(language)})`);
    const {socketId:primarySocket,engineId:primaryEngine,...primarySummary} = primary;
    summary.primary = primarySummary;
    if (!primary.joined) { console.log(JSON.stringify(summary, null, 2)); return; }
    assert.equal(primary.lobbyType, 0, "Native matchmaking did not return a public room");
    await evaluate(client, "void(window.__primary = __admission.latest)");
    await pause(12000);
    // Wait at most 20 seconds for a slot; full-room rejection cannot diagnose
    // duplicate identity, and the diagnostic never removes a player for space.
    for (let remaining = 20; remaining > 0; remaining--) {
      if (await evaluate(client, "__primary.users.size < __primary.capacity")) break;
      await pause(1000);
    }
    summary.occupiedBeforeInvite = await evaluate(client, "__primary.users.size");
    if (!await evaluate(client, "__primary.socket.connected && __primary.users.size < __primary.capacity")) {
      summary.skipped = "No open slot remained in the connected public room.";
      console.log(JSON.stringify(summary, null, 2)); return;
    }
    await evaluate(client, "(async()=>{window.__inviteEndpoint = await __lookup('id='+encodeURIComponent(__primary.room))})()");
    summary.inviteLookupMatchesPrimary = await evaluate(client,
      "__inviteEndpoint.uri===__endpoint.uri && __inviteEndpoint.path===__endpoint.path");
    const helper = await evaluate(client, `__join(__inviteEndpoint,__primary.room,'Peer Beta',${JSON.stringify(language)},[1,1,1,-1])`);
    const {socketId:helperSocket,engineId:helperEngine,...helperSummary} = helper;
    summary.normalInviteSameBrowser = helperSummary;
    summary.distinctSocketSessions = Boolean(primarySocket && helperSocket && primarySocket !== helperSocket);
    summary.distinctEngineSessions = Boolean(primaryEngine && helperEngine && primaryEngine !== helperEngine);
    summary.sameBrowserPeerUsesDifferentAvatar = true;
    summary.distinctShortNames = true;
    summary.cookieMetadataAfter = await cookies();
    await evaluate(client, "(()=>{if(__admission.latest!==__primary)__admission.latest.socket.close()})()");
    if (helper.joinerr === 100) {
      const { browserContextId } = await browser.client.send("Target.createBrowserContext");
      contexts.push(browserContextId);
      const initialCookies = await browser.client.send("Storage.getCookies", { browserContextId });
      summary.isolatedCookieJarInitiallyEmpty = initialCookies.cookies.length === 0;
      const isolated = await page(browserContextId);
      const room = await evaluate(client, "__primary.room");
      await pause(12000);
      if (await evaluate(client, "__primary.socket.connected && __primary.users.size < __primary.capacity")) {
        const body = `id=${encodeURIComponent(room)}`;
        await evaluate(isolated, `(async()=>{window.__endpoint = await __lookup(${JSON.stringify(body)})})()`);
        const peer = await evaluate(isolated, `__join(__endpoint,${JSON.stringify(room)},'Guest Gamma',${JSON.stringify(language)},[2,2,2,-1])`);
        const {socketId,engineId,...peerSummary} = peer;
        summary.normalInviteIsolatedStorage = peerSummary;
        summary.isolatedPeerHasDistinctEngineSession = Boolean(engineId && primaryEngine && engineId !== primaryEngine);
        summary.isolatedStorageSharesNetwork = true;
        summary.isolatedPeerUsesDifferentAvatar = true;
      } else summary.isolatedStorageSkipped = "Room disconnected or became full.";
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    for (const client of clients) {
      try { await evaluate(client, "__close()"); } catch {}
      client.close();
    }
    if (browser) {
      for (const browserContextId of contexts) {
        try { await browser.client.send("Target.disposeBrowserContext", {browserContextId}); } catch {}
      }
      try { await browser.client.send("Browser.close"); } catch { browser.child.kill(); }
      browser.client.close();
      if (browser.child.exitCode === null) await Promise.race([
        once(browser.child, "exit"), pause(5000)
      ]);
      const resolvedProfile = path.resolve(browser.profile);
      const relative = path.relative(path.resolve(os.tmpdir()), resolvedProfile);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)
        && path.basename(resolvedProfile).startsWith("skribbl-votekick-ui-")) {
        fs.rmSync(resolvedProfile, {recursive:true,force:true,maxRetries:5,retryDelay:100});
      }
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
