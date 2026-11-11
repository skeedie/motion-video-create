/* Lyric Studio — «Проверить ролик»: поиск типичных проблем без нейросетей.
   Геометрия меряется в отдельном скрытом окне движка (основное превью не трогается),
   остальное — по данным проекта. Check.run(onProgress) → [{kind, scene, t, text, fix?, safe?}] */
(function () {
  const tr = s => (window.T ? window.T(s) : s);
  const KINDS = {
    overlap: ['⧉', 'Текст поверх карточки'], edge: ['⇲', 'За краем кадра'], safe: ['▤', 'Зона интерфейса площадки'],
    repeat: ['↻', 'Повтор шаблона'], short: ['⏱', 'Слишком быстро'], order: ['⇄', 'Порядок слов'], field: ['✎', 'Пустое поле'],
    unsure: ['?', 'Неуверенные слова'], file: ['⚠', 'Нет файла'], empty: ['∅', 'Пустая сцена'], sticker: ['★', 'Стикер за кадром']
  };
  const OV = 12, EDGE = 8, MIN_LINE = 0.5, TOP_SHARE = 0.4;
  let stop = false, busy = false, list = [], fixing = false, batching = false;
  const mmss = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
  const q = s => { s = String(s || '').trim(); return s.length > 34 ? s.slice(0, 33) + '…' : s; };
  const W = () => proj.words;
  const sceneT = i => { const sc = proj.scenes[i], w = sc && W()[sc.a]; return w ? w.t : 0; };
  // правка проекта с отменой: состояние до правки — в историю, после — touch() через scheduleRebuild
  function commit(fn) { if (!batching) try { clearTimeout(histTimer); histCommit(); } catch (e) {} fn(); renderAll(); scheduleRebuild(50); }

  // ---------- проверки по данным проекта ----------
  function staticChecks(only) {
    const out = [], P = proj, scs = P.scenes, st = P.style, inSel = i => !only || only.includes(i);
    const add = (kind, scene, text, fix, safe) => { if (scene == null || inSel(scene)) out.push({ kind, scene, t: scene == null ? 0 : sceneT(scene), text, fix, safe: !!safe }); };
    if (!only) {
      if (!P.audioPath || !audio.src) add('file', null, tr('Трек не загружен — без него не будет звука и экспорта'));
      const bm = st.bgMedia; if (bm && !(bm.type === 'video' ? bm.path : (bm.asset && P.assets[bm.asset]) || bm.path)) add('file', null, tr('Фон-картинка или видео: файл не найден'));
      if (st.wmImg && !asset(st.wmImg)) add('file', null, tr('Логотип: картинка не найдена'));
      (P.fonts || []).forEach(f => { if (!P.assets[f.asset]) add('file', null, tr('Шрифт не найден:') + ' ' + f.family); });
      (P.stickers || []).forEach(x => { if (x.type === 'image' && !asset(x.value)) add('file', null, tr('Стикер-картинка не найдена')); });
    }
    // повтор шаблона у соседних сцен (повторы припева — не в счёт)
    const reps = scs.map((sc, i) => { try { return repeatsOf(i).length; } catch (e) { return 0; } });
    scs.forEach((sc, i) => {
      const nx = scs[i + 1]; if (!nx || sc.tpl !== nx.tpl) return;
      if (sceneSig(sc) && sceneSig(sc) === sceneSig(nx)) return;
      const k = reps[i + 1] && !reps[i] ? i : i + 1; // меняем ту, что не припев
      const tp = TPL[sc.tpl];
      add('repeat', k, tr('Тот же шаблон, что у соседней сцены:') + ' ' + (tp ? tr(tp.name) : sc.tpl), () => swapTpl(k), false);
    });
    if (!only && scs.length >= 5) {
      const seen = new Set(), cnt = {}; let n = 0;
      scs.forEach(sc => { const sg = sceneSig(sc); if (sg && seen.has(sg)) return; seen.add(sg); n++; cnt[sc.tpl] = (cnt[sc.tpl] || 0) + 1; });
      Object.entries(cnt).forEach(([id, c]) => { if (c / n > TOP_SHARE) add('repeat', null, tr('Один шаблон в большинстве сцен:') + ` ${TPL[id] ? tr(TPL[id].name) : id} — ${c}/${n}`); });
    }
    scs.forEach((sc, i) => {
      const ws = W().slice(sc.a, sc.b);
      if (sc.b <= sc.a || !ws.some(w => String(w.w || '').trim())) { add('empty', i, tr('В сцене нет слов')); return; }
      const un = ws.filter(w => w.unsure); if (un.length) add('unsure', i, tr('Нейросеть не уверена в словах:') + ' «' + q(un.map(w => w.w).join(', ')) + '»');
      // пустые поля шаблона, у которых есть значение по умолчанию (значит, шаблону оно нужно)
      [[sc.tpl, sc.f, 'f'], [sc.tpl2, sc.f2, 'f2']].forEach(([id, f, key]) => {
        const t = TPL[id]; if (!t || !f) return;
        t.fields.forEach(fd => {
          if (fd.type && fd.type !== 'text' && fd.type !== 'emoji') return; if (!String(fd.def ?? '').trim() || /пусто|необяз/i.test(fd.label)) return;
          if (f[fd.k] !== undefined && !String(f[fd.k]).trim()) add('field', i, tr('Пустое поле шаблона:') + ' ' + tr(fd.label), () => commit(() => { delete sc[key][fd.k]; }), false);
        });
        t.fields.forEach(fd => { if (fd.type === 'image' && typeof f[fd.k] === 'string' && f[fd.k].startsWith('asset:') && !asset(f[fd.k])) add('file', i, tr('Картинка в поле не найдена:') + ' ' + tr(fd.label)); });
      });
    });
    // строки: время на экране и порядок слов
    const lines = []; W().forEach((w, i) => { const L = lines[lines.length - 1]; if (L && L.line === w.line) L.b = i + 1; else lines.push({ line: w.line, a: i, b: i + 1 }); });
    const sceneOf = wi => scs.findIndex(sc => wi >= sc.a && wi < sc.b);
    lines.forEach((L, j) => {
      const si = sceneOf(L.a); if (si < 0) return; const ws = W(), nx = lines[j + 1];
      for (let i = L.a + 1; i < L.b; i++) if (ws[i].t < ws[i - 1].t - 1e-3) {
        const a = i - 1, b = i;
        add('order', si, tr('Слова идут не по порядку:') + ` «${q(ws[a].w)}» → «${q(ws[b].w)}»`, () => commit(() => { ws[b].t = +(ws[a].t + .02).toFixed(3); if (!(ws[b].e > ws[b].t)) ws[b].e = +(ws[b].t + .15).toFixed(3); }), true); break;
      }
      if (!nx || ws[L.a].adlib) return;
      const dur = ws[nx.a].t - ws[L.a].t; if (dur >= MIN_LINE) return;
      // растянуть: строка появляется раньше, если перед ней есть пауза
      const prevE = L.a > 0 ? Math.max(ws[L.a - 1].e || ws[L.a - 1].t, ws[L.a - 1].t + .05) : (+st.start || 0), want = ws[nx.a].t - MIN_LINE - .02;
      const can = want >= prevE + .02 && want < ws[L.a].t;
      add('short', si, tr('Строка на экране меньше 0,5 с:') + ` «${q(ws.slice(L.a, L.b).map(w => w.w).join(' '))}» — ` + tr(`${dur.toFixed(2)} с`),
        can ? () => commit(() => { ws[L.a].t = +want.toFixed(3); }) : null, false);
    });
    return out;
  }
  function swapTpl(i) {
    const sc = proj.scenes[i]; if (!sc) return; const nb = [proj.scenes[i - 1], proj.scenes[i + 1]].filter(Boolean).map(s => s.tpl);
    let lines = 1; try { const ws = W().slice(sc.a, sc.b); lines = new Set(ws.map(w => w.line)).size; } catch (e) {}
    const kin = /^kin-/.test(sc.tpl), pool = kin ? KIN_AUTO : (AUTO_TPL[Math.min(3, Math.max(1, lines))] || AUTO_TPL[2]);
    const cnt = {}; proj.scenes.forEach(s => cnt[s.tpl] = (cnt[s.tpl] || 0) + 1);
    const cand = pool.filter(id => TPL[id] && id !== sc.tpl && !nb.includes(id)).sort((a, b) => (cnt[a] || 0) - (cnt[b] || 0) || pool.indexOf(a) - pool.indexOf(b));
    const id = cand[0]; if (!id) return;
    const reps = proj.linkRepeats === false ? [] : (() => { try { return repeatsOf(i); } catch (e) { return []; } })();
    commit(() => { [i].concat(reps).forEach(k => { const s = proj.scenes[k]; s.tpl = id; s.f = {}; s.scale = ''; }); });
  }

  // ---------- геометрия в скрытом окне движка ----------
  function safeZone() {
    if (proj.style.format !== '9:16') return null;
    const v = $('#safeSel') && $('#safeSel').value; if (SAFE[v]) return Object.assign({ explicit: true }, SAFE[v]);
    // зона не выбрана — общие для всех площадок поля (самые узкие из Reels/TikTok/Shorts)
    const z = Object.values(SAFE); return { top: Math.min(...z.map(x => x.top)), bottom: Math.min(...z.map(x => x.bottom)), right: Math.min(...z.map(x => x.right)), rTop: Math.max(...z.map(x => x.rTop)), rBot: Math.min(...z.map(x => x.rBot)), name: '', explicit: false };
  }
  function makeFrame() {
    const [FW, FH] = FMT[proj.style.format] || FMT['9:16'], fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
    fr.style.cssText = `position:fixed;left:-10000px;top:0;width:${FW}px;height:${FH}px;border:0;visibility:visible;pointer-events:none`;
    fr.width = FW; fr.height = FH; document.body.append(fr); return fr;
  }
  const loadFrame = (fr, html) => new Promise(res => {
    fr.onload = () => { const w = fr.contentWindow; let n = 0; const iv = setInterval(() => { if (w.READY === true || w.__err || ++n > 400) { clearInterval(iv); res(w); } }, 25); };
    fr.srcdoc = html;
  });
  function vis(el) { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = e.ownerDocument.defaultView.getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; if (o < .05) return 0; } return o; }
  const R = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top });
  const union = (a, b) => !a ? b : !b ? a : R({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
  const inter = (a, b) => [Math.min(a.right, b.right) - Math.max(a.left, b.left), Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)];
  // прямоугольник видимого текста: только по видимым буквам, а не по всему блоку (блок подписи бывает шире кадра)
  function textRect(el) {
    const d = el.ownerDocument, tw = d.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, box = null, fs = 0;
    while ((n = tw.nextNode())) {
      if (!n.nodeValue.trim()) continue; const p = n.parentElement; if (!p || vis(p) < .5) continue;
      const rg = d.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) box = union(box, R(r));
      fs = Math.max(fs, parseFloat(d.defaultView.getComputedStyle(p).fontSize) || 0);
    }
    if (box) box.fs = fs; return box;
  }
  function measure(w, k) {
    const d = w.document, vw = w.innerWidth, vh = w.innerHeight;
    const cards = [...d.querySelectorAll('.wslot')].filter(s => +s.dataset.k === k).map(s => { const sc = s.querySelector('.wscale'), box = sc && sc.firstElementChild; if (!box || vis(box) < .5) return null; const r = R(sc.getBoundingClientRect()); if (r.width < 5 || r.height < 5) return null;
      const cs = w.getComputedStyle(sc), o = cs.transformOrigin.split(' ').map(parseFloat), K = r.width / Math.max(1, sc.offsetWidth); return { r, second: s.dataset.second === '1', O: { x: r.left + (o[0] || 0) * K, y: r.top + (o[1] || 0) * K } }; }).filter(Boolean);
    const texts = [...d.querySelectorAll('.cap, .kin > *')].filter(e => !e.closest('.wscale') && vis(e) > .5).map(e => { const r = textRect(e); return r && r.width > 4 && r.height > 4 ? r : null; }).filter(Boolean);
    const ph = d.querySelector('.phone .screen'), pr = ph && vis(ph) > .5 ? R(ph.getBoundingClientRect()) : null;
    return { vw, vh, cards, texts, frame: pr || R({ left: 0, top: 0, right: vw, bottom: vh }), phone: !!pr };
  }
  const over = (r, B) => Math.max(B.left - r.left, r.right - B.right, B.top - r.top, r.bottom - B.bottom);
  // куда сдвинуть и во сколько уменьшить карточку, чтобы она влезла в B и не задевала текст T
  function placeCard(c, B, T, m = 10) {
    const r = c.r; let f = Math.min(1, (B.width - 2 * m) / r.width, (B.height - 2 * m) / r.height), side = null;
    if (T) { const up = T.top - 12 - (B.top + m), dn = (B.bottom - m) - (T.bottom + 12), fu = Math.min(f, up / r.height), fd = Math.min(f, dn / r.height);
      side = fu >= fd ? 'up' : 'down'; f = Math.max(fu, fd); }
    if (!(f >= .5)) return null;
    const sc = { left: c.O.x + (r.left - c.O.x) * f, right: c.O.x + (r.right - c.O.x) * f, top: c.O.y + (r.top - c.O.y) * f, bottom: c.O.y + (r.bottom - c.O.y) * f };
    let dx = 0, dy = 0;
    if (sc.left + dx < B.left + m) dx = B.left + m - sc.left; if (sc.right + dx > B.right - m) dx = B.right - m - sc.right;
    if (side === 'up' && sc.bottom > T.top - 12) dy = T.top - 12 - sc.bottom; if (side === 'down' && sc.top < T.bottom + 12) dy = T.bottom + 12 - sc.top;
    if (sc.top + dy < B.top + m) dy = B.top + m - sc.top; if (sc.bottom + dy > B.bottom - m) dy = B.bottom - m - sc.bottom;
    return { f, dx: Math.round(dx), dy: Math.round(dy) };
  }
  function cardFix(i, c, B, T) {
    const p = placeCard(c, B, T); if (!p || (p.f > .995 && !p.dx && !p.dy)) return null;
    return () => commit(() => { const sc = proj.scenes[i]; if (!sc) return;
      if (c.second) { sc.dx2 = Math.round((sc.dx2 || 0) + p.dx); sc.dy2 = Math.round((sc.dy2 || 0) + p.dy); if (p.f < .995) sc.k2scale = +((sc.k2scale || .8) * p.f).toFixed(3); }
      else { sc.dx = Math.round((sc.dx || 0) + p.dx); sc.dy = Math.round((sc.dy || 0) + p.dy); if (p.f < .995) sc.scale = +((+sc.scale || defScale(sc)) * p.f).toFixed(3); } });
  }
  function geomFindings(i, g, tOut, z) {
    const out = [], tSrc = o2s(tOut, CUTS_OF.cuts), add = (kind, text, fix, safe) => out.push({ kind, scene: i, t: tSrc, text, fix, safe: !!safe });
    const B = g.frame, where = g.phone ? 'за экран телефона' : 'за край кадра';
    // карточка за краем
    g.cards.forEach(c => { const o = over(c.r, B); if (o > EDGE) add('edge', tr(`Карточка выходит ${where} на ${Math.round(o)} px`), cardFix(i, c, B, null), true); });
    // текст за краем (крупные слова с наклоном могут чуть выходить)
    g.texts.forEach(r => { const tol = EDGE + (r.fs >= 70 ? r.fs * .22 : 0), o = over(r, g.phone ? B : R({ left: 0, top: 0, right: g.vw, bottom: g.vh })); if (o > tol) add('edge', tr(`Текст выходит ${where} на ${Math.round(o)} px`), null); });
    // текст поверх карточки
    g.cards.forEach(c => { let T = null, mx = [0, 0]; g.texts.forEach(r => { const [ix, iy] = inter(r, c.r); if (ix > OV && iy > OV) { T = union(T, r); if (ix * iy > mx[0] * mx[1]) mx = [ix, iy]; } });
      if (T) add('overlap', tr(`Текст поверх карточки (${Math.round(mx[0])}×${Math.round(mx[1])} px)`), cardFix(i, c, B, T), true); });
    // зона интерфейса площадки (только 9:16). Колонка кнопок справа проверяется только для текста:
    // почти все карточки шире 86% кадра и задевают её всегда — это не ошибка ролика.
    if (z && !out.some(f => f.kind === 'edge')) {
      const top = z.top * g.vh, bot = g.vh * (1 - z.bottom), rl = g.vw * (1 - z.right), rt = z.rTop * g.vh, rb = z.rBot * g.vh;
      const tb = r => Math.max(0, top - r.top, r.bottom - bot), rcol = r => { const [ix, iy] = inter(r, { left: rl, right: g.vw, top: rt, bottom: rb }); return ix > 16 && iy > 16 ? ix : 0; };
      const zoneB = R({ left: 0, top, right: g.vw, bottom: bot });
      g.cards.forEach(c => { const s = tb(c.r); if (s > 16) add('safe', tr(`Карточка заходит под кнопки и подписи площадки (${Math.round(s)} px)`), cardFix(i, c, zoneB, null), true); });
      // зона не выбрана явно — строку текста считаем закрытой, только если под интерфейсом больше трети её высоты
      const lim = r => z.explicit ? 24 : Math.max(24, r.height * .35);
      const ts = g.texts.filter(r => Math.max(tb(r), rcol(r)) > lim(r)); if (ts.length) add('safe', tr('Текст заходит под кнопки и подписи площадки'), null);
    }
    return out;
  }
  const CUTS_OF = { cuts: [] };
  async function geomChecks(onProgress, only) {
    const out = [], spec = buildSpec(false, { lite: true }); CUTS_OF.cuts = spec._cuts || [];
    const idx = (only || proj.scenes.map((s, i) => i)).filter(i => spec.scenes[i] && spec.words[spec.scenes[i].words[0]] && spec.scenes[i].words[1] > spec.scenes[i].words[0]);
    const stks = only ? [] : (spec.stickers || []);
    const total = idx.length + (stks.length ? 1 : 0); if (!total) return out;
    const fr = makeFrame();
    try {
      onProgress && onProgress(0, total);
      const w = await loadFrame(fr, engineHTML(spec, null));
      if (w.__err || w.READY !== true) throw new Error(tr('Движок не запустился:') + ' ' + (w.__err || ''));
      try { await Promise.race([w.document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
      const z = safeZone(), sw = spec.words; let n = 0;
      for (const i of idx) {
        if (stop) break;
        const s = spec.scenes[i], a = s.words[0], b = s.words[1], nx = spec.scenes[i + 1] && sw[spec.scenes[i + 1].words[0]], nt = nx ? nx.t : 1e9;
        const t = Math.max(sw[a].t + .1, Math.min(sw[b - 1].t + .2, nt - .5));
        try { await w.seekAsync(t); } catch (e) { try { w.seek(t); } catch (e2) {} }
        out.push(...geomFindings(i, measure(w, i), t, z));
        onProgress && onProgress(++n, total);
        if (n % 3 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // стикеры и надписи поверх ролика
      if (stks.length && !stop) {
        for (const x of stks) {
          const t = (x.t0 + x.t1) / 2; try { await w.seekAsync(t); } catch (e) { try { w.seek(t); } catch (e2) {} }
          const el = w.document.querySelector(`.stk[data-st="${CSS.escape(String(x.id))}"]`); if (!el || vis(el) < .3) continue;
          const r = R(el.getBoundingClientRect()), vw = w.innerWidth, vh = w.innerHeight, o = over(r, R({ left: 0, top: 0, right: vw, bottom: vh }));
          if (o > Math.max(EDGE, Math.min(r.width, r.height) * .15)) {
            const st = (proj.stickers || []).find(s => s.id === x.id); if (!st) continue;
            const hx = r.width / 2 / vw, hy = r.height / 2 / vh, nxv = Math.min(1 - hx - .01, Math.max(hx + .01, st.x ?? .5)), nyv = Math.min(1 - hy - .01, Math.max(hy + .01, st.y ?? .5));
            const sceneI = (() => { const k = sceneAt(o2s(t, CUTS_OF.cuts)); return k < 0 ? null : k; })();
            out.push({ kind: 'sticker', scene: sceneI, t: o2s(t, CUTS_OF.cuts), text: x.type === 'image' ? tr(`Стикер выходит за край кадра на ${Math.round(o)} px`) : tr(`Надпись выходит за край кадра на ${Math.round(o)} px:`) + ' «' + q(x.value) + '»', safe: true, sticker: x.id,
              fix: hx < .49 && hy < .49 ? () => commit(() => { st.x = +nxv.toFixed(3); st.y = +nyv.toFixed(3); }) : null });
          }
        }
        onProgress && onProgress(++n, total);
      }
    } finally { fr.remove(); }
    return out;
  }
  async function run(onProgress, opts = {}) {
    if (busy) throw new Error(tr('Проверка уже идёт')); busy = true; stop = false;
    const t0 = performance.now();
    try {
      const only = opts.scenes || null, res = staticChecks(only);
      if (proj.words.length && proj.scenes.length && opts.geometry !== false) res.push(...await geomChecks(onProgress, only));
      // одна и та же беда без исправления в трёх и больше сценах — это устройство пресета: одна строка вместо многих
      const grp = {}; res.forEach(f => { if (f.kind === 'safe' && !f.fix && f.scene != null) (grp[f.text] = grp[f.text] || []).push(f); });
      Object.values(grp).forEach(g => { if (g.length < 3) return; g.slice(1).forEach(f => res.splice(res.indexOf(f), 1));
        g[0].text += ' — ' + tr(`в сценах: ${g.map(f => f.scene + 1).join(', ')}`); g[0].scenes = g.map(f => f.scene); });
      const ord = Object.keys(KINDS);
      res.sort((a, b) => (a.scene ?? -1) - (b.scene ?? -1) || ord.indexOf(a.kind) - ord.indexOf(b.kind));
      res.aborted = stop; res.ms = Math.round(performance.now() - t0);
      return res;
    } finally { busy = false; }
  }

  // ---------- окно ----------
  const css = document.createElement('style');
  css.textContent = `#ckModal .ckItem{display:flex;gap:10px;align-items:flex-start;padding:8px 6px;border-top:1px solid var(--line)}
#ckModal .ckIco{width:26px;height:26px;flex:none;border-radius:8px;background:var(--p2,rgba(255,255,255,.06));display:flex;align-items:center;justify-content:center;font-size:14px}
#ckModal .ckTxt{flex:1;min-width:0;font-size:12.5px;line-height:1.4}#ckModal .ckTxt b{font-weight:700}
#ckModal .ckItem.done{opacity:.45}#ckModal #ckList{max-height:56vh;overflow:auto;margin-top:8px}
#ckBack{position:fixed;right:18px;bottom:18px;z-index:45}`;
  document.head.append(css);
  const modal = document.createElement('div'); modal.id = 'ckModal'; modal.className = 'modal'; modal.hidden = true;
  modal.innerHTML = `<div class="mbox" style="width:min(640px,92vw)">
    <div class="mhead"><b>Проверка ролика</b><div class="grow"></div><button class="ghost" id="ckClose">✕</button></div>
    <p class="muted small" style="margin:0 0 8px">Ищет текст поверх карточек, выход за кадр, повторы шаблонов, слишком быстрые строки и пустые поля. Ролик не меняется, пока вы не нажмёте «исправить».</p>
    <div class="row tight"><button id="ckRun" class="primary">Проверить снова</button><button id="ckFixAll">Исправить всё безопасное</button><div class="grow"></div><button id="ckStop" class="ghost small" hidden>остановить</button></div>
    <div class="bar"><i id="ckBar"></i></div>
    <div class="status" id="ckStatus" data-notr></div>
    <div id="ckList" data-notr></div>
  </div>`;
  document.body.append(modal);
  const back = document.createElement('button'); back.id = 'ckBack'; back.className = 'primary small'; back.hidden = true; back.textContent = 'К списку проверки'; document.body.append(back);
  const setBar = (n, m) => { $('#ckBar').style.width = (m ? Math.round(100 * n / m) : 0) + '%'; };
  function render() {
    const box = $('#ckList'), live = list.filter(f => !f.done); box.innerHTML = '';
    $('#ckFixAll').disabled = !list.some(f => !f.done && f.fix && f.safe);
    if (!live.length && !busy) { const d = document.createElement('div'); d.className = 'status ok'; d.textContent = tr('Проблем не найдено'); box.append(d); }
    list.forEach(f => {
      const d = document.createElement('div'); d.className = 'ckItem' + (f.done ? ' done' : ''); const [ico, nm] = KINDS[f.kind] || ['•', ''];
      const head = f.scene != null ? tr(`Сцена ${f.scene + 1} · ${mmss(f.t)}`) : tr('Весь ролик');
      d.innerHTML = `<div class="ckIco" title="${esc(tr(nm))}">${ico}</div><div class="ckTxt"><b>${esc(head)}</b> — <span></span></div>`;
      d.querySelector('span').textContent = f.done ? f.text + ' ✓' : f.text;
      if (!f.done) {
        if (f.scene != null) { const b = document.createElement('button'); b.className = 'small ghost'; b.textContent = tr('показать'); b.onclick = () => show(f); d.append(b); }
        if (f.fix) { const b = document.createElement('button'); b.className = 'small'; b.textContent = tr('исправить'); b.onclick = () => fixOne(f, b); d.append(b); }
      }
      box.append(d);
    });
  }
  function status(t, cls) { const s = $('#ckStatus'); s.className = 'status' + (cls ? ' ' + cls : ''); s.textContent = t; }
  async function runUI() {
    if (busy) return; if (!proj.words.length) { list = []; render(); status(tr('Сначала добавьте текст и синхронизируйте слова')); return; }
    $('#ckStop').hidden = false; $('#ckRun').disabled = true; $('#ckFixAll').disabled = true; list = []; $('#ckList').innerHTML = '';
    try {
      const r = await run((n, m) => { setBar(n, m); status(n < m ? tr(`Сцена ${Math.min(n + 1, m)} из ${m}…`) : tr('Готово')); });
      list = r; status(r.aborted ? tr('Проверка остановлена — показано найденное до остановки') : (r.length ? tr(`Найдено: ${r.length} · ${(r.ms / 1000).toFixed(1)} с`) : ''), r.length ? '' : 'ok');
    } catch (e) { status(tr('Не удалось проверить:') + ' ' + (e.message || e), 'err'); }
    finally { $('#ckStop').hidden = true; $('#ckRun').disabled = false; setBar(0, 0); render(); }
  }
  function show(f) {
    modal.hidden = true; back.hidden = false;
    if (f.scene != null && proj.scenes[f.scene]) { selectScene(f.scene); }
    seekTo(f.t);
  }
  // после исправления находка перепроверяется: заново по той же сцене (или по всему ролику)
  const STATIC = ['repeat', 'field', 'order', 'short', 'unsure', 'empty', 'file'];
  async function recheck(f) {
    const only = f.scene != null && f.kind !== 'sticker' && f.kind !== 'file' ? [f.scene] : null, geo = !STATIC.includes(f.kind);
    const r = await run(null, { scenes: only, geometry: geo });
    const inScope = x => (only ? x.scene === f.scene : x.kind === f.kind) && (geo || STATIC.includes(x.kind));
    const same = x => x.kind === f.kind && x.scene === f.scene && (f.sticker == null || x.sticker === f.sticker);
    f.done = !r.some(same);
    // находки в той же области обновляются: ушедшие пропадают, новые (если правка что-то задела) добавляются
    // не исправилось — вместо старой находки встаёт свежая (с новым замером и новым исправлением)
    list = list.filter(x => (x === f && f.done) || (x !== f && (x.done || !inScope(x)))).concat(r.filter(inScope));
    const ord = Object.keys(KINDS); list.sort((a, b) => (a.scene ?? -1) - (b.scene ?? -1) || ord.indexOf(a.kind) - ord.indexOf(b.kind));
    return f.done;
  }
  async function fixOne(f, btn) {
    if (fixing || busy || !f.fix) return; fixing = true; if (btn) btn.disabled = true;
    try { await f.fix(); const ok = await recheck(f); status(ok ? tr('Исправлено (Ctrl+Z — отменить)') : tr('Исправлено частично — посмотрите сцену'), ok ? 'ok' : ''); }
    catch (e) { status(tr('Не удалось исправить:') + ' ' + (e.message || e), 'err'); }
    finally { fixing = false; render(); }
  }
  async function fixAll() {
    if (fixing || busy) return; const todo = list.filter(f => !f.done && f.fix && f.safe); if (!todo.length) return; fixing = true;
    // одна сцена — одно исправление геометрии за раз, иначе сдвиги складываются
    const seen = new Set(); let n = 0;
    try { clearTimeout(histTimer); histCommit(); } catch (e) {}
    batching = true;
    try {
      for (const f of todo) { const key = f.kind === 'sticker' ? 's' + f.sticker : f.kind === 'order' ? 'o' + f.text : 'g' + f.scene; if (seen.has(key)) continue; seen.add(key); await f.fix(); n++; }
      batching = false; status(tr('Проверяю ещё раз…')); fixing = false; await runUI(); status(tr(`Исправлено: ${n}. Ctrl+Z — отменить`) + (list.length ? ' · ' + tr(`Осталось: ${list.length}`) : ''), 'ok');
    } catch (e) { status(tr('Не удалось исправить:') + ' ' + (e.message || e), 'err'); }
    finally { fixing = false; batching = false; render(); }
  }
  function open() { modal.hidden = false; back.hidden = true; if (!list.length) runUI(); else render(); }
  $('#ckClose').onclick = () => { stop = true; modal.hidden = true; back.hidden = true; };
  $('#ckRun').onclick = runUI; $('#ckFixAll').onclick = fixAll; $('#ckStop').onclick = () => { stop = true; };
  back.onclick = () => { modal.hidden = false; back.hidden = true; render(); };
  const bc = $('#bCheck'); if (bc) bc.onclick = () => { list = []; open(); };
  const hm = document.querySelector('#helpMenu button[data-act="check"]'); if (hm) hm.onclick = e => { e.stopPropagation(); $('#helpMenu').hidden = true; list = []; open(); };
  window.Check = { run, abort: () => { stop = true; }, open, get busy() { return busy; }, get list() { return list; }, staticChecks, fixOne, fixAll };
})();
