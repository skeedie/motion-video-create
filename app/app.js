/* Lyric Studio — интерфейс редактора */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const FMT = { '9:16': [720, 1280], '1:1': [720, 720], '4:5': [720, 900], '16:9': [1280, 720] };
const PRESET_INFO = {
  'melhor': 'дымка, листики, окна плавают', 'melhor-lenta': 'лента сверху вниз', 'purple-haze': 'тёмный дым, звёзды',
  'night-drive': 'неон, ночь', 'rec-tape': 'монтажка REC', 'poster': 'огромные слова', 'cloud9': 'небо и облака',
  'soft-glow': 'мягкий поп', 'lockscreen': 'всё в iPhone', 'y2k-gingham': 'розовая клетка', 'rain-room': 'дождь, грусть'
};
const AUTO_TPL = {
  1: ['achievement', 'poll', 'player', 'recorder', 'rating', 'typing', 'slider', 'segmented', 'bank', 'purchase', 'record', 'pulse', 'todo', 'tg-group', 'leanrain', 'tg-feed'],
  2: ['chat', 'doc', 'counter', 'toggles', 'spend', 'drive', 'alert', 'weather', 'tg-her', 'notifs', 'cs-bomb', 'selfhit', 'map', 'call', 'cs-score'],
  3: ['list', 'notifs', 'chat', 'doc', 'toggles']
};
const TPL = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));
let ENGINE = '', PRESETS = {}, USER_PRESETS = {};
let proj = newProject(), sel = 0, audioUrl = null, audioData = null, specCache = null, playing = false, rebuildTimer = null, frameReady = false;
const audio = new Audio();

function newProject() {
  return { version: 1, audioPath: '', audioName: '', lyrics: '', alFrom: '', alTo: '', words: [], duration: 0, perScene: 2, scenes: [],
    style: { preset: 'melhor-lenta', format: '9:16', start: 0, end: 0, artist: 'melhor', title: '', wm: 'melhor', wmOp: 0.2, part: '', partColor: '#ffffff', beat: null, smokeOn: false, smokeA: '#78aa78', smokeB: '#9678c8', lead: null, fade: 0.4 } };
}
const toast = (m, ms = 2200) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); };
const fmtT = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function merge(a, b) { const o = Object.assign({}, a); for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? merge(o[k], b[k]) : b[k]; return o; }

// ---------- контекст сцены для шаблонов ----------
function sceneCtx(sc) {
  const ws = proj.words.slice(sc.a, sc.b), n = ws.length, groups = [];
  ws.forEach((w, i) => { const g = groups[groups.length - 1]; if (g && g.line === w.line) g.b = i + 1; else groups.push({ line: w.line, a: i, b: i + 1 }); });
  const parts = of => {
    if (groups.length >= of) { const per = groups.length / of, out = []; for (let k = 0; k < of; k++) { const g0 = groups[Math.round(k * per)], g1 = groups[Math.round((k + 1) * per) - 1]; out.push([g0.a, g1.b]); } return out; }
    const out = []; for (let k = 0; k < of; k++) out.push([Math.round(k * n / of), Math.round((k + 1) * n / of)]); return out;
  };
  return {
    n, all: '$line',
    part: (k, of) => { const p = parts(of)[k]; return p[1] > p[0] ? `$line[${p[0]}:${p[1]}]` : ''; },
    at: (k, of) => sc.a + Math.min(n - 1, parts(of)[k][0]),
    word: i => sc.a + Math.max(0, Math.min(n - 1, i))
  };
}
function sceneText(sc) { return proj.words.slice(sc.a, sc.b).map(w => w.w).join(' '); }

