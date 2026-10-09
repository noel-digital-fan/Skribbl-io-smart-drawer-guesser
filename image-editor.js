"use strict";
(() => {
  // The editor owns previews and settings. Auto Draw owns the original bitmap
  // and decides whether the primary action saves pending edits or starts drawing.
  function create(parent, { onDraw, onCancel, onError, onChange }) {
    const adjustments = globalThis.SG_IMAGE_ADJUSTMENTS;
    if (!adjustments) throw new Error("Image adjustments are unavailable. Reload the game page.");
    const element = document.createElement("section");
    element.className = "ssdg-d-image-editor";
    element.hidden = true;
    element.innerHTML = `
      <div class="ssdg-d-editor-heading">Image adjustments</div>
      <canvas class="ssdg-d-image-preview" aria-label="Adjusted image preview"></canvas>
      <label class="ssdg-d-monochrome-label"><input class="ssdg-d-monochrome ssdg-d-edit" type="checkbox"> Black and white</label>
      <label class="ssdg-d-slider-label">Contrast <output class="ssdg-d-contrast-value">0</output>
        <input class="ssdg-d-contrast ssdg-d-edit" type="range" min="-100" max="100" value="0" aria-label="Contrast">
      </label>
      <label class="ssdg-d-slider-label">Saturation <output class="ssdg-d-saturation-value">100%</output>
        <input class="ssdg-d-saturation ssdg-d-edit" type="range" min="0" max="200" value="100" aria-label="Saturation">
      </label>
      <fieldset class="ssdg-d-levels">
        <legend>Levels</legend>
        <div class="ssdg-d-level-tools"><label>Channel <select class="ssdg-d-level-channel ssdg-d-edit">
          <option value="RGB">RGB</option><option value="R">Red</option><option value="G">Green</option><option value="B">Blue</option>
        </select></label><button type="button" class="ssdg-d-level-auto ssdg-d-edit">Auto</button><button type="button" class="ssdg-d-level-reset ssdg-d-edit">Reset channel</button></div>
        <div class="ssdg-d-level-visual ssdg-d-level-input-visual">
          <canvas class="ssdg-d-histogram" width="256" height="90" aria-label="Original image histogram"></canvas>
          <div class="ssdg-d-level-track ssdg-d-level-input-track" role="group" aria-label="Input levels">
            <button type="button" class="ssdg-d-level-handle ssdg-d-level-handle-black ssdg-d-edit" data-level="inputBlack" role="slider" aria-label="Input black level" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="254" aria-valuenow="0" title="Input black level"><span class="ssdg-d-level-handle-marker" aria-hidden="true"></span></button>
            <button type="button" class="ssdg-d-level-handle ssdg-d-level-handle-gamma ssdg-d-edit" data-level="gamma" role="slider" aria-label="Midtone gamma" aria-orientation="horizontal" aria-valuemin="0.1" aria-valuemax="10" aria-valuenow="1" title="Midtone gamma"><span class="ssdg-d-level-handle-marker" aria-hidden="true"></span></button>
            <button type="button" class="ssdg-d-level-handle ssdg-d-level-handle-white ssdg-d-edit" data-level="inputWhite" role="slider" aria-label="Input white level" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="255" aria-valuenow="255" title="Input white level"><span class="ssdg-d-level-handle-marker" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="ssdg-d-level-inputs">
          <label>Black<input class="ssdg-d-level-black ssdg-d-edit" type="number" min="0" max="254" step="1" value="0"></label>
          <label>Gamma<input class="ssdg-d-level-gamma ssdg-d-edit" type="number" min="0.1" max="10" step="0.05" value="1"></label>
          <label>White<input class="ssdg-d-level-white ssdg-d-edit" type="number" min="1" max="255" step="1" value="255"></label>
        </div>
        <div class="ssdg-d-level-visual ssdg-d-level-output-visual">
          <div class="ssdg-d-level-gradient" aria-hidden="true"></div>
          <div class="ssdg-d-level-track ssdg-d-level-output-track" role="group" aria-label="Output levels">
            <button type="button" class="ssdg-d-level-handle ssdg-d-level-handle-black ssdg-d-edit" data-level="outputBlack" role="slider" aria-label="Output black level" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="254" aria-valuenow="0" title="Output black level"><span class="ssdg-d-level-handle-marker" aria-hidden="true"></span></button>
            <button type="button" class="ssdg-d-level-handle ssdg-d-level-handle-white ssdg-d-edit" data-level="outputWhite" role="slider" aria-label="Output white level" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="255" aria-valuenow="255" title="Output white level"><span class="ssdg-d-level-handle-marker" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="ssdg-d-level-outputs">
          <label>Output black<input class="ssdg-d-level-output-black ssdg-d-edit" type="number" min="0" max="254" step="1" value="0"></label>
          <label>Output white<input class="ssdg-d-level-output-white ssdg-d-edit" type="number" min="1" max="255" step="1" value="255"></label>
        </div>
      </fieldset>
      <small class="ssdg-d-level-help">Drag the markers, or enter exact values below each track.</small>
      <small class="ssdg-d-editor-help">Preview uses your adjustments. Drawing uses the game's available colors. The original image is kept for Reset.</small>
      <div class="ssdg-d-editor-actions"><button type="button" class="ssdg-d-image-reset ssdg-d-edit">Reset all</button><button type="button" class="ssdg-d-image-cancel ssdg-d-edit">Cancel</button><button type="button" class="ssdg-d-image-draw ssdg-d-edit">Draw image</button></div>`;
    parent.insertBefore(element, parent.querySelector(".ssdg-d-estimate"));
    const find = (selector) => element.querySelector(selector);
    const preview = find(".ssdg-d-image-preview"), histogramCanvas = find(".ssdg-d-histogram");
    const fields = {
      inputBlack: find(".ssdg-d-level-black"), gamma: find(".ssdg-d-level-gamma"),
      inputWhite: find(".ssdg-d-level-white"), outputBlack: find(".ssdg-d-level-output-black"),
      outputWhite: find(".ssdg-d-level-output-white"),
    };
    const handles = Array.from(element.querySelectorAll(".ssdg-d-level-handle"));
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    let original = null, histogram = null, settings = adjustments.normalize({}), channel = "RGB";
    let frame = 0, disabled = false, primaryDisabled = false, drag = null;

    function notifyChange() {
      onChange?.(adjustments.normalize(settings));
    }

    function levelBounds(key, level = settings.levels[channel]) {
      if (key === "gamma") return [0.1, 10];
      const pair = key.startsWith("input") ? "input" : "output";
      return key.endsWith("Black") ? [0, level[pair + "White"] - 1] : [level[pair + "Black"] + 1, 255];
    }

    function handlePosition(key, level = settings.levels[channel]) {
      // Gamma describes the input point that becomes 50% gray, so its marker
      // stays between the black and white markers as their range changes.
      return key === "gamma" ? level.inputBlack + (level.inputWhite - level.inputBlack) * 0.5 ** level.gamma : level[key];
    }

    function showLevels(syncNumbers = true) {
      const level = settings.levels[channel];
      if (syncNumbers) for (const [key, field] of Object.entries(fields)) field.value = level[key];
      for (const handle of handles) {
        const key = handle.dataset.level, [minimum, maximum] = levelBounds(key, level);
        handle.style.left = handlePosition(key, level) / 255 * 100 + "%";
        handle.setAttribute("aria-valuemin", String(minimum));
        handle.setAttribute("aria-valuemax", String(maximum));
        handle.setAttribute("aria-valuenow", String(level[key]));
        handle.setAttribute("aria-valuetext", key === "gamma" ? level.gamma + " gamma" : String(level[key]));
        handle.title = handle.getAttribute("aria-label") + ": " + level[key];
      }
    }

    function setLevel(key, value) {
      const [minimum, maximum] = levelBounds(key), bounded = clamp(value, minimum, maximum);
      const next = key === "gamma" ? Math.round(bounded * 100) / 100 : Math.round(bounded);
      if (!Number.isFinite(next) || next === settings.levels[channel][key]) return;
      settings = adjustments.normalize({ ...settings, levels: { ...settings.levels, [channel]: { ...settings.levels[channel], [key]: next } } });
      showLevels(); schedulePreview(); notifyChange();
    }

    function stopDragging() {
      if (!drag) return;
      const previous = drag;
      drag = null;
      previous.handle.classList.remove("is-dragging");
      document.removeEventListener("pointermove", moveHandle, true);
      document.removeEventListener("pointerup", endHandle, true);
      document.removeEventListener("pointercancel", cancelHandle, true);
      if (previous.handle.hasPointerCapture?.(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    }

    function moveHandle(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!original || disabled) { stopDragging(); return; }
      event.preventDefault(); event.stopPropagation();
      const rect = drag.track.getBoundingClientRect();
      if (!rect.width) return;
      const position = clamp((event.clientX - rect.left - drag.offset) / rect.width, 0, 1) * 255;
      if (drag.key === "gamma") {
        const level = settings.levels[channel], fraction = (position - level.inputBlack) / (level.inputWhite - level.inputBlack);
        setLevel("gamma", Math.log(clamp(fraction, 0.5 ** 10, 0.5 ** 0.1)) / Math.log(0.5));
      } else setLevel(drag.key, position);
    }

    function endHandle(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      moveHandle(event); stopDragging();
    }

    function cancelHandle(event) {
      if (drag && event.pointerId === drag.pointerId) stopDragging();
    }

    for (const handle of handles) {
      handle.addEventListener("pointerdown", event => {
        if (!original || disabled || drag || event.button !== 0) return;
        const track = handle.parentElement, rect = track.getBoundingClientRect();
        if (!rect.width) return;
        event.preventDefault(); event.stopPropagation();
        handle.focus({ preventScroll: true });
        const key = handle.dataset.level;
        drag = { handle, key, track, pointerId: event.pointerId, offset: event.clientX - rect.left - handlePosition(key) / 255 * rect.width };
        handle.classList.add("is-dragging");
        document.addEventListener("pointermove", moveHandle, { capture: true, passive: false });
        document.addEventListener("pointerup", endHandle, true);
        document.addEventListener("pointercancel", cancelHandle, true);
        // Pointer capture keeps a drag active outside the panel. The document
        // listeners also support browsers that reject capture for this pointer.
        try { handle.setPointerCapture(event.pointerId); } catch { /* Document fallback remains active. */ }
      });
      handle.addEventListener("lostpointercapture", cancelHandle);
      handle.addEventListener("keydown", event => {
        if (!original || disabled) return;
        const key = handle.dataset.level, [minimum, maximum] = levelBounds(key);
        const step = (key === "gamma" ? 0.05 : 1) * (event.shiftKey ? 10 : 1);
        let value = settings.levels[channel][key];
        if (event.key === "Home") value = minimum;
        else if (event.key === "End") value = maximum;
        else if (["ArrowLeft", "ArrowDown"].includes(event.key)) value -= step;
        else if (["ArrowRight", "ArrowUp"].includes(event.key)) value += step;
        else if (event.key === "PageDown") value -= step * 10;
        else if (event.key === "PageUp") value += step * 10;
        else if (event.key === "Escape" && drag) { stopDragging(); event.preventDefault(); return; }
        else return;
        event.preventDefault();
        stopDragging(); setLevel(key, value);
      });
    }

    function drawHistogram() {
      const context = histogramCanvas.getContext("2d");
      context.clearRect(0, 0, 256, 90);
      if (!histogram) return;
      const bins = histogram[channel], maximum = Math.max(1, ...bins);
      context.fillStyle = { RGB: "#536b8e", R: "#bc3f50", G: "#27854d", B: "#2671df" }[channel];
      for (let x = 0; x < 256; x++) {
        const height = Math.round(bins[x] / maximum * 88);
        context.fillRect(x, 90 - height, 1, height);
      }
    }

    function showSettings() {
      find(".ssdg-d-monochrome").checked = settings.monochrome;
      find(".ssdg-d-contrast").value = settings.contrast;
      find(".ssdg-d-saturation").value = settings.saturation;
      find(".ssdg-d-contrast-value").textContent = String(settings.contrast);
      find(".ssdg-d-saturation-value").textContent = settings.saturation + "%";
      find(".ssdg-d-level-channel").value = channel;
      showLevels();
      drawHistogram();
      api.setDisabled(disabled);
    }

    function schedulePreview() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!original) return;
        try {
          const rendered = adjustments.render(original, settings, { maxWidth: 640, maxHeight: 420 });
          preview.width = rendered.width;
          preview.height = rendered.height;
          preview.getContext("2d").drawImage(rendered, 0, 0);
          rendered.width = rendered.height = 1;
        } catch (error) { onError?.(error.message); }
      });
    }

    function changed(event) {
      if (!original || disabled) return;
      const level = {};
      for (const [key, field] of Object.entries(fields)) level[key] = field.value === "" ? undefined : Number(field.value);
      settings = adjustments.normalize({
        ...settings, monochrome: find(".ssdg-d-monochrome").checked,
        contrast: Number(find(".ssdg-d-contrast").value), saturation: Number(find(".ssdg-d-saturation").value),
        levels: { ...settings.levels, [channel]: level },
      });
      // Let a number be typed completely before replacing its text with the
      // normalized value (for example, the leading zero in gamma 0.5).
      if (event?.type === "change") showSettings();
      else {
        find(".ssdg-d-contrast-value").textContent = String(settings.contrast);
        find(".ssdg-d-saturation-value").textContent = settings.saturation + "%";
        showLevels(false);
      }
      api.setDisabled(disabled);
      schedulePreview();
      notifyChange();
    }

    find(".ssdg-d-level-channel").addEventListener("change", () => {
      stopDragging();
      channel = find(".ssdg-d-level-channel").value;
      showSettings();
    });
    for (const input of element.querySelectorAll("input")) {
      input.addEventListener("input", changed);
      input.addEventListener("change", changed);
    }
    find(".ssdg-d-level-auto").onclick = () => {
      stopDragging();
      settings = adjustments.normalize({ ...settings, levels: { ...settings.levels, [channel]: adjustments.autoLevels(histogram, channel) } });
      showSettings(); schedulePreview(); notifyChange();
    };
    find(".ssdg-d-level-reset").onclick = () => {
      stopDragging();
      settings = adjustments.normalize({ ...settings, levels: { ...settings.levels, [channel]: adjustments.normalize({}).levels[channel] } });
      showSettings(); schedulePreview(); notifyChange();
    };
    find(".ssdg-d-image-reset").onclick = () => {
      stopDragging();
      settings = adjustments.normalize({}); channel = "RGB";
      showSettings(); schedulePreview(); notifyChange();
    };
    find(".ssdg-d-image-cancel").onclick = () => onCancel();
    find(".ssdg-d-image-draw").onclick = () => Promise.resolve(onDraw()).catch(error => onError?.(error.message));
    // Editing numbers or selecting a channel must not feed game shortcuts/chat.
    for (const type of ["keydown", "keypress", "keyup"]) element.addEventListener(type, event => event.stopPropagation());

    const api = {
      element,
      open(image, initialSettings = {}) {
        api.close(); original = image; settings = adjustments.normalize(initialSettings); channel = "RGB";
        histogram = adjustments.histogram(image);
        element.hidden = false;
        showSettings(); schedulePreview(); api.setDisabled(disabled);
      },
      close() {
        stopDragging();
        if (frame) cancelAnimationFrame(frame);
        frame = 0; original = null; histogram = null; settings = adjustments.normalize({});
        preview.width = preview.height = 1; element.hidden = true;
        api.setDisabled(disabled);
      },
      setDisabled(value) {
        disabled = value;
        if (disabled || !original) stopDragging();
        for (const control of element.querySelectorAll(".ssdg-d-edit")) control.disabled = value || !original;
        find(".ssdg-d-saturation").disabled = value || !original || settings.monochrome;
        find(".ssdg-d-image-draw").disabled = value || !original || primaryDisabled;
      },
      setPrimaryAction({ label = "Draw image", disabled: actionDisabled = false } = {}) {
        find(".ssdg-d-image-draw").textContent = label;
        primaryDisabled = Boolean(actionDisabled);
        api.setDisabled(disabled);
      },
      getSettings: () => adjustments.normalize(settings),
      prepare() {
        if (!original) throw new Error("Upload an image first.");
        return adjustments.isNeutral(settings) ? original : adjustments.render(original, settings);
      },
    };
    return api;
  }
  globalThis.SG_IMAGE_EDITOR = { create };
})();
