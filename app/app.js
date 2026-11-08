/* Lyric Studio — интерфейс редактора */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const FMT = { '9:16': [720, 1280], '1:1': [720, 720], '4:5': [720, 900], '16:9': [1280, 720] };
const PRESET_INFO = {
  'melhor': 'дымка, листики, окна плавают', 'melhor-lenta': 'лента сверху вниз', 'purple-haze': 'тёмный дым, звёзды',
  'night-drive': 'неон, ночь', 'rec-tape': 'монтажка REC', 'poster': 'огромные слова', 'cloud9': 'небо и облака',
  'soft-glow': 'мягкий поп', 'lockscreen': 'всё в iPhone', 'y2k-gingham': 'розовая клетка', 'rain-room': 'дождь, грусть'
};
const AUTO_TPL = {
  1: ['achievement', 'poll', 'vc-sheet', 'player', 'recorder', 'pcach', 'rating', 'typing', 'server', 'slider', 'segmented', 'bank', 'story', 'purchase', 'record', 'pulse', 'vc-list', 'todo', 'tg-group', 'leanrain', 'tg-feed', 'callfull'],
  2: ['chat', 'doc', 'post', 'counter', 'toggles', 'imsg-dialog', 'spend', 'drive', 'lyrics', 'alert', 'weather', 'tg-her', 'notifs', 'cs-bomb', 'selfhit', 'map', 'call', 'cs-score'],
  3: ['list', 'notifs', 'chat', 'doc', 'toggles']
};
const KIN_AUTO = ['kin-pop', 'kin-stack', 'kin-punch'];
const BUILTIN_FONTS = ['Inter Display', 'Inter', 'Nunito', 'DejaVu Sans Mono'];
const TPL = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));
let ENGINE = '', PRESETS = {}, USER_PRESETS = {};
let proj = newProject(), sel = 0, audioUrl = null, audioData = null, specCache = null, beatInfo = null, playing = false, rebuildTimer = null, frameReady = false;
let projPath = null, dirty = false, lastExportPath = null;
const audio = new Audio();