// ---------- сборка SPEC для движка ----------
function buildSpec(forExport) {
  const st = proj.style, base = PRESETS[st.preset] || USER_PRESETS[st.preset] || {};
  let spec = merge(base, { format: st.format, start: +st.start || 0, end: +st.end || proj.duration, fade: +st.fade || 0.4 });
  if (st.lead != null && st.lead !== '') spec.lead = +st.lead;
  if (st.artist) spec.player = { artist: st.artist, title: st.title || '' }; else delete spec.player;
  if (st.wm) spec.watermark = { text: st.wm, opacity: +st.wmOp || 0.2, size: 11 };
  if (st.part === 'none') delete spec.particles; else if (st.part) spec.particles = { type: st.part, color: st.partColor, colors: [st.partColor + '88'] };
  if (st.beat != null && st.beat !== '') spec.beat = +st.beat;
  if (st.smokeOn) spec.smoke = merge(spec.smoke || { n: 10, opacity: .8 }, { colors: [hexA(st.smokeA, .5), hexA(st.smokeB, .5), hexA(st.smokeA, .4)], dustColor: hexA(st.smokeA, .45) });
  spec.spectrum = spec.spectrum ?? true;
  spec.scenes = proj.scenes.map(sc => {
    const t = TPL[sc.tpl] || TPL.chat, f = Object.assign({}, defFields(t), sc.f), c = sceneCtx(sc);
    let out = {}; try { out = t.make(f, c) || {}; } catch (e) { console.error(e); }
    const s = Object.assign({ words: [sc.a, sc.b] }, out);
    if (sc.scale) s.widget.scale = +sc.scale;
    const punch = [].concat(out.punch || []);
    if (sc.bump != null && sc.bump !== '') punch.push({ word: '·', at: +sc.bump, style: 'bump' });
    if (sc.stamp) punch.push({ word: sc.stamp, at: sc.stampAt !== '' && sc.stampAt != null ? +sc.stampAt : c.word(c.n - 2), style: 'stamp', color: '#16A34A', top: 12, right: 20, size: 26, rot: -9 });
    if (punch.length) s.punch = punch; else delete s.punch;
    if (sc.fx) s.fx = { type: 'emoji', emoji: sc.fx, at: sc.fxAt !== '' && sc.fxAt != null ? +sc.fxAt : c.word(0), dir: 'up', front: false, n: 12 };
    return s;
  });
  spec.words = proj.words.map(w => ({ w: w.w, t: w.t, e: w.e, line: w.line }));
  spec.duration = proj.duration;
  if (specCache && spec.spectrum !== false) spec.spec = specCache.data;
  return spec;
}
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const defFields = t => Object.fromEntries(t.fields.map(x => [x.k, x.def]));

function engineHTML(spec, base) {
  return ENGINE.replace('<head>', `<head>${base ? `<base href="${base}">` : ''}<script>window.onerror=(m)=>{window.__err=String(m)}<\/script><link rel="stylesheet" href="fonts.css">`).replace('/*SPEC*/', 'window.SPEC=' + JSON.stringify(spec) + ';');
}

// ---------- спектр ----------
async function ensureSpectrum() {
  if (!audioData) return;
  const st = proj.style, t0 = +st.start || 0, t1 = +st.end || proj.duration, key = t0 + ':' + t1;
  if (specCache && specCache.key === key) return;
  specCache = { key, data: Spectrum.spectrum(audioData.mono, audioData.sr, t0, t1, 30) };
}

