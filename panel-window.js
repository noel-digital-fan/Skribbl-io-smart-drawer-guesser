(() => {
  "use strict";

  const POSITIONS = ["off", "top-right", "top-left", "bottom-right", "bottom-left"];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pixel = value => typeof value === "string" && /^-?\d+(?:\.\d+)?px$/.test(value) && Number.isFinite(parseFloat(value));

  function normalizeSettings(settings) {
    const size = settings.panelSize;
    settings.panelSize = size && Number.isFinite(size.width) && size.width > 0 &&
      Number.isFinite(size.height) && size.height > 0 ? {width:size.width, height:size.height} : null;
    const position = settings.panelPosition;
    settings.panelPosition = position && pixel(position.left) && pixel(position.top) ?
      {left:position.left, top:position.top} : null;
    settings.collapsed = settings.collapsed === true;
    settings.panelHidden = settings.panelHidden === true;
    settings.panelRestorePosition = POSITIONS.includes(settings.panelRestorePosition) ? settings.panelRestorePosition : "off";
    return settings;
  }

  function create(panel, {settings, save}) {
    normalizeSettings(settings);
    const header = panel.querySelector(".ssdg-header");
    const body = panel.querySelector(".ssdg-body");
    const lifetime = new AbortController();
    let visibleEvents = null, gestureEvents = null, observer = null;
    let gesture = null, frame = 0, suspended = false, destroyed = false, hotspot = null, expandedHeight = 480;
    const defaultWidth = parseFloat(getComputedStyle(panel).width) || 360;

    function viewport() {
      const view = window.visualViewport;
      const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
      const gap = Math.min(4, width / 4, height / 4);
      return {left:(view?.offsetLeft ?? 0) + gap, top:(view?.offsetTop ?? 0) + gap,
        width:Math.max(1, width - gap * 2), height:Math.max(1, height - gap * 2)};
    }

    function constrain() {
      if (destroyed || suspended || panel.hidden || !panel.isConnected) return;
      const view = viewport();
      panel.style.maxWidth = view.width + "px";
      panel.style.maxHeight = view.height + "px";
      panel.style.width = clamp(settings.panelSize?.width ?? defaultWidth, Math.min(280, view.width), view.width) + "px";
      panel.style.height = settings.panelSize ? clamp(settings.panelSize.height, Math.min(180, view.height), view.height) + "px" : "";
      body.style.maxHeight = "";
      body.style.overflowY = "auto";
      const rect = panel.getBoundingClientRect();
      if (!settings.collapsed) expandedHeight = rect.height;
      panel.style.left = clamp(rect.left, view.left, view.left + view.width - rect.width) + "px";
      panel.style.top = clamp(rect.top, view.top, view.top + view.height - rect.height) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    function schedule() {
      if (!frame && !panel.hidden && !suspended) frame = requestAnimationFrame(() => {frame = 0; constrain();});
    }

    function savePosition() {
      settings.panelPosition = {left:panel.style.left, top:panel.style.top};
    }

    function finishGesture(persist = true) {
      if (!gesture) return;
      const {pointerId} = gesture;
      gesture = null;
      gestureEvents?.abort(); gestureEvents = null;
      panel.classList.remove("ssdg-window-interacting");
      if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId);
      if (persist) {savePosition(); save();}
    }

    function resizedRect(rect, edge, dx, dy) {
      const view = viewport();
      const right = rect.left + rect.width, bottom = rect.top + rect.height;
      let left = rect.left, top = rect.top, width = rect.width, height = rect.height;
      if (edge.includes("e")) width = clamp(rect.width + dx, Math.min(280, view.width), view.left + view.width - left);
      if (edge.includes("s")) height = clamp(rect.height + dy, Math.min(180, view.height), view.top + view.height - top);
      if (edge.includes("w")) {left = clamp(rect.left + dx, view.left, right - Math.min(280, view.width)); width = right - left;}
      if (edge.includes("n")) {top = clamp(rect.top + dy, view.top, bottom - Math.min(180, view.height)); height = bottom - top;}
      return {left, top, width, height};
    }

    function applyRect(rect, resize) {
      panel.style.left = rect.left + "px";
      panel.style.top = rect.top + "px";
      if (resize) {
        settings.panelSize = {width:rect.width, height:settings.collapsed ? settings.panelSize?.height ?? expandedHeight : rect.height};
        panel.style.width = rect.width + "px";
        if (!settings.collapsed) panel.style.height = rect.height + "px";
      }
    }

    function startGesture(event) {
      if (event.button !== 0 || !event.isPrimary || panel.hidden || suspended || gesture) return;
      const target = event.target instanceof Element ? event.target : null;
      const edge = target?.closest(".ssdg-resize-handle")?.dataset.edge;
      if (!edge && (!target || !header.contains(target) || target.closest("button, a, input, select, textarea, [contenteditable], [role=button]"))) return;
      if (edge && settings.collapsed && edge !== "e" && edge !== "w") return;
      event.preventDefault(); event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      gesture = {edge, pointerId:event.pointerId, x:event.clientX, y:event.clientY,
        rect:{left:rect.left, top:rect.top, width:rect.width, height:rect.height}};
      panel.classList.add("ssdg-window-interacting");
      panel.setPointerCapture(event.pointerId);
      gestureEvents = new AbortController();
      const options = {signal:gestureEvents.signal};
      panel.addEventListener("pointermove", moveGesture, options);
      panel.addEventListener("pointerup", endGesture, options);
      panel.addEventListener("pointercancel", endGesture, options);
      panel.addEventListener("lostpointercapture", endGesture, options);
    }

    function moveGesture(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      event.preventDefault();
      const {rect, edge, x, y} = gesture, dx = event.clientX - x, dy = event.clientY - y;
      if (edge) applyRect(resizedRect(rect, edge, dx, dy), true);
      else {
        const view = viewport();
        applyRect({...rect, left:clamp(rect.left + dx, view.left, view.left + view.width - rect.width),
          top:clamp(rect.top + dy, view.top, view.top + view.height - rect.height)}, false);
      }
    }

    function endGesture(event) {
      if (gesture && event.pointerId === gesture.pointerId) finishGesture();
    }

    function attachVisibleEvents() {
      if (visibleEvents || panel.hidden || suspended || destroyed) return;
      visibleEvents = new AbortController();
      const options = {signal:visibleEvents.signal};
      panel.addEventListener("pointerdown", startGesture, options);
      window.addEventListener("resize", schedule, options);
      window.visualViewport?.addEventListener("resize", schedule, options);
      window.visualViewport?.addEventListener("scroll", schedule, options);
      window.addEventListener("blur", () => finishGesture(), options);
      observer = new ResizeObserver(schedule);
      observer.observe(panel);
      observer.observe(body);
    }

    function detachVisibleEvents() {
      finishGesture();
      visibleEvents?.abort(); visibleEvents = null;
      observer?.disconnect(); observer = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function updateHotspot() {
      hotspot?.remove(); hotspot = null;
      const position = settings.panelRestorePosition;
      if (!panel.hidden || suspended || destroyed || position === "off") return;
      hotspot = document.createElement("button");
      hotspot.id = "ssdg-panel-restore";
      hotspot.type = "button";
      hotspot.dataset.position = position;
      hotspot.textContent = "+";
      hotspot.title = "Restore Skribbl menu";
      hotspot.setAttribute("aria-label", "Restore Skribbl menu (" + position.replace("-", " ") + " corner)");
      hotspot.onclick = () => setHidden(false);
      document.body.appendChild(hotspot);
    }

    function setHidden(hidden) {
      if (destroyed) return;
      hidden = hidden === true;
      if (hidden) {
        if (panel.contains(document.activeElement)) document.activeElement.blur();
        detachVisibleEvents();
      }
      const changed = settings.panelHidden !== hidden;
      settings.panelHidden = hidden;
      panel.hidden = hidden;
      panel.inert = hidden;
      if (!hidden) {constrain(); attachVisibleEvents();}
      updateHotspot();
      if (changed) save();
    }

    for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
      const handle = document.createElement("div");
      handle.className = "ssdg-resize-handle";
      handle.dataset.edge = edge;
      if (edge === "se") {
        handle.tabIndex = 0;
        handle.setAttribute("role", "button");
        handle.setAttribute("aria-label", "Resize menu: use arrow keys, Shift for larger steps");
        handle.title = "Resize menu";
        handle.addEventListener("keydown", event => {
          if (panel.hidden || suspended || settings.collapsed || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 50 : 10;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          applyRect(resizedRect(panel.getBoundingClientRect(), "se", dx, dy), true);
          savePosition(); save();
        }, {signal:lifetime.signal});
      } else handle.setAttribute("aria-hidden", "true");
      panel.appendChild(handle);
    }

    const restoreSelect = panel.querySelector("#ssdg-restore-position");
    if (restoreSelect) {
      restoreSelect.value = settings.panelRestorePosition;
      restoreSelect.addEventListener("change", () => {
        settings.panelRestorePosition = POSITIONS.includes(restoreSelect.value) ? restoreSelect.value : "off";
        updateHotspot(); save();
      }, {signal:lifetime.signal});
    }
    panel.querySelector("#ssdg-hide-btn")?.addEventListener("click", () => setHidden(true), {signal:lifetime.signal});
    window.addEventListener("pagehide", () => {suspended = true; detachVisibleEvents(); updateHotspot();}, {signal:lifetime.signal});
    window.addEventListener("pageshow", () => {suspended = false; constrain(); attachVisibleEvents(); updateHotspot();}, {signal:lifetime.signal});
    if (settings.panelPosition) {
      panel.style.left = settings.panelPosition.left;
      panel.style.top = settings.panelPosition.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    setHidden(settings.panelHidden);

    return {
      setHidden,
      toggleHidden:() => setHidden(!panel.hidden),
      constrain,
      destroy() {
        if (destroyed) return;
        detachVisibleEvents(); lifetime.abort(); destroyed = true;
        hotspot?.remove(); hotspot = null;
        panel.querySelectorAll(".ssdg-resize-handle").forEach(handle => handle.remove());
      },
    };
  }

  globalThis.SG_PANEL_WINDOW = Object.freeze({create, normalizeSettings});
})();