function newProject() {
  return { version: 2, audioPath: '', audioName: '', lyrics: '', alFrom: '', alTo: '', words: [], duration: 0, perScene: 2, scenes: [], assets: {}, fonts: [],
    style: { preset: 'melhor-lenta', format: '9:16', start: 0, end: 0, artist: 'melhor', title: '', wm: 'melhor', wmOp: 0.2, wmImg: '', part: '', partColor: '#ffffff', beat: null, smokeOn: false, smokeA: '#78aa78', smokeB: '#9678c8', lead: null, fade: 0.4,
      trans: '', custom: { on: false, theme: 'cards', bgType: 'gradient', bg1: '#F6F5F3', bg2: '#E4DAFF', font: 'Inter Display', accent: '#E10600', tilt: 3 },
      fx: { grain: 0, vhs: 0, aberr: 0, shake: 0 } } };
}
const toast = (m, ms = 2400) => { const t = $('#toast'); t.innerHTML = ''; t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); };
function toastErr(m) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(m)}</span> <button class="small">Скопировать отчёт</button>`; t.classList.add('on', 'err');
  t.querySelector('button').onclick = copyReport; clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on', 'err'), 9000);
  api.log('error', m);
}
const fmtT = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function merge(a, b) { const o = Object.assign({}, a); for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? merge(o[k], b[k]) : b[k]; return o; }
const uid = () => Math.random().toString(36).slice(2, 10);
const asset = v => typeof v === 'string' && v.startsWith('asset:') ? (proj.assets[v.slice(6)] || '') : v;

// ---------- журнал и ошибки ----------
window.addEventListener('error', e => api.log('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => api.log('error', 'promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
async function copyReport() {
  const st = `слов ${proj.words.length}, сцен ${proj.scenes.length}, пресет ${proj.style.preset}, формат ${proj.style.format}, трек ${proj.audioName ? 'есть' : 'нет'}`;
  try { await api.copyReport(st); toast('Отчёт скопирован — вставьте его в сообщение (Ctrl+V)', 4000); } catch (e) { toast('Не удалось скопировать отчёт'); }
}

// ---------- картинки и шрифты ----------
async function loadImage(keepAlpha, max = 640) {
  const f = await api.pickImage(); if (!f) return null;
  const bmp = await createImageBitmap(new Blob([f.data])), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const id = uid(); proj.assets[id] = keepAlpha || f.ext === 'png' || f.ext === 'webp' || f.ext === 'gif' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
  return 'asset:' + id;
}
function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
async function loadFont() {
  const f = await api.pickFont(); if (!f) return null;
  const mime = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[f.ext] || 'font/ttf';
  const family = f.name.replace(/\.[^.]+$/, '').replace(/["\\]/g, '').slice(0, 40), id = uid();
  proj.assets[id] = `data:${mime};base64,` + b64(f.data);
  proj.fonts = (proj.fonts || []).filter(x => x.family !== family).concat([{ family, asset: id }]);
  registerFonts(); return family;
}
function registerFonts() { (proj.fonts || []).forEach(f => { if (document.fonts && ![...document.fonts].some(x => x.family === f.family) && proj.assets[f.asset]) { try { const ff = new FontFace(f.family, `url(${proj.assets[f.asset]})`); ff.load().then(x => document.fonts.add(x)).catch(() => {}); } catch (e) {} } }); }
const allFonts = () => BUILTIN_FONTS.concat((proj.fonts || []).map(f => f.family)).concat(Object.values(USER_PRESETS).flatMap(p => (p.fonts || []).map(f => f.family)));
function fontOptions(val) { return [...new Set(allFonts())].map(f => `<option ${f === val ? 'selected' : ''}>${esc(f)}</option>`).join('') + '<option value="__load">Загрузить свой…</option>'; }

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
function bgCss(c) {
  if (c.bgType === 'solid') return c.bg1;
  if (c.bgType === 'radial') return `radial-gradient(ellipse 80% 60% at 50% 45%,${c.bg2} 0%,${c.bg1} 75%)`;
  if (c.bgType === 'grid') return `repeating-linear-gradient(0deg,${c.bg2}66 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,${c.bg2}66 0 1px,transparent 1px 32px),${c.bg1}`;
  return `linear-gradient(180deg,${c.bg1} 0%,${c.bg2} 100%)`;
}
function fieldsOf(sc) { const t = TPL[sc.tpl] || TPL.chat, f = Object.assign({}, defFields(t), sc.f); for (const fd of t.fields) if (fd.type === 'image') f[fd.k] = asset(f[fd.k]); return f; }
function buildSpec(forExport, opts = {}) {
  const st = proj.style, base = PRESETS[st.preset] || USER_PRESETS[st.preset] || {};
  let spec = merge(base, { format: st.format, start: +st.start || 0, end: +st.end || proj.duration, fade: +st.fade || 0.4 });
  if (st.lead != null && st.lead !== '') spec.lead = +st.lead;
  if (st.artist) spec.player = { artist: st.artist, title: st.title || '' }; else delete spec.player;
  const logo = asset(st.wmImg);
  if (st.wm || logo) spec.watermark = { text: st.wm || '', opacity: +st.wmOp || 0.2, size: 11, img: logo || undefined }; else delete spec.watermark;
  if (st.part === 'none') delete spec.particles; else if (st.part) spec.particles = { type: st.part, color: st.partColor, colors: [st.partColor + '88'] };
  if (st.beat != null && st.beat !== '') spec.beat = +st.beat;
  if (st.smokeOn) spec.smoke = merge(spec.smoke || { n: 10, opacity: .8 }, { colors: [hexA(st.smokeA, .5), hexA(st.smokeB, .5), hexA(st.smokeA, .4)], dustColor: hexA(st.smokeA, .45) });
  const c = st.custom || {};
  if (c.on) {
    spec.theme = c.theme; spec.bgBase = bgCss(c); spec.accent = c.accent; spec.tilt = +c.tilt;
    if (c.bgType === 'gingham') { spec.bgStyle = 'gingham'; spec.bgColor = c.bg1; } else spec.bgStyle = c.theme === 'cards' ? 'flat' : undefined;
    if (c.font && c.font !== 'Inter Display') { spec.capFont = c.font; spec.capWeight = 900; } else { delete spec.capFont; }
    if (c.theme !== 'cards') { delete spec.ghosts; }
  }
  if (st.trans) spec.trans = st.trans === 'fade' ? 'fade' : st.trans;
  const fx = st.fx || {};
  ['grain', 'vhs', 'aberr', 'shake'].forEach(k => { if (+fx[k] > 0) spec[k] = +fx[k]; });
  if (spec.vhs && typeof spec.vhs !== 'object') spec.vhs = { amount: +spec.vhs };
  delete spec.__fx; delete spec.__thumb;
  const fonts = (base.fonts || []).concat((proj.fonts || []).map(f => ({ family: f.family, src: proj.assets[f.asset] })).filter(f => f.src));
  if (fonts.length) spec.fonts = fonts;
  spec.spectrum = spec.spectrum ?? true;
  spec.scenes = proj.scenes.map(sc => {
    const t = TPL[sc.tpl] || TPL.chat, f = fieldsOf(sc), cx = sceneCtx(sc);
    let out = {}; try { out = t.make(f, cx) || {}; } catch (e) { console.error(e); }
    const s = Object.assign({ words: [sc.a, sc.b] }, out);
    if (sc.scale && s.widget) s.widget.scale = +sc.scale;
    const punch = [].concat(out.punch || []);
    if (s.widget && sc.bump != null && sc.bump !== '') punch.push({ word: '·', at: +sc.bump, style: 'bump' });
    if (s.widget && sc.stamp) punch.push({ word: sc.stamp, at: sc.stampAt !== '' && sc.stampAt != null ? +sc.stampAt : cx.word(cx.n - 2), style: 'stamp', color: '#16A34A', top: 12, right: 20, size: 26, rot: -9 });
    if (punch.length) s.punch = punch; else delete s.punch;
    if (sc.fx) s.fx = { type: 'emoji', emoji: sc.fx, at: sc.fxAt !== '' && sc.fxAt != null ? +sc.fxAt : cx.word(0), dir: 'up', front: false, n: 12 };
    if (s.kinetic && c.on && !s.kinetic.accent) s.kinetic.accent = c.accent;
    return s;
  });
  spec.words = proj.words.map(w => ({ w: w.w, t: w.t, e: w.e, line: w.line }));
  spec.duration = proj.duration;
  if (specCache && spec.spectrum !== false) spec.spec = specCache.data;
  if (beatInfo && beatInfo.beats) spec.beats = beatInfo.beats.filter(b => b >= spec.start - 1 && b <= spec.end + 1);
  if (opts.transparent) spec.transparent = true;
  return spec;
}
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const defFields = t => Object.fromEntries(t.fields.map(x => [x.k, x.def]));

function engineHTML(spec, base) {
  return ENGINE.replace('<head>', `<head>${base ? `<base href="${base}">` : ''}<script>window.onerror=(m)=>{window.__err=String(m)}<\/script><link rel="stylesheet" href="fonts.css">`).replace('/*SPEC*/', 'window.SPEC=' + JSON.stringify(spec) + ';');
}

// ---------- спектр и биты ----------
async function ensureSpectrum() {
  if (!audioData) return;
  const st = proj.style, t0 = +st.start || 0, t1 = +st.end || proj.duration, key = t0 + ':' + t1;
  if (specCache && specCache.key === key) return;
  specCache = { key, data: Spectrum.spectrum(audioData.mono, audioData.sr, t0, t1, 30) };
}
function analyzeBeats() {
  if (!audioData) return; try { beatInfo = Beats.detect(audioData.mono, audioData.sr); $('#bpmLabel').textContent = `≈ ${beatInfo.bpm} BPM · ${beatInfo.beats.length} битов`; } catch (e) { beatInfo = null; api.log('warn', 'биты: ' + e.message); }
  Timeline.invalidate();
}

// ---------- превью ----------
function scheduleRebuild(ms = 350, noHistory) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildPreview, ms); if (!noHistory) touch(); Timeline.redraw(); }
async function rebuildPreview() {
  if (!proj.words.length) { $('#preview').srcdoc = '<body style="margin:0;background:#111;color:#666;font:600 18px Inter;display:flex;align-items:center;justify-content:center;height:100vh">Нет текста</body>'; return; }
  await ensureSpectrum();
  const fr = $('#preview'), [W, H] = FMT[proj.style.format]; frameReady = false;
  fr.width = W; fr.height = H; fr.style.width = W + 'px'; fr.style.height = H + 'px'; fitStage();
  fr.onload = () => { const cw = fr.contentWindow; const wait = () => { if (cw.READY) { frameReady = true; seek(curT()); } else if (cw.document.readyState === 'complete' && cw.__err) { toastErr('Ошибка движка: ' + cw.__err); } else setTimeout(wait, 50); }; wait(); };
  fr.srcdoc = engineHTML(buildSpec(false), null);
}
function fitStage() {
  const [W, H] = FMT[proj.style.format], wrap = $('#stageWrap'), k = Math.min((wrap.clientWidth - 32) / W, (wrap.clientHeight - 32) / H);
  $('#stage').style.width = W * k + 'px'; $('#stage').style.height = H * k + 'px'; $('#preview').style.transform = `scale(${k})`; drawSafe();
}
window.addEventListener('resize', fitStage);
const curT = () => audio.src ? audio.currentTime : (window.__t ?? (+proj.style.start || 0));
function seek(t) { if (!audio.src) window.__t = t; const cw = $('#preview').contentWindow; if (frameReady && cw && cw.seek) try { cw.seek(t); } catch (e) {} updateTransport(t); }
function seekTo(t) { const s = +proj.style.start || 0, e = +proj.style.end || proj.duration || 0; t = Math.max(0, Math.min(Math.max(e, proj.duration || 0), t)); if (audio.src) audio.currentTime = t; seek(t); }
function updateTransport(t) {
  const s = +proj.style.start || 0, e = +proj.style.end || proj.duration || 1;
  $('#tCur').textContent = fmtT(t); $('#tEnd').textContent = fmtT(e);
  if (!$('#scrub')._drag) $('#scrub').value = Math.round(1000 * (t - s) / Math.max(.01, e - s));
  const k = sceneAt(t);
  if (playing && k >= 0 && k !== sel) { sel = k; renderStrip(); renderScene(); }
}
function sceneAt(t) { return proj.scenes.findIndex((sc, i) => { const n = proj.scenes[i + 1]; return t < (n && proj.words[n.a] ? proj.words[n.a].t - .1 : 1e9); }); }
function loop() {
  if (playing) { const e = +proj.style.end || proj.duration; if (audio.currentTime >= e) { audio.pause(); playing = false; $('#bPlay').textContent = '▶'; audio.currentTime = +proj.style.start || 0; } seek(audio.currentTime); }
  requestAnimationFrame(loop);
}
function togglePlay() {
  if (!audio.src) return toast('Сначала выберите трек');
  if (playing) { audio.pause(); playing = false; $('#bPlay').textContent = '▶'; return; }
  const s = +proj.style.start || 0, e = +proj.style.end || proj.duration;
  if (audio.currentTime < s || audio.currentTime >= e - .05) audio.currentTime = s;
  audio.play(); playing = true; $('#bPlay').textContent = '❚❚';
}
$('#bPlay').onclick = togglePlay;
$('#scrub').addEventListener('input', () => { const s = +proj.style.start || 0, e = +proj.style.end || proj.duration; seekTo(s + (e - s) * $('#scrub').value / 1000); });
$('#scrub').addEventListener('pointerdown', () => $('#scrub')._drag = true); $('#scrub').addEventListener('pointerup', () => $('#scrub')._drag = false);

// ---------- безопасные зоны ----------
const SAFE = {
  tiktok: { top: .09, bottom: .21, right: .15, rTop: .38, rBot: .86, name: 'TikTok' },
  reels: { top: .08, bottom: .22, right: .14, rTop: .48, rBot: .9, name: 'Reels' },
  shorts: { top: .08, bottom: .26, right: .15, rTop: .45, rBot: .9, name: 'Shorts' }
};
function drawSafe() {
  const v = $('#safeSel').value, box = $('#safe'), z = SAFE[v]; box.hidden = !z || proj.style.format !== '9:16'; if (box.hidden) return;
  box.innerHTML = `<i style="left:0;right:0;top:0;height:${z.top * 100}%"></i><i style="left:0;right:0;bottom:0;height:${z.bottom * 100}%"><b>подпись и ник ${z.name}</b></i><i style="right:0;width:${z.right * 100}%;top:${z.rTop * 100}%;bottom:${(1 - z.rBot) * 100}%"><b>кнопки</b></i>`;
}
$('#safeSel').onchange = drawSafe;

// ---------- трек ----------
async function loadAudio(info) {
  proj.audioPath = info.path; proj.audioName = info.name; $('#audioName').textContent = info.name;
  const buf = info.data || await api.readFile(info.path);
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(new Blob([buf])); audio.src = audioUrl;
  audioData = await Spectrum.decodeMono(buf); proj.duration = proj.duration || audioData.duration; specCache = null;
  if (!proj.style.end) proj.style.end = +audioData.duration.toFixed(2);
  setTimeout(analyzeBeats, 30);
}
$('#bAudio').onclick = async () => { const info = await api.pickAudio(); if (!info) return; try { await loadAudio(info); proj.duration = audioData.duration; fillStyle(); Timeline.fit(); touch(); toast('Трек загружен'); } catch (e) { toastErr('Не удалось прочитать файл: ' + e.message); } };

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
    st.className = 'status ok'; st.textContent = `Готово: ${r.words.length} слов, ${proj.scenes.length} сцен.` + (r.median < 0.15 ? '\nВокал плохо слышно — проверьте тайминги на таймлайне.' : '');
    fillStyle(); renderAll(); Timeline.fit(); scheduleRebuild(50);
  } catch (e) { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); api.log('error', 'синхронизация: ' + (e.message || e)); }
  $('#bAlign').disabled = false;
};
function autoRange() { if (!proj.words.length) return; const w0 = proj.words[0], w1 = proj.words[proj.words.length - 1]; proj.style.start = Math.max(0, +(w0.t - 0.3).toFixed(2)); proj.style.end = +Math.min(proj.duration || 1e9, w1.e + 0.45).toFixed(2); specCache = null; }
const blankScene = (a, b, tpl) => ({ a, b, tpl, f: {}, bump: '', stamp: '', stampAt: '', fx: '', fxAt: '', scale: '' });
function autoScenes() {
  const per = proj.perScene || 2, lines = [], kin = $('#autoKin').checked;
  proj.words.forEach((w, i) => { const L = lines[lines.length - 1]; if (L && L.line === w.line) L.b = i + 1; else lines.push({ line: w.line, a: i, b: i + 1 }); });
  proj.scenes = []; const used = {}; let kk = 0;
  for (let i = 0, n = 0; i < lines.length; i += per, n++) {
    const grp = lines.slice(i, i + per), k = grp.length, pool = AUTO_TPL[Math.min(3, k)];
    let tpl = pool[(used[k] = (used[k] ?? -1) + 1) % pool.length];
    if (kin && n % 4 === 3) tpl = KIN_AUTO[kk++ % KIN_AUTO.length];
    proj.scenes.push(blankScene(grp[0].a, grp[k - 1].b, tpl));
  }
  sel = 0;
}
$('#bAutoScenes').onclick = () => { if (!proj.words.length) return toast('Сначала синхронизируйте слова'); if (!confirm('Пересобрать сцены? Текущие настройки сцен пропадут (можно вернуть через Ctrl+Z).')) return; autoScenes(); renderAll(); scheduleRebuild(50); };
$$('#perScene button').forEach(b => b.onclick = () => { proj.perScene = +b.dataset.v; $$('#perScene button').forEach(x => x.classList.toggle('on', x === b)); });

// ---------- слова ----------
function renderWords() {
  const box = $('#wordList'); box.innerHTML = ''; let ln = -1;
  proj.words.forEach((w, i) => {
    const d = document.createElement('div'); d.className = 'w' + (w.line !== ln ? ' ln' : ''); ln = w.line;
    d.innerHTML = `<span>${esc(w.w)}</span><button data-d="-0.05">−</button><span class="mono">${w.t.toFixed(2)}</span><button data-d="0.05">+</button>`;
    d.children[0].onclick = () => seekTo(Math.max(0, w.t - .15));
    d.querySelectorAll('button').forEach(b => b.onclick = () => { w.t = +(w.t + +b.dataset.d).toFixed(2); w.e = Math.max(w.e, w.t + .05); d.querySelector('.mono').textContent = w.t.toFixed(2); scheduleRebuild(); });
    box.append(d);
  });
}

// ---------- сцены ----------
function thumb(id) { return `thumbs/${id}.jpg`; }
function renderStrip() {
  const box = $('#sceneStrip'); box.innerHTML = '';
  proj.scenes.forEach((sc, i) => {
    if (!proj.words[sc.a]) return;
    const d = document.createElement('div'); d.className = 'sc' + (i === sel ? ' on' : '');
    d.innerHTML = `<img src="${thumb(sc.tpl)}" onerror="this.style.visibility='hidden'"><div><div class="n">${i + 1} · ${fmtT(proj.words[sc.a].t)}</div><div class="t">${esc(sceneText(sc))}</div></div>`;
    d.onclick = () => selectScene(i, true);
    box.append(d);
  });
  const on = box.children[sel]; if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  Timeline.redraw();
}
function selectScene(i, jump) {
  if (i < 0 || i >= proj.scenes.length) return; sel = i;
  if (jump) { const sc = proj.scenes[i]; seekTo(Math.max(+proj.style.start || 0, proj.words[sc.a].t - .1 + .6)); }
  renderStrip(); renderScene();
}
function wordOptions(sc, val, none = 'нет') {
  return `<option value="">${none}</option>` + proj.words.slice(sc.a, sc.b).map((w, i) => `<option value="${sc.a + i}" ${String(val) === String(sc.a + i) ? 'selected' : ''}>${esc(w.w)}</option>`).join('');
}
const SEL_LABEL = { auto: 'как в шаблоне', none: 'не показывать', note: 'заметка', ticker: 'фиолетовая лента', transcript: 'расшифровка (тёмная)', status: 'статус (зелёный)', warn: 'предупреждение', search: 'поиск сверху', data: 'данные', decline: 'отклонить', approve: 'одобрить' };
function imgPicker(box, val, onPick, onClear, label = 'Выбрать картинку…') {
  const src = asset(val); box.className = 'imgPick';
  box.innerHTML = src ? `<img src="${src}"><button class="small">заменить</button><button class="small ghost">✕</button>` : `<button class="small">${label}</button>`;
  const bs = box.querySelectorAll('button'); bs[0].onclick = onPick; if (bs[1]) bs[1].onclick = onClear;
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
    else if (fd.type === 'image') {
      d.innerHTML = `<label class="lbl">${esc(fd.label)}</label><div></div>`;
      const pb = d.lastChild, redraw = () => imgPicker(pb, sc.f[fd.k], async () => { const a = await loadImage(false); if (a) { sc.f[fd.k] = a; redraw(); scheduleRebuild(50); } }, () => { sc.f[fd.k] = ''; redraw(); scheduleRebuild(50); });
      redraw();
    }
    else {
      d.innerHTML = `<label class="lbl">${esc(fd.label)}</label>`;
      if (fd.type === 'select') { inp = document.createElement('select'); inp.innerHTML = fd.opts.map(o => `<option ${o === v ? 'selected' : ''} value="${o}">${SEL_LABEL[o] || o}</option>`).join(''); }
      else if (fd.type === 'font') { inp = document.createElement('select'); inp.innerHTML = fontOptions(v); }
      else { inp = document.createElement('input'); inp.type = fd.type === 'number' ? 'number' : fd.type === 'color' ? 'color' : 'text'; if (fd.type === 'number') inp.step = 'any'; inp.value = v; if (fd.type === 'emoji') inp.className = 'emo'; }
      inp.oninput = async () => {
        if (fd.type === 'font' && inp.value === '__load') { const fam = await loadFont(); if (fam) sc.f[fd.k] = fam; renderScene(); scheduleRebuild(50); return; }
        sc.f[fd.k] = fd.type === 'number' ? +inp.value : inp.value; scheduleRebuild();
      };
      d.append(inp);
    }
    box.append(d);
  });
  const card = !t.nocard; $('#seCardOnly').hidden = !card; $('#seScaleBox').hidden = !card;
  $('#seBump').innerHTML = wordOptions(sc, sc.bump); $('#seStamp').value = sc.stamp || ''; $('#seStampAt').innerHTML = wordOptions(sc, sc.stampAt, 'авто');
  $('#seFx').value = sc.fx || ''; $('#seFxAt').innerHTML = wordOptions(sc, sc.fxAt, 'авто');
  $('#seScale').value = sc.scale || defScale(sc); $('#seScaleV').textContent = (+$('#seScale').value).toFixed(2);
}
function defScale(sc) { try { const w = TPL[sc.tpl].make(fieldsOf(sc), sceneCtx(sc)).widget; return (w && w.scale) || 1.3; } catch (e) { return 1.3; } }
$('#seBump').onchange = e => { proj.scenes[sel].bump = e.target.value; scheduleRebuild(); };
$('#seStamp').oninput = e => { proj.scenes[sel].stamp = e.target.value; scheduleRebuild(); };
$('#seStampAt').onchange = e => { proj.scenes[sel].stampAt = e.target.value; scheduleRebuild(); };
$('#seFx').oninput = e => { proj.scenes[sel].fx = e.target.value; scheduleRebuild(); };
$('#seFxAt').onchange = e => { proj.scenes[sel].fxAt = e.target.value; scheduleRebuild(); };
$('#seScale').oninput = e => { proj.scenes[sel].scale = +e.target.value; $('#seScaleV').textContent = (+e.target.value).toFixed(2); scheduleRebuild(200); };
function mergePrev() { if (sel < 1) return; const p = proj.scenes[sel - 1]; p.b = proj.scenes[sel].b; proj.scenes.splice(sel, 1); sel--; renderAll(); scheduleRebuild(); }
function mergeNext() { if (sel >= proj.scenes.length - 1) return; const c = proj.scenes[sel]; c.b = proj.scenes[sel + 1].b; proj.scenes.splice(sel + 1, 1); renderAll(); scheduleRebuild(); }
function splitScene(atTime) {
  let i = atTime != null ? sceneAt(atTime) : sel; if (i < 0) i = sel; const sc = proj.scenes[i]; if (!sc || sc.b - sc.a < 2) return toast('Слишком короткая сцена');
  const ws = proj.words; let m = -1;
  if (atTime != null) { for (let k = sc.a + 1; k < sc.b; k++) if (ws[k].t >= atTime - .02) { m = k; break; } if (m < 0) return toast('Курсор после последнего слова сцены'); }
  else { m = sc.a + Math.floor((sc.b - sc.a) / 2); for (let d = 0; d < sc.b - sc.a; d++) { for (const k of [m + d, m - d]) if (k > sc.a && k < sc.b && ws[k].line !== ws[k - 1].line) { m = k; d = 1e9; break; } } }
  const nw = Object.assign(blankScene(m, sc.b, AUTO_TPL[1][(i + 3) % AUTO_TPL[1].length])); sc.b = m;
  proj.scenes.splice(i + 1, 0, nw); sel = i; renderAll(); scheduleRebuild();
}
$('#seMergePrev').onclick = mergePrev; $('#seMergeNext').onclick = mergeNext;
$('#seSplit').onclick = () => { const sc = proj.scenes[sel], t = curT(); splitScene(sc && t > proj.words[sc.a].t + .05 && t < proj.words[sc.b - 1].t ? t : null); };

// ---------- галерея ----------
let gCat = null;
function openGallery() {
  if (!proj.scenes[sel]) return;
  gCat = gCat || 'Все';
  $('#gCats').innerHTML = ['Все'].concat(TEMPLATE_CATS).map(c => `<button class="${c === gCat ? 'on' : ''}">${c}</button>`).join('');
  $$('#gCats button').forEach(b => b.onclick = () => { gCat = b.textContent; openGallery(); });
  const list = TEMPLATES.filter(t => gCat === 'Все' || t.cat === gCat);
  $('#gGrid').innerHTML = list.map(t => `<div class="tp" data-id="${t.id}"><img src="${thumb(t.id)}" onerror="this.style.visibility='hidden'"><b>${esc(t.name)}</b><span>${t.lines === 1 ? '1 строка' : t.lines + ' строки'}${t.nocard ? ' · без карточки' : ''}</span></div>`).join('');
  $$('#gGrid .tp').forEach(d => d.onclick = () => { const sc = proj.scenes[sel]; sc.tpl = d.dataset.id; sc.f = {}; sc.scale = ''; $('#gallery').hidden = true; renderAll(); scheduleRebuild(50); });
  $('#gallery').hidden = false;
}
$('#seTpl').onclick = openGallery; $('#gClose').onclick = () => $('#gallery').hidden = true;

// ---------- стиль ----------
function renderPresets() {
  const all = Object.keys(PRESETS).concat(Object.keys(USER_PRESETS).filter(k => !PRESETS[k]));
  $('#presetGrid').innerHTML = all.map(k => `<div class="pr ${k === proj.style.preset ? 'on' : ''} ${PRESETS[k] ? '' : 'user'}" data-k="${esc(k)}" title="${esc(PRESET_INFO[k] || 'мой пресет')}"><img src="${USER_PRESETS[k] && USER_PRESETS[k].__thumb && !PRESETS[k] ? USER_PRESETS[k].__thumb : 'presets/' + esc(k) + '.jpg'}" onerror="this.style.visibility='hidden'">${esc(k)}${PRESETS[k] ? '' : '<i class="del" title="Удалить пресет">✕</i>'}</div>`).join('');
  $$('#presetGrid .pr').forEach(d => d.onclick = e => {
    const k = d.dataset.k;
    if (e.target.classList.contains('del')) { if (!confirm(`Удалить пресет «${k}»?`)) return; delete USER_PRESETS[k]; api.saveUserPresets(USER_PRESETS); if (proj.style.preset === k) proj.style.preset = 'melhor-lenta'; renderPresets(); scheduleRebuild(50); return; }
    proj.style.preset = k; const p = PRESETS[k] || USER_PRESETS[k] || {}; if (p.format) proj.style.format = p.format;
    if (USER_PRESETS[k] && USER_PRESETS[k].__fx) proj.style.fx = Object.assign({ grain: 0, vhs: 0, aberr: 0, shake: 0 }, USER_PRESETS[k].__fx);
    renderPresets(); fillStyle(); scheduleRebuild(50);
  });
}
function fillStyle() {
  const st = proj.style, c = st.custom, fx = st.fx;
  $$('#fmt button').forEach(b => b.classList.toggle('on', b.dataset.v === st.format));
  $('#vStart').value = st.start; $('#vEnd').value = st.end; $('#artist').value = st.artist; $('#songTitle').value = st.title; $('#wm').value = st.wm; $('#wmOp').value = st.wmOp;
  imgPicker($('#wmLogo'), st.wmImg, async () => { const a = await loadImage(true, 400); if (a) { st.wmImg = a; fillStyle(); scheduleRebuild(50); } }, () => { st.wmImg = ''; fillStyle(); scheduleRebuild(50); }, 'Логотип-картинка…');
  $('#partType').value = st.part || ''; $('#partColor').value = st.partColor; const p = PRESETS[st.preset] || USER_PRESETS[st.preset] || {};
  $('#beat').value = st.beat ?? (p.beat || 0); $('#beatV').textContent = (+$('#beat').value).toFixed(3);
  $('#smokeOn').checked = !!st.smokeOn; $('#smokeA').value = st.smokeA; $('#smokeB').value = st.smokeB; $('#lead').value = st.lead ?? (p.lead ?? 0.2); $('#fade').value = st.fade;
  $('#cOn').checked = !!c.on; $('#cBox').classList.toggle('off', !c.on); $('#cTheme').value = c.theme; $('#cBgType').value = c.bgType; $('#cBg1').value = c.bg1; $('#cBg2').value = c.bg2;
  $('#cFont').innerHTML = fontOptions(c.font); $('#cAccent').value = c.accent; $('#cTilt').value = c.tilt; $('#cTiltV').textContent = (+c.tilt).toFixed(1) + '°'; $('#cTrans').value = st.trans || '';
  [['grain', 2], ['vhs', 2], ['aberr', 2], ['shake', 2]].forEach(([k, d]) => { const id = 'fx' + k[0].toUpperCase() + k.slice(1); $('#' + id).value = fx[k] || 0; $('#' + id + 'V').textContent = +fx[k] ? (+fx[k]).toFixed(d) : 'выкл'; });
  updateTransport(curT());
}
const bindStyle = (sel, key, conv = v => v, ev = 'input', rebuildSpec = false) => $(sel).addEventListener(ev, e => { proj.style[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); if (rebuildSpec) specCache = null; if (key === 'beat') $('#beatV').textContent = (+e.target.value).toFixed(3); scheduleRebuild(); if (rebuildSpec) Timeline.redraw(); });
bindStyle('#vStart', 'start', v => +v, 'change', true); bindStyle('#vEnd', 'end', v => +v, 'change', true);
bindStyle('#artist', 'artist'); bindStyle('#songTitle', 'title'); bindStyle('#wm', 'wm'); bindStyle('#wmOp', 'wmOp', v => +v);
bindStyle('#partType', 'part', v => v, 'change'); bindStyle('#partColor', 'partColor'); bindStyle('#beat', 'beat', v => +v);
bindStyle('#smokeOn', 'smokeOn', v => v, 'change'); bindStyle('#smokeA', 'smokeA'); bindStyle('#smokeB', 'smokeB'); bindStyle('#lead', 'lead', v => v === '' ? null : +v, 'change'); bindStyle('#fade', 'fade', v => +v, 'change');
bindStyle('#cTrans', 'trans', v => v, 'change');
const bindC = (sel, key, conv = v => v, ev = 'input') => $(sel).addEventListener(ev, async e => {
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (key === 'font' && v === '__load') { const fam = await loadFont(); if (!fam) { fillStyle(); return; } v = fam; }
  proj.style.custom[key] = conv(v); if (key === 'on' || key === 'font' || key === 'tilt') fillStyle(); scheduleRebuild();
});
bindC('#cOn', 'on', v => v, 'change'); bindC('#cTheme', 'theme', v => v, 'change'); bindC('#cBgType', 'bgType', v => v, 'change'); bindC('#cBg1', 'bg1'); bindC('#cBg2', 'bg2');
bindC('#cFont', 'font', v => v, 'change'); bindC('#cAccent', 'accent'); bindC('#cTilt', 'tilt', v => +v);
$('#cFontLoad').onclick = async () => { const fam = await loadFont(); if (fam) { proj.style.custom.font = fam; proj.style.custom.on = true; fillStyle(); scheduleRebuild(50); toast('Шрифт «' + fam + '» добавлен'); } };
['grain', 'vhs', 'aberr', 'shake'].forEach(k => { const id = '#fx' + k[0].toUpperCase() + k.slice(1); $(id).addEventListener('input', e => { proj.style.fx[k] = +e.target.value; $(id + 'V').textContent = +e.target.value ? (+e.target.value).toFixed(2) : 'выкл'; scheduleRebuild(250); }); });
$('#fxReset').onclick = () => { proj.style.fx = { grain: 0, vhs: 0, aberr: 0, shake: 0 }; fillStyle(); scheduleRebuild(50); };
$$('#fmt button').forEach(b => b.onclick = () => { proj.style.format = b.dataset.v; fillStyle(); drawSafe(); scheduleRebuild(50); });
$('#bAutoRange').onclick = () => { autoRange(); fillStyle(); scheduleRebuild(50); };
const PRESET_KEEP = ['format', 'theme', 'caption', 'lead', 'fade', 'spectrum', 'specBars', 'trans', 'push', 'tilt', 'smoke', 'ghosts', 'capFont', 'capWeight', 'captionSize', 'capAttach', 'capGap', 'capGlow', 'particles', 'beat', 'beatColor', 'bgBase', 'bgStyle', 'bgColor', 'hud', 'labels', 'hlStyle', 'accent', 'ink', 'kin', 'clouds', 'adlibColor', 'cs', 'grain', 'vhs', 'aberr', 'shake'];
function currentPreset() {
  const sp = buildSpec(false), out = Object.fromEntries(PRESET_KEEP.filter(k => sp[k] !== undefined).map(k => [k, sp[k]]));
  if (out.vhs && typeof out.vhs === 'object') out.vhs = out.vhs.amount;
  const used = new Set([sp.capFont].concat(sp.scenes.map(s => s.kinetic && s.kinetic.font)).filter(Boolean));
  const fonts = (sp.fonts || []).filter(f => used.has(f.family)); if (fonts.length) out.fonts = fonts;
  out.__fx = Object.assign({}, proj.style.fx); return out;
}
$('#bSavePreset').onclick = async () => {
  const name = ($('#presetName').value || '').trim(); if (!name) return toast('Впишите название пресета');
  if (PRESETS[name]) return toast('Так называется встроенный пресет — выберите другое имя');
  USER_PRESETS[name] = currentPreset();
  try { const r = $('#stage').getBoundingClientRect(); const th = await api.captureRect({ x: r.x, y: r.y, width: r.width, height: r.height }); if (th) USER_PRESETS[name].__thumb = th; } catch (e) {}
  proj.style.custom.on = false; proj.style.trans = '';
  await api.saveUserPresets(USER_PRESETS); proj.style.preset = name; renderPresets(); fillStyle(); scheduleRebuild(50); toast('Пресет сохранён');
};
$('#bPresetExport').onclick = async () => {
  const k = proj.style.preset, data = USER_PRESETS[k] || (PRESETS[k] ? null : null) || currentPreset();
  const name = USER_PRESETS[k] ? k : ($('#presetName').value || '').trim() || 'мой-стиль';
  const p = await api.exportPreset(JSON.stringify({ lyricStudioPreset: 1, name, preset: data }, null, 1), name); if (p) toast('Пресет сохранён в файл');
};
$('#bPresetImport').onclick = async () => {
  const list = await api.importPreset(); if (!list) return; let n = 0, last = null;
  for (const it of list) {
    try { const j = JSON.parse(it.json), p = j.preset || j; if (typeof p !== 'object' || Array.isArray(p)) throw 0; let name = (j.name || it.name || 'пресет').slice(0, 40); while (PRESETS[name] || (USER_PRESETS[name] && JSON.stringify(USER_PRESETS[name]) !== JSON.stringify(p))) name += ' 2'; USER_PRESETS[name] = p; n++; last = name; }
    catch (e) { toastErr('Файл «' + it.name + '» не похож на пресет'); }
  }
  if (n) { await api.saveUserPresets(USER_PRESETS); proj.style.preset = last; renderPresets(); fillStyle(); scheduleRebuild(50); toast(n === 1 ? `Пресет «${last}» добавлен` : `Добавлено пресетов: ${n}`); }
};

// ---------- вкладки ----------
$$('.tabs').forEach(tb => tb.querySelectorAll('button').forEach(b => b.onclick = () => {
  tb.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  const panel = tb.parentElement; panel.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
  if (b.dataset.tab === 'words') renderWords();
}));

// ---------- история (отмена/повтор) ----------
let hist = [], hpos = -1, histTimer = null;
const snap = () => { const { assets, ...rest } = proj; return JSON.stringify(rest); };
function histReset() { hist = [snap()]; hpos = 0; updUndo(); }
function histCommit() { const s = snap(); if (s === hist[hpos]) return; hist = hist.slice(0, hpos + 1); hist.push(s); if (hist.length > 120) hist.shift(); hpos = hist.length - 1; updUndo(); }
function touch() { dirty = true; clearTimeout(histTimer); histTimer = setTimeout(histCommit, 400); updTitle(); }
function histGo(d) {
  clearTimeout(histTimer); histCommit(); const np = hpos + d; if (np < 0 || np >= hist.length) return;
  hpos = np; const keep = proj.assets; proj = JSON.parse(hist[hpos]); proj.assets = keep; dirty = true; $('#lyrics').value = proj.lyrics || '';
  if (sel >= proj.scenes.length) sel = Math.max(0, proj.scenes.length - 1); specCache = null;
  renderAll(); updUndo(); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildPreview, 60); toast(d < 0 ? 'Отменено' : 'Повторено', 900);
}
function updUndo() { $('#bUndo').disabled = hpos <= 0; $('#bRedo').disabled = hpos >= hist.length - 1; }
$('#bUndo').onclick = () => histGo(-1); $('#bRedo').onclick = () => histGo(1);

// ---------- проект, автосохранение, недавние ----------
function updTitle() { $('#projName').textContent = (projPath ? projPath.split(/[\\/]/).pop() : 'новый проект') + (dirty ? ' •' : ''); }
function renderAll() { renderStrip(); renderScene(); renderPresets(); fillStyle(); updTitle(); }
function applyProject(p, path) {
  proj = merge(newProject(), p); proj.style = merge(newProject().style, p.style || {}); proj.assets = p.assets || {}; proj.fonts = p.fonts || [];
  projPath = path || null; $('#lyrics').value = proj.lyrics; $('#alFrom').value = proj.alFrom; $('#alTo').value = proj.alTo; $('#audioName').textContent = proj.audioName || 'не выбран';
  sel = 0; specCache = null; beatInfo = null; $('#bpmLabel').textContent = ''; registerFonts();
}
async function afterLoad() {
  if (proj.audioPath) { try { await loadAudio({ path: proj.audioPath, name: proj.audioName }); } catch (e) { audio.removeAttribute('src'); audioData = null; toast('Трек не найден по старому пути — выберите его заново', 4500); } }
  renderAll(); Timeline.fit(); histReset(); dirty = false; updTitle(); rebuildPreview();
}
async function saveProject(as) {
  proj.lyrics = $('#lyrics').value;
  const p = await api.saveProject(JSON.stringify(proj), (proj.audioName || 'проект').replace(/\.[^.]+$/, '') + '.lsp', as ? null : projPath);
  if (p) { projPath = p; dirty = false; updTitle(); api.clearAutosave(); toast('Сохранено'); }
}
async function openProject(path) {
  if (dirty && proj.words.length && !confirm('Текущий проект не сохранён. Открыть другой?')) return;
  const r = await api.openProject(path); if (!r) return;
  let p; try { p = JSON.parse(r.json); } catch (e) { return toastErr('Файл проекта повреждён'); }
  applyProject(p, r.path); await afterLoad();
}
$('#bNew').onclick = () => { if (dirty && proj.words.length && !confirm('Начать новый проект? Несохранённые изменения пропадут.')) return; applyProject(newProject(), null); audio.removeAttribute('src'); audioData = null; $('#alignStatus').textContent = ''; renderAll(); Timeline.fit(); histReset(); dirty = false; updTitle(); rebuildPreview(); };
$('#bSave').onclick = () => saveProject(false);
$('#bOpen').onclick = async e => {
  e.stopPropagation(); const m = $('#openMenu'); if (!m.hidden) { m.hidden = true; return; }
  const rec = await api.recent();
  m.innerHTML = `<button data-p="">Открыть файл…</button>` + (rec.length ? '<div class="msep">Недавние</div>' + rec.map(r => `<button data-p="${esc(r.path)}" title="${esc(r.path)}">${esc(r.name)}<span class="muted small"> · ${new Date(r.time).toLocaleDateString('ru-RU')}</span></button>`).join('') : '');
  m.querySelectorAll('button').forEach(b => b.onclick = () => { m.hidden = true; openProject(b.dataset.p || undefined); }); m.hidden = false;
};
$('#bHelp').onclick = e => { e.stopPropagation(); const m = $('#helpMenu'); m.hidden = !m.hidden; };
document.addEventListener('click', () => { $('#openMenu').hidden = true; $('#helpMenu').hidden = true; });
$$('#helpMenu button').forEach(b => b.onclick = () => {
  const a = b.dataset.act; $('#helpMenu').hidden = true;
  if (a === 'keys') $('#keysModal').hidden = false; else if (a === 'report') copyReport(); else if (a === 'logs') api.openLogFolder(); else if (a === 'update') checkUpdate(true);
});
setInterval(() => { if (dirty && (proj.words.length || proj.lyrics)) { proj.lyrics = $('#lyrics').value; api.autosave(JSON.stringify(proj)).catch(() => {}); } }, 15000);
window.__beforeClose = async () => {
  if (dirty && (proj.words.length || proj.lyrics)) { proj.lyrics = $('#lyrics').value; try { await api.autosave(JSON.stringify(proj)); } catch (e) {} }
  else { try { await api.clearAutosave(); } catch (e) {} }
  return true;
};
$('#lyrics').addEventListener('input', () => { proj.lyrics = $('#lyrics').value; touch(); });

// ---------- баннер ----------
function banner(text, btns) {
  $('#bannerText').innerHTML = text; const bb = $('#bannerBtns'); bb.innerHTML = '';
  (btns || []).forEach(([label, fn, cls]) => { const b = document.createElement('button'); b.textContent = label; b.className = cls || ''; b.onclick = fn; bb.append(b); });
  $('#banner').hidden = false; document.body.classList.add('hasBanner'); setTimeout(fitStage, 10);
}
const hideBanner = () => { $('#banner').hidden = true; document.body.classList.remove('hasBanner'); setTimeout(fitStage, 10); };

// ---------- обновления ----------
async function checkUpdate(manual) {
  let info = null; try { info = await api.checkUpdate(); } catch (e) { if (manual) toast('Не удалось проверить обновления: ' + e.message, 4000); return; }
  if (!info) { if (manual) toast('У вас последняя версия'); return; }
  banner(`Доступна новая версия <b>${esc(info.version)}</b>.`, [['Обновить', () => installUpdate(info), 'primary'], ['Что нового', () => api.openExternal(info.page)], ['Позже', hideBanner, 'ghost']]);
}
async function installUpdate(info) {
  banner('Скачиваю обновление…', []);
  try {
    const r = await api.installUpdate(info, t => { $('#bannerText').textContent = t; });
    if (r.portable) banner(`Новая версия скачана рядом с программой: <b>${esc(r.path.split(/[\\/]/).pop())}</b>. Закройте эту и запустите новую — проекты и пресеты сохранятся.`, [['Показать файл', () => api.showFile(r.path)], ['Ок', hideBanner, 'ghost']]);
    else banner('Запускаю установщик… Программа закроется, после установки откройте её снова.', []);
  } catch (e) { banner('Не удалось скачать обновление: ' + esc(e.message), [['Ещё раз', () => installUpdate(info)], ['Закрыть', hideBanner, 'ghost']]); api.log('error', 'обновление: ' + e.message); }
}

// ---------- экспорт ----------
let exporting = false;
const segOn = id => $$(id + ' button').find(b => b.classList.contains('on'));
$$('#exportModal .seg').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); exportInfo(); }));
$('#xDraft').onchange = exportInfo;
$$('#xPlat button').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.v; if (!v) return;
  if (proj.style.format !== '9:16') { proj.style.format = '9:16'; fillStyle(); scheduleRebuild(50); }
  $$('#xRes button').forEach(x => x.classList.toggle('on', x.dataset.v === '1080')); $$('#xCont button').forEach(x => x.classList.toggle('on', x.dataset.v === 'mp4'));
  $('#safeSel').value = v; drawSafe(); exportInfo();
}));
function exportOpts() {
  const draft = $('#xDraft').checked, cont = segOn('#xCont').dataset.v;
  return { draft, container: cont, res: draft ? 360 : +segOn('#xRes').dataset.v, fps: draft ? 15 : +segOn('#xFps').dataset.v };
}
function exportInfo() {
  const o = exportOpts(), d = (+proj.style.end || proj.duration) - (+proj.style.start || 0), [W, H] = FMT[proj.style.format];
  const w = W >= H ? Math.round(o.res * W / H / 2) * 2 : o.res, h = Math.round(w * H / W / 2) * 2, plat = segOn('#xPlat').dataset.v;
  $('#xAlphaHint').hidden = o.container === 'mp4';
  $('#xInfo').innerHTML = `Длина ${d.toFixed(1)} с · ${proj.scenes.length} сцен · ${w}×${h} · ${o.fps} кадров/с · ${Math.round(d * o.fps)} кадров` + (plat ? `<br>${SAFE[plat].name}: вертикальное 1080×1920. Включены зоны интерфейса на превью — держите текст вне красных областей.` : '') + (o.res >= 2160 && !o.draft ? '<br>4K рендерится в несколько раз дольше 1080p.' : '');
}
$('#bExport').onclick = () => {
  if (!proj.words.length || !proj.audioPath) return toast('Сначала трек, текст и синхронизация');
  exportInfo(); $('#xBar').style.width = '0'; $('#xStatus').textContent = ''; $('#xStatus').className = 'status'; $('#xShow').hidden = true; $('#exportModal').hidden = false;
};
$('#xClose').onclick = () => { if (!exporting) $('#exportModal').hidden = true; };
$('#xCancel').onclick = () => api.cancelExport();
$('#xShow').onclick = () => lastExportPath && api.showFile(lastExportPath);
$('#xGo').onclick = async () => {
  await ensureSpectrum(); const o = exportOpts(), alpha = o.container !== 'mp4';
  const spec = buildSpec(true, { transparent: alpha }), [W, H] = FMT[proj.style.format];
  exporting = true; $('#xGo').disabled = true; $('#xCancel').hidden = false; $('#xShow').hidden = true; const st = $('#xStatus'); st.className = 'status';
  try {
    const r = await api.exportVideo({ html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? Math.round(o.res * W / H / 2) * 2 : o.res, start: +spec.start, end: +spec.end, fade: +spec.fade, audioPath: proj.audioPath,
      fps: o.fps, draft: o.draft, container: o.container, name: (proj.audioName || 'video').replace(/\.[^.]+$/, '') + (o.draft ? '-черновик' : '') },
      p => { $('#xBar').style.width = Math.round(p.frac * 100) + '%'; st.textContent = p.text; });
    if (r && r.ok) { st.className = 'status ok'; st.textContent = 'Готово: ' + r.path; $('#xBar').style.width = '100%'; lastExportPath = r.path; $('#xShow').hidden = false; }
    else st.textContent = r && r.cancelled ? 'Отменено' : 'Не сохранено';
  } catch (e) { st.className = 'status err'; st.innerHTML = 'Ошибка: ' + esc(e.message || e) + ' <button class="small" id="xRep">Скопировать отчёт</button>'; $('#xRep').onclick = copyReport; }
  exporting = false; $('#xGo').disabled = false; $('#xCancel').hidden = true;
};

// ---------- горячие клавиши ----------
document.addEventListener('keydown', e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !(document.activeElement.type === 'range' || document.activeElement.type === 'checkbox');
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), code = e.code;
  if (mod && code === 'KeyS') { e.preventDefault(); saveProject(e.shiftKey); return; }
  if (mod && code === 'KeyO') { e.preventDefault(); openProject(); return; }
  if (mod && code === 'KeyE') { e.preventDefault(); $('#bExport').click(); return; }
  if (!$('#exportModal').hidden || !$('#gallery').hidden || !$('#keysModal').hidden) { if (e.key === 'Escape') { $('#gallery').hidden = true; $('#keysModal').hidden = true; if (!exporting) $('#exportModal').hidden = true; } return; }
  if (inField) return;
  if (mod && code === 'KeyZ') { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); return; }
  if (mod && code === 'KeyY') { e.preventDefault(); histGo(1); return; }
  if (mod) return;
  if (code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (code === 'ArrowLeft' || code === 'ArrowRight') { e.preventDefault(); seekTo(curT() + (code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
  else if (code === 'ArrowUp') { e.preventDefault(); selectScene(sel - 1, true); }
  else if (code === 'ArrowDown') { e.preventDefault(); selectScene(sel + 1, true); }
  else if (code === 'Home') { e.preventDefault(); seekTo(+proj.style.start || 0); }
  else if (code === 'KeyS') { e.preventDefault(); splitScene(curT()); }
  else if (code === 'KeyM') { e.preventDefault(); mergeNext(); }
  else if (code === 'KeyG') { e.preventDefault(); openGallery(); }
  else if (e.key === '?') { $('#keysModal').hidden = false; }
});

// ---------- таймлайн ----------
Timeline.init($('#timeline'), {
  proj: () => proj, env: () => beatInfo, beats: () => beatInfo, time: () => curT(), seek: t => seekTo(t),
  range: () => [+proj.style.start || 0, +proj.style.end || proj.duration || 10],
  changed: (kind, live) => { if (kind === 'scenes') { renderStrip(); renderScene(); scheduleRebuild(250); } else if (kind === 'scenes-done') { scheduleRebuild(60); } else scheduleRebuild(live ? 400 : 120); },
  select: i => { sel = i; renderStrip(); renderScene(); }, selected: () => sel, playing: () => playing, snap: () => $('#snapBeats').checked
});
$('#tlFit').onclick = () => Timeline.fit();

// ---------- старт ----------
(async function init() {
  ENGINE = await (await fetch('engine.html')).text();
  PRESETS = await (await fetch('presets.json')).json();
  try { USER_PRESETS = (await api.loadUserPresets()) || {}; } catch (e) { USER_PRESETS = {}; }
  try { const v = await api.version(); $('#verLabel').textContent = 'Версия ' + v.version + (v.portable ? ' · portable' : ''); } catch (e) {}
  renderAll(); histReset(); dirty = false; updTitle(); rebuildPreview(); loop();
  window.__ls = { get proj() { return proj; }, set proj(v) { proj = v; }, loadAudio, renderAll, rebuildPreview, buildSpec, engineHTML, autoScenes, autoRange, seek, seekTo, ensureSpectrum, analyzeBeats, get beatInfo() { return beatInfo; }, histGo, applyProject, afterLoad, currentPreset, splitScene, touch, scheduleRebuild };
  try {
    const a = await api.loadAutosave();
    if (a && a.json) { const p = JSON.parse(a.json); if ((p.words && p.words.length) || p.lyrics) banner(`Найден несохранённый проект от ${new Date(a.time).toLocaleString('ru-RU')}${p.audioName ? ' («' + esc(p.audioName) + '»)' : ''}.`, [['Восстановить', async () => { hideBanner(); applyProject(p, null); await afterLoad(); dirty = true; updTitle(); }, 'primary'], ['Не нужно', () => { hideBanner(); api.clearAutosave(); }, 'ghost']]); }
  } catch (e) {}
  setTimeout(() => { if ($('#banner').hidden) checkUpdate(false); }, 4000);
})();