// ---------- превью ----------
function scheduleRebuild(ms = 350) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildPreview, ms); }
async function rebuildPreview() {
  if (!proj.words.length) { $('#preview').srcdoc = '<body style="margin:0;background:#111;color:#666;font:600 18px Inter;display:flex;align-items:center;justify-content:center;height:100vh">Нет текста</body>'; return; }
  await ensureSpectrum();
  const fr = $('#preview'), [W, H] = FMT[proj.style.format]; frameReady = false;
  fr.width = W; fr.height = H; fr.style.width = W + 'px'; fr.style.height = H + 'px'; fitStage();
  fr.onload = () => { const cw = fr.contentWindow; const wait = () => { if (cw.READY) { frameReady = true; seek(curT()); } else if (cw.document.readyState === 'complete' && cw.__err) { toast('Ошибка движка: ' + cw.__err); } else setTimeout(wait, 50); }; wait(); };
  fr.srcdoc = engineHTML(buildSpec(false), null);
}
function fitStage() {
  const [W, H] = FMT[proj.style.format], wrap = $('#stageWrap'), k = Math.min((wrap.clientWidth - 32) / W, (wrap.clientHeight - 32) / H);
  $('#stage').style.width = W * k + 'px'; $('#stage').style.height = H * k + 'px'; $('#preview').style.transform = `scale(${k})`;
}
window.addEventListener('resize', fitStage);
const curT = () => audio.src ? audio.currentTime : (+proj.style.start || 0);
function seek(t) { const cw = $('#preview').contentWindow; if (frameReady && cw && cw.seek) try { cw.seek(t); } catch (e) {} updateTransport(t); }
function updateTransport(t) {
  const s = +proj.style.start || 0, e = +proj.style.end || proj.duration || 1;
  $('#tCur').textContent = fmtT(t); $('#tEnd').textContent = fmtT(e);
  if (!$('#scrub')._drag) $('#scrub').value = Math.round(1000 * (t - s) / Math.max(.01, e - s));
  const k = proj.scenes.findIndex((sc, i) => { const n = proj.scenes[i + 1]; return t < (n ? proj.words[n.a].t - .1 : 1e9); });
  if (playing && k >= 0 && k !== sel) { sel = k; renderStrip(); renderScene(); }
}
function loop() {
  if (playing) { const e = +proj.style.end || proj.duration; if (audio.currentTime >= e) { audio.pause(); playing = false; $('#bPlay').textContent = '▶'; audio.currentTime = +proj.style.start || 0; } seek(audio.currentTime); }
  requestAnimationFrame(loop);
}
$('#bPlay').onclick = () => {
  if (!audio.src) return toast('Сначала выберите трек');
  if (playing) { audio.pause(); playing = false; $('#bPlay').textContent = '▶'; return; }
  const s = +proj.style.start || 0, e = +proj.style.end || proj.duration;
  if (audio.currentTime < s || audio.currentTime >= e - .05) audio.currentTime = s;
  audio.play(); playing = true; $('#bPlay').textContent = '❚❚';
};
$('#scrub').addEventListener('input', () => { const s = +proj.style.start || 0, e = +proj.style.end || proj.duration; const t = s + (e - s) * $('#scrub').value / 1000; if (audio.src) audio.currentTime = t; seek(t); });
$('#scrub').addEventListener('pointerdown', () => $('#scrub')._drag = true); $('#scrub').addEventListener('pointerup', () => $('#scrub')._drag = false);
document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#bPlay').click(); } });

// ---------- трек ----------
async function loadAudio(info) {
  proj.audioPath = info.path; proj.audioName = info.name; $('#audioName').textContent = info.name;
  const buf = info.data || await api.readFile(info.path);
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(new Blob([buf])); audio.src = audioUrl;
  audioData = await Spectrum.decodeMono(buf); proj.duration = proj.duration || audioData.duration; specCache = null;
  if (!proj.style.end) proj.style.end = +audioData.duration.toFixed(2);
}
$('#bAudio').onclick = async () => { const info = await api.pickAudio(); if (!info) return; try { await loadAudio(info); proj.duration = audioData.duration; fillStyle(); toast('Трек загружен'); } catch (e) { toast('Не удалось прочитать файл: ' + e.message, 4000); } };

