(() => {
  'use strict';

  // This runs in the page's MAIN world before Socket.IO loads. Helpers use the
  // same ordinary factory and endpoint as the game, with separate connections.
  const REQUEST_EVENT = 'ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-request';
  const STATUS_EVENT = 'ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status';
  const MAX_CAPACITY = 20;
  const MAX_HELPERS = MAX_CAPACITY - 1;
  const JOIN_TIMEOUT_MS = 8000;
  const JOIN_SPACING_MS = 1000;
  const VOTE_TIMEOUT_MS = 3000;
  const OUTCOME_TIMEOUT_MS = 8000;
  const ADMIN_FLAG = 4;
  const socketRecords = new WeakMap();
  const factoryWrappers = new WeakMap();
  const observedRecords = new Set();
  const hiddenHelperIds = new Set();
  let primary = null;
  let currentRun = null;
  let unloaded = false;
  let suspendedRecords = [];
  let suspendedPrimary = null;

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isId = value => Number.isSafeInteger(value) && value >= 0;
  const isOwnerId = value => value === -1 || isId(value);
  const capacityFrom = value => {
    const capacity = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    return Number.isInteger(capacity) && capacity >= 2 && capacity <= MAX_CAPACITY ? capacity : null;
  };
  const roomId = value => typeof value === 'string' && value.length > 0 && value.length <= 256
    ? value : null;

  function publish(payload) {
    try {
      document.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: JSON.stringify(payload) }));
    } catch (_) {
      // Observing game events must never interrupt the game itself.
    }
  }

  function snapshot() {
    const connected = !!(primary && primary.socket.connected && primary.lobbyId !== null);
    publish({
      type: 'snapshot',
      connected,
      lobbyId: connected ? primary.lobbyId : null,
      users: connected ? Array.from(primary.users.values())
        .filter(user => !hiddenHelperIds.has(user.id))
        .map(user => ({
          id: user.id,
          name: user.name,
          isSelf: user.id === primary.me,
          isOwner: user.id === primary.owner,
          isAdmin: (user.flags & ADMIN_FLAG) === ADMIN_FLAG
        })) : [],
      capacity: connected ? primary.capacity : null,
      occupied: connected ? primary.users.size : 0,
      availableSlots: connected && primary.capacity !== null
        ? Math.max(0, primary.capacity - primary.users.size) : null,
      lobbyType: connected ? primary.lobbyType : null,
      helperRejectionCode: connected ? primary.helperRejectionCode : null,
      automatic: true
    });
  }

  function status(state, message, run = currentRun) {
    const payload = { type: 'status', state, message, running: !!(currentRun && !currentRun.finished) };
    if (run && run.lastVote) {
      payload.votes = run.lastVote.votes;
      payload.required = run.lastVote.required;
    }
    if (run && run.admissionCode !== null) payload.admissionCode = run.admissionCode;
    if (run && run.probe) payload.probe = { ...run.probe };
    publish(payload);
  }

  function userFrom(value) {
    if (!isObject(value) || !isId(value.id) || typeof value.name !== 'string') return null;
    return {
      id: value.id,
      name: value.name.slice(0, 128),
      flags: Number.isSafeInteger(value.flags) ? value.flags : 0
    };
  }

  function lobbyFrom(value) {
    if (!isObject(value) || !isId(value.me) || !isOwnerId(value.owner)
      || roomId(value.id) === null || !Array.isArray(value.users)) return null;
    const users = new Map();
    for (const valueUser of value.users) {
      const user = userFrom(valueUser);
      if (user) users.set(user.id, user);
    }
    if (!users.has(value.me)) return null;
    return {
      me: value.me, owner: value.owner, lobbyId: value.id, users,
      // Native packet 10 supplies the room mode: 0 public, 1 private.
      lobbyType: value.type === 0 || value.type === 1 ? value.type : null,
      capacity: Array.isArray(value.settings) ? capacityFrom(value.settings[1]) : null
    };
  }

  function trustedEndpoint(args) {
    try {
      const uri = typeof args[0] === 'string' ? args[0] : window.location.origin;
      const endpoint = new URL(uri, window.location.href);
      const host = endpoint.hostname.toLowerCase();
      if (!['https:', 'http:', 'wss:', 'ws:'].includes(endpoint.protocol)
        || endpoint.username || endpoint.password
        || (host !== 'skribbl.io' && !host.endsWith('.skribbl.io'))) return null;
      const options = typeof args[0] === 'string' ? args[1] : args[0];
      if (options !== undefined && !isObject(options)) return null;
      return { uri, options: options ? { ...options } : {} };
    } catch (_) {
      return null;
    }
  }

  function clearLobby(record) {
    record.lobbyId = null;
    record.me = null;
    record.owner = null;
    record.capacity = null;
    record.lobbyType = null;
    record.helperRejectionCode = null;
    record.matchmakingProbed = false;
    record.users.clear();
    record.votes.clear();
    record.voteCounts.clear();
    hiddenHelperIds.clear();
  }

  function safeListener(callback) {
    return (...args) => {
      try { callback(...args); } catch (_) { /* Leave native game listeners unaffected. */ }
    };
  }

  function finishRun(run, state, message) {
    if (!run || run.finished) return;
    run.finished = true;
    if (currentRun === run) currentRun = null;
    if (run.lookupController) run.lookupController.abort();
    for (const timer of run.timers) clearTimeout(timer);
    run.timers.clear();
    for (const waiter of run.waiters) waiter.reject(new Error('Vote run ended.'));
    run.waiters.clear();
    for (const helper of Array.from(run.helpers)) closeHelper(run, helper);
    status(state, message, run);
    snapshot();
  }

  function closeHelper(run, helper) {
    if (helper.closed) return;
    helper.closed = true;
    for (const [event, listener] of helper.listeners) {
      try { helper.socket.off(event, listener); } catch (_) {}
    }
    helper.listeners.length = 0;
    const index = run.helpers.indexOf(helper);
    if (index !== -1) run.helpers.splice(index, 1);
    try { helper.socket.close(); } catch (_) {
      try { helper.socket.disconnect(); } catch (_) {}
    }
  }

  class AdmissionError extends Error {
    constructor(message, code = null) {
      super(message);
      this.code = Number.isSafeInteger(code) && code >= 0 ? code : null;
    }
  }

  function targetDeparture(run, reason) {
    const message = reason === 1
      ? 'The server confirmed that the selected player was kicked.'
      : reason === 2
        ? 'The selected player was banned; a vote kick was not confirmed.'
        : 'The selected player left the lobby; a vote kick was not confirmed.';
    finishRun(run, 'done', message);
  }

  function ensureRun(run) {
    if (run.finished || currentRun !== run) throw new Error('Vote run ended.');
    if (primary !== run.primary || !primary.socket.connected || primary.lobbyId !== run.lobbyId
      || primary.me !== run.me) throw new Error('Your lobby connection changed.');
    if (primary.owner !== run.owner) throw new Error('The lobby owner changed.');
    if (run.probe) {
      if (primary.lobbyType !== run.lobbyType) throw new Error('The lobby type changed.');
      return;
    }
    if (primary.lobbyType !== 1) throw new Error('Vote kick is available only in a confirmed private lobby.');
    const target = primary.users.get(run.targetId);
    if (!target) throw new Error('The selected player is no longer in the lobby.');
    if (target.id === primary.me || target.id === primary.owner
      || (target.flags & ADMIN_FLAG) === ADMIN_FLAG || hiddenHelperIds.has(target.id)) {
      throw new Error('That player cannot be selected for a vote kick.');
    }
  }

  function timerFor(run, callback, delay) {
    const timer = setTimeout(() => {
      run.timers.delete(timer);
      if (!run.finished) callback();
    }, delay);
    run.timers.add(timer);
    return timer;
  }

  function waitFor(run, matches, timeout, failureMessage) {
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, reject, timer: null };
      waiter.timer = timerFor(run, () => {
        run.waiters.delete(waiter);
        reject(new Error(failureMessage));
      }, timeout);
      run.waiters.add(waiter);
    });
  }

  function notifyWaiters(run, event) {
    if (!run || run.finished) return;
    for (const waiter of Array.from(run.waiters)) {
      if (!waiter.matches(event)) continue;
      clearTimeout(waiter.timer);
      run.timers.delete(waiter.timer);
      run.waiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  function delay(run, duration) {
    return waitFor(run, () => false, duration, 'spacing').catch(error => {
      if (error.message !== 'spacing') throw error;
      ensureRun(run);
    });
  }

  function voteFrom(value) {
    if (!Array.isArray(value) || value.length < 4 || !isId(value[0]) || !isId(value[1])
      || !Number.isSafeInteger(value[2]) || value[2] < 0
      || !Number.isSafeInteger(value[3]) || value[3] < 1) return null;
    return { voterId: value[0], targetId: value[1], votes: value[2], required: value[3] };
  }

  function observeVote(record, value) {
    const vote = voteFrom(value);
    if (!vote) return;
    if (record === primary && record.lobbyId !== null) {
      let voters = record.votes.get(vote.targetId);
      if (!voters) record.votes.set(vote.targetId, voters = new Set());
      voters.add(vote.voterId);
      record.voteCounts.set(vote.targetId, vote);
    }
    const run = currentRun;
    if (run && vote.targetId === run.targetId) {
      run.lastVote = vote;
      notifyWaiters(run, { type: 'vote', ...vote });
    }
  }

  function primaryData(record, packet) {
    if (record !== primary || !isObject(packet)) return;
    const value = packet.data;
    switch (packet.id) {
      case 10: {
        const lobby = lobbyFrom(value);
        clearLobby(record);
        if (lobby) Object.assign(record, lobby);
        if (currentRun) finishRun(currentRun, 'error', lobby
          ? 'Your lobby session was refreshed.' : 'Lobby information is unavailable. Vote kick stopped.');
        snapshot();
        break;
      }
      case 1: {
        if (record.lobbyId === null) return;
        const user = userFrom(value);
        if (user) {
          record.users.set(user.id, user);
          if (currentRun) {
            try { ensureRun(currentRun); } catch (error) { finishRun(currentRun, 'error', error.message); }
          }
          snapshot();
        }
        break;
      }
      case 2: {
        if (!isObject(value) || !isId(value.id) || record.lobbyId === null) return;
        if (value.id === record.me) {
          if (currentRun) finishRun(currentRun, 'error', 'Your session left the lobby.');
          clearLobby(record);
          snapshot();
          return;
        }
        record.users.delete(value.id);
        record.votes.delete(value.id);
        record.voteCounts.delete(value.id);
        for (const voters of record.votes.values()) voters.delete(value.id);
        hiddenHelperIds.delete(value.id);
        if (currentRun && value.id === currentRun.targetId) targetDeparture(currentRun, value.reason);
        else if (currentRun && currentRun.helpers.some(helper => helper.me === value.id)) {
          finishRun(currentRun, 'error', 'A helper left the lobby before the outcome was confirmed.');
        }
        snapshot();
        break;
      }
      case 5:
        observeVote(record, value);
        break;
      case 12:
        if (!isObject(value) || (value.id !== 1 && value.id !== '1') || record.lobbyId === null) return;
        record.capacity = capacityFrom(value.val);
        snapshot();
        break;
      case 17:
        if (!isOwnerId(value) || record.lobbyId === null) return;
        if (currentRun && value !== record.owner) finishRun(currentRun, 'error', 'The lobby owner changed.');
        record.owner = value;
        snapshot();
        break;
      case 90:
        if (!isObject(value) || !isId(value.id) || typeof value.name !== 'string') return;
        if (record.users.has(value.id)) {
          record.users.get(value.id).name = value.name.slice(0, 128);
          snapshot();
        }
        break;
      default:
        break;
    }
  }

  function loginCaptured(record, value) {
    if (!isObject(value)) return;
    if (currentRun) finishRun(currentRun, 'error', 'Your lobby connection changed.');
    if (primary && primary !== record) detachRecord(primary);
    primary = record;
    clearLobby(record);
    // Never retain or copy the native login's name suffix / secret code.
    const language = value.lang;
    const avatar = value.avatar;
    record.login = (typeof language === 'string' || Number.isFinite(language))
      && Array.isArray(avatar) && avatar.length === 4 && avatar.every(Number.isSafeInteger)
      ? { lang: language, avatar: avatar.slice() } : null;
    snapshot();
  }

  function detachRecord(record) {
    for (const [event, listener] of record.listeners) {
      try { record.socket.off(event, listener); } catch (_) {}
    }
    record.listeners.length = 0;
    try {
      if (record.socket.emit === record.wrappedEmit) {
        if (record.emitDescriptor) Object.defineProperty(record.socket, 'emit', record.emitDescriptor);
        else delete record.socket.emit;
      }
    } catch (_) {}
    observedRecords.delete(record);
    socketRecords.delete(record.socket);
  }

  function observeSocket(socket, factory, factoryThis, args) {
    if (socket && socketRecords.has(socket)) return socketRecords.get(socket);
    if (unloaded || !socket || typeof socket.on !== 'function'
      || typeof socket.emit !== 'function') return null;
    const endpoint = trustedEndpoint(args);
    if (!endpoint) return;
    const record = {
      socket, factory, factoryThis, endpoint, login: null, lobbyId: null,
      me: null, owner: null, capacity: null, lobbyType: null, helperRejectionCode: null,
      matchmakingProbed: false,
      users: new Map(), votes: new Map(), voteCounts: new Map(), listeners: []
    };
    record.emitDescriptor = Object.getOwnPropertyDescriptor(socket, 'emit');
    const emit = socket.emit;
    record.wrappedEmit = new Proxy(emit, {
      apply(target, thisArg, callArgs) {
        try {
          if (thisArg === socket && callArgs[0] === 'login') loginCaptured(record, callArgs[1]);
        } catch (_) {}
        return Reflect.apply(target, thisArg, callArgs);
      }
    });
    try { socket.emit = record.wrappedEmit; } catch (_) { return; }
    if (socket.emit !== record.wrappedEmit) return;
    socketRecords.set(socket, record);
    observedRecords.add(record);
    function listen(event, callback) {
      const listener = safeListener(callback);
      record.listeners.push([event, listener]);
      socket.on(event, listener);
    }
    listen('data', packet => primaryData(record, packet));
    listen('connect', () => { if (record === primary) snapshot(); });
    listen('disconnect', () => {
      if (record !== primary) return;
      if (currentRun) finishRun(currentRun, 'error', 'Your game connection disconnected.');
      clearLobby(record);
      snapshot();
    });
    for (const event of ['joinerr', 'connect_error']) listen(event, () => {
      if (record !== primary) return;
      if (currentRun) finishRun(currentRun, 'error', 'Your game connection was rejected.');
      clearLobby(record);
      snapshot();
    });
    return record;
  }

  function wrapFactory(factory) {
    if (typeof factory !== 'function') return factory;
    if (factoryWrappers.has(factory)) return factoryWrappers.get(factory);
    const wrapper = new Proxy(factory, {
      apply(target, thisArg, args) {
        const socket = Reflect.apply(target, thisArg, args);
        try { observeSocket(socket, target, thisArg, args); } catch (_) {}
        return socket;
      },
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try { observeSocket(socket, target, undefined, args); } catch (_) {}
        return socket;
      }
    });
    factoryWrappers.set(factory, wrapper);
    factoryWrappers.set(wrapper, wrapper);
    return wrapper;
  }

  function installFactoryHook() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'io');
      if (descriptor && !descriptor.configurable) {
        if ('value' in descriptor && descriptor.writable) window.io = wrapFactory(descriptor.value);
        return;
      }
      let exposed = wrapFactory(window.io);
      Object.defineProperty(window, 'io', {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : true,
        get() {
          return descriptor && descriptor.get
            ? wrapFactory(Reflect.apply(descriptor.get, this, [])) : exposed;
        },
        set(value) {
          if (descriptor && descriptor.set) Reflect.apply(descriptor.set, this, [value]);
          exposed = wrapFactory(value);
        }
      });
    } catch (_) {
      // A page that locks its io global remains playable; the UI stays disconnected.
    }
  }

  function rejectionMessage(index, code, lobbyType) {
    if (code === 100 && lobbyType === 0) {
      return `The public lobby rejected helper ${index} as already connected (server code 100). Your vote remains registered; extra sessions are unavailable on this connection.`;
    }
    const reasons = {
      1: 'room not found', 2: 'room is full', 3: 'kick cooldown', 4: 'room ban',
      5: 'joining too quickly', 100: 'already connected to this room',
      200: 'too many connections from this IP', 300: 'too many previous kicks'
    };
    return `Helper ${index} was rejected by the server (${reasons[code] || 'unknown rejection'}).`;
  }

  async function joinHelper(run, index) {
    ensureRun(run);
    const helper = { socket: null, me: null, joined: false, closed: false, loginSent: false, listeners: [] };
    const options = {
      ...run.primary.endpoint.options,
      ...(run.helperEndpoint ? { path: run.helperEndpoint.path } : {}),
      forceNew: true, multiplex: false, reconnection: false, timeout: JOIN_TIMEOUT_MS
    };
    // Do not reuse optional authentication from the primary connection.
    delete options.auth;
    delete options.query;
    let socket;
    try {
      socket = Reflect.apply(run.primary.factory, run.primary.factoryThis,
        [run.helperEndpoint ? run.helperEndpoint.uri : run.primary.endpoint.uri, options]);
    } catch (_) {
      throw new AdmissionError(`Helper ${index} could not open a connection.`);
    }
    if (socket === run.primary.socket || run.helpers.some(other => other.socket === socket)) {
      throw new AdmissionError(`Helper ${index} did not receive a separate connection.`);
    }
    if (run.probe && socket && socket.io && socket.io === run.primary.socket.io) {
      try { socket.close(); } catch (_) {}
      throw new AdmissionError('The diagnostic did not receive a separate socket manager.');
    }
    if (!socket || typeof socket.on !== 'function' || typeof socket.off !== 'function'
      || typeof socket.emit !== 'function' || typeof socket.close !== 'function') {
      try { if (socket && typeof socket.close === 'function') socket.close(); } catch (_) {}
      throw new AdmissionError(`Helper ${index} could not open a connection.`);
    }
    helper.socket = socket;
    run.helpers.push(helper);
    const joined = waitFor(run, event => (event.type === 'joined' || event.type === 'join-failed')
      && event.helper === helper,
      JOIN_TIMEOUT_MS, `Helper ${index} did not join before the timeout.`);
    // A synchronous server event can finish a run before this function reaches await.
    joined.catch(() => {});
    function listen(event, callback) {
      const listener = safeListener(callback);
      helper.listeners.push([event, listener]);
      socket.on(event, listener);
    }
    function failJoin(message, code = null) {
      if (run.finished || helper.closed) return;
      if (helper.joined) {
        finishRun(run, 'error', message);
        return;
      }
      notifyWaiters(run, { type: 'join-failed', helper, message, code });
      closeHelper(run, helper);
    }
    function sendLogin() {
      if (run.finished || helper.closed || helper.loginSent) return;
      try { ensureRun(run); } catch (error) { finishRun(run, 'error', error.message); return; }
      if (run.probe) {
        const engineId = socket.io && socket.io.engine && socket.io.engine.id;
        const primaryEngineId = run.primary.socket.io && run.primary.socket.io.engine
          && run.primary.socket.io.engine.id;
        if ((socket.id && socket.id === run.primary.socket.id)
          || (engineId && primaryEngineId && engineId === primaryEngineId)) {
          failJoin('The diagnostic did not receive independent connection identifiers.');
          return;
        }
        run.probe.stage = 'admission';
        status('joining', `The ${run.probe.mode} diagnostic connected; checking lobby admission.`, run);
      }
      try {
        helper.loginSent = true;
        socket.emit('login', {
          join: run.probe && run.probe.mode === 'matchmaking' ? '' : run.lobbyId,
          create: 0,
          name: run.probe ? 'Admission probe' : `Vote helper ${index}`,
          lang: run.primary.login.lang,
          avatar: run.primary.login.avatar.slice()
        });
      } catch (_) {
        failJoin(`Helper ${index} could not send its login.`);
      }
    }
    listen('connect', sendLogin);
    listen('joinerr', code => failJoin(run.probe
      ? `The server rejected diagnostic admission${Number.isSafeInteger(code) && code >= 0 ? ` (code ${code})` : ''}. No votes were sent.`
      : rejectionMessage(index, code, run.primary.lobbyType), code));
    listen('connect_error', () => failJoin(`Helper ${index} could not connect.`));
    listen('disconnect', () => failJoin(`Helper ${index} disconnected before the outcome was confirmed.`));
    listen('data', packet => {
      if (run.finished || helper.closed || !isObject(packet)) return;
      if (packet.id === 10) {
        const lobby = lobbyFrom(packet.data);
        if (run.probe && lobby) {
          run.probe.sameRoom = lobby.lobbyId === run.lobbyId;
          run.probe.lobbyType = lobby.lobbyType;
        }
        if (!lobby || lobby.lobbyId !== run.lobbyId
          || (helper.joined && helper.me !== lobby.me)
          || lobby.me === run.me || run.helpers.some(other => other !== helper && other.me === lobby.me)) {
          failJoin(run.probe && run.probe.sameRoom === false
            ? 'The diagnostic entered a different lobby and disconnected; targeted admission was not confirmed.'
            : `Helper ${index} did not enter the expected lobby.`);
          return;
        }
        if (run.probe && (lobby.lobbyType !== run.lobbyType || !lobby.users.has(run.me))) {
          failJoin('The diagnostic lobby snapshot did not match the original session.');
          return;
        }
        if (!run.probe && lobby.lobbyType !== 1) {
          finishRun(run, 'error', 'The helper could not confirm a private lobby.');
          return;
        }
        if (lobby.owner !== run.owner) {
          finishRun(run, 'error', 'The lobby owner changed.');
          return;
        }
        const target = run.probe ? null : lobby.users.get(run.targetId);
        if (!run.probe && !target) {
          finishRun(run, 'done', 'The selected player is no longer in the lobby; a vote kick was not confirmed.');
          return;
        }
        if (!run.probe && (target.id === lobby.owner || (target.flags & ADMIN_FLAG) === ADMIN_FLAG)) {
          finishRun(run, 'error', 'That player cannot be selected for a vote kick.');
          return;
        }
        helper.me = lobby.me;
        helper.joined = true;
        // Count the admitted helper immediately even if the main socket's join
        // broadcast arrives later. Other players remain in the complete roster.
        if (!run.probe) {
          run.primary.users.set(helper.me, lobby.users.get(helper.me));
          if (lobby.capacity !== null) run.primary.capacity = lobby.capacity;
        }
        hiddenHelperIds.add(helper.me);
        snapshot();
        notifyWaiters(run, { type: 'joined', helper });
      } else if (!run.probe && helper.joined && packet.id === 5) {
        observeVote(null, packet.data);
      } else if (!run.probe && helper.joined && [1, 2, 12, 17, 90].includes(packet.id)) {
        primaryData(run.primary, packet);
      }
    });
    if (socket.connected) sendLogin();
    let result;
    try { result = await joined; } catch (error) {
      if (run.finished) throw error;
      closeHelper(run, helper);
      throw new AdmissionError(error.message);
    }
    if (result.type === 'join-failed') throw new AdmissionError(result.message, result.code);
    ensureRun(run);
    return helper;
  }

  async function castVote(run, socket, voterId, label) {
    ensureRun(run);
    if (!socket.connected) throw new Error(`${label} is no longer connected.`);
    const acknowledged = waitFor(run, event => event.type === 'vote'
      && event.voterId === voterId && event.targetId === run.targetId,
    VOTE_TIMEOUT_MS, `The server did not confirm ${label.toLowerCase()}'s vote.`);
    acknowledged.catch(() => {});
    socket.emit('data', { id: 5, data: run.targetId });
    await acknowledged;
    ensureRun(run);
  }

  function joiningStopReason(run) {
    if (run.lastVote && run.lastVote.votes >= run.lastVote.required) {
      return 'The latest server vote count meets the requirement.';
    }
    if (run.primary.lobbyType === 0 && run.primary.helperRejectionCode === 100) {
      return 'Only your own vote can be used here: this public lobby already refused extra sessions (server code 100).';
    }
    if (run.primary.capacity === null) {
      return 'Room capacity is unavailable, so no helper sessions were added.';
    }
    if (run.primary.users.size >= run.primary.capacity) {
      return 'The lobby is full. No further helper sessions can join.';
    }
    if (!run.primary.login) {
      return 'Helper login settings are unavailable. Your registered vote remains.';
    }
    if (run.helpers.length >= MAX_HELPERS) {
      return 'The game\'s maximum helper count has been reached.';
    }
    return null;
  }

  function waitForOutcome(run, message) {
    ensureRun(run);
    status('waiting', `${message} Waiting for the server to confirm a kick.`, run);
    const terminalState = run.primary.helperRejectionCode === 100 ? 'error' : 'done';
    timerFor(run, () => finishRun(run, terminalState,
      `${message} The server did not confirm a kick. Helper sessions have disconnected.`), OUTCOME_TIMEOUT_MS);
  }

  async function executeRun(run) {
    try {
      status('voting', 'Registering your own vote before adding any helper sessions.', run);
      if (!run.primary.votes.get(run.targetId)?.has(run.me)) {
        await castVote(run, run.primary.socket, run.me, 'Your session');
      }
      while (!run.finished) {
        ensureRun(run);
        let stopReason = joiningStopReason(run);
        if (stopReason) { waitForOutcome(run, stopReason); return; }
        if (run.helpers.length > 0) {
          await delay(run, JOIN_SPACING_MS);
          stopReason = joiningStopReason(run);
          if (stopReason) { waitForOutcome(run, stopReason); return; }
        }
        const index = run.helpers.length + 1;
        status('joining', `Joining helper ${index}. Lobby: ${run.primary.users.size}/${run.primary.capacity} players.`, run);
        const helper = await joinHelper(run, index);
        ensureRun(run);
        // Joining can change the required votes. Cast this admitted helper's
        // vote to obtain a count for the new population, even if a concurrent
        // vote met the old requirement while its connection was opening.
        status('voting', `Registering helper ${index}'s vote. Lobby: ${run.primary.users.size}/${run.primary.capacity} players.`, run);
        await castVote(run, helper.socket, helper.me, `Helper ${index}`);
      }
    } catch (error) {
      if (run.finished) return;
      if (error instanceof AdmissionError) {
        run.admissionCode = error.code;
        // A rejection is a server decision, not a local socket reuse. Remember
        // this public-room decision only for the current native lobby session.
        // New native login/snapshot/disconnect resets it; private rooms and
        // temporary full/rate/IP-limit errors retain their existing behavior.
        if (error.code === 100 && run.primary.lobbyType === 0) {
          run.primary.helperRejectionCode = error.code;
          snapshot();
        }
        try { waitForOutcome(run, `${error.message} No further helpers will join.`); }
        catch (fatal) { finishRun(run, 'error', fatal.message); }
      } else {
        finishRun(run, 'error', error instanceof Error ? error.message : 'The vote run failed.');
      }
    }
  }

  async function lookupProbeEndpoint(run) {
    ensureRun(run);
    const controller = new AbortController();
    run.lookupController = controller;
    let timedOut = false;
    const timer = timerFor(run, () => {
      timedOut = true;
      controller.abort();
      finishRun(run, 'error', 'The native lobby lookup timed out. No helper connection was opened.');
    }, JOIN_TIMEOUT_MS);
    try {
      const body = new URLSearchParams(run.probe.mode === 'invite'
        ? { id: run.lobbyId } : { lang: String(run.primary.login.lang) });
      const response = await fetch('/api/play', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin', body: body.toString(), signal: controller.signal
      });
      ensureRun(run);
      if (response.status !== 200) throw new Error(`The native lobby lookup returned HTTP ${response.status}. No helper connection was opened.`);
      const value = (await response.text()).trim();
      ensureRun(run);
      let endpoint;
      try { endpoint = new URL(value); } catch (_) {}
      if (!endpoint || endpoint.protocol !== 'https:'
        || !endpoint.hostname.toLowerCase().endsWith('.skribbl.io')
        || !/^\d+$/.test(endpoint.port) || endpoint.username || endpoint.password
        || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
        throw new Error('The native lobby lookup returned an unsupported endpoint. No helper connection was opened.');
      }
      return { uri: `${endpoint.protocol}//${endpoint.hostname}`, path: `/${endpoint.port}/` };
    } catch (error) {
      if (run.finished) throw error;
      if (timedOut) throw new Error('The native lobby lookup timed out. No helper connection was opened.');
      if (error instanceof Error && /^(The native lobby lookup)/.test(error.message)) throw error;
      throw new Error('The native lobby lookup failed before a helper connection could open.');
    } finally {
      clearTimeout(timer);
      run.timers.delete(timer);
      if (run.lookupController === controller) run.lookupController = null;
    }
  }

  async function executeProbe(run) {
    try {
      status('joining', `Resolving the native ${run.probe.mode} route. This diagnostic sends login only.`, run);
      run.helperEndpoint = await lookupProbeEndpoint(run);
      ensureRun(run);
      if (run.primary.capacity === null || run.primary.users.size >= run.primary.capacity) {
        throw new Error('Lobby capacity changed during lookup. No helper connection was opened.');
      }
      run.probe.stage = 'connect';
      status('joining', `Opening one ${run.probe.mode} diagnostic connection.`, run);
      await joinHelper(run, 1);
      ensureRun(run);
      run.probe.stage = 'complete';
      finishRun(run, 'done', 'The diagnostic was admitted to your current lobby and disconnected. No votes were sent; vote eligibility was not tested.');
    } catch (error) {
      if (run.finished) return;
      if (error instanceof AdmissionError) {
        run.admissionCode = error.code;
        run.probe.code = error.code;
        if (error.code === 100 && run.primary.lobbyType === 0) {
          run.primary.helperRejectionCode = error.code;
        }
      }
      finishRun(run, 'error', error instanceof Error ? error.message : 'The admission diagnostic failed.');
    }
  }

  function startProbe(request) {
    if (currentRun) { status('error', 'A vote run or diagnostic is already active.'); return; }
    const mode = request.mode === undefined ? 'invite' : request.mode;
    if (mode !== 'invite' && mode !== 'matchmaking') {
      status('error', 'Choose invite or matchmaking for the admission diagnostic.');
      return;
    }
    if (!primary || !primary.socket.connected || primary.lobbyId === null) {
      status('error', 'Join a lobby first. The diagnostic requires your current game connection.');
      return;
    }
    const run = {
      primary, lobbyId: primary.lobbyId, me: primary.me, owner: primary.owner,
      lobbyType: primary.lobbyType, helpers: [], timers: new Set(), waiters: new Set(),
      finished: false, admissionCode: null, lastVote: null, lookupController: null,
      probe: { mode, stage: 'validation', code: null, sameRoom: null, lobbyType: null }
    };
    currentRun = run;
    try {
      ensureRun(run);
      if (!primary.login) throw new Error('Native helper login settings are unavailable. No diagnostic connection was opened.');
      if (primary.capacity === null) throw new Error('Lobby capacity is unavailable. No diagnostic connection was opened.');
      if (primary.users.size >= primary.capacity) throw new Error('The lobby is full. No diagnostic connection was opened.');
      if (mode === 'invite' && primary.lobbyType === 0 && primary.helperRejectionCode === 100) {
        run.admissionCode = run.probe.code = 100;
        throw new Error('This public lobby already rejected extra sessions (code 100). An invitation diagnostic will not repeat that denial.');
      }
      if (mode === 'matchmaking') {
        if (primary.lobbyType !== 0) throw new Error('A matchmaking diagnostic requires a public lobby.');
        const language = primary.login.lang;
        if (!((Number.isSafeInteger(language) && language >= 0 && language <= 27)
          || (typeof language === 'string' && /^(?:[0-9]|1[0-9]|2[0-7])$/.test(language)))) {
          throw new Error('The native matchmaking language is unavailable.');
        }
        if (primary.matchmakingProbed) throw new Error('This native lobby session already used its single matchmaking diagnostic.');
        primary.matchmakingProbed = true;
      }
      run.probe.stage = 'lookup';
      void executeProbe(run);
    } catch (error) {
      finishRun(run, 'error', error instanceof Error ? error.message : 'The diagnostic could not start.');
    }
  }

  function start(request) {
    if (currentRun) { status('error', 'A vote run is already active.'); return; }
    if (!isId(request.targetId)) {
      status('error', 'Select a player for the automatic vote kick.');
      return;
    }
    if (!primary || !primary.socket.connected || primary.lobbyId === null) {
      status('error', 'Join a lobby first. Reload the game if its connection was not captured.');
      snapshot();
      return;
    }
    if (primary.lobbyType !== 1) {
      status('error', primary.lobbyType === 0
        ? 'Vote kick is unavailable in public lobbies.'
        : 'Wait for a confirmed private lobby before using vote kick.');
      snapshot();
      return;
    }
    const run = {
      primary, targetId: request.targetId,
      lobbyId: primary.lobbyId, me: primary.me, owner: primary.owner,
      helpers: [], timers: new Set(), waiters: new Set(), finished: false,
      admissionCode: null,
      lastVote: primary.voteCounts.get(request.targetId) || null
    };
    currentRun = run;
    try { ensureRun(run); } catch (error) { finishRun(run, 'error', error.message); return; }
    void executeRun(run);
  }

  function requestReceived(event) {
    if (unloaded) return;
    try {
      if (typeof event.detail !== 'string' || event.detail.length > 4096) throw new Error('invalid');
      const request = JSON.parse(event.detail);
      if (!isObject(request)) throw new Error('invalid');
      switch (request.action) {
        case 'snapshot': snapshot(); break;
        case 'start': start(request); break;
        case 'probe': startProbe(request); break;
        case 'stop':
          if (currentRun) finishRun(currentRun, 'stopped', currentRun.probe
            ? 'Stopped. The diagnostic lookup was cancelled and its helper disconnected; no votes were sent.'
            : 'Stopped. All helper sessions have left.');
          else status('stopped', 'No vote run is active.');
          break;
        default: throw new Error('invalid');
      }
    } catch (_) {
      status('error', 'Invalid vote kick request.');
    }
  }

  document.addEventListener(REQUEST_EVENT, requestReceived);
  window.addEventListener('pagehide', () => {
    if (unloaded) return;
    unloaded = true;
    if (currentRun) finishRun(currentRun, 'stopped', 'Page closed. Helper sessions disconnected.');
    document.removeEventListener(REQUEST_EVENT, requestReceived);
    suspendedRecords = Array.from(observedRecords);
    suspendedPrimary = primary;
    for (const record of suspendedRecords) detachRecord(record);
    primary = null;
  });
  window.addEventListener('pageshow', () => {
    if (!unloaded) return;
    unloaded = false;
    document.addEventListener(REQUEST_EVENT, requestReceived);
    for (const previous of suspendedRecords) {
      try {
        const resumed = observeSocket(previous.socket, previous.factory, previous.factoryThis,
          [previous.endpoint.uri, previous.endpoint.options]);
        if (!resumed || previous !== suspendedPrimary) continue;
        primary = resumed;
        resumed.login = previous.login;
        // Native events may have been missed while observers were detached.
        // Require a fresh room snapshot before authorizing votes after restore.
        clearLobby(resumed);
      } catch (_) {}
    }
    suspendedRecords = [];
    suspendedPrimary = null;
    if (!primary) hiddenHelperIds.clear();
    snapshot();
  });
  installFactoryHook();
})();
