// Таймлайн: волна трека, биты, сцены (тянуть границы), слова (тянуть по времени), курсор воспроизведения.
// Timeline.init(canvas, H) — H: { proj(), env(), beats(), time(), seek(t), range(), changed(kind), select(i), selected(), snap() }
(function () {
  const ROW = { ruler: 18, wave: 46, scenes: 26, words: 28 }, PAD = 4;
  let cv, ctx, H, view = null, drag = null, hover = null, dpr = 1, need = true, peaks = null, peaksKey = '';
  const yWave = ROW.ruler, yScenes = ROW.ruler + ROW.wave + PAD, yWords = yScenes + ROW.scenes + PAD, HEIGHT = yWords + ROW.words + 6;
  const COLORS = ['#7C4DFF', '#22C55E', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444', '#A3E635', '#F97316'];

  function fit() { const [a, b] = H.range(); view = { t0: a, t1: Math.max(a + 1, b) }; peaks = null; need = true; }
  const W = () => cv.width / dpr;
  const x2t = x => view.t0 + (x / W()) * (view.t1 - view.t0);
  const t2x = t => (t - view.t0) / (view.t1 - view.t0) * W();

  function resize() {
    dpr = window.devicePixelRatio || 1; const r = cv.parentElement.getBoundingClientRect();
    cv.width = Math.max(100, Math.floor(r.width * dpr)); cv.height = Math.floor(HEIGHT * dpr); cv.style.width = r.width + 'px'; cv.style.height = HEIGHT + 'px';
    peaks = null; need = true;
  }
  function buildPeaks() {
    const env = H.env(); const key = view.t0.toFixed(3) + ':' + view.t1.toFixed(3) + ':' + cv.width + ':' + (env ? env.env.length : 0);
    if (peaks && key === peaksKey) return; peaksKey = key;
    const w = Math.floor(W()); peaks = new Float32Array(w);
    if (!env) return; const e = env.env, fps = env.fps;
    for (let x = 0; x < w; x++) { const a = Math.floor(x2t(x) * fps), b = Math.max(a + 1, Math.floor(x2t(x + 1) * fps)); let m = 0; for (let k = Math.max(0, a); k < Math.min(e.length, b); k++) if (e[k] > m) m = e[k]; peaks[x] = m; }
    let mx = 1e-6; for (let x = 0; x < w; x++) if (peaks[x] > mx) mx = peaks[x]; for (let x = 0; x < w; x++) peaks[x] /= mx;
  }
  function sceneT(p, i) { const sc = p.scenes[i]; return [p.words[sc.a] ? p.words[sc.a].t : 0, p.words[sc.b - 1] ? p.words[sc.b - 1].e : 0]; }

  function draw() {
    if (!view) fit();
    const p = H.proj(), w = W(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, HEIGHT);
    ctx.fillStyle = '#121418'; ctx.fillRect(0, 0, w, HEIGHT);
    // линейка
    const span = view.t1 - view.t0, step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find(s => w / (span / s) > 60) || 60;
    ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = '#6B7280'; ctx.strokeStyle = '#2A2F38'; ctx.lineWidth = 1;
    for (let t = Math.ceil(view.t0 / step) * step; t < view.t1; t += step) { const x = Math.round(t2x(t)) + .5; ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, HEIGHT); ctx.stroke(); ctx.fillText(Math.floor(t / 60) + ':' + (t % 60).toFixed(step < 1 ? 1 : 0).padStart(step < 1 ? 4 : 2, '0'), x + 3, 10); }
    // отрезок ролика
    const [ra, rb] = H.range(); ctx.fillStyle = 'rgba(0,0,0,.45)'; if (t2x(ra) > 0) ctx.fillRect(0, 12, t2x(ra), HEIGHT); if (t2x(rb) < w) ctx.fillRect(t2x(rb), 12, w - t2x(rb), HEIGHT);
    // волна
    buildPeaks(); const mid = yWave + ROW.wave / 2;
    ctx.fillStyle = '#3B4252'; for (let x = 0; x < peaks.length; x++) { const v = peaks[x] * (ROW.wave / 2 - 2); ctx.fillRect(x, mid - v, 1, v * 2 || 1); }
    // биты
    const bt = H.beats(); if (bt && bt.beats) { ctx.fillStyle = 'rgba(155,107,255,.55)'; const every = (span / bt.beats.length * w / span) < 5 ? 4 : 1; bt.beats.forEach((b, i) => { if (b < view.t0 || b > view.t1 || i % every) return; const x = Math.round(t2x(b)); ctx.fillRect(x, yWave, 1, ROW.wave); ctx.fillRect(x - 1, yWave + ROW.wave - 4, 3, 4); }); }
    // сцены
    const sel = H.selected();
    p.scenes.forEach((sc, i) => {
      if (!p.words[sc.a]) return; const [a, b] = [p.words[sc.a].t - .05, (p.scenes[i + 1] && p.words[p.scenes[i + 1].a]) ? p.words[p.scenes[i + 1].a].t - .05 : p.words[sc.b - 1].e + .3];
      const x0 = t2x(a), x1 = t2x(b); if (x1 < 0 || x0 > w) return;
      const c = COLORS[i % COLORS.length]; ctx.fillStyle = c + (i === sel ? 'CC' : '55'); rr(x0 + 1, yScenes, Math.max(2, x1 - x0 - 2), ROW.scenes, 6); ctx.fill();
      if (i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; rr(x0 + 1, yScenes, Math.max(2, x1 - x0 - 2), ROW.scenes, 6); ctx.stroke(); }
      ctx.save(); ctx.beginPath(); ctx.rect(x0 + 4, yScenes, Math.max(0, x1 - x0 - 8), ROW.scenes); ctx.clip(); ctx.fillStyle = '#fff'; ctx.font = '600 11px Inter, sans-serif';
      const tp = (window.TEMPLATES || []).find(t => t.id === sc.tpl); ctx.fillText(`${i + 1} · ${tp ? tp.name : sc.tpl}`, x0 + 8, yScenes + 17); ctx.restore();
      if (i > 0) { const bx = Math.round(x0); ctx.fillStyle = hover && hover.kind === 'border' && hover.i === i ? '#fff' : 'rgba(255,255,255,.6)'; ctx.fillRect(bx - 1, yScenes - 2, 3, ROW.scenes + 4); }
    });
    // слова
    ctx.font = '600 11px Inter, sans-serif';
    p.words.forEach((wd, i) => {
      const x0 = t2x(wd.t), x1 = Math.max(x0 + 14, t2x(wd.e)); if (x1 < 0 || x0 > w) return;
      const on = drag && drag.kind === 'word' && drag.set.includes(i), hv = hover && hover.kind === 'word' && hover.i === i;
      ctx.fillStyle = on ? '#9B6BFF' : hv ? '#3D4352' : '#2A2F38'; rr(x0, yWords + 2, x1 - x0 - 1, ROW.words - 4, 5); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(x0, yWords, x1 - x0 - 2, ROW.words); ctx.clip(); ctx.fillStyle = on ? '#fff' : '#D1D5DB'; ctx.fillText(wd.w, x0 + 4, yWords + 18); ctx.restore();
      ctx.fillStyle = '#9B6BFF'; ctx.fillRect(Math.round(x0), yWords + 2, 2, ROW.words - 4);
      if (wd.acc) { ctx.fillStyle = wd.acc.color || '#FDE047'; ctx.beginPath(); ctx.arc(x1 - 6, yWords + 6, 3.5, 0, Math.PI * 2); ctx.fill(); }
      if (wd.adlib) { ctx.fillStyle = 'rgba(255,90,95,.8)'; ctx.fillRect(x0, yWords + ROW.words - 5, Math.max(2, x1 - x0 - 1), 2); }
    });
    // курсор
    const x = Math.round(t2x(H.time())) + .5; ctx.strokeStyle = '#FF5A5F'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    ctx.fillStyle = '#FF5A5F'; ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7); ctx.fill();
    if (drag && drag.kind === 'word' && drag.snapped != null) { const sx = Math.round(t2x(drag.snapped)) + .5; ctx.strokeStyle = '#FDE047'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(sx, yWave); ctx.lineTo(sx, HEIGHT); ctx.stroke(); ctx.setLineDash([]); }
    need = false;
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); r = Math.min(r, w / 2, h / 2); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function hit(mx, my) {
    const p = H.proj();
    if (my >= yScenes - 3 && my <= yScenes + ROW.scenes + 3) {
      for (let i = 1; i < p.scenes.length; i++) { const sc = p.scenes[i]; if (!p.words[sc.a]) continue; if (Math.abs(t2x(p.words[sc.a].t - .05) - mx) < 6) return { kind: 'border', i }; }
      for (let i = 0; i < p.scenes.length; i++) { const sc = p.scenes[i], n = p.scenes[i + 1]; if (!p.words[sc.a]) continue; const a = t2x(p.words[sc.a].t - .05), b = n && p.words[n.a] ? t2x(p.words[n.a].t - .05) : t2x(p.words[sc.b - 1].e + .3); if (mx >= a && mx <= b) return { kind: 'scene', i }; }
    }
    if (my >= yWords && my <= yWords + ROW.words) {
      for (let i = p.words.length - 1; i >= 0; i--) { const wd = p.words[i], a = t2x(wd.t), b = Math.max(a + 14, t2x(wd.e)); if (mx >= a - 2 && mx <= b) return { kind: 'word', i }; }
    }
    return { kind: 'time' };
  }
  function snapT(t, alt) {
    const bt = H.beats(); if (alt || !H.snap() || !bt || !bt.beats || !bt.beats.length) return { t, s: null };
    let best = null, d = 1e9; for (const b of bt.beats) { const dd = Math.abs(b - t); if (dd < d) { d = dd; best = b; } }
    const tol = Math.max(0.05, (view.t1 - view.t0) / W() * 8); return d <= tol ? { t: best, s: best } : { t, s: null };
  }
  function onDown(e) {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = hit(mx, my), p = H.proj();
    cv.setPointerCapture(e.pointerId);
    if (h.kind === 'border') { drag = { kind: 'border', i: h.i }; }
    else if (h.kind === 'word') {
      const sc = p.scenes.findIndex(s => h.i >= s.a && h.i < s.b), set = [h.i];
      if (e.shiftKey) { for (let k = h.i + 1; k < p.words.length && p.words[k].line === p.words[h.i].line; k++) set.push(k); }
      drag = { kind: 'word', set, x0: mx, orig: set.map(k => [p.words[k].t, p.words[k].e]), moved: false };
      if (sc >= 0 && sc !== H.selected()) H.select(sc);
    } else if (h.kind === 'scene') { H.select(h.i); drag = { kind: 'time' }; H.seek(Math.max(H.range()[0], x2t(mx))); }
    else { drag = { kind: 'time' }; H.seek(x2t(mx)); }
    need = true;
  }
  function onMove(e) {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, p = H.proj();
    if (!drag) { const h = hit(mx, my); hover = h; cv.style.cursor = h.kind === 'border' ? 'ew-resize' : h.kind === 'word' ? 'grab' : 'default'; need = true; return; }
    if (drag.kind === 'time') { H.seek(x2t(mx)); return; }
    if (drag.kind === 'border') {
      const i = drag.i, prev = p.scenes[i - 1], cur = p.scenes[i], t = x2t(mx);
      let k = cur.a; // ближайшее начало слова
      let bd = 1e9; for (let j = prev.a + 1; j < cur.b; j++) { const d = Math.abs(p.words[j].t - .05 - t); if (d < bd) { bd = d; k = j; } }
      if (k !== cur.a) { prev.b = k; cur.a = k; H.changed('scenes'); }
      need = true; return;
    }
    if (drag.kind === 'word') {
      const dt = x2t(mx) - x2t(drag.x0); if (Math.abs(mx - drag.x0) > 2) drag.moved = true; if (!drag.moved) return;
      const first = drag.set[0], sn = snapT(drag.orig[0][0] + dt, e.altKey), real = sn.t - drag.orig[0][0]; drag.snapped = sn.s;
      const lo = first > 0 ? p.words[first - 1].t + .03 : 0, last = drag.set[drag.set.length - 1], hi = last < p.words.length - 1 ? p.words[last + 1].t - .03 : 1e9;
      const d2 = Math.max(lo - drag.orig[0][0], Math.min(hi - drag.orig[drag.orig.length - 1][0], real));
      drag.set.forEach((k, j) => { p.words[k].t = +(drag.orig[j][0] + d2).toFixed(3); p.words[k].e = +(drag.orig[j][1] + d2).toFixed(3); });
      if (first > 0 && p.words[first - 1].e > p.words[first].t) p.words[first - 1].e = p.words[first].t;
      H.changed('words', true); need = true; return;
    }
  }
  function onUp() { if (drag && drag.kind === 'word' && drag.moved) H.changed('words'); if (drag && drag.kind === 'border') H.changed('scenes-done'); drag = null; need = true; }
  function onWheel(e) {
    e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, t = x2t(mx), span = view.t1 - view.t0;
    if (e.ctrlKey || e.metaKey) { const k = Math.exp(e.deltaY * 0.0015), ns = Math.min(Math.max(1.5, span * k), 3600); view.t0 = t - (mx / W()) * ns; view.t1 = view.t0 + ns; }
    else { const d = (e.deltaX || e.deltaY) * span / W(); view.t0 += d; view.t1 += d; }
    peaks = null; need = true;
  }
  function follow() { if (!H.playing || !H.playing()) return; const t = H.time(); if (!drag && view && (t > view.t1 || t < view.t0)) { const s = view.t1 - view.t0; view.t0 = t - s * 0.1; view.t1 = view.t0 + s; peaks = null; } }
  function loop() { follow(); if (need || true) draw(); requestAnimationFrame(loop); }
  window.Timeline = {
    init(canvas, hooks) { cv = canvas; ctx = cv.getContext('2d'); H = hooks; resize(); new ResizeObserver(resize).observe(cv.parentElement);
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
      cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(), h = hit(e.clientX - r.left, e.clientY - r.top); if (h.kind === 'word' && H.wordMenu) H.wordMenu(h.i, e.clientX, e.clientY); });
      cv.addEventListener('pointerleave', () => { hover = null; need = true; }); cv.addEventListener('wheel', onWheel, { passive: false }); requestAnimationFrame(loop); },
    fit, redraw() { need = true; }, invalidate() { peaks = null; need = true; }, get dragging() { return !!drag; }
  };
})();