// ---------- синхронизация ----------
$('#bAlign').onclick = async () => {
  proj.lyrics = $('#lyrics').value; proj.alFrom = $('#alFrom').value; proj.alTo = $('#alTo').value;
  if (!proj.audioPath) return toast('Сначала выберите трек');
  if (!proj.lyrics.trim()) return toast('Вставьте текст песни');
  const st = $('#alignStatus'); st.className = 'status'; st.textContent = 'Готовлюсь…'; $('#bAlign').disabled = true;
  try {
    const r = await api.align({ audioPath: proj.audioPath, lyrics: proj.lyrics, from: proj.alFrom === '' ? null : +proj.alFrom, to: proj.alTo === '' ? null : +proj.alTo },
      p => { st.textContent = p; });
    proj.words = r.words; proj.duration = r.duration || proj.duration;
    autoRange(); autoScenes();
    st.className = 'status ok'; st.textContent = `Готово: ${r.words.length} слов, ${proj.scenes.length} сцен.` + (r.median < 0.15 ? '\nВокал плохо слышно — проверьте тайминги во вкладке «Слова».' : '');
    fillStyle(); renderAll(); scheduleRebuild(50);
  } catch (e) { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); }
  $('#bAlign').disabled = false;
};
function autoRange() { if (!proj.words.length) return; const w0 = proj.words[0], w1 = proj.words[proj.words.length - 1]; proj.style.start = Math.max(0, +(w0.t - 0.3).toFixed(2)); proj.style.end = +Math.min(proj.duration, w1.e + 0.45).toFixed(2); specCache = null; }
function autoScenes() {
  const per = proj.perScene || 2, lines = [];
  proj.words.forEach((w, i) => { const L = lines[lines.length - 1]; if (L && L.line === w.line) L.b = i + 1; else lines.push({ line: w.line, a: i, b: i + 1 }); });
  proj.scenes = []; const used = {};
  for (let i = 0; i < lines.length; i += per) {
    const grp = lines.slice(i, i + per), k = grp.length, pool = AUTO_TPL[Math.min(3, k)];
    let tpl = pool[(used[k] = (used[k] ?? -1) + 1) % pool.length];
    proj.scenes.push({ a: grp[0].a, b: grp[k - 1].b, tpl, f: {}, bump: '', stamp: '', stampAt: '', fx: '', fxAt: '', scale: '' });
  }
  sel = 0;
}
$('#bAutoScenes').onclick = () => { if (!proj.words.length) return toast('Сначала синхронизируйте слова'); if (!confirm('Пересобрать сцены? Текущие настройки сцен пропадут.')) return; autoScenes(); renderAll(); scheduleRebuild(50); };
$$('#perScene button').forEach(b => b.onclick = () => { proj.perScene = +b.dataset.v; $$('#perScene button').forEach(x => x.classList.toggle('on', x === b)); });

// ---------- слова ----------
function renderWords() {
  const box = $('#wordList'); box.innerHTML = ''; let ln = -1;
  proj.words.forEach((w, i) => {
    const d = document.createElement('div'); d.className = 'w' + (w.line !== ln ? ' ln' : ''); ln = w.line;
    d.innerHTML = `<span>${esc(w.w)}</span><button data-d="-0.05">−</button><span class="mono">${w.t.toFixed(2)}</span><button data-d="0.05">+</button>`;
    d.children[0].onclick = () => { const t = Math.max(0, w.t - .15); if (audio.src) audio.currentTime = t; seek(t); };
    d.querySelectorAll('button').forEach(b => b.onclick = () => { w.t = +(w.t + +b.dataset.d).toFixed(2); w.e = Math.max(w.e, w.t + .05); d.querySelector('.mono').textContent = w.t.toFixed(2); scheduleRebuild(); });
    box.append(d);
  });
}

