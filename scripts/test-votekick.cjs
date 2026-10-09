"use strict";

// Isolated regression checks for vote-kick orchestration. The Socket.IO server,
// browser bridge and clock are mocks: this script never joins a live lobby.
// Run: node scripts/test-votekick.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const REQUEST = "ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-request";
const STATUS = "ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status";
const BASE_USERS = [
  { id: 1, name: "Me", flags: 0 },
  { id: 2, name: "Duplicate", flags: 0 },
  { id: 3, name: "Owner", flags: 0 },
  { id: 4, name: "Admin", flags: 4 },
  { id: 5, name: "Duplicate", flags: 0 },
];
const copy = value => JSON.parse(JSON.stringify(value));

class EventHub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ callback, once: Boolean(options?.once) });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback));
  }
  dispatchEvent(event) {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      if (entry.once) this.removeEventListener(event.type, entry.callback);
      entry.callback.call(this, event);
    }
    return true;
  }
}

function fixture(options = {}) {
  let now = 0, nextTimer = 0, factoryCalls = 0, creatingPrimary = false, activePrimary = null;
  const timers = new Map(), sockets = [], statuses = [], history = [], lookupRequests = [];
  const document = new EventHub(), window = new EventHub();
  const input = { value: "https://skribbl.io/?room-one", getAttribute: () => null };
  document.querySelector = selector => selector === "#input-invite" ? input : null;
  document.querySelectorAll = () => [];
  document.getElementById = id => id === "input-invite" ? input : null;
  document.readyState = "complete";
  const users = copy(options.users || BASE_USERS);
  const lobby = options.lobbyId || "room-one";
  let serverCapacity = options.capacity ?? 20;
  let serverLobbyType = options.lobbyType ?? 1;
  let countVotes = options.initialVotes || 0;
  const voteCounts = new Map([[2, options.initialVotes || 0]]);

  function schedule(callback, delay = 0, interval = 0) {
    const id = ++nextTimer;
    timers.set(id, { id, callback, time: now + Number(delay || 0), interval });
    return id;
  }
  function server(socket, event, payload) {
    schedule(() => socket.receive(event, copy(payload)), 0);
  }
  function broadcast(event, payload) {
    if (event === "data" && payload?.id === 12 && String(payload.data?.id) === "1") {
      const capacity = Number(payload.data.val);
      if (Number.isInteger(capacity) && capacity >= 2 && capacity <= 20) serverCapacity = capacity;
    }
    for (const socket of sockets.filter(socket => socket.connected)) server(socket, event, payload);
  }
  function snapshot(me, overrides = {}) {
    return { me, type: serverLobbyType, id: lobby, settings: [0, serverCapacity, 80, 3, 3, 2, 0, 0],
      users: copy(users), round: 0, owner: 3, state: { id: 4, time: 80, data: {} }, ...overrides };
  }

  class MockSocket {
    constructor(uri, settings, ordinal) {
      this.uri = uri; this.options = settings; this.ordinal = ordinal;
      this.connected = false; this.closeCount = 0; this.isPrimary = creatingPrimary;
      this.listeners = new Map(); this.anyListeners = [];
      this.io = { uri, opts: settings }; this.id = "socket-" + ordinal;
      this.outgoing = [];
      schedule(() => {
        if (this.closeCount) return;
        if (options.connectErrorAt === ordinal) return this.receive("connect_error", new Error("Connection refused"));
        if (options.neverConnectAt === ordinal) return;
        this.connected = true; this.receive("connect");
      });
    }
    on(event, callback) {
      const list = this.listeners.get(event) || [];
      list.push(callback); this.listeners.set(event, list); return this;
    }
    once(event, callback) {
      const wrapped = (...args) => { this.off(event, wrapped); callback(...args); };
      return this.on(event, wrapped);
    }
    off(event, callback) {
      if (event === undefined) this.listeners.clear();
      else if (callback === undefined) this.listeners.delete(event);
      else this.listeners.set(event, (this.listeners.get(event) || []).filter(fn => fn !== callback));
      return this;
    }
    onAny(callback) { this.anyListeners.push(callback); return this; }
    offAny(callback) { this.anyListeners = this.anyListeners.filter(fn => fn !== callback); return this; }
    removeAllListeners(event) { return this.off(event); }
    receive(event, ...args) {
      if (event === "disconnect") this.connected = false;
      if (event !== "connect" && event !== "disconnect") for (const callback of [...this.anyListeners]) callback(event, ...args);
      for (const callback of [...(this.listeners.get(event) || [])]) callback(...args);
    }
    emit(event, payload, ...rest) {
      this.outgoing.push({ event, payload: payload && copy(payload), rest });
      history.push({ kind: "emit", ordinal: this.ordinal, event, payload: payload && copy(payload), time: now });
      if (event === "login" && !this.isPrimary) {
        const joinError = options.joinErrAt === this.ordinal ? (options.joinErrCode || 200) : null;
        if (joinError !== null) { server(this, "joinerr", joinError); return this; }
        if (options.noSnapshotAt === this.ordinal) return this;
        const id = 100 + this.ordinal;
        const helperUser = { id, name: payload.name, flags: 0 };
        if (!options.separateHelperLobby) users.push(helperUser);
        history.push({ kind: "joined", ordinal: this.ordinal, time: now });
        const lateVote = options.externalVoteBeforeHelperSnapshot;
        if (lateVote?.ordinal === this.ordinal) {
          voteCounts.set(lateVote.targetId, lateVote.votes);
          broadcast("data", { id: 5, data: [lateVote.voterId, lateVote.targetId, lateVote.votes, lateVote.required] });
        }
        const joinedState = snapshot(id, {
          ...(options.separateHelperLobby ? { users: [helperUser] } : {}),
          ...(options.helperSnapshotOverrides || {})
        });
        server(this, "data", { id: 10, data: options.helperSnapshotTransform ? options.helperSnapshotTransform(joinedState) : joinedState });
        if (!options.suppressHelperRoster && !options.separateHelperLobby) broadcast("data", { id: 1, data: helperUser });
      }
      if (event === "data" && payload?.id === 5) {
        countVotes++;
        const ordinal = this.ordinal, target = payload.data;
        const targetVotes = (voteCounts.get(target) || 0) + 1;
        voteCounts.set(target, targetVotes);
        options.onVote?.({ countVotes, socket: this, target, broadcast, users });
        const required = options.thresholds?.[Math.min(countVotes - 1, options.thresholds.length - 1)] || options.required || 3;
        if (options.noAckAtVote !== countVotes) {
          broadcast("data", { id: 5, data: [options.ackVoterOverride ?? (this.isPrimary ? 1 : 100 + ordinal), target, targetVotes, required] });
        }
        if (options.naturalLeaveAtVote === countVotes) broadcast("data", { id: 2, data: { id: target, reason: 0 } });
        if (options.kickAfter === countVotes || options.kickWhenThresholdMet && targetVotes >= required) broadcast("data", { id: 2, data: { id: target, reason: 1 } });
      }
      return this;
    }
    close() {
      this.closeCount++; history.push({ kind: "closed", ordinal: this.ordinal, time: now });
      const wasConnected = this.connected; this.connected = false;
      if (wasConnected) this.receive("disconnect", "io client disconnect");
      if (wasConnected && !this.isPrimary) {
        const index = users.findIndex(user => user.id === 100 + this.ordinal);
        if (index >= 0) { const [user] = users.splice(index, 1); broadcast("data", { id: 2, data: { id: user.id, reason: 0 } }); }
      }
      return this;
    }
    disconnect() { return this.close(); }
  }
  function originalIo(uri, settings) {
    history.push({ kind: "factory", uri, settings, receiver: this, time: now });
    const factoryOrdinal = factoryCalls++;
    if (options.reusePrimaryAtFactoryCall === factoryOrdinal) return activePrimary;
    if (options.reuseHelperAtFactoryCall === factoryOrdinal) return sockets.find(socket => !socket.isPrimary);
    const socket = new MockSocket(uri, settings, sockets.length); sockets.push(socket); return socket;
  }
  originalIo.Socket = MockSocket;
  originalIo.Manager = function MockManager() {};
  originalIo.protocol = 5;
  originalIo.connect = originalIo;
  Object.defineProperty(originalIo, "fixtureHidden", { value: "preserved", enumerable: false, configurable: true });
  if (!options.lateIo) window.io = originalIo;
  window.window = window; window.document = document;
  window.location = { href: "https://skribbl.io/?room-one", origin: "https://skribbl.io", hostname: "skribbl.io" };
  window.navigator = { onLine: true };
  window.setTimeout = (callback, delay) => schedule(callback, delay);
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (callback, delay) => schedule(callback, delay, Number(delay));
  window.clearInterval = id => timers.delete(id);
  class FakeDate extends Date { static now() { return now; } }
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  // Native /api/play is mocked exclusively for explicit admission probes.
  function fetch(url, request) {
    const record = { url, method: request.method, headers: copy(request.headers),
      credentials: request.credentials, body: request.body, aborted: false };
    lookupRequests.push(record);
    return new Promise((resolve, reject) => {
      const timer = schedule(() => {
        if (options.lookupError) return reject(new Error("Mock lookup network failure"));
        resolve({ ok: (options.lookupStatus ?? 200) === 200, status: options.lookupStatus ?? 200,
          text: () => new Promise(resolveText => schedule(() => resolveText(
            options.lookupEndpoint ?? "https://probe-server.skribbl.io:5011/"), options.lookupTextDelay ?? 0)) });
      }, options.lookupDelay ?? 0);
      request.signal.addEventListener("abort", () => {
        record.aborted = true;
        if (options.ignoreLookupAbort) return;
        timers.delete(timer); reject(new Error("Mock lookup aborted"));
      }, { once: true });
    });
  }
  const context = { window, document, io: originalIo, location: window.location, navigator: window.navigator,
    CustomEvent, Event: CustomEvent, Date: FakeDate, URL, URLSearchParams, console, fetch,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    performance: { now: () => now }, queueMicrotask, AbortController, Promise };
  document.addEventListener(STATUS, event => statuses.push(JSON.parse(event.detail)));
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "votekick-runner.js"), "utf8"), context, { filename: "votekick-runner.js" });

  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  async function advance(duration) {
    const deadline = now + duration;
    await flush();
    let steps = 0;
    for (;;) {
      const next = [...timers.values()].filter(timer => timer.time <= deadline).sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!next) break;
      assert.ok(++steps < 10000, "Mock timer loop did not converge");
      now = next.time; timers.delete(next.id);
      if (next.interval) timers.set(next.id, { ...next, time: now + next.interval });
      next.callback(); await flush();
    }
    now = deadline; await flush();
  }
  async function until(predicate, budget = 60000) {
    const deadline = now + budget;
    for (let steps = 0; steps < 2000; steps++) {
      await advance(0); if (predicate()) return;
      const next = [...timers.values()].sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!next || next.time > deadline) break;
      await advance(Math.max(0, next.time - now));
    }
    assert.ok(predicate(), `Condition did not complete: ${JSON.stringify(statuses.slice(-3))}`);
  }
  function request(data) { document.dispatchEvent(new CustomEvent(REQUEST, { detail: JSON.stringify(data) })); }
  function status() { return statuses.filter(value => value.type === "status").at(-1); }
  function votes() { return history.filter(value => value.kind === "emit" && value.event === "data" && value.payload?.id === 5); }
  async function connectMain(overrides = {}, factoryOptions = {}, loginOptions = {}) {
    if (Object.hasOwn(overrides, "type")) serverLobbyType = overrides.type;
    creatingPrimary = true;
    let socket;
    try {
      socket = window.io("https://game-server.skribbl.io", { path: "/5000/", transports: ["websocket", "polling"], ...factoryOptions });
    } finally { creatingPrimary = false; }
    activePrimary = socket;
    await advance(0);
    socket.emit("login", { join: lobby, create: 0, name: "Me", lang: "0", avatar: [0, 0, 0, -1], ...loginOptions });
    socket.receive("data", { id: 10, data: snapshot(1, overrides) });
    await advance(0); return socket;
  }
  return { window, document, request, status, statuses, sockets, history, lookupRequests, votes, advance, until, connectMain,
    get primary() { return activePrimary; },
    originalIo, snapshot, broadcast, input, users, rawRequest: detail => document.dispatchEvent(new CustomEvent(REQUEST, { detail })) };
}

