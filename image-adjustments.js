"use strict";
// Image edits are always rendered from the original bitmap. Pure RGBA transforms
// need no DOM and preserve alpha; preview and final conversion share these settings.
(() => {
  const CHANNELS = ["RGB", "R", "G", "B"], MAX_PIXELS = 20000000, CACHE_LIMIT = 32;
  const cache = new Map();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const number = (value, fallback, low, high) => {
    if (value === null || value === undefined || value === "") return fallback;
    let converted;
    try { converted = Number(value); } catch { return fallback; }
    return Number.isFinite(converted) ? clamp(converted, low, high) : fallback;
  };

  function level(raw = {}) {
    const inputBlack = Math.min(254, Math.round(number(raw?.inputBlack, 0, 0, 255)));
    const outputBlack = Math.min(254, Math.round(number(raw?.outputBlack, 0, 0, 255)));
    return {
      inputBlack,
      inputWhite: Math.max(inputBlack + 1, Math.round(number(raw?.inputWhite, 255, 0, 255))),
      gamma: number(raw?.gamma, 1, 0.1, 10),
      outputBlack,
      outputWhite: Math.max(outputBlack + 1, Math.round(number(raw?.outputWhite, 255, 0, 255))),
    };
  }

  function normalize(raw = {}) {
    const settings = raw && typeof raw === "object" ? raw : {}, levels = {};
    const source = settings.levels && typeof settings.levels === "object" ? settings.levels : {};
    // A flat levels object is accepted for a single selected channel; the normal
    // representation retains independent master, red, green and blue adjustments.
    const flatChannel = CHANNELS.includes(source.channel) ? source.channel : "RGB";
    const flat = ["inputBlack", "inputWhite", "gamma", "outputBlack", "outputWhite"].some((key) => key in source);
    for (const channel of CHANNELS) levels[channel] = level(source[channel] || (flat && channel === flatChannel ? source : {}));
    return {
      monochrome: settings.monochrome === true,
      contrast: number(settings.contrast, 0, -100, 100),
      saturation: number(settings.saturation, 100, 0, 200),
      levels,
    };
  }

  const defaults = () => normalize({});
  function isNeutral(settings) {
    const normalized = normalize(settings);
    if (normalized.monochrome || normalized.contrast !== 0 || normalized.saturation !== 100) return false;
    return CHANNELS.every((channel) => {
      const value = normalized.levels[channel];
      return value.inputBlack === 0 && value.inputWhite === 255 && value.gamma === 1
        && value.outputBlack === 0 && value.outputWhite === 255;
    });
  }

  const applyLevel = (value, settings) => settings.outputBlack
    + (clamp((value - settings.inputBlack) / (settings.inputWhite - settings.inputBlack), 0, 1)
      ** (1 / settings.gamma)) * (settings.outputWhite - settings.outputBlack);

  function lookup(settings) {
    const key = JSON.stringify(settings);
    let result = cache.get(key);
    if (result) return result;
    const contrast = settings.contrast * 2.55;
    const factor = 259 * (contrast + 255) / (255 * (259 - contrast));
    result = ["R", "G", "B"].map((channel) => {
      const table = new Float64Array(256);
      for (let value = 0; value < 256; value++) {
        const master = applyLevel(value, settings.levels.RGB);
        const adjusted = applyLevel(master, settings.levels[channel]);
        table[value] = clamp(factor * (adjusted - 128) + 128, 0, 255);
      }
      return table;
    });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  }

  function transformRGBA(pixels, settings) {
    if (!ArrayBuffer.isView(pixels) || Object.prototype.toString.call(pixels) !== "[object Uint8ClampedArray]" || pixels.length % 4) throw new TypeError("RGBA data must be a Uint8ClampedArray with four bytes per pixel.");
    const normalized = normalize(settings);
    if (isNeutral(normalized)) return pixels;
    const [red, green, blue] = lookup(normalized), saturation = normalized.saturation / 100;
    for (let i = 0; i < pixels.length; i += 4) {
      let r = red[pixels[i]], g = green[pixels[i + 1]], b = blue[pixels[i + 2]];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (normalized.monochrome) r = g = b = luminance;
      else {
        r = clamp(luminance + saturation * (r - luminance), 0, 255);
        g = clamp(luminance + saturation * (g - luminance), 0, 255);
        b = clamp(luminance + saturation * (b - luminance), 0, 255);
      }
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
    }
    return pixels;
  }

  function dimensions(image, options) {
    const width = Math.floor(image?.width || image?.naturalWidth || 0);
    const height = Math.floor(image?.height || image?.naturalHeight || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new TypeError("A decoded image with valid dimensions is required.");
    if (width * height > MAX_PIXELS) throw new RangeError("Images must contain at most 20 million pixels.");
    const maxWidth = number(options?.maxWidth, width, 1, width);
    const maxHeight = number(options?.maxHeight, height, 1, height);
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
  }

  function render(image, settings, options = {}) {
    const [width, height] = dimensions(image, options), canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const normalized = normalize(settings), neutral = isNeutral(normalized);
    const context = canvas.getContext("2d", { willReadFrequently: !neutral });
    if (!context) throw new Error("Image editing canvas is unavailable.");
    context.drawImage(image, 0, 0, width, height);
    if (!neutral) {
      const data = context.getImageData(0, 0, width, height);
      transformRGBA(data.data, normalized);
      context.putImageData(data, 0, 0);
    }
    return canvas;
  }

  function histogram(image, options = {}) {
    const canvas = render(image, defaults(), { ...options, maxWidth: options.maxWidth ?? 512, maxHeight: options.maxHeight ?? 512 });
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const result = { R: new Uint32Array(256), G: new Uint32Array(256), B: new Uint32Array(256), RGB: new Uint32Array(256), count: 0 };
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      result.R[data[i]]++; result.G[data[i + 1]]++; result.B[data[i + 2]]++;
      result.RGB[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
      result.count++;
    }
    return result;
  }

  function autoLevels(hist, channel = "RGB") {
    const bins = hist?.[CHANNELS.includes(channel) ? channel : "RGB"];
    if (!bins || bins.length !== 256) return level();
    let count = 0;
    for (const value of bins) count += Number.isFinite(value) && value > 0 ? value : 0;
    if (!count) return level();
    const tail = count * 0.005;
    let inputBlack = 0, inputWhite = 255, total = 0;
    for (; inputBlack < 255; inputBlack++) { total += bins[inputBlack]; if (total > tail) break; }
    total = 0;
    for (; inputWhite > 0; inputWhite--) { total += bins[inputWhite]; if (total > tail) break; }
    // A flat image has no dynamic range to expand; Auto should retain its tone.
    return inputBlack < inputWhite ? level({ inputBlack, inputWhite }) : level();
  }

  globalThis.SG_IMAGE_ADJUSTMENTS = { normalize, isNeutral, transformRGBA, render, histogram, autoLevels, defaults };
})();
