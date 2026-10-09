// Faithful port of the drawing-relevant parts of https://skribbl.io/js/game.js
// (inspected 2026-10-02): pointer handlers with the 90 Hz move gate, command
// creation (Qt), bounds filter (Vt), hard-pixel brush (Xt), tolerance flood fill,
// size/tool/color state, Clear, and the 8-commands-per-50 ms network drain.
(() => {
  const W = 800, H = 600, Je = 4, Qe = 40, je = 0, Ze = 1, Xe = 0;
  const kt = [[255,255,255],[0,0,0],[193,193,193],[80,80,80],[239,19,11],[116,11,7],[255,113,0],[194,56,0],[255,228,0],[232,162,0],[0,204,0],[0,70,25],[0,255,145],[0,120,93],[0,178,255],[0,86,158],[35,31,211],[14,8,101],[163,0,186],[85,0,105],[223,105,167],[135,53,84],[255,172,142],[204,119,77],[160,82,45],[99,48,13]];
  const q = (e, t, n) => (e < t ? t : n < e ? n : e);
  const toolbar = document.querySelector("#game-toolbar");
  const C = document.querySelector("#game-canvas canvas");
  const ct = C.getContext("2d", { willReadFrequently: true });
  let vt = 0, bt = 1, St = 0, Ct = 4, qt = -1, on = null, ln = 0, rn = 90, gt = -1;
  let v = [], dt = 0, sn = 0, pt = [], ht = [], r = [0, 9999, 9999, 0, 0];
  const b = [0, 0], mt = [0, 0], Ht = 50;
  const sim = (window.__sim = { sends: [], dropped: 0, ignored: 0, moves: 0, downs: 0, clears: 0, get commands() { return v; }, get sent() { return dt; } });

  const Bt = (e) => { e = kt[q(e, 0, kt.length)]; return { r: e[0], g: e[1], b: e[2] }; };
  function Jt() { ct.fillStyle = "#FFF"; ct.fillRect(0, 0, W, H); }
  function Gt(e) {
    r[0] += 1; r[1] = Math.min(r[1], e[0]); r[2] = Math.min(r[2], e[1]); r[3] = Math.max(r[3], e[2]); r[4] = Math.max(r[4], e[3]);
    if (r[0] >= Ht) {
      let t = r[1], n = r[2], a = r[3], o = r[4];
      if (a - t <= 0 || o - n <= 0) { t = e[0]; n = e[1]; a = e[2]; o = e[3]; }
      ht.push({ data: ct.getImageData(t, n, a - t, o - n), bounds: r });
      r = [0, 9999, 9999, 0, 0];
    }
  }
  function Zt(e, t, n, a, o) { if (0 <= t && t < e.data.length) { e.data[t] = n; e.data[t + 1] = a; e.data[t + 2] = o; e.data[t + 3] = 255; } }
  function Xt(e, t, n, a, o, r, i, l) {
    const c = Math.floor(o / 2), d = c * c;
    const ox = Math.min(e, n) - c, oy = Math.min(t, a) - c, hx = Math.max(e, n) + c, hy = Math.max(t, a) + c;
    e -= ox; t -= oy; n -= ox; a -= oy;
    const m = ct.getImageData(ox, oy, hx - ox, hy - oy);
    function s(x, y) {
      for (let dx = -c; dx <= c; dx++) for (let dy = -c; dy <= c; dy++) {
        let k;
        if (dx * dx + dy * dy < d && 0 <= (k = 4 * ((y + dy) * m.width + x + dx)) && k < m.data.length) { m.data[k] = r; m.data[k + 1] = i; m.data[k + 2] = l; m.data[k + 3] = 255; }
      }
    }
    if (e == n && t == a) s(e, t);
    else {
      s(e, t); s(n, a);
      const g = Math.abs(n - e), f = Math.abs(a - t), y = e < n ? 1 : -1, vv = t < a ? 1 : -1;
      let bb = g - f;
      while (e != n || t != a) { const S = bb << 1; if (-f < S) { bb -= f; e += y; } if (S < g) { bb += g; t += vv; } s(e, t); }
    }
    ct.putImageData(m, ox, oy);
  }
  function jt(e) {
    const t = [0, 0, W, H];
    if (e[0] === je) {
      const n = q(Math.floor(e[2]), Je, Qe), a = Math.ceil(n / 2);
      const o = q(Math.floor(e[3]), -a, W + a), rr = q(Math.floor(e[4]), -a, H + a), i = q(Math.floor(e[5]), -a, W + a), aa = q(Math.floor(e[6]), -a, H + a);
      const l = Bt(e[1]);
      t[0] = q(o - n, 0, W); t[1] = q(rr - n, 0, H); t[2] = q(i + n, 0, W); t[3] = q(aa + n, 0, H);
      Xt(o, rr, i, aa, n, l.r, l.g, l.b);
    } else if (e[0] === Ze) {
      const l = Bt(e[1]), i = q(Math.floor(e[2]), 0, W), a = q(Math.floor(e[3]), 0, H), s = l.r, c = l.g, d = l.b;
      const u = ct.getImageData(0, 0, W, H), h = [[i, a]];
      const n0 = 4 * (a * u.width + i);
      const p = 0 <= n0 && n0 < u.data.length ? [u.data[n0], u.data[1 + n0], u.data[2 + n0]] : [0, 0, 0];
      if (s != p[0] || c != p[1] || d != p[2]) {
        const S = (e) => {
          const t = u.data[e], n = u.data[e + 1], ee = u.data[e + 2];
          return (t != s || n != c || ee != d) && Math.abs(t - p[0]) < 3 && Math.abs(n - p[1]) < 3 && Math.abs(ee - p[2]) < 3;
        };
        const k = u.height, w = u.width;
        while (h.length) {
          const m = h.pop(); const g = m[0]; let f = m[1]; let y = 4 * (f * w + g);
          while (0 <= f-- && S(y)) y -= 4 * w;
          y += 4 * w; ++f; let vv = false, bb = false;
          while (f++ < k - 1 && S(y)) {
            Zt(u, y, s, c, d);
            if (0 < g) { if (S(y - 4)) { if (!vv) { h.push([g - 1, f]); vv = true; } } else vv = false; }
            if (g < w - 1) { if (S(y + 4)) { if (!bb) { h.push([g + 1, f]); bb = true; } } else bb = false; }
            y += 4 * w;
          }
        }
        ct.putImageData(u, 0, 0);
      }
    }
    return t;
  }
  function Vt(e) {
    let ok;
    if (e[0] != je) ok = e[0] == Ze && 0 <= e[2] && e[2] < W && 0 <= e[3] && e[3] < H;
    else {
      let a = e[3], o = e[4], rr = e[5], i = e[6];
      const t = Math.ceil(e[2] / 2), n = (a + rr) / 2; o = (o + i) / 2; rr = Math.abs(rr - a) / 2; a = Math.abs(i - i) / 2;
      const box = { x1: -(t + rr), y1: -(t + rr), x2: W + t + rr, y2: H + t + a };
      ok = box.x1 < n && n < box.x2 && box.y1 < o && o < box.y2;
    }
    if (ok) { v.push(e); Gt(jt(e)); } else sim.ignored++;
  }
  function Qt(isDown) {
    if (qt == -1) return;
    const t = qt == 0 ? bt : St;
    let n = null;
    if (isDown) {
      const px = ct.getImageData(b[0], b[1], 1, 1).data;
      let e = 0;
      for (; e < kt.length; e++) if (kt[e][0] == px[0] && kt[e][1] == px[1] && kt[e][2] == px[2]) break;
      if (vt == 1) { if (e == t) return; n = [Ze, t, b[0], b[1]]; }
    }
    if (vt == Xe) {
      let e = Ct;
      if (0 <= gt) e = (e - Je) * q(gt, 0, 1) + Je;
      const l = Math.ceil(0.5 * e);
      n = [je, t, e, q(Math.floor(mt[0]), -l, W + l), q(Math.floor(mt[1]), -l, H + l), q(Math.floor(b[0]), -l, W + l), q(Math.floor(b[1]), -l, H + l)];
    }
    if (n != null) Vt(n);
  }
  function en(x, y, n, isDown) {
    const o = C.getBoundingClientRect();
    const e = Math.floor(((x - o.left) / o.width) * W), t = Math.floor(((y - o.top) / o.height) * H);
    if (isDown) { gt = n; mt[0] = b[0] = e; mt[1] = b[1] = t; }
    else { mt[0] = b[0]; mt[1] = b[1]; gt = n; b[0] = e; b[1] = t; }
  }
  const tn = (e) => e == 0 || e == 2 || e == 5;
  C.addEventListener("pointerdown", (e) => {
    if (on == null && tn(e.button)) { on = e.pointerId; qt = e.button; sim.downs++; en(e.clientX, e.clientY, -1, true); Qt(true); }
  });
  C.addEventListener("pointermove", (e) => {
    if (on !== e.pointerId) return;
    const now = performance.now();
    if (now - ln < 1e3 / rn) { sim.dropped++; return; }
    ln = now; sim.moves++;
    en(e.clientX, e.clientY, -1, false); Qt(false);
  });
  const up = (e) => { if (on === e.pointerId) { if (sn != v.length) { sn = v.length; pt.push(sn); } on = null; qt = -1; } };
  C.addEventListener("pointerup", up); C.addEventListener("pointercancel", up);
  C.addEventListener("wheel", (e) => { e.preventDefault(); At(Ct + 2 * Math.sign(-e.deltaY)); });

  // Toolbar: tools, sizes, colors (DOM shaped like the real game).
  const preview = toolbar.querySelector(".size-preview .icon");
  const Mt = (e) => 20 + ((e - Je) / (Qe - Je)) * 80;
  const xt = [];
  function At(e) { Ct = q(e, Je, Qe); preview.style.backgroundSize = Mt(Ct) + "%"; }
  const sizes = toolbar.querySelector(".sizes .container");
  [4, 10, 20, 32, 40].forEach((size, id) => {
    const el = document.createElement("div"); el.className = "size clickable";
    const $t = { id, size, element: el }; el.size = $t; xt.push($t); sizes.append(el);
    el.addEventListener("click", function () { At(xt[this.size.id].size); });
  });
  const tools = toolbar.querySelector(".toolbar-group-tools"), actions = toolbar.querySelector(".toolbar-group-actions");
  const mk = (parent, name, index, onClick) => { const el = document.createElement("div"); el.className = "tool clickable"; el.dataset.tooltip = name; el.toolIndex = index; el.addEventListener("click", onClick); parent.append(el); };
  mk(tools, "Brush", 0, () => { vt = 0; });
  mk(tools, "Fill", 1, () => { vt = 1; });
  mk(actions, "Undo", 0, () => {});
  mk(actions, "Clear", 1, () => { v = []; pt = []; dt = 0; sn = 0; r = [0, 9999, 9999, 0, 0]; ht = []; Jt(); sim.clears++; sim.clearedAt = performance.now(); });
  const colors = toolbar.querySelector(".colors");
  kt.forEach((rgb, i) => {
    const el = document.createElement("div"); el.className = "color"; el.colorIndex = i; el.style.background = `rgb(${rgb})`;
    el.addEventListener("pointerdown", (e) => { if (e.button === 0) bt = i; else St = i; });
    colors.append(el);
  });
  At(4); Jt();
  // Test hook: push a command exactly as Qt would (bypasses input pacing).
  sim.exec = (cmd) => Vt(cmd);

  // Network drain: identical cadence to the game (8 commands per 50 ms tick).
  setInterval(() => {
    const e = v.length - dt;
    if (e > 0) { const t = dt + 8; const n = v.slice(dt, t); dt = Math.min(t, v.length); sim.sends.push({ at: performance.now(), count: n.length, total: dt }); }
  }, 50);
})();
