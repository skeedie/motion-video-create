// Звуки интерфейса сцен: каждый виджет звучит «как интерфейс» — вибрация на звонке, клавиши и «отправлено» в переписке,
// «дзынь» на уведомлении, гудки диктофона, клик плеера, тики на счётчиках. Моменты берутся из готовой спецификации
// (после buildSpec) тем же способом, что и в движке (engine.html: mkAt, t0/t1 сцен), а не угадываются.
// SFX.uiEvents(spec, k, vol) -> [{t, type, v, ui:true, k, ...}] — события сцены k; SFX.uiHas(widget) — есть ли у виджета звуки.
(function () {
  const S = window.SFX; if (!S) return;
  const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), P = (t, t0, d) => cl((t - t0) / Math.max(d, 1e-3));
  const eo = x => 1 - Math.pow(1 - x, 3), eio = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const KEY_GAP = 1 / 12;   // клавиши — не чаще 12 в секунду
  const VIB_STEP = .7;      // вибрация звонка — каждые 0.7 с
  // базовые громкости событий (дальше умножаются на громкость «звуков интерфейса»)
  const V = { key: .5, send: .8, receive: .8, notify: .9, vibrate: .9, rec: .9, play: .9, tick: 1, shutter: .9, error: .8, success: .8, thump: .45, pop: .4 };

  // времена сцен так же, как в движке: слова без эдлибов, t0 = первое слово − lead, t1 = начало следующей
  function sceneTimes(spec) {
    const W = spec.words || [], ADL = spec.adlibs !== 'inline';
    const T = (spec.scenes || []).map(s => { const wi = []; if (s.words) for (let i = s.words[0]; i < s.words[1]; i++) if (W[i] && !(ADL && W[i].adlib)) wi.push(i);
      const ws = wi.map(i => W[i]); return { ws, t0: s.t0 != null ? s.t0 : ws.length ? Math.max(0, ws[0].t - (s.lead ?? spec.lead ?? .2)) : 0, t1: s.t1 }; });
    T.forEach((s, k) => { if (s.t1 == null) s.t1 = T[k + 1] ? T[k + 1].t0 : spec.outro ? spec.outro.t0 : spec.end ?? spec.duration; });
    return T;
  }
  function mkAt(spec, s) { const W = spec.words || []; return x => {
    if (x == null) return s.ws.length ? s.ws[0].t : s.t0 + .2;
    if (typeof x === 'number') return x < 0 ? s.t0 + (-x) : (W[x] ? W[x].t : s.t0);
    if (typeof x === 'object') return x.t;
    const m = String(x).match(/^(.*?)(?:#(\d+))?([+-]\d*\.?\d+)?$/), key = norm(m[1]), nth = +(m[2] || 1), off = parseFloat(m[3] || 0);
    if (key === 'end') return s.t1 + off; if (key === 'start') return s.t0 + off;
    const w = s.ws.filter(w => norm(w.w).startsWith(key))[nth - 1] || W.find(w => w.t >= s.t0 - .5 && norm(w.w).startsWith(key));
    return (w ? w.t : s.t0 + .3) + off; }; }
  // слова части текста «$line[a:b]» (индексы — по словам сцены, как в движке)
  function partWords(s, text) { const m = String(text || '').match(/^\$line(?:\[(-?\d*):(-?\d*)\])?/); if (!m) return null;
    const n = s.ws.length, a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : n; return s.ws.slice(a < 0 ? n + a : a, b < 0 ? n + b : b); }
  // моменты, когда плавная прокрутка числа проходит k/n пути (тик на каждом «щелчке» счётчика)
  function rollTimes(t, d, n, ease = eo) { const out = []; for (let k = 1; k <= n; k++) { const q = k / n; let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (ease(mid) < q) lo = mid; else hi = mid; } out.push(t + hi * d); } return out; }

  // ---- карта «виджет → события». A: at(x), t0, t1, ws, push(t, type, v, extra), keys(times), words(list)
  const H = {
    // переписки: клавиши на набираемом сообщении, «отправлено»/«пришло» в момент появления пузыря (IN(b, t − 0.1))
    chat(p, A) { const ms = p.msgs || [];
      ms.forEach((m, i) => { const t = A.at(m.at ?? (i ? -.3 * i : null)) - .1; A.push(t, m.me ? 'send' : 'receive'); });
      const typed = ms.filter(m => m.me && partWords(A.s, m.text));
      if (p.keyboard && typed.length) { const ks = []; A.ws.forEach(wd => { const cs = [...wd.w]; cs.forEach((c, j) => ks.push(wd.t + j * Math.min(.08, (wd.e - wd.t) / cs.length))); }); A.keys(ks); }
      else typed.forEach(m => A.words(partWords(A.s, m.text))); },
    tg(p, A) { const ms = p.msgs || [];
      ms.forEach((m, i) => { const t = A.at(m.at ?? (i ? -.3 * i : null)) - .08; A.push(t, m.me ? 'send' : 'receive'); if (m.me) { const pw = partWords(A.s, m.text); if (pw) A.words(pw); } }); },
    tgfeed(p, A) { const t = A.at(p.at), d = p.dur || 1.3; rollTimes(t, d, 9, eio).forEach(x => A.push(x, 'tick', .6));
      A.push(A.at(p.accent_at ?? p.at) + (p.accent_at ? 0 : d + .05), 'receive');
      if (p.react) A.push(A.at(p.react_at ?? p.accent_at ?? p.at) + (p.react_at ? 0 : .2), 'pop'); },
    server(p, A) { const t = A.at(p.at); A.push(t - .1, 'send'); const pw = partWords(A.s, p.text); if (pw) A.words(pw); if (p.react) A.push(A.at(p.react_at ?? 'end-0.9'), 'pop'); },
    vcomments(p, A) { const t = A.at(p.at); A.push(t - .1, 'send'); const pw = partWords(A.s, p.text); if (pw) A.words(pw); A.push(A.at(p.like_at ?? 'end-0.8'), 'pop'); },
    post(p, A) { A.push(A.at(p.at) - .05, 'send'); A.push(A.at(p.like_at ?? 'end-0.9'), 'pop'); },
    story(p, A) { if (p.like_at != null) A.push(A.at(p.like_at), 'pop'); },
    typing(p, A) { const pw = !p.text || String(p.text).startsWith('$line') ? partWords(A.s, p.text || '$line') : null;
      if (pw) A.words(pw); else A.spread(A.at(p.at), A.at(p.end_at ?? 'end-.5'), String(p.text).length); },
    compose(p, A) { A.spread(A.at(p.at), A.at(p.end_at ?? 'end-.4'), String(p.text || '').length); },
    // уведомления: «дзынь» на каждое (IN(n, at − 0.08)), высота чередуется
    notifs(p, A) { (p.items || []).forEach((it, i) => A.push(A.at(it.at ?? (i ? -.25 * i : null)) - .08, 'notify', 1, { f: i % 2 ? 1568 : 1318.5 })); },
    // звонки: вибрация от начала сцены каждые 0.7 с до ответа, щелчок на ответе
    call(p, A) { const te = p.end ? A.at(p.end.at) : null; A.vibrate(te); if (te != null) A.push(te, p.end.action === 'decline' ? 'error' : 'play'); },
    callfull(p, A) { const te = p.accept_at != null ? A.at(p.accept_at) : null; A.vibrate(te); if (te != null) A.push(te, 'play'); },
    // диктофон: два гудка перед стартом записи; плеер: клик play при появлении
    recorder(p, A) { const t = A.at(p.at); A.push(Math.max(A.t0, t - .25), 'rec'); },
    player(p, A) { A.push(Math.max(A.t0 + .05, A.at(p.at) - .2), 'play'); },
    camera(p, A) { (p.shots || [p.at]).forEach(x => A.push(A.at(x), 'shutter')); },
    // счётчики и числа: тик на каждом «щелчке» прокрутки
    counter(p, A) { const t = A.at(p.at), d = p.dur || 1.2; rollTimes(t, d, 10).forEach(x => A.push(x, 'tick'));
      if (p.notif && p.notif.at != null) A.push(A.at(p.notif.at), 'notify'); },
    alert(p, A) { const t = A.at(p.at), d = p.dur || 1.2; rollTimes(t, d, 6).slice(0, -1).forEach(x => A.push(x, 'tick', .7)); A.push(t + d, 'error'); if (p.tap_at != null) A.push(A.at(p.tap_at), 'play'); },
    battery(p, A) { const t = A.at(p.at), d = p.dur || 1.4; rollTimes(t, d, 6).slice(0, -1).forEach(x => A.push(x, 'tick', .7)); if ((p.to ?? 3) <= 20) A.push(t + d, 'error'); },
    poll(p, A) { const seen = new Set(); (p.opts || []).forEach(o => { const t = A.at(o.at); if (!seen.has(t)) { seen.add(t); rollTimes(t, .9, 6).forEach(x => A.push(x, 'tick', .8)); } if (o.pick_at != null) A.push(A.at(o.pick_at), 'play'); }); },
    slider(p, A) { const t = A.at(p.at), te = p.end_at != null ? A.at(p.end_at) : t + 1.2, n = Math.max(2, Math.round(Math.abs((p.to ?? 1) - (p.from ?? .3)) * 10)); rollTimes(t, te - t, n, eio).forEach(x => A.push(x, 'tick', .8)); },
    rating(p, A) { const t = A.at(p.at), d = p.dur || 1.2, n = Math.max(3, Math.min(10, Math.round(Math.abs((p.value ?? 4.8) - (p.from ?? 0)) * 2))); rollTimes(t, d, n).forEach(x => A.push(x, 'tick', .8)); },
    selfhit(p, A) { const t = A.at(p.at), d = p.dur || 1.2; rollTimes(t, d, 10).forEach(x => A.push(x, 'tick', .8)); if (p.roll_at != null) A.push(A.at(p.roll_at), 'tick'); if (p.damage_at != null) A.push(A.at(p.damage_at), 'error'); },
    spend(p, A) { (p.items || []).forEach((it, i) => { const t = A.at(it.at ?? (i ? -.3 * i : null)); A.push(t, 'send', .6); rollTimes(t, .9, 5).forEach(x => A.push(x, 'tick', .6)); }); },
    // пульс: писк монитора на каждом ударе (фаза — интеграл пульса, как в движке)
    pulse(p, A) { const vals = p.values || [{ at: null, v: 72 }], ts = vals.map(v => A.at(v.at));
      const val = tt => { let cur = vals[0].v, prev = vals[0].v, t0 = -9; vals.forEach((v, i) => { if (tt >= ts[i]) { prev = cur; cur = v.v; t0 = ts[i]; } }); return prev + (cur - prev) * eio(P(tt, t0, 1.1)); };
      const PT0 = A.t0 - 3, DT = 1 / 120; let ph = 0, prev = 0; for (let tt = PT0 + DT; tt <= A.t1; tt += DT) { ph += val(tt) / 60 * DT; if (tt >= A.t0 + .2 && Math.floor(ph - .52) > Math.floor(prev - .52)) A.push(tt, 'tick', .7); prev = ph; } },
    // переключатели и галочки: щелчок
    toggles(p, A) { (p.rows || []).forEach(r => { if (r.at != null) A.push(A.at(r.at), 'tick'); }); },
    controls(p, A) { (p.events || []).forEach(e => A.push(A.at(e.at), 'tick')); },
    segmented(p, A) { let cur = p.sel || 0; (p.events || []).forEach(e => { if (e.sel !== cur) A.push(A.at(e.at), 'tick'); cur = e.sel; }); if (p.row && p.row.at != null) A.push(A.at(p.row.at), 'tick'); },
    todo(p, A) { (p.items || []).forEach(it => { if (it.at != null) A.push(A.at(it.at), 'tick'); });
      if (p.progress) { const t = A.at(p.progress.at), d = p.progress.dur || 1.6, to = p.progress.to ?? 98; rollTimes(t, d, 8).forEach(x => A.push(x, 'tick', .6)); if (to >= 100) A.push(t + d, 'success'); } },
    doc(p, A) { (p.rows || []).forEach(r => { if (r.at != null && r.hl) A.push(A.at(r.at), 'tick', .7); }); if (p.seal_at != null) A.push(A.at(p.seal_at), 'thump'); },
    record(p, A) { (p.rows || []).forEach(r => { if (r.at == null) return; const t = A.at(r.at), dd = r.dur || .45; A.spread(t, t + dd, String(r.value || '').length);
      A.push(t + dd, r.mark === '✕' || r.mark === '✗' ? 'error' : r.mark === '✓' ? 'success' : 'tick', .6); }); },
    // игры: бомба пищит всё чаще до обезвреживания; счёт — щелчок, проигранный раунд — ошибка
    bomb(p, A) { const t = A.at(p.at), td = A.at(p.defuse_at ?? 'end-1'), from = p.from ?? 7, to = p.to ?? .8, te = A.t1;
      for (let tt = t; tt < Math.min(td, te) - .05;) { A.push(tt, 'tick', .9); const r = Math.max(to, from - (from - to) * P(tt, t, te - t)); tt += 1 / (1.2 + (from - r) * .9); }
      A.push(td, 'key', 1.6); const dd = p.defuse_dur || 1.6; A.push(td + dd, 'success'); },
    score(p, A) { A.push(A.at(p.at), 'tick'); A.push(A.at(p.banner_at ?? 'end-1'), 'error'); },
    achievement(p, A) { A.push(A.at(p.at), 'success'); },
    pcach(p, A) { A.push(A.at(p.at), 'success'); },
    purchase(p, A) { A.push(A.at(p.approve_at ?? 'end-.5'), p.action === 'decline' ? 'error' : 'success'); },
    map(p, A) { if (p.move_at != null) A.push(A.at(p.move_at), 'play'); const t = A.at(p.at); A.push(p.end_at != null ? A.at(p.end_at) : t + 1.2, 'receive', .7); }
    // без звуков интерфейса: типографика, list, bank, weather, leanrain, drive, lyrics, viz, blocks и др. — там нечего «нажимать»
  };

  function uiEvents(spec, k, vol = 1, T) {
    T = T || sceneTimes(spec); const s = T[k], sc = (spec.scenes || [])[k]; if (!s || !sc) return [];
    const ev = [], at = mkAt(spec, s); let n = 0;
    const push = (t, type, v = 1, extra) => { if (t == null || !isFinite(t) || t < s.t0 - .05 || t > s.t1) return; ev.push(Object.assign({ t: +t.toFixed(4), type, v: +(v * (V[type] ?? 1) * vol).toFixed(4), ui: true, k }, extra)); };
    const keys = ts => { let last = -1e9; ts.slice().sort((a, b) => a - b).forEach(t => { if (t - last >= KEY_GAP - 1e-9) { push(t, 'key', 1, { n: n++ }); last = t; } }); };
    const A = { s, at, t0: s.t0, t1: s.t1, ws: s.ws, push, keys,
      // клавиши на словах: 1–3 нажатия на слово по 0.07 с
      words: list => { const ts = []; (list || []).forEach(w => { const c = Math.max(1, Math.min(3, Math.floor([...w.w].length / 2))), st = Math.min(.07, Math.max(.02, ((w.e ?? w.t + .2) - w.t) / c)); for (let j = 0; j < c; j++) ts.push(w.t + j * st); }); keys(ts); },
      // набор текста, растянутый на отрезок [a, b]: по нажатию на символ, не чаще 12/с
      spread: (a, b, len) => { if (!(b > a) || !len) return; const c = Math.min(len, Math.floor((b - a) * 12) + 1), ts = []; for (let j = 0; j < c; j++) ts.push(a + (b - a) * j / c); keys(ts); },
      vibrate: te => { const end = Math.min(te ?? s.t1, s.t1); for (let t = s.t0 + .05; t < end - .1; t += VIB_STEP) push(t, 'vibrate'); } };
    [sc.widget, sc.widget2].forEach(w => { const h = w && H[w.type]; if (h) try { h(w, A); } catch (e) { console.warn('звуки сцены', k, e); } });
    return ev.sort((a, b) => a.t - b.t);
  }
  S.sceneTimes = sceneTimes;
  S.resolveAt = (spec, k) => mkAt(spec, sceneTimes(spec)[k]);
  S.uiHas = w => !!(w && H[w.type]);
  S.uiEvents = uiEvents;
  S.uiTypes = Object.keys(H);
})();