// ---------- сцены ----------
function thumb(id) { return `thumbs/${id}.jpg`; }
function renderStrip() {
  const box = $('#sceneStrip'); box.innerHTML = '';
  proj.scenes.forEach((sc, i) => {
    const d = document.createElement('div'); d.className = 'sc' + (i === sel ? ' on' : '');
    d.innerHTML = `<img src="${thumb(sc.tpl)}" onerror="this.style.visibility='hidden'"><div><div class="n">${i + 1} · ${fmtT(proj.words[sc.a].t)}</div><div class="t">${esc(sceneText(sc))}</div></div>`;
    d.onclick = () => { sel = i; const t = Math.max(+proj.style.start || 0, proj.words[sc.a].t - .1 + .6); if (audio.src) audio.currentTime = t; seek(t); renderStrip(); renderScene(); };
    box.append(d);
  });
  const on = box.children[sel]; if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function wordOptions(sc, val, none = 'нет') {
  return `<option value="">${none}</option>` + proj.words.slice(sc.a, sc.b).map((w, i) => `<option value="${sc.a + i}" ${String(val) === String(sc.a + i) ? 'selected' : ''}>${esc(w.w)}</option>`).join('');
}
function renderScene() {
  const sc = proj.scenes[sel]; $('#sceneEmpty').hidden = !!sc; $('#sceneEditor').hidden = !sc; if (!sc) return;
  const t = TPL[sc.tpl] || TPL.chat;
  $('#seIdx').textContent = `Сцена ${sel + 1} из ${proj.scenes.length} · ${fmtT(proj.words[sc.a].t)}`; $('#seText').textContent = sceneText(sc);
  $('#seTplImg').src = thumb(t.id); $('#seTplName').textContent = t.name;
  const box = $('#seFields'); box.innerHTML = '';
  t.fields.forEach(fd => {
    const v = sc.f[fd.k] ?? fd.def, d = document.createElement('div'); d.className = 'fld';
    let inp;
    if (fd.type === 'bool') { d.innerHTML = `<label class="chk"><input type="checkbox" ${v ? 'checked' : ''}> ${esc(fd.label)}</label>`; inp = d.querySelector('input'); inp.onchange = () => { sc.f[fd.k] = inp.checked; scheduleRebuild(); }; }
    else {
      d.innerHTML = `<label class="lbl">${esc(fd.label)}</label>`;
      if (fd.type === 'select') { inp = document.createElement('select'); inp.innerHTML = fd.opts.map(o => `<option ${o === v ? 'selected' : ''} value="${o}">${({ auto: 'как в шаблоне', none: 'не показывать', note: 'заметка', ticker: 'фиолетовая лента', transcript: 'расшифровка (тёмная)', status: 'статус (зелёный)', warn: 'предупреждение', search: 'поиск сверху', data: 'данные', decline: 'отклонить', approve: 'одобрить' })[o] || o}</option>`).join(''); }
      else { inp = document.createElement('input'); inp.type = fd.type === 'number' ? 'number' : fd.type === 'color' ? 'color' : 'text'; if (fd.type === 'number') inp.step = 'any'; inp.value = v; if (fd.type === 'emoji') inp.className = 'emo'; }
      inp.oninput = () => { sc.f[fd.k] = fd.type === 'number' ? +inp.value : inp.value; scheduleRebuild(); };
      d.append(inp);
    }
    box.append(d);
  });
  $('#seBump').innerHTML = wordOptions(sc, sc.bump); $('#seStamp').value = sc.stamp || ''; $('#seStampAt').innerHTML = wordOptions(sc, sc.stampAt, 'авто');
  $('#seFx').value = sc.fx || ''; $('#seFxAt').innerHTML = wordOptions(sc, sc.fxAt, 'авто');
  $('#seScale').value = sc.scale || defScale(sc); $('#seScaleV').textContent = (+$('#seScale').value).toFixed(2);
}
function defScale(sc) { try { return TPL[sc.tpl].make(defFields(TPL[sc.tpl]), sceneCtx(sc)).widget.scale || 1.3; } catch (e) { return 1.3; } }
$('#seBump').onchange = e => { proj.scenes[sel].bump = e.target.value; scheduleRebuild(); };
$('#seStamp').oninput = e => { proj.scenes[sel].stamp = e.target.value; scheduleRebuild(); };
$('#seStampAt').onchange = e => { proj.scenes[sel].stampAt = e.target.value; scheduleRebuild(); };
$('#seFx').oninput = e => { proj.scenes[sel].fx = e.target.value; scheduleRebuild(); };
$('#seFxAt').onchange = e => { proj.scenes[sel].fxAt = e.target.value; scheduleRebuild(); };
$('#seScale').oninput = e => { proj.scenes[sel].scale = +e.target.value; $('#seScaleV').textContent = (+e.target.value).toFixed(2); scheduleRebuild(200); };
$('#seMergePrev').onclick = () => { if (sel < 1) return; const p = proj.scenes[sel - 1]; p.b = proj.scenes[sel].b; proj.scenes.splice(sel, 1); sel--; renderAll(); scheduleRebuild(); };
$('#seMergeNext').onclick = () => { if (sel >= proj.scenes.length - 1) return; const c = proj.scenes[sel]; c.b = proj.scenes[sel + 1].b; proj.scenes.splice(sel + 1, 1); renderAll(); scheduleRebuild(); };
$('#seSplit').onclick = () => {
  const sc = proj.scenes[sel]; if (sc.b - sc.a < 2) return toast('Слишком короткая сцена');
  const ws = proj.words; let m = sc.a + Math.floor((sc.b - sc.a) / 2);
  for (let d = 0; d < sc.b - sc.a; d++) { for (const k of [m + d, m - d]) if (k > sc.a && k < sc.b && ws[k].line !== ws[k - 1].line) { m = k; d = 1e9; break; } }
  const nw = Object.assign({}, sc, { a: m, f: {}, tpl: AUTO_TPL[1][(sel + 3) % AUTO_TPL[1].length], bump: '', stamp: '', stampAt: '', fx: '', fxAt: '', scale: '' }); sc.b = m;
  proj.scenes.splice(sel + 1, 0, nw); renderAll(); scheduleRebuild();
};

// ---------- галерея ----------
let gCat = null;
function openGallery() {
  gCat = gCat || TEMPLATE_CATS[0];
  $('#gCats').innerHTML = ['Все'].concat(TEMPLATE_CATS).map(c => `<button class="${c === gCat ? 'on' : ''}">${c}</button>`).join('');
  $$('#gCats button').forEach(b => b.onclick = () => { gCat = b.textContent; openGallery(); });
  const list = TEMPLATES.filter(t => gCat === 'Все' || t.cat === gCat);
  $('#gGrid').innerHTML = list.map(t => `<div class="tp" data-id="${t.id}"><img src="${thumb(t.id)}" onerror="this.style.visibility='hidden'"><b>${esc(t.name)}</b><span>${t.lines === 1 ? '1 строка' : t.lines + ' строки'}</span></div>`).join('');
  $$('#gGrid .tp').forEach(d => d.onclick = () => { const sc = proj.scenes[sel]; sc.tpl = d.dataset.id; sc.f = {}; sc.scale = ''; $('#gallery').hidden = true; renderAll(); scheduleRebuild(50); });
  $('#gallery').hidden = false;
}
$('#seTpl').onclick = openGallery; $('#gClose').onclick = () => $('#gallery').hidden = true;

// ---------- стиль ----------
function renderPresets() {
  const all = Object.keys(PRESETS).concat(Object.keys(USER_PRESETS).filter(k => !PRESETS[k]));
  $('#presetGrid').innerHTML = all.map(k => `<div class="pr ${k === proj.style.preset ? 'on' : ''}" data-k="${esc(k)}" title="${esc(PRESET_INFO[k] || 'мой пресет')}"><img src="presets/${k}.jpg" onerror="this.style.visibility='hidden'">${esc(k)}</div>`).join('');
  $$('#presetGrid .pr').forEach(d => d.onclick = () => { proj.style.preset = d.dataset.k; const p = PRESETS[d.dataset.k] || USER_PRESETS[d.dataset.k] || {}; if (p.format) proj.style.format = p.format; renderPresets(); fillStyle(); scheduleRebuild(50); });
}
function fillStyle() {
  const st = proj.style;
  $$('#fmt button').forEach(b => b.classList.toggle('on', b.dataset.v === st.format));
  $('#vStart').value = st.start; $('#vEnd').value = st.end; $('#artist').value = st.artist; $('#songTitle').value = st.title; $('#wm').value = st.wm; $('#wmOp').value = st.wmOp;
  $('#partType').value = st.part || ''; $('#partColor').value = st.partColor; const p = PRESETS[st.preset] || USER_PRESETS[st.preset] || {};
  $('#beat').value = st.beat ?? (p.beat || 0); $('#beatV').textContent = (+$('#beat').value).toFixed(3);
  $('#smokeOn').checked = !!st.smokeOn; $('#smokeA').value = st.smokeA; $('#smokeB').value = st.smokeB; $('#lead').value = st.lead ?? (p.lead ?? 0.2); $('#fade').value = st.fade;
  updateTransport(curT());
}
const bindStyle = (sel, key, conv = v => v, ev = 'input', rebuildSpec = false) => $(sel).addEventListener(ev, e => { proj.style[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); if (rebuildSpec) specCache = null; if (key === 'beat') $('#beatV').textContent = (+e.target.value).toFixed(3); scheduleRebuild(); });
bindStyle('#vStart', 'start', v => +v, 'change', true); bindStyle('#vEnd', 'end', v => +v, 'change', true);
bindStyle('#artist', 'artist'); bindStyle('#songTitle', 'title'); bindStyle('#wm', 'wm'); bindStyle('#wmOp', 'wmOp', v => +v);
bindStyle('#partType', 'part', v => v, 'change'); bindStyle('#partColor', 'partColor'); bindStyle('#beat', 'beat', v => +v);
bindStyle('#smokeOn', 'smokeOn', v => v, 'change'); bindStyle('#smokeA', 'smokeA'); bindStyle('#smokeB', 'smokeB'); bindStyle('#lead', 'lead', v => v === '' ? null : +v, 'change'); bindStyle('#fade', 'fade', v => +v, 'change');
$$('#fmt button').forEach(b => b.onclick = () => { proj.style.format = b.dataset.v; fillStyle(); scheduleRebuild(50); });
$('#bAutoRange').onclick = () => { autoRange(); fillStyle(); scheduleRebuild(50); };
$('#bSavePreset').onclick = async () => {
  const name = ($('#presetName').value || '').trim(); if (!name) return toast('Впишите название пресета');
  const sp = buildSpec(false); const keep = ['format', 'theme', 'caption', 'lead', 'fade', 'spectrum', 'specBars', 'trans', 'push', 'tilt', 'smoke', 'ghosts', 'capFont', 'capWeight', 'captionSize', 'capAttach', 'capGap', 'capGlow', 'particles', 'beat', 'beatColor', 'bgBase', 'bgStyle', 'bgColor', 'hud', 'labels', 'hlStyle', 'accent', 'ink', 'kin', 'clouds', 'adlibColor', 'cs'];
  USER_PRESETS[name] = Object.fromEntries(keep.filter(k => sp[k] !== undefined).map(k => [k, sp[k]]));
  await api.saveUserPresets(USER_PRESETS); proj.style.preset = name; renderPresets(); toast('Пресет сохранён');
};

// ---------- вкладки ----------
$$('.tabs').forEach(tb => tb.querySelectorAll('button').forEach(b => b.onclick = () => {
  tb.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  const panel = tb.parentElement; panel.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
  if (b.dataset.tab === 'words') renderWords();
}));

// ---------- проект ----------
function renderAll() { renderStrip(); renderScene(); renderPresets(); fillStyle(); }
$('#bNew').onclick = () => { if (!confirm('Начать новый проект?')) return; proj = newProject(); audio.removeAttribute('src'); audioData = null; specCache = null; $('#lyrics').value = ''; $('#audioName').textContent = 'не выбран'; $('#alignStatus').textContent = ''; renderAll(); rebuildPreview(); };
$('#bSave').onclick = async () => { proj.lyrics = $('#lyrics').value; const p = await api.saveProject(JSON.stringify(proj, null, 1), (proj.audioName || 'проект').replace(/\.[^.]+$/, '') + '.lsp'); if (p) toast('Сохранено'); };
$('#bOpen').onclick = async () => {
  const r = await api.openProject(); if (!r) return;
  try { proj = merge(newProject(), JSON.parse(r.json)); } catch (e) { return toast('Файл проекта повреждён'); }
  $('#lyrics').value = proj.lyrics; $('#alFrom').value = proj.alFrom; $('#alTo').value = proj.alTo; $('#audioName').textContent = proj.audioName || 'не выбран'; sel = 0; specCache = null;
  if (proj.audioPath) { try { await loadAudio({ path: proj.audioPath, name: proj.audioName }); } catch (e) { toast('Трек не найден по старому пути — выберите его заново', 4000); } }
  renderAll(); rebuildPreview();
};

// ---------- экспорт ----------
let exporting = false;
$$('#xRes button').forEach(b => b.onclick = () => $$('#xRes button').forEach(x => x.classList.toggle('on', x === b)));
$('#bExport').onclick = () => {
  if (!proj.words.length || !proj.audioPath) return toast('Сначала трек, текст и синхронизация');
  const d = (+proj.style.end || proj.duration) - (+proj.style.start || 0); $('#xInfo').textContent = `Длина ${d.toFixed(1)} с, ${proj.scenes.length} сцен, формат ${proj.style.format}.`;
  $('#xBar').style.width = '0'; $('#xStatus').textContent = ''; $('#xStatus').className = 'status'; $('#exportModal').hidden = false;
};
$('#xClose').onclick = () => { if (!exporting) $('#exportModal').hidden = true; };
$('#xCancel').onclick = () => api.cancelExport();
$('#xGo').onclick = async () => {
  await ensureSpectrum(); const res = +$$('#xRes button').find(b => b.classList.contains('on')).dataset.v;
  const spec = buildSpec(true), [W, H] = FMT[proj.style.format];
  exporting = true; $('#xGo').disabled = true; $('#xCancel').hidden = false; const st = $('#xStatus');
  try {
    const r = await api.exportVideo({ html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? Math.round(res * W / H / 2) * 2 : res, start: +spec.start, end: +spec.end, fade: +spec.fade, audioPath: proj.audioPath, fps: 30,
      name: (proj.audioName || 'video').replace(/\.[^.]+$/, '') + '.mp4' },
      p => { $('#xBar').style.width = Math.round(p.frac * 100) + '%'; st.textContent = p.text; });
    if (r && r.ok) { st.className = 'status ok'; st.textContent = 'Готово: ' + r.path; $('#xBar').style.width = '100%'; }
    else st.textContent = r && r.cancelled ? 'Отменено' : 'Не сохранено';
  } catch (e) { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); }
  exporting = false; $('#xGo').disabled = false; $('#xCancel').hidden = true;
};

// ---------- старт ----------
(async function init() {
  ENGINE = await (await fetch('engine.html')).text();
  PRESETS = await (await fetch('presets.json')).json();
  try { USER_PRESETS = (await api.loadUserPresets()) || {}; } catch (e) { USER_PRESETS = {}; }
  renderAll(); rebuildPreview(); loop();
  window.__ls = { get proj() { return proj; }, set proj(v) { proj = v; }, loadAudio, renderAll, rebuildPreview, buildSpec, engineHTML, autoScenes, autoRange, seek, ensureSpectrum };
})();
