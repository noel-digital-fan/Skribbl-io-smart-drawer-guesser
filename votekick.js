(() => {
  "use strict";

  const INSTANCE_KEY = "__sgVotekickUi";
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const STATUS_STATES = new Set(["joining", "voting", "waiting", "done", "error", "stopped"]);
  let dispose = null;

  function start() {
    if (dispose) return;

    let root = null;
    let controls = null;
    let mountedBody = null;
    let snapshotReceived = false;
    let unavailable = false;
    let connected = false;
    let lobbyId = "";
    let lobbyType = null;
    let users = [];
    let capacity = null;
    let occupied = 0;
    let availableSlots = null;
    let selectedId = "";
    let running = false;
    let state = "";
    let message = "";
    let handshakeTimer = null;
    let startTimer = null;
    let stopped = false;
    const controlEvents = [];

    const request = payload => document.dispatchEvent(new CustomEvent("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-request", {
      detail: JSON.stringify(payload)
    }));
    const eligibleUsers = () => users.filter(user => !user.isSelf && !user.isOwner && !user.isAdmin);
    const selectedUser = () => eligibleUsers().find(user => String(user.id) === selectedId);
    const inPrivateLobby = () => navigator.onLine && snapshotReceived && connected && Boolean(lobbyId) && lobbyType === 1;

    function listen(element, type, handler) {
      element.addEventListener(type, handler);
      controlEvents.push(() => element.removeEventListener(type, handler));
    }

    function clearHandshake() {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }

    function clearStartTimeout() {
      clearTimeout(startTimer);
      startTimer = null;
    }

    function feedback() {
      if (running) return message || "Casting your vote...";
      if (!navigator.onLine) return "Browser is offline. Reconnect to use Votekick.";
      if (!snapshotReceived) return unavailable
        ? "Votekick controls are unavailable. Refresh this game page after reloading the extension."
        : "Connecting votekick controls...";
      if (!connected || !lobbyId) return "Join a lobby to use Votekick.";
      if (message) return message;
      if (!eligibleUsers().length) return "No eligible players in this lobby.";
      if (availableSlots === 0) return "Lobby full: only your vote will be cast.";
      if (capacity === null) return "Your vote will be cast; room capacity is unavailable.";
      return "Choose a player. Bots join only as needed for more votes.";
    }

    function roomInformation() {
      if (!snapshotReceived || !connected || !lobbyId) return "";
      if (capacity === null) return `Lobby: ${occupied} players · capacity unavailable`;
      const vacancies = availableSlots === null ? "open slots unavailable"
        : `${availableSlots} open ${availableSlots === 1 ? "slot" : "slots"}`;
      return `Lobby: ${occupied}/${capacity} players · ${vacancies}`;
    }

    function renderRoster() {
      if (!controls) return;
      const list = eligibleUsers();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = list.length ? "Choose a player" : "No eligible players";
      const options = list.map(user => {
        const option = document.createElement("option");
        option.value = String(user.id);
        option.textContent = `${user.name || "Player"} (#${user.id})`;
        return option;
      });
      controls.target.replaceChildren(placeholder, ...options);
      controls.target.value = selectedId;
    }

    function render() {
      if (!controls) return;
      const available = inPrivateLobby();
      root.hidden = !available;
      controls.target.disabled = running || !available || !eligibleUsers().length;
      controls.join.disabled = running || !available || !selectedUser();
      controls.stop.hidden = !running;
      controls.stop.disabled = !running;
      controls.progress.textContent = running ? "Running" : "";
      controls.progress.hidden = !running;
      controls.room.textContent = roomInformation();
      controls.room.hidden = !controls.room.textContent;
      controls.status.textContent = feedback();
      controls.status.classList.toggle("is-error", state === "error" || unavailable);
      controls.status.classList.toggle("is-done", state === "done");
      controls.join.setAttribute("aria-busy", String(running));
    }

    function askForSnapshot() {
      if (!snapshotReceived && handshakeTimer === null) {
        handshakeTimer = setTimeout(() => {
          handshakeTimer = null;
          if (stopped || snapshotReceived) return;
          unavailable = true;
          render();
        }, 3000);
      }
      request({ action: "snapshot" });
    }

    function joinAndVote(event) {
      event.preventDefault();
      if (running) return;
      const target = selectedUser();
      if (!inPrivateLobby() || !target) {
        state = "error";
        message = "Choose a player currently in your lobby.";
        render();
        return;
      }
      running = true;
      state = "voting";
      message = "Casting your vote...";
      render();
      startTimer = setTimeout(() => {
        startTimer = null;
        if (stopped || !running) return;
        request({ action: "stop" });
        running = false;
        state = "error";
        message = "Votekick controls did not respond. Refresh this game page and try again.";
        render();
      }, 5000);
      request({ action: "start", targetId: target.id });
    }

    function build() {
      root = document.createElement("details");
      root.className = "ssdg-v ssdg-v-section";
      root.id = "ssdg-votekick";
      root.hidden = true;
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = "Votekick";
      const progress = document.createElement("span");
      progress.className = "ssdg-v-progress";
      progress.hidden = true;
      summary.append(title, progress);

      const form = document.createElement("form");
      form.className = "ssdg-v-form";
      form.noValidate = true;
      const row = document.createElement("div");
      row.className = "ssdg-v-fields";
      const targetLabel = document.createElement("label");
      targetLabel.htmlFor = "ssdg-votekick-target";
      targetLabel.textContent = "Player";
      const target = document.createElement("select");
      target.id = "ssdg-votekick-target";
      target.name = "votekick-target";
      target.required = true;
      target.setAttribute("aria-describedby", "ssdg-votekick-help ssdg-votekick-room ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status");
      targetLabel.append(target);
      row.append(targetLabel);

      const room = document.createElement("p");
      room.id = "ssdg-votekick-room";
      room.className = "ssdg-v-room";
      room.hidden = true;

      const hint = document.createElement("p");
      hint.id = "ssdg-votekick-help";
      hint.className = "ssdg-v-help";
      hint.textContent = "Your vote counts first. Bots use open slots only as needed, then leave.";
      const status = document.createElement("p");
      status.id = "ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status";
      status.className = "ssdg-v-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      const actions = document.createElement("div");
      actions.className = "ssdg-v-actions";
      const join = document.createElement("button");
      join.id = "ssdg-votekick-join";
      join.type = "submit";
      join.className = "ssdg-v-join";
      join.textContent = "Votekick";
      const stop = document.createElement("button");
      stop.id = "ssdg-votekick-stop";
      stop.type = "button";
      stop.className = "ssdg-v-stop";
      stop.textContent = "Stop";
      stop.hidden = true;
      actions.append(join, stop);
      form.append(row, room, hint, status, actions);
      root.append(summary, form);
      controls = { form, target, join, stop, status, progress, room };

      listen(form, "submit", joinAndVote);
      listen(target, "change", () => {
        if (running) return;
        const candidate = eligibleUsers().find(user => String(user.id) === target.value);
        selectedId = candidate ? String(candidate.id) : "";
        message = "";
        state = "";
        render();
      });
      listen(stop, "click", () => {
        if (!running) return;
        message = "Stopping and leaving extra sessions...";
        render();
        request({ action: "stop" });
      });
      listen(root, "toggle", () => {
        if (root.open) askForSnapshot();
      });
      renderRoster();
      render();
    }

    function mount() {
      if (stopped) return;
      const body = document.querySelector("#skribbl-smart-drawer-guesser-panel .ssdg-body");
      if (!body) return;
      if (!root) build();
      const changedBody = mountedBody !== body;
      const tabs = Array.from(body.children).find(child => child.classList.contains("ssdg-d-tabs"));
      // Auto Draw wraps existing body children in its Guess pane on startup.
      // Move this disclosure back beside the tab panes when that happens.
      if (tabs) {
        if (root.parentElement !== body || tabs.nextElementSibling !== root) tabs.after(root);
      } else if (root.parentElement !== body) {
        body.prepend(root);
      }
      if (changedBody) {
        mountedBody = body;
        askForSnapshot();
      }
    }

    function parseUser(user) {
      if (!user || typeof user !== "object") return null;
      const validId = typeof user.id === "number"
        ? Number.isSafeInteger(user.id) && user.id >= 0
        : typeof user.id === "string" && user.id.length > 0 && user.id.length <= 100;
      if (!validId || typeof user.name !== "string" ||
          typeof user.isSelf !== "boolean" || typeof user.isOwner !== "boolean" || typeof user.isAdmin !== "boolean") return null;
      return {
        id: user.id,
        name: user.name.slice(0, 100),
        isSelf: user.isSelf,
        isOwner: user.isOwner,
        isAdmin: user.isAdmin
      };
    }

    function receiveStatus(event) {
      if (typeof event.detail !== "string" || event.detail.length > 65536) return;
      let payload;
      try { payload = JSON.parse(event.detail); } catch { return; }
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "snapshot") {
        if (typeof payload.connected !== "boolean" || !Array.isArray(payload.users) || payload.users.length > 128) {
          connected = false;
          lobbyId = "";
          lobbyType = null;
          selectedId = "";
          renderRoster();
          render();
          return;
        }
        const nextLobby = typeof payload.lobbyId === "string" || typeof payload.lobbyId === "number"
          ? String(payload.lobbyId).slice(0, 100) : "";
        const nextLobbyType = payload.lobbyType === 0 || payload.lobbyType === 1 ? payload.lobbyType : null;
        const changedLobby = lobbyId !== nextLobby || lobbyType !== nextLobbyType;
        connected = payload.connected;
        lobbyId = nextLobby;
        lobbyType = nextLobbyType;
        const seen = new Set();
        users = payload.users.map(parseUser).filter(user => {
          if (!user || seen.has(String(user.id))) return false;
          seen.add(String(user.id));
          return true;
        });
        capacity = Number.isSafeInteger(payload.capacity) && payload.capacity > 0 ? payload.capacity : null;
        occupied = Number.isSafeInteger(payload.occupied) && payload.occupied >= 0 ? payload.occupied : users.length;
        availableSlots = Number.isSafeInteger(payload.availableSlots) && payload.availableSlots >= 0
          ? payload.availableSlots : capacity === null ? null : Math.max(0, capacity - occupied);
        if (selectedId && (changedLobby || !inPrivateLobby() || !selectedUser())) {
          selectedId = "";
          if (!running) {
            state = "";
            message = changedLobby || !inPrivateLobby()
              ? "" : "Selected player is no longer available. Choose another player.";
          }
        }
        snapshotReceived = true;
        unavailable = false;
        clearHandshake();
        renderRoster();
        render();
        return;
      }

      if (payload.type !== "status" || !STATUS_STATES.has(payload.state) ||
          typeof payload.running !== "boolean" || typeof payload.message !== "string") return;
      clearStartTimeout();
      state = payload.state;
      running = payload.running;
      message = payload.message.slice(0, 1200);
      if (Number.isInteger(payload.votes) && payload.votes >= 0 &&
          Number.isInteger(payload.required) && payload.required > 0) {
        message += ` (${payload.votes}/${payload.required} votes)`;
      }
      render();
    }

    function connectionChanged() {
      if (!navigator.onLine) lobbyType = null;
      render();
      if (navigator.onLine) askForSnapshot();
    }

    const observer = new MutationObserver(mount);
    document.addEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status", receiveStatus);
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();

    dispose = () => {
      stopped = true;
      if (running) request({ action: "stop" });
      observer.disconnect();
      clearHandshake();
      clearStartTimeout();
      document.removeEventListener("ssdg-bpjccmbldjbdpkgaikbejoninpmgaidd-votekick-status", receiveStatus);
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      controlEvents.forEach(remove => remove());
      root?.remove();
      dispose = null;
    };
  }

  // Restore controls when a game page returns from the browser's page cache.
  window.addEventListener("pagehide", () => dispose?.());
  window.addEventListener("pageshow", start);
  start();
})();