function helpersClosed(f) {
  assert.ok(f.sockets.filter(socket => !socket.isPrimary).every(socket => socket.closeCount >= 1 && !socket.connected), "A temporary session remained open");
  assert.ok(f.sockets.filter(socket => socket.isPrimary).every(socket => socket.closeCount === 0), "A main game connection was closed");
}

async function run() {
  let completed = 0;
  async function check(name, test) { await test(); completed++; console.log("PASS " + name); }
  const start = (f, targetId = 2) => f.request({ action: "start", targetId });
  const terminal = f => f.until(() => f.status()?.running === false);
  const honest = f => assert.ok(!/\b(?:was|has been|is) kicked\b|kick confirmed|successfully kicked/i.test(f.status().message), f.status().message);

  await check("io factory behavior and automatic capacity snapshots preserve player IDs", async () => {
    const f = fixture(); const main = await f.connectMain();
    for (const property of ["Socket", "Manager", "protocol", "fixtureHidden"]) assert.equal(f.window.io[property], f.originalIo[property]);
    assert.equal(Object.getOwnPropertyDescriptor(f.window.io, "fixtureHidden").enumerable, false);
    assert.equal(f.history[0].receiver, f.window); assert.ok(main instanceof f.originalIo.Socket);
    const callback = () => {};
    assert.equal(main.emit("game-event", { value: 7 }, callback), main);
    assert.equal(main.outgoing.at(-1).rest[0], callback);
    f.request({ action: "snapshot" }); const state = f.statuses.at(-1);
    assert.equal(state.connected, true); assert.equal(state.lobbyId, "room-one");
    assert.equal(state.capacity, 20); assert.equal(state.occupied, 5); assert.equal(state.availableSlots, 15);
    assert.equal(state.automatic, true); assert.equal(state.maxExtraSessions, undefined);
    assert.ok(state.users.some(user => user.id === 2) && state.users.some(user => user.id === 5));
    assert.equal(f.sockets.length, 1);
  });

  await check("Socket.IO assigned after startup is observed", async () => {
    const f = fixture({ lateIo: true }); f.window.io = f.originalIo;
    await f.connectMain(); f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).connected, true);
  });

  await check("own vote precedes sequential helper join and vote; server confirms kick", async () => {
    const f = fixture({ kickAfter: 3 }); await f.connectMain(); start(f, 5); await terminal(f);
    assert.equal(f.status().state, "done"); assert.match(f.status().message, /confirmed.*kicked/i);
    assert.deepEqual(f.votes().map(vote => vote.ordinal), [0, 1, 2]);
    assert.ok(f.votes().every(vote => vote.payload.data === 5), "Duplicate names chose the wrong ID");
    const previousVotes = f.votes();
    for (let ordinal = 1; ordinal <= 2; ordinal++) {
      const factoryIndex = f.history.findIndex(entry => entry.kind === "factory" && entry.settings?.forceNew && entry.time === f.history.find(entry => entry.kind === "joined" && entry.ordinal === ordinal)?.time);
      const priorVoteIndex = f.history.indexOf(previousVotes[ordinal - 1]);
      assert.ok(priorVoteIndex < factoryIndex, "A helper opened before the prior vote was acknowledged");
      const joinIndex = f.history.findIndex(entry => entry.kind === "joined" && entry.ordinal === ordinal);
      assert.ok(joinIndex < f.history.indexOf(previousVotes[ordinal]), "A helper voted before joining");
    }
    helpersClosed(f);
  });

  await check("a full lobby casts only the user's vote", async () => {
    const f = fixture({ capacity: 5, required: 9 }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); honest(f); helpersClosed(f);
  });

  await check("a threshold satisfied by the user's vote opens no helpers", async () => {
    const f = fixture({ required: 1, kickWhenThresholdMet: true }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); assert.match(f.status().message, /confirmed.*kicked/i);
  });

  await check("obsolete session-count input cannot cap automatic threshold following", async () => {
    const f = fixture({ required: 5, kickWhenThresholdMet: true }); await f.connectMain();
    f.request({ action: "start", targetId: 2, extraSessions: 1 }); await terminal(f);
    assert.equal(f.votes().length, 5); assert.equal(f.sockets.length, 5); helpersClosed(f);
  });

  await check("available room slots stop helper creation before an unmet threshold", async () => {
    const f = fixture({ capacity: 6, required: 9 }); await f.connectMain(); start(f);
    await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 2); assert.equal(f.sockets[1].connected, true);
    await terminal(f); honest(f); helpersClosed(f);
  });

  await check("helper own snapshots count toward capacity while primary roster broadcasts lag", async () => {
    const f = fixture({ capacity: 6, required: 9, suppressHelperRoster: true }); await f.connectMain(); start(f);
    await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 2);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).occupied, 6); assert.equal(f.statuses.at(-1).availableSlots, 0);
    await terminal(f); honest(f); helpersClosed(f);
  });

  await check("a later helper's authoritative room capacity stops further joining", async () => {
    const f = fixture({ capacity: 20, required: 9, helperSnapshotTransform: state => ({ ...state,
      settings: state.settings.map((value, index) => index === 1 ? 6 : value) }) });
    await f.connectMain(); start(f); await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 2);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).capacity, 6);
    await terminal(f); honest(f); helpersClosed(f);
  });

  await check("an unmet threshold can require more than three helpers", async () => {
    const f = fixture({ required: 6, kickWhenThresholdMet: true }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 6); assert.equal(f.sockets.length, 6); helpersClosed(f);
  });

  await check("increasing server thresholds are followed until the latest requirement is met", async () => {
    const f = fixture({ thresholds: [3, 4, 5, 5, 5], kickWhenThresholdMet: true }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 5); assert.equal(f.sockets.length, 5); assert.equal(f.status().required, 5); helpersClosed(f);
  });

  await check("an admitted helper votes when an external acknowledgement met the old pre-join threshold", async () => {
    const f = fixture({ thresholds: [3, 5, 5], kickWhenThresholdMet: true,
      externalVoteBeforeHelperSnapshot: { ordinal: 1, voterId: 5, targetId: 2, votes: 3, required: 3 } });
    await f.connectMain(); start(f); await terminal(f);
    assert.deepEqual(f.votes().map(vote => vote.ordinal), [0, 1, 2]);
    assert.equal(f.status().votes, 5); assert.equal(f.status().required, 5);
    assert.match(f.status().message, /confirmed.*kicked/i); helpersClosed(f);
  });

  await check("actual capacity 20 bounds automatic helpers without an arbitrary small cap", async () => {
    const f = fixture({ users: BASE_USERS.slice(0, 2), capacity: 20, required: 99, helperSnapshotOverrides: { owner: -1 } });
    await f.connectMain({ owner: -1 }); start(f); await terminal(f);
    assert.equal(f.sockets.length, 19); assert.equal(f.votes().length, 19);
    const joins = f.history.filter(entry => entry.kind === "joined"); assert.equal(joins.length, 18);
    honest(f); helpersClosed(f);
  });

  await check("native string slot index and value changes update the automatic capacity", async () => {
    const f = fixture({ capacity: 5, required: 9, onVote: ({ countVotes, broadcast }) => {
      if (countVotes === 1) broadcast("data", { id: 12, data: { id: "1", val: "7" } });
    } });
    await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 3); assert.equal(f.sockets.length, 3);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).capacity, 7); helpersClosed(f);
  });

  await check("a concurrent real player filling the room prevents helper joins", async () => {
    const f = fixture({ capacity: 6, required: 9, onVote: ({ countVotes, broadcast, users }) => {
      if (countVotes === 1) { const user = { id: 6, name: "Real arrival", flags: 0 }; users.push(user); broadcast("data", { id: 1, data: user }); }
    } });
    await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); honest(f);
  });

  await check("unknown capacity permits the user's vote but no speculative helper joins", async () => {
    const f = fixture({ required: 9 }); await f.connectMain({ settings: [0] }); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); honest(f);
  });

  await check("a known existing own vote is reused without submitting it again", async () => {
    const f = fixture({ initialVotes: 1, required: 3, kickWhenThresholdMet: true }); const main = await f.connectMain();
    main.receive("data", { id: 5, data: [1, 2, 1, 3] }); start(f); await terminal(f);
    assert.deepEqual(f.votes().map(vote => vote.ordinal), [1, 2]); helpersClosed(f);
  });

  await check("helpers remain connected until an outcome; vote counts alone never claim a kick", async () => {
    const f = fixture({ required: 3 }); await f.connectMain(); start(f);
    await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.sockets.length, 3); assert.ok(f.sockets.slice(1).every(socket => socket.connected));
    await terminal(f); honest(f); helpersClosed(f);
  });

  await check("helper connections isolate sockets and omit native auth/query/login secrets", async () => {
    const f = fixture({ required: 2, kickWhenThresholdMet: true });
    await f.connectMain({}, { auth: { token: "fixture-secret" }, query: { code: "fixture-secret" } }, { code: "fixture-secret" });
    start(f); await terminal(f); const helper = f.sockets[1];
    assert.equal(helper.options.forceNew, true); assert.equal(helper.options.multiplex, false);
    assert.equal(helper.options.reconnection, false); assert.equal(helper.options.path, "/5000/");
    assert.equal(helper.options.auth, undefined); assert.equal(helper.options.query, undefined);
    assert.equal(helper.outgoing.find(event => event.event === "login").payload.code, undefined); helpersClosed(f);
  });

  for (const code of [2, 200, 5]) await check(`admission rejection ${code} retains earlier registered voters until outcome and never retries`, async () => {
    const f = fixture({ joinErrAt: 2, joinErrCode: code, required: 9 }); await f.connectMain(); start(f);
    await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 3);
    assert.equal(f.sockets[1].connected, true); assert.equal(f.sockets[2].connected, false);
    await terminal(f); honest(f); helpersClosed(f); await f.advance(30000);
    assert.equal(f.sockets.length, 3, "Server rejection was retried");
  });

  await check("public native snapshots reject direct Vote Kick requests before votes or helper connections", async () => {
    const f = fixture({ lobbyType: 0 }); await f.connectMain({ owner: -1 }, {}, { create: 1 });
    for (const target of [2, 3, 5]) { start(f, target); await f.advance(30000); }
    assert.equal(f.status().state, "error"); assert.match(f.status().message, /public lobbies/);
    assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).lobbyType, 0);
    assert.equal(f.primary.connected, true); helpersClosed(f);
  });

  await check("a private UI snapshot cannot bypass a native public lobby guard", async () => {
    const f = fixture({ lobbyType: 0 }); await f.connectMain();
    f.document.dispatchEvent({ type: STATUS, detail: JSON.stringify({ type: "snapshot", connected: true,
      lobbyId: "room-one", lobbyType: 1, users: [] }) });
    start(f); await f.advance(30000);
    assert.equal(f.status().state, "error"); assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
  });

  await check("a native lobby transition during start feedback is checked before emitting the own vote", async () => {
    const f = fixture(); const main = await f.connectMain();
    f.document.addEventListener(STATUS, event => {
      const payload = JSON.parse(event.detail);
      if (payload.type === "status" && payload.state === "voting" && payload.running) {
        main.receive("data", { id: 10, data: f.snapshot(1, { type: 0 }) });
      }
    });
    start(f); await f.advance(30000);
    assert.equal(f.status().running, false); assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
  });

  for (const type of [undefined, null, "1", true, -1, 2]) await check(`unknown native lobby type ${JSON.stringify(type)} rejects direct Vote Kick requests`, async () => {
    const f = fixture(); await f.connectMain({ type }); start(f); await f.advance(30000);
    assert.equal(f.status().state, "error"); assert.match(f.status().message, /confirmed private lobby/);
    assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).lobbyType, null);
    helpersClosed(f);
  });

  await check("private/public/unknown transitions in the same room stop a run and require new private confirmation", async () => {
    const f = fixture({ noSnapshotAt: 1, required: 9 }); const main = await f.connectMain();
    start(f); await f.until(() => f.sockets.length === 2);
    main.receive("data", { id: 10, data: f.snapshot(1, { type: 0 }) });
    await f.advance(30000); assert.equal(f.status().running, false); helpersClosed(f);
    assert.equal(f.votes().length, 1);
    start(f, 5); await f.advance(30000); assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 2);
    main.receive("data", { id: 10, data: f.snapshot(1, { type: undefined }) });
    start(f, 5); await f.advance(30000); assert.equal(f.votes().length, 1);
    main.receive("data", { id: 10, data: f.snapshot(1, { type: 1 }) });
    start(f, 5); await f.until(() => f.votes().length >= 2);
    f.request({ action: "stop" }); await f.advance(30000); helpersClosed(f);
  });

  for (const data of [null, {}, { type: 1 }, { me: 1, owner: 3, id: "room-one", users: [] }]) await check(`malformed replacement lobby snapshot ${JSON.stringify(data)} invalidates prior private state`, async () => {
    const f = fixture({ noSnapshotAt: 1 }); const main = await f.connectMain(); start(f);
    await f.until(() => f.sockets.length === 2); main.receive("data", { id: 10, data });
    await f.advance(30000); assert.equal(f.status().running, false); helpersClosed(f);
    f.request({ action: "snapshot" }); const state = f.statuses.at(-1);
    assert.equal(state.connected, false); assert.equal(state.lobbyType, null); assert.equal(state.users.length, 0);
    start(f, 5); await f.advance(30000); assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 2);
  });

  await check("duplicate rejection in a private room is not remembered as a public-room restriction", async () => {
    const f = fixture({ joinErrAt: 1, joinErrCode: 100, required: 2 });
    await f.connectMain({ type: 1 }); start(f); await terminal(f);
    f.request({ action: "snapshot" });
    assert.equal(f.statuses.at(-1).lobbyType, 1);
    assert.equal(f.statuses.at(-1).helperRejectionCode, null);
    start(f, 5); await terminal(f);
    assert.equal(f.sockets.length, 3); assert.equal(f.votes().length, 3); helpersClosed(f);
  });

  await check("confirmed removal still succeeds while waiting after a private helper rejection", async () => {
    const f = fixture({ joinErrAt: 1, joinErrCode: 100, required: 2 });
    await f.connectMain({ owner: -1 }); start(f);
    await f.until(() => f.status()?.state === "waiting");
    f.broadcast("data", { id: 2, data: { id: 2, reason: 1 } });
    await terminal(f); assert.equal(f.status().state, "done");
    assert.match(f.status().message, /server confirmed.*kicked/i); helpersClosed(f);
  });

  await check("cache restoration discards detached lobby state until a fresh native private snapshot", async () => {
    const f = fixture({ required: 1, kickWhenThresholdMet: true }); const main = await f.connectMain();
    f.window.dispatchEvent({ type: "pagehide", persisted: true });
    main.receive("data", { id: 10, data: f.snapshot(1, { type: 0 }) });
    f.window.dispatchEvent({ type: "pageshow", persisted: true });
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).lobbyType, null);
    start(f, 5); await terminal(f); assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
    main.receive("data", { id: 10, data: f.snapshot(1) }); start(f, 5); await terminal(f);
    assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("disconnected Start opens no socket", async () => {
    const f = fixture(); start(f); await f.advance(30000); assert.equal(f.sockets.length, 0); assert.equal(f.votes().length, 0);
  });

  await check("private lobby without an owner accepts the native -1 sentinel", async () => {
    const f = fixture({ helperSnapshotOverrides: { owner: -1 }, required: 2, kickWhenThresholdMet: true });
    await f.connectMain({ owner: -1 }); start(f, 3); await terminal(f); assert.equal(f.votes().length, 2); helpersClosed(f);
  });

  for (const invalid of [
    { targetId: 1 }, { targetId: 3 }, { targetId: 4 }, { targetId: 999 },
    { targetId: "2" }, { targetId: -1 }, { targetId: 1.5 },
  ]) await check(`invalid automatic request ${JSON.stringify(invalid)} has no effects`, async () => {
    const f = fixture(); await f.connectMain(); f.request({ action: "start", ...invalid }); await f.advance(30000);
    assert.equal(f.sockets.length, 1); assert.equal(f.votes().length, 0);
  });

  await check("Stop during own-vote acknowledgement prevents every helper", async () => {
    const f = fixture({ noAckAtVote: 1 }); await f.connectMain(); start(f);
    await f.until(() => f.votes().length === 1); f.request({ action: "stop" }); await f.advance(30000);
    assert.equal(f.status().state, "stopped"); assert.equal(f.sockets.length, 1); helpersClosed(f);
  });

  await check("Stop during joining cleans temporary connections after preserving the own vote", async () => {
    const f = fixture({ noSnapshotAt: 1 }); await f.connectMain(); start(f);
    await f.until(() => f.sockets.length > 1); f.request({ action: "stop" }); await f.advance(30000);
    assert.equal(f.status().state, "stopped"); assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("Stop while waiting clears all outcome timers", async () => {
    const f = fixture(); await f.connectMain(); start(f); await f.until(() => f.status()?.state === "waiting");
    f.request({ action: "stop" }); await f.advance(30000); assert.equal(f.status().state, "stopped"); helpersClosed(f);
  });

  await check("a second Start cannot create a simultaneous batch", async () => {
    const f = fixture({ noSnapshotAt: 1 }); await f.connectMain(); start(f); await f.until(() => f.sockets.length > 1);
    start(f, 5); await f.advance(30000); assert.equal(f.sockets.length, 2); assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("a factory returning the main socket cannot close it or submit a helper vote", async () => {
    const f = fixture({ reusePrimaryAtFactoryCall: 1 }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); assert.equal(f.primary.connected, true); helpersClosed(f);
  });

  await check("a reused helper is closed exactly once after an admission failure", async () => {
    const f = fixture({ reuseHelperAtFactoryCall: 2, required: 9 }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 2); assert.equal(f.sockets[1].closeCount, 1); helpersClosed(f);
  });

  for (const cause of ["pagehide", "disconnect"]) await check(`${cause} cancels active helper joins`, async () => {
    const f = fixture({ noSnapshotAt: 1 }); const main = await f.connectMain(); start(f); await f.until(() => f.sockets.length > 1);
    if (cause === "pagehide") f.window.dispatchEvent({ type: "pagehide" }); else main.receive("disconnect", "transport close");
    await f.advance(30000); assert.equal(f.status().running, false); assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("pageshow observes a new native main connection and repeat pagehide cancels", async () => {
    const f = fixture({ capacity: 7, required: 9 }); await f.connectMain(); start(f); await f.until(() => f.status()?.state === "waiting");
    f.window.dispatchEvent({ type: "pagehide", persisted: true }); await f.advance(0); helpersClosed(f);
    f.window.dispatchEvent({ type: "pageshow", persisted: true }); await f.connectMain(); start(f, 5);
    await f.until(() => f.status()?.state === "waiting"); assert.equal(f.votes().length, 6);
    f.window.dispatchEvent({ type: "pagehide", persisted: true }); await f.advance(30000); assert.equal(f.status().state, "stopped"); helpersClosed(f);
  });

  await check("pageshow retains the same main connection without opening helpers automatically", async () => {
    const f = fixture({ required: 3 }); const main = await f.connectMain(); start(f); await f.until(() => f.status()?.state === "waiting");
    const departedIds = f.sockets.filter(socket => !socket.isPrimary).map(socket => 100 + socket.ordinal);
    f.window.dispatchEvent({ type: "pagehide", persisted: true }); await f.advance(0);
    const before = f.sockets.length; f.window.dispatchEvent({ type: "pageshow", persisted: true }); await f.advance(0);
    assert.equal(f.sockets.length, before);
    for (const id of departedIds) main.receive("data", { id: 2, data: { id, reason: 0 } });
    main.receive("data", { id: 10, data: f.snapshot(1) });
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).connected, true);
    start(f, 5); await f.until(() => f.status()?.state === "waiting"); assert.equal(f.primary, main); assert.equal(f.votes().length, 6);
    f.request({ action: "stop" }); await f.advance(30000); helpersClosed(f);
  });

  await check("helper login timeout preserves earlier voters for the bounded outcome wait", async () => {
    const f = fixture({ noSnapshotAt: 2, required: 9 }); await f.connectMain(); start(f); await f.until(() => f.status()?.state === "waiting");
    assert.equal(f.votes().length, 2); assert.equal(f.sockets[1].connected, true); assert.equal(f.sockets[2].connected, false);
    await terminal(f); honest(f); helpersClosed(f);
  });

  await check("helper connection refusal stops additional joining and waits honestly", async () => {
    const f = fixture({ connectErrorAt: 2, required: 9 }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 3); honest(f); helpersClosed(f);
  });

  await check("a registered helper disconnection aborts the active run", async () => {
    const f = fixture({ noSnapshotAt: 2, required: 9 }); await f.connectMain(); start(f); await f.until(() => f.sockets.length >= 3);
    f.sockets[1].receive("disconnect", "transport close"); await f.advance(30000);
    assert.equal(f.status().state, "error"); assert.equal(f.votes().length, 2); helpersClosed(f);
  });

  for (const data of [{ noAckAtVote: 1 }, { ackVoterOverride: 5 }]) await check(`unconfirmed own vote ${JSON.stringify(data)} prevents helper joins`, async () => {
    const f = fixture(data); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.status().state, "error"); assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 1); helpersClosed(f);
  });

  await check("a missing helper vote acknowledgement prevents additional helper joins", async () => {
    const f = fixture({ noAckAtVote: 2, required: 9 }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.status().state, "error"); assert.equal(f.votes().length, 2); assert.equal(f.sockets.length, 2); helpersClosed(f);
  });

  await check("natural departure is distinguished from a kick", async () => {
    const f = fixture({ naturalLeaveAtVote: 1 }); await f.connectMain(); start(f); await terminal(f);
    assert.match(f.status().message, /left|leave|depart/i); honest(f); assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  for (const packet of [
    { id: 10, data: null }, { id: 17, data: 2 }, { id: 1, data: { id: 2, name: "Duplicate", flags: 4 } },
    { id: 2, data: { id: 1, reason: 1 } },
  ]) await check(`session or eligibility change ${packet.id} cancels joining`, async () => {
    const f = fixture({ noSnapshotAt: 1 }); const main = await f.connectMain(); start(f); await f.until(() => f.sockets.length > 1);
    main.receive("data", packet.id === 10 ? { id: 10, data: f.snapshot(1, { id: "another-room" }) } : packet);
    await f.advance(30000); assert.equal(f.status().running, false); assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("a helper entering the wrong lobby cannot submit a vote", async () => {
    const f = fixture({ helperSnapshotOverrides: { id: "another-room" } }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 2); honest(f); helpersClosed(f);
  });

  for (const type of [0, undefined, null, "1", 2]) await check(`helper snapshot type ${JSON.stringify(type)} cannot authorize a helper vote`, async () => {
    const f = fixture({ helperSnapshotOverrides: { type } }); await f.connectMain(); start(f); await terminal(f);
    assert.equal(f.status().state, "error"); assert.equal(f.votes().length, 1); assert.equal(f.sockets.length, 2);
    helpersClosed(f);
  });

  for (const change of ["login", "self-leave", "disconnect", "joinerr", "connect_error"]) await check(`${change} clears private authorization until a fresh native snapshot`, async () => {
    const f = fixture({ required: 1, kickWhenThresholdMet: true }); const main = await f.connectMain();
    if (change === "login") main.emit("login", { join: "another-room", create: 0, lang: "0", avatar: [0, 0, 0, -1] });
    else if (change === "self-leave") main.receive("data", { id: 2, data: { id: 1, reason: 0 } });
    else main.receive(change, 100);
    f.request({ action: "snapshot" }); assert.equal(f.statuses.at(-1).lobbyType, null);
    if (change === "disconnect") { main.connected = true; main.receive("connect"); }
    start(f); await f.advance(30000); assert.equal(f.votes().length, 0); assert.equal(f.sockets.length, 1);
    main.receive("data", { id: 10, data: f.snapshot(1) }); start(f); await terminal(f);
    assert.equal(f.votes().length, 1); helpersClosed(f);
  });

  await check("malformed or unsupported bridge messages do not create sockets or votes", async () => {
    const f = fixture(); await f.connectMain();
    for (const data of [null, {}, 17, "{", "null", "[]", JSON.stringify({ action: "unknown" }), "x".repeat(50000)]) f.rawRequest(data);
    await f.advance(30000); assert.equal(f.sockets.length, 1); assert.equal(f.votes().length, 0);
  });

  const probeFixture = options => fixture({ lobbyType: 0, ...options });
  const probe = (f, mode) => f.request({ action: "probe", ...(mode === undefined ? {} : { mode }) });
  function loginOnly(f) {
    assert.equal(f.votes().length, 0, "An admission probe emitted a vote");
    assert.ok(f.history.filter(entry => entry.kind === "emit").every(entry => entry.event === "login"),
      "An admission probe emitted an application event other than login");
    helpersClosed(f);
  }

  await check("invite probe uses native room lookup, independent endpoint/path, exact room admission and login only", async () => {
    const f = probeFixture(); await f.connectMain({}, { auth: { token: "fixture-secret" }, query: { code: "fixture-secret" } }, { code: "fixture-secret" });
    probe(f); await terminal(f);
    assert.equal(f.status().state, "done");
    assert.deepEqual(f.status().probe, { mode: "invite", stage: "complete", code: null, sameRoom: true, lobbyType: 0 });
    assert.deepEqual(f.lookupRequests.map(record => [record.url, record.method, record.body, record.credentials]),
      [["/api/play", "POST", "id=room-one", "same-origin"]]);
    assert.equal(f.lookupRequests[0].headers["Content-Type"], "application/x-www-form-urlencoded");
    const helper = f.sockets[1]; assert.equal(helper.uri, "https://probe-server.skribbl.io");
    assert.equal(helper.options.path, "/5011/"); assert.equal(helper.options.forceNew, true);
    assert.equal(helper.options.multiplex, false); assert.equal(helper.options.reconnection, false);
    assert.equal(helper.options.auth, undefined); assert.equal(helper.options.query, undefined);
    const login = helper.outgoing[0].payload; assert.equal(login.join, "room-one"); assert.equal(login.create, 0);
    assert.equal(login.code, undefined); assert.equal(helper.outgoing.length, 1);
    assert.deepEqual(f.statuses.filter(value => value.probe).map(value => value.probe.stage),
      ["lookup", "connect", "admission", "complete"]);
    const diagnostics = JSON.stringify(f.statuses.filter(value => value.probe));
    assert.ok(!diagnostics.includes("room-one") && !diagnostics.includes("fixture-secret")
      && !diagnostics.includes("Duplicate") && !diagnostics.includes("socket-"));
    assert.match(f.status().message, /vote eligibility was not tested/); loginOnly(f);
  });

  await check("private invitation probe uses the same bounded route without changing private vote behavior", async () => {
    const f = probeFixture({ helperSnapshotOverrides: { type: 1 } }); await f.connectMain({ type: 1 });
    probe(f, "invite"); await terminal(f); assert.equal(f.status().state, "done");
    assert.equal(f.status().probe.lobbyType, 1); assert.equal(f.lookupRequests.length, 1); loginOnly(f);
  });

  await check("public probe denial retains exact admission100, closes immediately and does not repeat invitation", async () => {
    const f = probeFixture({ joinErrAt: 1, joinErrCode: 100 }); await f.connectMain({ owner: -1 });
    probe(f); await terminal(f);
    assert.deepEqual(f.status().probe, { mode: "invite", stage: "admission", code: 100, sameRoom: null, lobbyType: null });
    assert.equal(f.status().admissionCode, 100); assert.equal(f.sockets.length, 2);
    assert.ok(!/your vote remains|registered/i.test(f.status().message));
    probe(f); await terminal(f); assert.equal(f.status().probe.stage, "validation");
    assert.equal(f.lookupRequests.length, 1); assert.equal(f.sockets.length, 2); loginOnly(f);
  });

  await check("explicit public matchmaking probes lang with empty join and can run once after an invitation denial", async () => {
    const f = probeFixture({ joinErrAt: 1, joinErrCode: 100 }); await f.connectMain({}, {}, { lang: "3" });
    probe(f); await terminal(f); probe(f, "matchmaking"); await terminal(f);
    assert.equal(f.status().state, "done"); assert.equal(f.status().probe.sameRoom, true);
    assert.equal(f.lookupRequests[1].body, "lang=3"); assert.equal(f.sockets.length, 3);
    const login = f.sockets[2].outgoing[0].payload;
    assert.equal(login.join, ""); assert.equal(login.create, 0); assert.equal(login.lang, "3");
    probe(f, "matchmaking"); await terminal(f); assert.equal(f.lookupRequests.length, 2);
    assert.match(f.status().message, /single matchmaking diagnostic/); loginOnly(f);
  });

  for (const mode of ["invite", "matchmaking"]) await check(`${mode} admission to another room is diagnosed and never changes the primary lobby`, async () => {
    const f = probeFixture({ separateHelperLobby: true, helperSnapshotOverrides: { id: "other-room", owner: -1 } });
    await f.connectMain(); probe(f, mode); await terminal(f);
    assert.equal(f.status().state, "error"); assert.equal(f.status().probe.sameRoom, false);
    assert.equal(f.status().probe.lobbyType, 0); assert.equal(f.status().probe.stage, "admission");
    assert.match(f.status().message, /different lobby/);
    f.request({ action: "snapshot" }); const state = f.statuses.at(-1);
    assert.equal(state.lobbyId, "room-one"); assert.equal(state.occupied, BASE_USERS.length);
    assert.equal(state.users.length, BASE_USERS.length); loginOnly(f);
  });

  await check("same-room probe snapshot with a different lobby type is rejected", async () => {
    const f = probeFixture({ helperSnapshotOverrides: { type: 1 }, suppressHelperRoster: true }); await f.connectMain();
    probe(f); await terminal(f); assert.equal(f.status().state, "error");
    assert.equal(f.status().probe.sameRoom, true); assert.equal(f.status().probe.lobbyType, 1); loginOnly(f);
  });

  for (const mode of ["bogus", null, 0, {}]) await check(`invalid probe mode ${JSON.stringify(mode)} has no networking or votes`, async () => {
    const f = probeFixture(); await f.connectMain(); probe(f, mode); await f.advance(30000);
    assert.equal(f.status().state, "error"); assert.equal(f.lookupRequests.length, 0); assert.equal(f.sockets.length, 1); loginOnly(f);
  });

  for (const settings of [
    { overrides: { type: 1 }, mode: "matchmaking" },
    { options: { capacity: 5 } }, { overrides: { settings: [] } },
    { login: { avatar: [] } }, { mode: "matchmaking", login: { lang: "0&extra=1" } },
    { mode: "matchmaking", login: { lang: 28 } }
  ]) await check(`probe rejects unsupported prerequisites ${JSON.stringify(settings)}`, async () => {
    const f = probeFixture(settings.options); await f.connectMain(settings.overrides, {}, settings.login);
    probe(f, settings.mode); await terminal(f); assert.equal(f.status().probe.stage, "validation");
    assert.equal(f.lookupRequests.length, 0); assert.equal(f.sockets.length, 1); loginOnly(f);
  });

  await check("probe requires a captured connected primary lobby", async () => {
    const f = probeFixture(); probe(f); await f.advance(0); assert.equal(f.lookupRequests.length, 0);
    assert.equal(f.sockets.length, 0); loginOnly(f);
  });

  for (const failure of [
    { lookupStatus: 429 }, { lookupStatus: 201 }, { lookupError: true },
    { lookupEndpoint: "https://other.example:5011/" },
    { lookupEndpoint: "http://probe-server.skribbl.io:5011/" },
    { lookupEndpoint: "https://probe-server.skribbl.io/" },
    { lookupEndpoint: "https://user:secret@probe-server.skribbl.io:5011/" },
    { lookupEndpoint: "https://probe-server.skribbl.io:5011/path?secret=value" }
  ]) await check(`probe lookup failure ${JSON.stringify(failure)} is distinct from admission denial`, async () => {
    const f = probeFixture(failure); await f.connectMain(); probe(f); await terminal(f);
    assert.equal(f.status().state, "error"); assert.equal(f.status().probe.stage, "lookup");
    assert.equal(f.status().probe.code, null); assert.equal(f.status().probe.sameRoom, null);
    assert.equal(f.sockets.length, 1); assert.equal(f.lookupRequests.length, 1);
    assert.ok(!JSON.stringify(f.status().probe).includes("secret")); loginOnly(f);
  });

  for (const change of ["stop", "pagehide", "disconnect", "snapshot", "owner"]) await check(`${change} cancels probe lookup and a late response cannot open a helper`, async () => {
    const f = probeFixture({ lookupDelay: 20000, ignoreLookupAbort: true }); const main = await f.connectMain();
    probe(f); await f.advance(0); assert.equal(f.lookupRequests.length, 1);
    if (change === "stop") f.request({ action: "stop" });
    else if (change === "pagehide") f.window.dispatchEvent({ type: "pagehide", persisted: false });
    else if (change === "disconnect") main.receive("disconnect", "transport close");
    else if (change === "snapshot") main.receive("data", { id: 10, data: f.snapshot(1, { id: "new-room" }) });
    else main.receive("data", { id: 17, data: 2 });
    assert.equal(f.lookupRequests[0].aborted, true); await f.advance(30000);
    assert.equal(f.status().running, false); assert.equal(f.sockets.length, 1); loginOnly(f);
  });

  await check("lookup timeout finishes at its deadline and late network/body completion cannot create a helper", async () => {
    const f = probeFixture({ lookupTextDelay: 20000, ignoreLookupAbort: true }); await f.connectMain();
    probe(f); await f.advance(8000); assert.equal(f.status().running, false);
    assert.equal(f.status().probe.stage, "lookup"); assert.match(f.status().message, /timed out/);
    assert.equal(f.lookupRequests[0].aborted, true); await f.advance(30000);
    assert.equal(f.sockets.length, 1); loginOnly(f);
  });

  await check("capacity filling during lookup prevents opening the diagnostic helper", async () => {
    const f = probeFixture({ capacity: 6, lookupDelay: 1000 }); const main = await f.connectMain(); probe(f);
    main.receive("data", { id: 1, data: { id: 99, name: "New player", flags: 0 } });
    await terminal(f); assert.equal(f.sockets.length, 1); assert.match(f.status().message, /capacity changed/); loginOnly(f);
  });

  for (const failure of [{ connectErrorAt: 1 }, { neverConnectAt: 1 }, { noSnapshotAt: 1 }]) await check(`probe transport/admission timeout ${JSON.stringify(failure)} closes one helper without voting`, async () => {
    const f = probeFixture(failure); await f.connectMain(); probe(f); await terminal(f);
    assert.equal(f.sockets.length, 2); assert.equal(f.status().state, "error");
    assert.equal(f.status().probe.stage, failure.noSnapshotAt ? "admission" : "connect"); loginOnly(f);
  });

  await check("stop after probe socket creation immediately closes it and prevents a late login", async () => {
    const f = probeFixture({ neverConnectAt: 1 }); await f.connectMain(); probe(f);
    await f.until(() => f.sockets.length === 2); f.request({ action: "stop" }); await f.advance(30000);
    assert.equal(f.sockets[1].outgoing.length, 0); assert.equal(f.status().state, "stopped"); loginOnly(f);
  });

  await check("probe and normal vote runs cannot overlap", async () => {
    const f = probeFixture({ lookupDelay: 20000 }); await f.connectMain(); probe(f); start(f);
    assert.equal(f.status().running, true); assert.equal(f.votes().length, 0);
    probe(f, "matchmaking"); assert.equal(f.lookupRequests.length, 1);
    f.request({ action: "stop" }); await f.advance(30000); assert.equal(f.sockets.length, 1); loginOnly(f);
    const g = fixture({ noAckAtVote: 1 }); await g.connectMain(); start(g); probe(g);
    assert.equal(g.lookupRequests.length, 0); assert.equal(g.sockets.length, 1);
    assert.equal(g.votes().length, 1); g.request({ action: "stop" }); await g.advance(30000); helpersClosed(g);
  });

  await check("native lobby refresh permits one new matchmaking probe without adding votes", async () => {
    const f = probeFixture(); const main = await f.connectMain(); probe(f, "matchmaking"); await terminal(f);
    main.receive("data", { id: 10, data: f.snapshot(1) }); probe(f, "matchmaking"); await terminal(f);
    assert.equal(f.lookupRequests.length, 2); assert.equal(f.sockets.length, 3); loginOnly(f);
  });

  console.log(`\n${completed} vote-kick and admission-probe checks passed; no live connections were made.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
