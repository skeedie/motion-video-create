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
var PROFILE = {};
// поля-картинки, где на экране «я» — туда подставляется аватарка из профиля
const ME_IMG = { server: 'img', 'vc-sheet': 'img', 'vc-list': 'img', post: 'img', story: 'img' };
function defaultOf(t, fd) {
  if (fd.def === 'melhor' && PROFILE.nick) return PROFILE.nick;
  if (fd.type === 'image' && ME_IMG[t.id] === fd.k && PROFILE.avatar) return PROFILE.avatar;
  return fd.def;
}
let ENGINE = '', PRESETS = {}, USER_PRESETS = {};
let proj = newProject(), sel = 0, audioUrl = null, audioData = null, specCache = null, beatInfo = null, playing = false, rebuildTimer = null, frameReady = false;
let projPath = null, dirty = false, lastExportPath = null, msel = new Set([0]), clip = null, USER_TPL = {};
const audio = new Audio();

function newProject() {
  return { version: 2, audioPath: '', audioName: '', lyrics: '', bpm: null, alFrom: '', alTo: '', words: [], duration: 0, perScene: 2, scenes: [], assets: {}, fonts: [],
    style: { preset: 'melhor-lenta', format: '9:16', start: 0, end: 0, artist: PROFILE.nick || 'melhor', title: '', wm: PROFILE.nick || 'melhor', wmOp: 0.2, wmImg: '', hook: '', hookDur: 2.5,
      sfx: { on: false, vol: 0.7, trans: true, events: true, acc: true }, part: '', partColor: '#ffffff', beat: null, smokeOn: false, smokeA: '#78aa78', smokeB: '#9678c8', lead: null, fade: 1.2, fadeIn: 0.3, fadeCurve: 'smooth', quant: 4, vfade: false, trim: { auto: true, cutOn: true, cutGap: 6 }, cuts: [],
      trans: '', custom: { on: false, theme: 'cards', bgType: 'gradient', bg1: '#F6F5F3', bg2: '#E4DAFF', font: 'Inter Display', accent: '#E10600', tilt: 3 },
      fx: { grain: 0, vhs: 0, aberr: 0, shake: 0 }, bgMedia: null, adlibs: 'chip',
      intro: { on: false, title: '', label: '', dur: 2.5 }, outro: { on: false, text: 'слушай везде', sub: 'ссылка в профиле', dur: 3 } } };
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
function sceneCtx(sc, lo = 0, hi = null) {
  const inl = proj.style.adlibs === 'inline', all = proj.words.slice(sc.a, sc.b).map((w, i) => Object.assign({ gi: sc.a + i }, w)).filter(w => inl || !w.adlib);
  hi = hi == null ? all.length : hi; const ws = all.slice(lo, hi), n = ws.length, groups = [];
  ws.forEach((w, i) => { const g = groups[groups.length - 1]; if (g && g.line === w.line) g.b = i + 1; else groups.push({ line: w.line, a: i, b: i + 1 }); });
  const parts = of => {
    if (groups.length >= of) { const per = groups.length / of, out = []; for (let k = 0; k < of; k++) { const g0 = groups[Math.round(k * per)], g1 = groups[Math.round((k + 1) * per) - 1]; out.push([g0.a, g1.b]); } return out; }
    const out = []; for (let k = 0; k < of; k++) out.push([Math.round(k * n / of), Math.round((k + 1) * n / of)]); return out;
  };
  return {
    n, all: lo === 0 && hi === all.length ? '$line' : `$line[${lo}:${hi}]`,
    part: (k, of) => { const p = parts(of)[k]; return p[1] > p[0] ? `$line[${p[0] + lo}:${p[1] + lo}]` : ''; },
    at: (k, of) => n ? ws[Math.min(n - 1, parts(of)[k][0])].gi : sc.a,
    word: i => n ? ws[Math.max(0, Math.min(n - 1, i))].gi : sc.a
  };
}
// где делить сцену между двумя карточками: по строкам, иначе пополам
function splitPoint(sc) { const inl = proj.style.adlibs === 'inline', ws = proj.words.slice(sc.a, sc.b).filter(w => inl || !w.adlib); if (ws.length < 2) return 0; const lines = [...new Set(ws.map(w => w.line))]; if (lines.length >= 2) { const half = lines[Math.ceil(lines.length / 2)]; return ws.findIndex(w => w.line === half); } return Math.ceil(ws.length / 2); }
function sceneText(sc) { return proj.words.slice(sc.a, sc.b).map(w => w.w).join(' '); }

// ---------- сборка SPEC для движка ----------
function bgCss(c) {
  if (c.bgType === 'solid') return c.bg1;
  if (c.bgType === 'radial') return `radial-gradient(ellipse 80% 60% at 50% 45%,${c.bg2} 0%,${c.bg1} 75%)`;
  if (c.bgType === 'grid') return `repeating-linear-gradient(0deg,${c.bg2}66 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,${c.bg2}66 0 1px,transparent 1px 32px),${c.bg1}`;
  return `linear-gradient(180deg,${c.bg1} 0%,${c.bg2} 100%)`;
}
function fieldsOf(sc, second) { const t = TPL[second ? sc.tpl2 : sc.tpl] || TPL.chat, f = Object.assign({}, defFields(t), second ? sc.f2 : sc.f); for (const fd of t.fields) if (fd.type === 'image') f[fd.k] = asset(f[fd.k]); return f; }
const deepAssets = o => { if (typeof o === 'string') return o.startsWith('asset:') ? asset(o) : o; if (Array.isArray(o)) return o.map(deepAssets); if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = deepAssets(o[k]); return r; } return o; };
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
  const DB = st.barSnap ? downbeats() : null;
  spec.scenes = proj.scenes.map(sc => {
    const t = TPL[sc.tpl] || TPL.chat, f = fieldsOf(sc), two = sc.tpl2 && TPL[sc.tpl2], sp = two ? splitPoint(sc) : 0, cx = two && sp ? sceneCtx(sc, 0, sp) : sceneCtx(sc);
    let out = {}; try { out = deepAssets(t.make(f, cx) || {}); } catch (e) { console.error(e); }
    if (two) { try { const o2 = deepAssets(TPL[sc.tpl2].make(fieldsOf(sc, true), sp ? sceneCtx(sc, sp) : sceneCtx(sc)) || {}); if (o2.widget) out.widget2 = o2.widget; } catch (e) { console.error(e); } }
    const s = Object.assign({ words: [sc.a, sc.b] }, out);
    if (sc.scale && s.widget) s.widget.scale = +sc.scale;
    const punch = [].concat(out.punch || []);
    const inSc = v => v !== '' && v != null && +v >= sc.a && +v < sc.b; // слово акцента может оказаться в соседней сцене (после правки границ) — тогда «авто»
    if (s.widget && inSc(sc.bump)) punch.push({ word: '·', at: +sc.bump, style: 'bump' });
    if (s.widget && sc.stamp) punch.push({ word: sc.stamp, at: inSc(sc.stampAt) ? +sc.stampAt : cx.word(cx.n - 2), style: 'stamp', color: '#16A34A', top: 12, right: 20, size: 26, rot: -9 });
    const fxs = [];
    if (sc.fx) fxs.push({ type: 'emoji', emoji: sc.fx, at: inSc(sc.fxAt) ? +sc.fxAt : cx.word(0), dir: 'up', front: false, n: 12 });
    // дополнительные акценты сцены: сколько угодно подпрыгиваний, штампов и эмодзи, каждый на своём слове
    let stampN = sc.stamp ? 1 : 0;
    (sc.accents || []).forEach(a => { const at = a.at !== '' && a.at != null && +a.at >= sc.a && +a.at < sc.b ? +a.at : null;
      if (a.k === 'bump') { if (s.widget && at != null) punch.push({ word: '·', at, style: 'bump' }); }
      else if (a.k === 'stamp') { if (s.widget && a.v) { punch.push({ word: a.v, at: at ?? cx.word(cx.n - 1), style: 'stamp', color: a.color || '#16A34A', top: 12 + 74 * stampN, right: 20 + 46 * (stampN % 2), size: 26, rot: stampN % 2 ? 7 : -9 }); stampN++; } }
      else if (a.k === 'fx') { if (a.v) fxs.push({ type: 'emoji', emoji: a.v, at: at ?? cx.word(0), dir: 'up', front: false, n: 12 }); } });
    if (punch.length) s.punch = punch; else delete s.punch;
    if (fxs.length) s.fx = fxs.length === 1 ? fxs[0] : fxs;
    if (s.kinetic && c.on && !s.kinetic.accent) s.kinetic.accent = c.accent;
    if (sc.trans) s.trans = sc.trans; if (sc.cam) s.cam = sc.cam;
    ['dx', 'dy', 'dx2', 'dy2', 'k2scale'].forEach(k => { if (sc[k]) s[k] = sc[k]; });
    if (st.barSnap && DB && proj.words[sc.a] && sc !== proj.scenes[0]) { const t = proj.words[sc.a].t, c2 = DB.filter(d => d <= t - .05 && d >= t - .9).pop() ?? (beatInfo ? beatInfo.beats.filter(b => b <= t - .05 && b >= t - .55).pop() : null); if (c2 != null) s.t0 = +s2o(c2, activeCuts(...effRange())).toFixed(3); }
    return s;
  });
  const qT = quantizer(); let prevT = -1;
  spec.words = proj.words.map(w => { let t = qT(w.t, w.e); if (t < prevT) t = Math.max(w.t, prevT); prevT = t; const o = { w: w.w, t, e: w.e, line: w.line }; if (w.adlib) o.adlib = true; if (w.acc) o.acc = w.acc; return o; });
  spec.adlibs = st.adlibs || 'chip';
  const bm = st.bgMedia; if (bm && (bm.asset || bm.path)) spec.bgMedia = { type: bm.type, src: bm.type === 'video' ? api.mediaUrl(bm.path) : asset('asset:' + bm.asset), blur: +bm.blur || 0, dim: +bm.dim || 0, zoom: bm.zoom ? 0.12 : 0 };
  const lastE = proj.words.length ? proj.words[proj.words.length - 1].e : spec.end, [srcA, srcB] = effRange(), cuts = activeCuts(srcA, srcB), O = t => s2o(t, cuts);
  spec.start = srcA; spec.end = O(srcB); spec._srcA = srcA; spec._srcB = srcB; spec._cuts = cuts;
  if (cuts.length) { spec.words.forEach(w => { w.t = +O(w.t).toFixed(3); w.e = +O(w.e).toFixed(3); }); }
  if (st.intro && st.intro.on && proj.words.length) spec.intro = { t0: srcA, title: st.intro.title || st.title || (proj.audioName || '').replace(/\.[^.]+$/, ''), artist: st.artist, label: st.intro.label || undefined };
  if (st.outro && st.outro.on && proj.words.length) spec.outro = { t0: O(Math.min(+st.end || proj.duration, lastE + .35)), text: st.outro.text || 'слушай везде', sub: st.outro.sub, artist: st.artist };
  spec.fade = +st.fade || 0;
  if (st.vfade) spec.vfade = { in: +st.fadeIn || 0, out: +st.fade || 0 };
  spec.duration = proj.duration;
  if (specCache && spec.spectrum !== false) spec.spec = specCache.data;
  if (beatInfo && beatInfo.beats) spec.beats = beatInfo.beats.filter(b => b >= srcA - 1 && b <= srcB + 1 && !cuts.some(c => b > c.a && b < c.b)).map(b => +O(b).toFixed(3));
  if (st.hook && st.hook.trim()) spec.hook = { text: st.hook.trim(), t0: +spec.start, t1: +spec.start + (+st.hookDur || 2.5) };
  if (fx.energy && beatInfo) spec.energy = energyCurve(+spec.start, +spec.end, cuts);
  if ((proj.stickers || []).length) spec.stickers = proj.stickers.map(x => Object.assign({}, x, { value: x.type === 'image' ? asset(x.value) : x.value, t0: +O(x.t0).toFixed(3), t1: +O(x.t1).toFixed(3) }));
  if (+fx.tilt3d > 0) spec.tilt3d = +fx.tilt3d;
  if (opts.lite) spec.lite = true;
  if (opts.transparent) spec.transparent = true;
  return spec;
}
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const defFields = t => Object.fromEntries(t.fields.map(x => [x.k, defaultOf(t, x)]));

// Текст песни и поля сцен — данные, а не разметка и не код:
//  · «<» перед буквой в них экранируется, иначе строка вроде «a<b» съедалась как тег;
//  · скрипт движка получает одноразовую метку (nonce), и политика страницы не исполняет ничего другого —
//    чужой проект, пресет или шаблон не может выполнить свой код в окне редактора.
function engineHTML(spec, base) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const json = JSON.stringify(spec, (k, v) => typeof v === 'string' && v.indexOf('<') >= 0 && !v.startsWith('data:') ? v.replace(/<(?=[a-zA-Z\/!?])/g, '&lt;') : v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return ENGINE.replace('<script>', () => `<script nonce="${nonce}">`)
    .replace('<head>', () => `<head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'; object-src 'none'">${base ? `<base href="${base}">` : ''}<script nonce="${nonce}">window.onerror=(m)=>{ if(!/ResizeObserver loop/.test(String(m))) window.__err=String(m) }<\/script><link rel="stylesheet" href="fonts.css">`)
    .replace('/*SPEC*/', () => 'window.SPEC=' + json + ';');
}

// вырезанные проигрыши: время трека (исходное) ↔ время ролика
function activeCuts(a, b) { return (proj.style.cuts || []).filter(c => c.on !== false && c.b > a && c.a < b).map(c => ({ a: Math.max(a, c.a), b: Math.min(b, c.b) })).sort((x, y) => x.a - y.a); }
function s2o(t, cuts) { let r = t; for (const c of cuts) { if (t >= c.b) r -= c.b - c.a; else if (t > c.a) r -= t - c.a; } return r; }
function o2s(u, cuts) { let t = u; for (const c of cuts) if (t >= c.a) t += c.b - c.a; return t; }
let CUTS = [];
// фактический отрезок ролика с учётом интро и аутро
function effRange() {
  const st = proj.style; let a = +st.start || 0, b = +st.end || proj.duration || 0;
  if (proj.words.length && st.intro && st.intro.on) a = Math.max(0, a - (+st.intro.dur || 2.5));
  if (proj.words.length && st.outro && st.outro.on) { const lastE = proj.words[proj.words.length - 1].e; b = Math.min(proj.duration || 1e9, Math.min(b, lastE + .35) + (+st.outro.dur || 3)); }
  return [a, b];
}
// ---------- спектр и биты ----------
async function ensureSpectrum() {
  if (!audioData) return;
  const [t0, t1] = effRange(), cuts = activeCuts(t0, t1), key = t0 + ':' + t1 + JSON.stringify(cuts);
  if (specCache && specCache.key === key) return;
  if (!cuts.length) { specCache = { key, data: Spectrum.spectrum(audioData.mono, audioData.sr, t0, t1, 30) }; return; }
  const sr = audioData.sr, parts = []; let pos = t0; for (const c of cuts) { parts.push([pos, c.a]); pos = c.b; } parts.push([pos, t1]);
  const len = parts.reduce((s, [a, b]) => s + Math.max(0, Math.floor((b - a) * sr)), 0), cat = new Float32Array(len); let o = 0;
  for (const [a, b] of parts) { const seg = audioData.mono.subarray(Math.floor(a * sr), Math.floor(b * sr)); cat.set(seg, o); o += seg.length; }
  const d = Spectrum.spectrum(cat, sr, 0, len / sr, 30); d.t0 = t0; specCache = { key, data: d };
}
// биты: сразу — быстрым алгоритмом, затем точнее — нейросетью Beat This! (ответ сети запоминается для этого трека)
let netAct = null, netActPath = '', netBusy = false;
function analyzeBeats() {
  if (!audioData) { showBpm(); return; }
  let dsp = null; try { dsp = Beats.detect(audioData.mono, audioData.sr, { bpm: proj.bpm || undefined }); } catch (e) { api.log('warn', 'биты: ' + e.message); }
  beatInfo = dsp;
  if (netAct && netActPath === proj.audioPath) { try { const nb = Beats.fromNet(netAct.beat, netAct.down, netAct.fps, { bpm: proj.bpm || undefined }, dsp || {}); if (nb) beatInfo = nb; } catch (e) { api.log('warn', 'биты нейросети: ' + e.message); } }
  showBpm(); Timeline.invalidate();
}
async function loadNetBeats() {
  const p = proj.audioPath; if (!p || !api.netBeats || netActPath === p || netBusy) return;
  netBusy = true; showBpm();
  try { const r = await api.netBeats({ audioPath: p }); if (proj.audioPath === p && r) { netAct = r; netActPath = p; specCache = null; analyzeBeats(); scheduleRebuild(50); } }
  catch (e) { api.log('warn', 'биты нейросетью: ' + (e.message || e)); }
  netBusy = false; showBpm();
}
function showBpm() {
  $('#bpmLabel').textContent = beatInfo ? `${beatInfo.bpm} BPM · ${beatInfo.beats.length} битов` : '';
  if (document.activeElement !== $('#bpmIn')) $('#bpmIn').value = beatInfo ? beatInfo.bpm : (proj.bpm || '');
  $('#bpmMode').textContent = proj.bpm ? 'вручную' : netBusy ? 'нейросеть…' : beatInfo && beatInfo.neural ? 'нейросеть' : beatInfo ? 'авто' : '';
  $('#bpmMode').title = beatInfo && beatInfo.neural ? 'Темп и сильные доли определила нейросеть Beat This!' : netBusy ? 'Нейросеть уточняет биты…' : '';
}
// поменять темп: сетка битов пересчитывается под заданный темп, от неё зависят обрезка, смена сцен и «подтягивание» слов
function setBpm(v) {
  v = v ? Math.max(40, Math.min(240, +(+v).toFixed(1))) : null; proj.bpm = v; specCache = null; analyzeBeats(); touch();
  if (proj.words.length && proj.style.trim.auto) autoTrim(true); scheduleRebuild(50);
  toast(v ? `Темп ${v} BPM — сетка битов пересчитана` : `Темп определён заново: ${beatInfo ? beatInfo.bpm : '—'} BPM`);
}
$('#bpmIn').onchange = e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (v >= 40 && v <= 240) setBpm(v); else showBpm(); };
$('#bpmHalf').onclick = () => beatInfo && setBpm(beatInfo.bpm / 2 >= 40 ? beatInfo.bpm / 2 : beatInfo.bpm);
$('#bpmDbl').onclick = () => beatInfo && setBpm(beatInfo.bpm * 2 <= 240 ? beatInfo.bpm * 2 : beatInfo.bpm);
$('#bpmAutoBtn').onclick = () => setBpm(null);
$('#bpmLabel').onclick = () => { document.querySelector('#left .tabs button[data-tab=track]').click(); $('#bpmIn').focus(); $('#bpmIn').select(); };
let taps = [], tapT = null;
$('#bpmTap').onclick = () => {
  const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; taps.push(now); taps = taps.slice(-9);
  if (taps.length >= 2) { const per = (taps[taps.length - 1] - taps[0]) / (taps.length - 1) / 1000; $('#bpmIn').value = (60 / per).toFixed(1); $('#bpmMode').textContent = `простукивание · ${taps.length}`; }
  clearTimeout(tapT); tapT = setTimeout(() => { if (taps.length >= 4) { const per = (taps[taps.length - 1] - taps[0]) / (taps.length - 1) / 1000; taps = []; setBpm(60 / per); } else { taps = []; showBpm(); } }, 1600);
};
// слово, спетое рядом с долей бита, показывается ровно в долю (не дальше 60 мс)
function quantizer() {
  const div = +proj.style.quant || 0; if (!div || !beatInfo || beatInfo.beats.length < 4) return t => t; const B = beatInfo.beats;
  return (t, e) => {
    let lo = 0, hi = B.length - 1; if (t < B[0] || t > B[hi]) return t;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    const step = (B[hi] - B[lo]) / div, k = Math.round((t - B[lo]) / step), g = B[lo] + k * step, tol = Math.min(.06, step * .3);
    return Math.abs(g - t) <= tol && (e == null || g < e - .04) ? +g.toFixed(3) : t;
  };
}

// громкость трека 10 раз в секунду, сглаженная за 2 с и нормированная 0..1 (для «энергии» и лучшего куска)
function loudness(fps = 10) {
  if (!beatInfo) return null; const e = beatInfo.env, step = beatInfo.fps / fps, n = Math.floor(e.length / step), raw = new Float32Array(n), K = Math.max(1, Math.round(step));
  for (let i = 0; i < n; i++) { let s = 0; const o = Math.floor(i * step); for (let k = 0; k < K; k++) { const v = e[o + k] || 0; s += v * v; } raw[i] = Math.sqrt(s / K); }
  const W = fps, sm = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = i - W; k <= i + W; k++) if (k >= 0 && k < n) { s += raw[k]; c++; } sm[i] = s / c; }
  const srt = [...sm].sort((a, b) => a - b), lo = srt[Math.floor(n * .1)] || 0, hi = srt[Math.floor(n * .97)] || 1;
  return { fps, data: sm.map(v => Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)))) };
}
function energyCurve(t0, t1, cuts = []) { const L = loudness(10); if (!L) return undefined; const out = []; for (let u = t0; u <= t1; u += .1) { const k = Math.round(o2s(u, cuts) * 10); out.push(+(L.data[Math.min(L.data.length - 1, Math.max(0, k))] || 0).toFixed(3)); } return { fps: 10, t0, data: out }; }
function bestClip(len) {
  const L = loudness(10); if (!L || !proj.words.length) return toast('Нужны трек и синхронизированные слова');
  const lines = []; proj.words.forEach((w, i) => { const g = lines[lines.length - 1]; if (g && g.line === w.line) { g.e = w.e; g.b = i + 1; } else lines.push({ line: w.line, t: w.t, e: w.e, a: i, b: i + 1 }); });
  const sig = {}; lines.forEach(g => { g.sig = normTxt(proj.words.slice(g.a, g.b).map(w => w.w).join(' ')); sig[g.sig] = (sig[g.sig] || 0) + 1; });
  const avg = (a, b) => { let s = 0, c = 0; for (let k = Math.floor(a * 10); k < Math.ceil(b * 10) && k < L.data.length; k++) { s += L.data[k]; c++; } return c ? s / c : 0; };
  let best = null;
  lines.forEach((g, i) => {
    const st = Math.max(0, g.t - .3); let en = st + len, last = null;
    for (let j = i; j < lines.length && lines[j].e <= st + len + 1.5; j++) last = lines[j];
    if (last) en = Math.min(proj.duration || 1e9, last.e + .4); if (en - st < len * .7) return;
    const inWin = lines.filter(x => x.t >= st && x.e <= en), chorus = inWin.length ? inWin.filter(x => sig[x.sig] > 1).length / inWin.length : 0;
    const score = avg(st, en) + .25 * chorus + (i === 0 ? -.05 : 0);
    if (!best || score > best.score) best = { st, en, score };
  });
  if (!best) return toast('Трек короче выбранной длины');
  proj.style.start = +best.st.toFixed(2); proj.style.end = +best.en.toFixed(2); specCache = null; fillStyle(); Timeline.fit(); scheduleRebuild(50);
  toast(`Выбран кусок ${fmtT(best.st)}–${fmtT(best.en)} (${(best.en - best.st).toFixed(1)} с)`, 3000);
}
const EMO_MAP = [[/деньг|бабк|бабл|кэш|кеш|лаве|бабос|доллар|руб/, '💸'], [/люб|сердц|целу/, '❤️'], [/огонь|огне|жар|гор(ит|ю|им)|пожар/, '🔥'], [/дым|курю|дуть|дунул|сипнул|затяг|кальян/, '💨'],
  [/слез|плач|грус|больно/, '😢'], [/смех|смеш|ржу|ахах/, '😂'], [/ноч|луна|луну/, '🌙'], [/звезд|звёзд/, '✨'], [/сон|сплю|спать|проснул/, '😴'], [/тачк|машин|гоню/, '🚗'],
  [/пиво|выпил|бутыл|бокал|шампан/, '🍾'], [/трав|шишк|лист|зелен/, '🌿'], [/сироп|лин\b|линчик/, '💜'], [/бомб|взрыв/, '💣'], [/корон|корол|царь/, '👑'], [/черт|чёрт|ад\b|дьявол/, '😈'],
  [/телефон|звон|трубк/, '📱'], [/музык|трек|бит\b|песн/, '🎵'], [/холод|снег|мороз|лёд|лед\b/, '❄️'], [/дожд|ливен/, '🌧️'], [/смерт|умер|умру|мёртв|мертв/, '💀'], [/глаз|смотр/, '👀']];
function onsetAt(t) { if (!beatInfo) return 0; const e = beatInfo.env, k = Math.round(t * beatInfo.fps); return Math.max(0, (e[k] || 0) - (e[k - 3] || 0)) + Math.max(0, (e[k + 2] || 0) - (e[k - 1] || 0)); }
function autoAccents() {
  if (!proj.scenes.length) return toast('Сначала синхронизируйте слова'); let n = 0;
  proj.scenes.forEach(sc => {
    const t = TPL[sc.tpl] || {}, ids = []; for (let i = sc.a + 1; i < sc.b; i++) if (!proj.words[i].adlib) ids.push(i);
    if (!t.nocard && (sc.bump === '' || sc.bump == null) && ids.length) { let bi = ids[0], bv = -1; ids.forEach(i => { const v = onsetAt(proj.words[i].t); if (v > bv) { bv = v; bi = i; } }); sc.bump = String(bi); sc.autoBump = true; n++; }
    if (!sc.fx) { for (let i = sc.a; i < sc.b; i++) { const w = normTxt(proj.words[i].w), m = EMO_MAP.find(([re]) => re.test(w)); if (m) { sc.fx = m[1]; sc.fxAt = String(i); sc.autoFx = true; n++; break; } } }
  });
  renderAll(); scheduleRebuild(50); toast(n ? `Расставлено акцентов: ${n}` : 'Все сцены уже с акцентами');
}
function clearAutoAccents() { proj.scenes.forEach(sc => { if (sc.autoBump) { sc.bump = ''; delete sc.autoBump; } if (sc.autoFx) { sc.fx = ''; sc.fxAt = ''; delete sc.autoFx; } }); renderAll(); scheduleRebuild(50); toast('Авто-акценты убраны'); }
$('#bAutoAcc').onclick = autoAccents; $('#bClearAcc').onclick = clearAutoAccents;
$$('.bestBtn').forEach(b => b.onclick = () => bestClip(+b.dataset.v));

// ---------- превью ----------
function scheduleRebuild(ms = 350, noHistory) { if (!noHistory) propagateRepeats(); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildPreview, ms); if (!noHistory) touch(); Timeline.redraw(); }
async function rebuildPreview() {
  if (!proj.words.length) { $('#preview').srcdoc = '<body style="margin:0;background:#111;color:#666;font:600 18px Inter;display:flex;align-items:center;justify-content:center;height:100vh">' + esc(T('Нет текста')) + '</body>'; return; }
  await ensureSpectrum();
  const fr = $('#preview'), [W, H] = FMT[proj.style.format]; frameReady = false;
  fr.width = W; fr.height = H; fr.style.width = W + 'px'; fr.style.height = H + 'px'; fitStage();
  fr.onload = () => { const cw = fr.contentWindow; const wait = () => { if (cw.READY) { frameReady = true; seek(curT()); try { attachPreviewDrag(); } catch (e) {} } else if (cw.document.readyState === 'complete' && cw.__err) { toastErr('Ошибка движка: ' + cw.__err); } else setTimeout(wait, 50); }; wait(); };
  const spec = buildSpec(false, { lite: $('#litePrev').checked }); CUTS = spec._cuts || []; fr.srcdoc = engineHTML(spec, null); scheduleSfx(spec);
}
function fitStage() {
  const [W, H] = FMT[proj.style.format], wrap = $('#stageWrap'), k = Math.min((wrap.clientWidth - 32) / W, (wrap.clientHeight - 32) / H);
  $('#stage').style.width = W * k + 'px'; $('#stage').style.height = H * k + 'px'; $('#preview').style.transform = `scale(${k})`; drawSafe();
}
window.addEventListener('resize', fitStage);
// панели вокруг превью меняют высоту (перенос строк, таймлайн) — подгоняем превью под то, что реально осталось
try { new ResizeObserver(() => fitStage()).observe($('#stageWrap')); } catch (e) {}
const curT = () => audio.src ? audio.currentTime : (window.__t ?? (+proj.style.start || 0));
function seek(t) { if (!audio.src) window.__t = t; const cw = $('#preview').contentWindow; if (frameReady && cw && cw.seek) try { cw.__playing = playing; cw.seek(s2o(t, CUTS)); } catch (e) {} updateTransport(t); }
function seekTo(t) { const s = +proj.style.start || 0, e = +proj.style.end || proj.duration || 0; t = Math.max(0, Math.min(Math.max(e, proj.duration || 0), t)); if (audio.src) audio.currentTime = t; seek(t); }
function updateTransport(t) {
  const [s, e0] = effRange(), e = e0 || 1;
  $('#tCur').textContent = fmtT(t); $('#tEnd').textContent = fmtT(e);
  if (!$('#scrub')._drag) $('#scrub').value = Math.round(1000 * (t - s) / Math.max(.01, e - s));
  const k = sceneAt(t);
  if (playing && k >= 0 && k !== sel && !Focus.typingIn('#sceneEditor')) { sel = k; renderStrip(); renderScene(); }
}
function sceneAt(t) { return proj.scenes.findIndex((sc, i) => { const n = proj.scenes[i + 1]; return t < (n && proj.words[n.a] ? proj.words[n.a].t - .1 : 1e9); }); }
function loop() {
  if (playing) { const c = CUTS.find(c => audio.currentTime >= c.a - .01 && audio.currentTime < c.b - .02); if (c) audio.currentTime = c.b; audio.volume = fadeGain(audio.currentTime); }
  if (playing) { const [s, e] = effRange(); if (audio.currentTime >= e) { audio.pause(); playing = false; stopSfx(); $('#bPlay').textContent = '▶'; audio.currentTime = s; } seek(audio.currentTime); }
  requestAnimationFrame(loop);
}
function togglePlay() {
  if (!audio.src) return toast('Сначала выберите трек');
  if (playing) { audio.pause(); playing = false; stopSfx(); $('#bPlay').textContent = '▶'; return; }
  const [s, e] = effRange();
  if (audio.currentTime < s || audio.currentTime >= e - .05) audio.currentTime = s;
  audio.play(); playing = true; $('#bPlay').textContent = '❚❚'; startSfx();
}
$('#bPlay').onclick = togglePlay;
$('#scrub').addEventListener('input', () => { const [s, e] = effRange(); seekTo(s + (e - s) * $('#scrub').value / 1000); });
$('#scrub').addEventListener('pointerdown', () => $('#scrub')._drag = true); $('#scrub').addEventListener('pointerup', () => $('#scrub')._drag = false);

// ---------- звуковые эффекты ----------
const SFX_CAT = { 'Переписка': 'ding', 'Соцсети': 'ding', 'Игры': 'blip', 'Цифры': 'tick', 'Документы': 'thump', 'Состояние': 'pop' };
function sfxEvents(spec) {
  const sx = proj.style.sfx, ev = [], W = spec.words, lead = spec.lead ?? .2;
  const uiEv = [], uiT = sx.ui ? SFX.sceneTimes(spec) : null; // звуки интерфейса сцен (app/sfx-ui.js)
  const push = (t, type, v) => { if (t != null && isFinite(t)) ev.push({ t, type, v }); };
  const walk = (o, cb) => { if (!o || typeof o !== 'object') return; for (const k in o) { const v = o[k]; if (/(^at$|_at$)/.test(k) && typeof v === 'number' && v >= 0 && W[v]) cb(W[v].t); else if (typeof v === 'object') walk(v, cb); } };
  spec.scenes.forEach((s, k) => {
    const sc = proj.scenes[k], tpl = TPL[sc && sc.tpl] || {}, w0 = W[s.words[0]]; if (!w0) return;
    if (sx.trans && k > 0) push(w0.t - lead - .12, 'whoosh', .8);
    const ui = !!(uiT && sc && sc.snd !== 'off' && (SFX.uiHas(s.widget) || SFX.uiHas(s.widget2))); if (ui) uiEv.push(...SFX.uiEvents(spec, k, sx.uiVol ?? .7, uiT));
    if (sx.events && s.widget && !ui) {
      if (tpl.id === 'typing') { for (let i = s.words[0]; i < s.words[1]; i++) push(W[i].t, 'click', .8); }
      else if (tpl.id === 'call' || tpl.id === 'callfull') push(w0.t - lead + .1, 'ring', .7);
      else if (tpl.id === 'achievement' || tpl.id === 'pcach') push(w0.t, 'chime', .9);
      else if (SFX_CAT[tpl.cat]) walk(s.widget, t => push(t - .03, SFX_CAT[tpl.cat], .8));
    }
    if (sx.acc) { (s.punch || []).forEach(p => { if (typeof p.at === 'number' && W[p.at]) push(W[p.at].t, p.style === 'stamp' ? 'thump' : 'pop', p.style === 'stamp' ? 1 : .6); }); [].concat(s.fx || []).forEach(f => { if (typeof f.at === 'number' && W[f.at]) push(W[f.at].t, 'pop', .7); }); }
  });
  if (sx.acc) W.forEach(w => { if (w.acc && (w.acc.zoom || w.acc.shake)) push(w.t, 'hit', .8); else if (w.acc && w.acc.emoji) push(w.t + .04, 'pop', .7); });
  if (sx.trans && spec.intro) push(spec.intro.t0 + .1, 'whoosh', .7);
  if (sx.trans && spec.outro) push(spec.outro.t0 - .1, 'whoosh', .8);
  ev.sort((a, b) => a.t - b.t); const out = ev.filter((e, i) => !i || e.t - ev[i - 1].t > .07 || e.type !== ev[i - 1].type);
  return uiEv.length ? out.concat(uiEv).sort((a, b) => a.t - b.t) : out;
}
SFX.appEvents = sfxEvents;
let sfxBuf = null, sfxKey = '', sfxTimer = null, sfxCtx = null, sfxGain = null, sfxNode = null, sfxT0 = 0;
function scheduleSfx(spec) {
  clearTimeout(sfxTimer); if (!proj.style.sfx.on) { sfxBuf = null; stopSfx(); return; }
  sfxTimer = setTimeout(async () => { const ev = sfxEvents(spec), key = JSON.stringify(ev) + spec.start + ':' + spec.end; if (key === sfxKey && sfxBuf) return;
    try { sfxBuf = await SFX.render(ev, +spec.start, +spec.end); sfxT0 = +spec.start; sfxKey = key; if (playing) startSfx(); } catch (e) { api.log('warn', 'звуки: ' + e.message); } }, 300);
}
function startSfx() {
  stopSfx(); if (!sfxBuf || !proj.style.sfx.on) return;
  sfxCtx = sfxCtx || new AudioContext(); sfxGain = sfxGain || sfxCtx.createGain(); sfxGain.gain.value = proj.style.sfx.vol; try { sfxGain.connect(sfxCtx.destination); } catch (e) {}
  const off = s2o(audio.currentTime, CUTS) - sfxT0; if (off >= sfxBuf.duration) return;
  sfxNode = sfxCtx.createBufferSource(); sfxNode.buffer = sfxBuf; sfxNode.connect(sfxGain); sfxNode.start(0, Math.max(0, off)); sfxNode._at = s2o(audio.currentTime, CUTS); sfxNode._wall = sfxCtx.currentTime;
}
function stopSfx() { if (sfxNode) { try { sfxNode.stop(); } catch (e) {} sfxNode = null; } }
// если плеер перемотали или звук разошёлся — перезапустить дорожку эффектов
setInterval(() => { if (!playing || !sfxNode || !sfxCtx) return; const exp = sfxNode._at + (sfxCtx.currentTime - sfxNode._wall); if (Math.abs(exp - s2o(audio.currentTime, CUTS)) > .12) startSfx(); }, 400);
async function sfxForExport(spec, container) { if (!proj.style.sfx.on || container === 'gif' || container === 'sticker') return null; const buf = await SFX.render(sfxEvents(spec), +spec.start, +spec.end); return { data: SFX.wav(buf), vol: proj.style.sfx.vol }; }

function fadeGain(t) {
  const [a, b] = effRange(), u = s2o(t, CUTS) - s2o(a, CUTS), L = s2o(b, CUTS) - s2o(a, CUTS), fi = +proj.style.fadeIn || 0, fo = +proj.style.fade || 0, cv = proj.style.fadeCurve || 'smooth';
  const shape = q => { q = Math.max(0, Math.min(1, q)); return cv === 'linear' ? q : cv === 'soft' ? Math.sqrt(q) : cv === 'fast' ? q * q : Math.sin(q * Math.PI / 2) ** 2; };
  let g = 1; if (fi > 0 && u < fi) g = Math.min(g, shape(u / fi)); if (fo > 0 && u > L - fo) g = Math.min(g, shape((L - u) / fo)); return Math.max(0, Math.min(1, g));
}
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
  setTimeout(() => { analyzeBeats(); loadNetBeats(); }, 30);
}
$('#bAudio').onclick = async () => { const info = await api.pickAudio(); if (!info) return; try { await loadAudio(info); proj.duration = audioData.duration; fillStyle(); Timeline.fit(); touch(); toast('Трек загружен'); } catch (e) { toastErr('Не удалось прочитать файл: ' + e.message); } };

// ---------- синхронизация ----------
$('#bAlign').onclick = async () => {
  proj.lyrics = $('#lyrics').value; proj.alFrom = $('#alFrom').value; proj.alTo = $('#alTo').value;
  if (!proj.audioPath) return toast('Сначала выберите трек');
  if (!proj.lyrics.trim()) return toast('Вставьте текст песни');
  const st = $('#alignStatus'); st.className = 'status'; st.textContent = 'Готовлюсь…'; alBusy(true);
  try {
    const g = guessLang(proj.lyrics); if (g && g !== $('#alLang').value) { $('#alLang').value = g; toast(g === 'en' ? 'Текст на английском — включил английскую модель' : 'Текст на русском — включил русскую модель', 3000); }
    proj.lang = $('#alLang').value; proj.vocals = $('#alVocals').checked; proj.vocalsQ = $('#alVocalsQ').value;
    const r = await api.align({ audioPath: proj.audioPath, lyrics: proj.lyrics, from: proj.alFrom === '' ? null : +proj.alFrom, to: proj.alTo === '' ? null : +proj.alTo, lang: proj.lang, vocals: proj.vocals, vocalsQ: proj.vocalsQ },
      p => { st.textContent = p; });
    const oldW = proj.words, oldS = proj.scenes;
    proj.words = r.words; markAdlibs(proj.words); proj.duration = r.duration || proj.duration;
    if (!beatInfo) analyzeBeats(); if (proj.style.trim.auto) autoTrim(true); else autoRange(); if (!keepScenes(oldW, oldS)) autoScenes();
    st.className = 'status ok'; st.textContent = `Готово: ${r.words.length} слов, ${proj.scenes.length} сцен.` + (r.median < 0.15 ? '\nВокал плохо слышно — проверьте тайминги на таймлайне.' : '');
    fillStyle(); renderAll(); Timeline.fit(); scheduleRebuild(50);
  } catch (e) { if (wasCancelled(e)) { st.className = 'status'; st.textContent = 'Отменено.'; } else { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); api.log('error', 'синхронизация: ' + (e.message || e)); } }
  alBusy(false);
};
// долгие операции с нейросетью можно остановить: синхронизацию, распознавание, отделение вокала, загрузку модели
const wasCancelled = e => /__cancel/.test(String(e && e.message || e));
function alBusy(on) { $('#alCancel').hidden = !on; $('#alCancel').disabled = false; $('#bRecog').disabled = $('#bAlign').disabled = on; }
$('#alCancel').onclick = () => { $('#alCancel').disabled = true; $('#alignStatus').textContent = 'Останавливаю…'; api.cancelModel().catch(() => {}); };
// язык по самому тексту: латиница без кириллицы — английский, и наоборот
function guessLang(text) {
  const t = String(text).replace(/\{[^}]*\}/g, ''), cy = (t.match(/[а-яё]/gi) || []).length, la = (t.match(/[a-z]/gi) || []).length;
  return la > 20 && la > cy * 3 ? 'en' : cy > 20 && cy > la * 2 ? 'ru' : null;
}
// распознанные слова → строки. Строка ≈ такт (1,4–3,2 с), рвём там, где пауза больше, и по возможности на сильной доле.
// Подбор разбиения — динамическим программированием по «штрафу» каждой строки.
function wordsToLines(words) {
  const n = words.length; if (!n) return '';
  const D = downbeats(), B = beatInfo ? beatInfo.beats : [], beat = B.length > 1 ? (B[B.length - 1] - B[0]) / (B.length - 1) : .5;
  // типичная строка речитатива ~1,9 с: берём ближайшее к этому целое число долей (2, 3, 4, 6 или 8)
  const target = B.length ? [2, 3, 4, 6, 8].map(k => k * beat).sort((a, b) => Math.abs(a - 1.9) - Math.abs(b - 1.9))[0] : 1.9;
  const nearBar = t => { if (!D.length) return 0; let m = 1e9; for (const d of D) { const x = Math.abs(d - t); if (x < m) m = x; if (d > t + 2) break; } return Math.min(1, m / (beat * .75)); };
  const cost = (i, j) => { // слова i..j-1
    const end = w => w.e0 ?? w.e, d = end(words[j - 1]) - words[i].t, k = j - i, g = j < n ? words[j].t - end(words[j - 1]) : 1;
    let c = 2 * ((d - target) / target) ** 2 - 4 * Math.min(g, .6) + (k === 1 ? 1.5 : 0) + (k > 12 ? 4 : 0) + .6 * nearBar(words[i].t);
    // знаки препинания от нейросети подсказывают, где кончается фраза
    const pe = words[j - 1].w; if (j < n) c -= /[.!?…]$/.test(pe) ? 1.6 : /[,;:]$/.test(pe) ? .6 : 0;
    for (let q = i + 1; q < j; q++) { if (words[q].t - end(words[q - 1]) > 1.2) c += 6; if (/[.!?…]$/.test(words[q - 1].w)) c += .8; } // пауза или конец фразы внутри строки — плохо
    return c;
  };
  const best = new Float64Array(n + 1).fill(Infinity), from = new Int32Array(n + 1); best[0] = 0;
  for (let j = 1; j <= n; j++) for (let i = Math.max(0, j - 16); i < j; i++) { const v = best[i] + cost(i, j); if (v < best[j]) { best[j] = v; from[j] = i; } }
  const cuts = []; for (let j = n; j > 0; j = from[j]) cuts.push(from[j]); cuts.reverse();
  let line = -1; words.forEach((w, i) => { if (cuts.includes(i)) line++; w.line = line; });
  return words.reduce((txt, w, i) => txt + (i ? (w.line !== words[i - 1].line ? '\n' : ' ') : '') + w.w, '');
}
$('#bRecog').onclick = async () => {
  if (!proj.audioPath) return toast('Сначала выберите трек');
  if ($('#lyrics').value.trim() && !await Dialogs.confirm('Заменить текст в поле распознанным с трека?', { ok: 'Заменить' })) return;
  proj.alFrom = $('#alFrom').value; proj.alTo = $('#alTo').value; proj.lang = $('#alLang').value; proj.vocals = $('#alVocals').checked; proj.vocalsQ = $('#alVocalsQ').value;
  const st = $('#alignStatus'); st.className = 'status'; st.textContent = 'Готовлюсь…'; alBusy(true);
  try {
    if (!beatInfo) analyzeBeats();
    const r = await api.transcribe({ audioPath: proj.audioPath, from: proj.alFrom === '' ? null : +proj.alFrom, to: proj.alTo === '' ? null : +proj.alTo, lang: proj.lang, vocals: proj.vocals, vocalsQ: proj.vocalsQ }, p => { st.textContent = p; });
    const words = r.words.map(w => ({ w: w.w, t: w.t, e: w.e, e0: w.e0, conf: w.conf }));
    proj.lyrics = wordsToLines(words); $('#lyrics').value = proj.lyrics;
    proj.words = words.map(w => Object.assign({ w: w.w, t: w.t, e: w.e, line: w.line }, w.conf < .6 ? { unsure: true } : null)); markAdlibs(proj.words);
    if (proj.style.trim.auto) autoTrim(true); else autoRange(); autoScenes();
    const lines = proj.words.length ? proj.words[proj.words.length - 1].line + 1 : 0, unsure = words.filter(w => w.conf < .6).length;
    st.className = 'status ok'; st.textContent = `Распознано: ${words.length} слов, ${lines} строк${unsure ? `, неуверенно — ${unsure} (они подсвечены на вкладке «Слова» и на таймлайне)` : ''}. Нейросеть ошибается в сленге и именах: поправьте текст в поле и нажмите «Синхронизировать слова» — тайминги подстроятся под исправления.`;
    fillStyle(); renderAll(); Timeline.fit(); scheduleRebuild(50); touch();
  } catch (e) { if (wasCancelled(e)) { st.className = 'status'; st.textContent = 'Отменено.'; } else { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); api.log('error', 'распознавание: ' + (e.message || e)); } }
  alBusy(false);
};
// сильные доли (начала тактов): из каждых 4 битов берётся тот, где удар в низах сильнее
function downbeats() {
  if (beatInfo && beatInfo.downbeats && beatInfo.downbeats.length > 1) return beatInfo.downbeats;
  if (!beatInfo || beatInfo.beats.length < 8) return []; const B = beatInfo.beats; let best = -1, bp = 0;
  for (let p = 0; p < 4; p++) { let s = 0; for (let i = p; i < B.length; i += 4) s += onsetAt(B[i]); if (s > best) { best = s; bp = p; } }
  return B.filter((b, i) => i % 4 === bp);
}
function autoTrim(quiet) {
  if (!proj.words.length) return toast('Сначала синхронизируйте слова'); const st = proj.style, Wd = proj.words, D = downbeats(), B = beatInfo ? beatInfo.beats : [];
  const period = B.length > 1 ? (B[B.length - 1] - B[0]) / (B.length - 1) : .6, bar = period * 4, first = Wd.find(w => !w.adlib) || Wd[0], last = Wd[Wd.length - 1], fo = +st.fade || 0;
  const want = first.t - Math.min(bar, 2.6);
  let start = D.filter(d => d <= first.t - .35 && d >= first.t - Math.max(bar * 1.05, 1.2)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
  if (start == null) start = B.filter(b => b <= first.t - .3 && b >= first.t - 2).pop(); if (start == null) start = first.t - .45;
  let end = D.find(d => d >= last.e + .25 && d <= last.e + bar * 1.1); if (end == null) end = B.find(b => b >= last.e + .3 && b <= last.e + 2); if (end == null) end = last.e + .6;
  end = Math.max(end, last.e + fo * .8);
  st.start = +Math.max(0, start - .02).toFixed(2); st.end = +Math.min(proj.duration || 1e9, end).toFixed(2);
  st.cuts = (st.cuts || []).filter(c => !c.auto);
  if (st.trim.cutOn) {
    const lines = []; Wd.forEach(w => { const g = lines[lines.length - 1]; if (g && g.line === w.line) g.e = w.e; else lines.push({ line: w.line, t: w.t, e: w.e }); });
    for (let i = 0; i + 1 < lines.length; i++) {
      const g1 = lines[i], g2 = lines[i + 1]; if (g2.t - g1.e < (+st.trim.cutGap || 6)) continue;
      const a = D.find(d => d >= g1.e + .4) ?? (g1.e + 1), b = [...D].reverse().find(d => d <= g2.t - .35) ?? (g2.t - 1);
      if (b - a >= Math.max(2, bar * .95)) st.cuts.push({ a: +a.toFixed(3), b: +b.toFixed(3), on: true, auto: true });
    }
  }
  specCache = null; fillStyle(); Timeline.fit(); scheduleRebuild(50);
  if (!quiet) { const n = st.cuts.filter(c => c.auto).length; toast(`Ролик ${fmtT(st.start)}–${fmtT(st.end)}` + (n ? `, вырезано проигрышей: ${n}` : ''), 3500); }
}
function renderCuts() {
  const st = proj.style, box = $('#cutList'); if (!box) return;
  box.innerHTML = (st.cuts || []).map((c, i) => `<div class="cut ${c.on === false ? 'off' : ''}"><input type="checkbox" data-i="${i}" ${c.on === false ? '' : 'checked'}><span>✂ ${fmtT(c.a)} → ${fmtT(c.b)} · ${(c.b - c.a).toFixed(1)} с</span><button class="small ghost" data-x="${i}" title="Убрать вырез">✕</button></div>`).join('');
  box.querySelectorAll('input').forEach(x => x.onchange = () => { st.cuts[+x.dataset.i].on = x.checked; specCache = null; renderCuts(); scheduleRebuild(50); });
  box.querySelectorAll('button').forEach(x => x.onclick = () => { st.cuts.splice(+x.dataset.x, 1); specCache = null; renderCuts(); scheduleRebuild(50); });
}
function markAdlibs(words) { let inside = false; words.forEach((w, i) => { const s = w.w.trim(); if (i && w.line !== words[i - 1].line) inside = false; /* незакрытая «(» не прячет весь остальной текст */ if (s.startsWith('(')) inside = true; w.adlib = inside || undefined; if (!w.adlib) delete w.adlib; if (/\)[,.!?…]*$/.test(s)) inside = false; }); }
function autoRange() { if (!proj.words.length) return; const w0 = proj.words[0], w1 = proj.words[proj.words.length - 1]; proj.style.start = Math.max(0, +(w0.t - 0.3).toFixed(2)); proj.style.end = +Math.min(proj.duration || 1e9, w1.e + 0.45).toFixed(2); specCache = null; }
const blankScene = (a, b, tpl) => ({ a, b, tpl, f: {}, bump: '', stamp: '', stampAt: '', fx: '', fxAt: '', scale: '' });
// подбор шаблона по словам строки: [регулярка, шаблоны по приоритету]
const KEYMAP = [
  [/звон|позвон|трубк|набер|абонент/, ['callfull', 'call']],
  [/пиш(у|ет|и|ешь)|напиш|сообщ|смс|переписк|чат|в личк|ответ(ь|ила|ил)/, ['imsg-dialog', 'tg-her', 'chat']],
  [/деньг|бабк|бабл|кэш|кеш|лаве|бабос|карт[аеуы]|руб(ль|лей)|доллар|баксы|зарплат|банк|счёт|счет/, ['bank', 'counter', 'spend']],
  [/болит|болен|болею|бол(ь|и)|врач|доктор|таблет|сироп|горл|кашл|температур|справк|лечен/, ['doc', 'record']],
  [/бомб|взрыв|дефуз|раунд|катк|калаш|каэс|контр|зайти на|плент/, ['cs-bomb', 'cs-score']],
  [/урон|дамаг|хп\b|крит|убил|килл|ваншот|хедшот/, ['selfhit']],
  [/дожд|ливен|снег|солнц|погод|холод|мороз|туман|жар[аы]\b/, ['weather', 'leanrain']],
  [/тачк|машин|дорог|трасс|гоню|руль|педал|бмв|мерс|еду\b|ехал|колёс|колес|за рулём/, ['drive', 'map']],
  [/трек|песн|музык|бит\b|битос|слушай|плейлист|альбом|куплет|припев|наушник/, ['lyrics', 'player']],
  [/лайк|коммент|подпис(чик|ка)|хейт|блог|тикток|рилс|сторис|стори\b|пост\b|ленте|репост|просмотр/, ['vc-sheet', 'post', 'story', 'vc-list']],
  [/сердц|пульс|давлен|дыш/, ['pulse']],
  [/батаре|заряд|сел[аи]? |энерджайз|разрядил|процент/, ['alert']],
  [/опрос|выбира|да или нет|или нет/, ['poll']],
  [/сплю|проснул|будильн|утро|утром|ночью|ноч[ьи]\b|не сплю|время \d|часов/, ['notifs']],
  [/рейтинг|оценк|звёзд|звезд|отзыв/, ['rating']],
  [/надо|список|план\b|дел[ао]\b|сделать/, ['todo']],
  [/уровень|риск|предел|на максимум/, ['slider']],
  [/доставк|заказ|купил|пачк|магаз|корзин/, ['spend', 'purchase']],
  [/достижен|ачивк|левел|лвл|прокач|апнул/, ['pcach', 'achievement']],
  [/запис|диктофон|микрофон|фристайл|студи/, ['recorder']],
  [/сервер|созвон|дискорд|войс|каток/, ['server']],
  [/вкл(ючи|ючаю)|выкл|режим/, ['toggles', 'segmented']]
];
const normTxt = t => String(t).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const sceneSig = sc => normTxt(proj.words.slice(sc.a, sc.b).filter(w => !w.adlib).map(w => w.w).join(' '));
function pickByWords(text, recent) {
  const t = ' ' + normTxt(text) + ' ';
  for (const [re, list] of KEYMAP) if (re.test(t)) { const c = list.find(x => TPL[x] && !recent.includes(x)); if (c) return c; }
  return null;
}
// повторная синхронизация после правки текста: если строк столько же, сцены (шаблоны, поля, акценты) и акценты слов
// остаются на своих строках, а не пересобираются с нуля
function keepScenes(oldW, oldS) {
  if (!oldS.length || !oldW.length || !proj.words.length) return false;
  const lines = Wd => { const L = []; Wd.forEach((w, i) => { const g = L[L.length - 1]; if (g && g.line === w.line) g.b = i + 1; else L.push({ line: w.line, a: i, b: i + 1 }); }); return L; };
  const LO = lines(oldW), LN = lines(proj.words); if (LO.length !== LN.length) return false;
  const map = i => { const k = LO.findIndex(g => i >= g.a && i < g.b); return k < 0 ? -1 : Math.min(LN[k].b - 1, LN[k].a + (i - LO[k].a)); };
  const st = oldS.map(sc => map(sc.a)); if (st[0] !== 0 || st.some((v, i) => v < 0 || (i && v <= st[i - 1]))) return false;
  proj.scenes = oldS.map((sc, i) => { const a = st[i], b = i + 1 < st.length ? st[i + 1] : proj.words.length, n = JSON.parse(JSON.stringify(sc)), mv = v => v === '' || v == null ? v : (a + (+v - sc.a) < b ? String(a + (+v - sc.a)) : '');
    Object.assign(n, { a, b, bump: mv(sc.bump) ?? '', stampAt: mv(sc.stampAt) ?? '', fxAt: mv(sc.fxAt) ?? '' }); if (n.accents) n.accents = n.accents.map(x => Object.assign(x, { at: mv(x.at) ?? '' })); return n; });
  oldW.forEach((w, i) => { if (w.acc) { const j = map(i); if (j >= 0 && !proj.words[j].acc) proj.words[j].acc = w.acc; } });
  if (sel >= proj.scenes.length) sel = 0; msel = new Set([sel]); return true;
}
function autoScenes() {
  const per = proj.perScene || 2, lines = [], kin = $('#autoKin').checked, smart = $('#autoSmart').checked;
  proj.words.forEach((w, i) => { const L = lines[lines.length - 1]; if (L && L.line === w.line) L.b = i + 1; else lines.push({ line: w.line, a: i, b: i + 1 }); });
  lines.forEach(L => L.sig = normTxt(proj.words.slice(L.a, L.b).map(w => w.w).join(' ')));
  // припев: строка, с которой раньше уже начиналась сцена, начинает новую сцену той же длины
  const startLen = {}, firstSeen = {}; lines.forEach((L, i) => { if (firstSeen[L.sig] == null) firstSeen[L.sig] = i; });
  proj.scenes = []; const used = {}, sigTpl = {}, recent = []; let kk = 0;
  for (let i = 0, n = 0; i < lines.length; n++) {
    let k = startLen[lines[i].sig] && firstSeen[lines[i].sig] < i ? startLen[lines[i].sig] : per;
    for (let j = 1; j < k && i + j < lines.length; j++) { const L = lines[i + j]; if (startLen[L.sig] && firstSeen[L.sig] < i + j) { k = j; break; } }
    k = Math.min(k, lines.length - i); const grp = lines.slice(i, i + k); if (!startLen[lines[i].sig]) startLen[lines[i].sig] = k;
    const sc = blankScene(grp[0].a, grp[k - 1].b, null), sig = normTxt(grp.map(g => g.sig).join(' '));
    let tpl = sigTpl[sig];
    if (!tpl) {
      const pool = AUTO_TPL[Math.min(3, k)];
      tpl = smart ? pickByWords(grp.map(g => g.sig).join(' '), recent.slice(-3)) : null;
      if (!tpl) { do { tpl = pool[(used[k] = (used[k] ?? -1) + 1) % pool.length]; } while (recent.slice(-2).includes(tpl) && pool.length > 3); }
      if (kin && n % 4 === 3) tpl = KIN_AUTO[kk++ % KIN_AUTO.length];
      sigTpl[sig] = tpl;
    }
    sc.tpl = tpl; recent.push(tpl); proj.scenes.push(sc); i += k;
  }
  sel = 0; msel = new Set([0]);
}
$('#bAutoScenes').onclick = async () => { if (!proj.words.length) return toast('Сначала синхронизируйте слова'); if (!await Dialogs.confirm('Пересобрать сцены? Текущие настройки сцен пропадут (можно вернуть через Ctrl+Z).', { ok: 'Пересобрать' })) return; autoScenes(); renderAll(); scheduleRebuild(50); };
$$('#perScene button').forEach(b => b.onclick = () => { proj.perScene = +b.dataset.v; $$('#perScene button').forEach(x => x.classList.toggle('on', x === b)); touch(); });

// ---------- слова ----------
function renderWords() {
  const box = $('#wordList'); box.innerHTML = ''; let ln = -1;
  const nUnsure = proj.words.filter(w => w.unsure).length;
  if (nUnsure) { const h = document.createElement('div'); h.className = 'hint unsureHint'; h.innerHTML = `<span>${esc(T(`Неуверенно распознанных слов: ${nUnsure}. Они подсвечены. Послушайте их; если слово верное, нажмите на «?».`))}</span><button class="ghost small" style="margin-left:6px">${esc(T('снять все'))}</button>`;
    h.querySelector('button').onclick = () => { proj.words.forEach(w => delete w.unsure); renderWords(); Timeline.redraw(); touch(); }; box.append(h); }
  proj.words.forEach((w, i) => {
    const d = document.createElement('div'); d.className = 'w' + (w.line !== ln ? ' ln' : '') + (w.unsure ? ' unsure' : ''); ln = w.line;
    d.innerHTML = `<span>${esc(w.w)}${w.unsure ? `<b class="uq" title="${esc(T('Нейросеть не уверена в этом слове. Нажмите, если оно верное'))}">?</b>` : ''}</span><button data-d="-0.05">−</button><span class="mono">${w.t.toFixed(2)}</span><button data-d="0.05">+</button>`;
    d.children[0].onclick = e => { if (e.target.classList.contains('uq')) { delete w.unsure; renderWords(); Timeline.redraw(); touch(); return; } seekTo(Math.max(0, w.t - .15)); };
    d.querySelectorAll('button').forEach(b => b.onclick = () => { const lo = i ? proj.words[i - 1].t + .03 : 0, hi = proj.words[i + 1] ? proj.words[i + 1].t - .03 : 1e9; w.t = +Math.max(lo, Math.min(hi, w.t + +b.dataset.d)).toFixed(2); w.e = +Math.max(w.e, w.t + .05).toFixed(2); /* не обгоняет соседей, как и на таймлайне */ d.querySelector('.mono').textContent = w.t.toFixed(2); scheduleRebuild(); });
    box.append(d);
  });
}

// ---------- сцены ----------
function thumb(id) { return `thumbs/${id}.jpg`; }
function renderStrip() {
  const box = $('#sceneStrip'); box.innerHTML = '';
  proj.scenes.forEach((sc, i) => {
    if (!proj.words[sc.a]) return;
    const d = document.createElement('div'); d.className = 'sc' + (i === sel ? ' on' : '') + (msel.has(i) && msel.size > 1 ? ' msel' : '');
    d.innerHTML = `<img src="${thumb(sc.tpl)}" onerror="this.style.visibility='hidden'"><div><div class="n">${i + 1} · ${fmtT(proj.words[sc.a].t)}</div><div class="t">${esc(sceneText(sc))}</div></div>`;
    d.onclick = e => {
      if (e.ctrlKey || e.metaKey) { if (msel.has(i) && msel.size > 1) msel.delete(i); else msel.add(i); sel = i; renderStrip(); renderScene(); return; }
      if (e.shiftKey) { const a = Math.min(sel, i), b = Math.max(sel, i); msel = new Set(); for (let k = a; k <= b; k++) msel.add(k); sel = i; renderStrip(); renderScene(); return; }
      selectScene(i, true);
    };
    box.append(d);
  });
  const on = box.children[sel]; if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  Timeline.redraw();
}
function selectScene(i, jump) {
  if (i < 0 || i >= proj.scenes.length) return; sel = i; msel = new Set([i]);
  if (jump) { const sc = proj.scenes[i]; seekTo(Math.max(+proj.style.start || 0, proj.words[sc.a].t - .1 + .6)); }
  renderStrip(); renderScene();
}
function wordOptions(sc, val, none = 'нет') {
  return `<option value="">${none}</option>` + proj.words.slice(sc.a, sc.b).map((w, i) => `<option data-notr value="${sc.a + i}" ${String(val) === String(sc.a + i) ? 'selected' : ''}>${esc(w.w)}</option>`).join('');
}
const SEL_LABEL = { circle: 'круг вокруг обложки', bars: 'полосы', wave: 'волна', auto: 'как в шаблоне', none: 'не показывать', note: 'заметка', ticker: 'фиолетовая лента', transcript: 'расшифровка (тёмная)', status: 'статус (зелёный)', warn: 'предупреждение', search: 'поиск сверху', data: 'данные', decline: 'отклонить', approve: 'одобрить' };
// onCut(новое значение) — если передан, рядом с картинкой появляется кнопка «вырезать фон»
function imgPicker(box, val, onPick, onClear, label = 'Выбрать картинку…', onCut) {
  const src = asset(val); box.className = 'imgPick';
  box.innerHTML = src ? `<img src="${src}"><button class="small">заменить</button>${onCut ? '<button class="small" data-cut title="Нейросеть уберёт фон и оставит человека или предмет">✂ без фона</button>' : ''}<button class="small ghost">✕</button>` : `<button class="small">${label}</button>`;
  const bs = [...box.querySelectorAll('button:not([data-cut])')]; bs[0].onclick = onPick; if (bs[1]) bs[1].onclick = onClear;
  const cb = box.querySelector('[data-cut]'); if (cb) cb.onclick = async () => { const v = await cutBackground(val, cb); if (v) onCut(v); };
}
// вырезать фон нейросетью: картинка → PNG с прозрачностью (новый ресурс проекта)
async function cutBackground(val, btn) {
  const src = asset(val); if (!src || !api.removeBg) return null;
  let dataUrl = src; if (!/^data:/.test(src)) { const b = await (await fetch(src)).blob(); dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
  const was = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await api.removeBg({ dataUrl }, t => { if (btn) btn.textContent = t.length > 26 ? '…' : t; toast(t, 2500); });
    const id = uid(); proj.assets[id] = r.dataUrl; toast('Фон убран', 1800); touch(); return 'asset:' + id;
  } catch (e) { toastErr('Не удалось убрать фон: ' + (e.message || e)); return null; }
  finally { if (btn) { btn.disabled = false; btn.textContent = was; } }
}
function renderScene() {
  const sc = proj.scenes[sel]; $('#sceneEmpty').hidden = !!sc; $('#sceneEditor').hidden = !sc; if (!sc) return;
  const t = TPL[sc.tpl] || TPL.chat;
  $('#seIdx').textContent = `Сцена ${sel + 1} из ${proj.scenes.length} · ${fmtT(proj.words[sc.a].t)}`; $('#seText').textContent = sceneText(sc);
  $('#seTplImg').src = thumb(t.id); $('#seTplName').textContent = t.name;
  renderFields($('#seFields'), t, sc.f);
  const t2 = sc.tpl2 && TPL[sc.tpl2]; $('#se2Box').hidden = !t2; $('#se2Del').hidden = !t2; $('#se2Add').hidden = !!t2;
  if (t2) { $('#se2TplImg').src = thumb(t2.id); $('#se2TplName').textContent = t2.name; sc.f2 = sc.f2 || {}; renderFields($('#se2Fields'), t2, sc.f2); }
  const ts = targets(); $('#seMulti').hidden = ts.length < 2;
  if (ts.length > 1) $('#seMulti').innerHTML = `Выделено сцен: <b>${ts.length}</b>. Шаблон из галереи и «вставить вид» применятся ко всем выделенным.`;
  const reps = repeatsOf(sel); $('#seRepeats').hidden = !reps.length;
  if (reps.length) { $('#seRepeats').innerHTML = `Эта строка повторяется в сценах <b>${reps.map(k => k + 1).join(', ')}</b> (припев).<label class="chk"><input type="checkbox" id="seLink" ${proj.linkRepeats === false ? '' : 'checked'}> менять повторы вместе с этой сценой</label>`;
    $('#seLink').onchange = e => { proj.linkRepeats = e.target.checked; if (e.target.checked) scheduleRebuild(50); else touch(); }; }
  const card = !t.nocard; $('#seCardOnly').hidden = !card; $('#seScaleBox').hidden = !card;
  $('#seBump').innerHTML = wordOptions(sc, sc.bump); $('#seStamp').value = sc.stamp || ''; $('#seStampAt').innerHTML = wordOptions(sc, sc.stampAt, 'авто');
  $('#seFx').value = sc.fx || ''; $('#seFxAt').innerHTML = wordOptions(sc, sc.fxAt, 'авто');
  renderAccents(sc, card);
  $('#seTrans').value = sc.trans || ''; $('#seCam').value = sc.cam || '';
  $('#seSnd').value = sc.snd === 'off' ? 'off' : '';
  $('#seScale').value = sc.scale || defScale(sc); $('#seScaleV').textContent = (+$('#seScale').value).toFixed(2);
}
// ---------- конструктор виджета из блоков ----------
const BLK = {
  header: ['Шапка', [['title', 'Имя', 'src'], ['sub', 'Подпись', 'src'], ['emoji', 'Аватар-эмодзи', 'emoji'], ['img', 'Аватар-картинка', 'img'], ['right', 'Справа (время)', 'text']]],
  text: ['Текст', [['text', 'Текст', 'src'], ['size', 'Размер', 'num'], ['align', 'Выравнивание', 'sel:left=слева,center=по центру,right=справа']]],
  bubble: ['Пузырь сообщения', [['text', 'Текст', 'src'], ['side', 'Сторона', 'sel:right=справа (я),left=слева (собеседник)']]],
  image: ['Картинка', [['img', 'Картинка', 'img'], ['emoji', 'Или эмодзи', 'emoji'], ['h', 'Высота', 'num']]],
  counter: ['Счётчик', [['label', 'Подпись', 'src'], ['from', 'От', 'num'], ['to', 'До', 'num'], ['prefix', 'Перед числом', 'text'], ['suffix', 'После числа', 'text']]],
  progress: ['Полоса прогресса', [['label', 'Подпись', 'src'], ['value', 'Процент', 'num']]],
  button: ['Кнопка', [['label', 'Надпись', 'src'], ['align', 'Ширина', 'sel:stretch=во всю ширину,left=слева,right=справа']]],
  icons: ['Ряд эмодзи', [['text', 'Эмодзи через пробел', 'text']]],
  divider: ['Разделитель', []]
};
const SRC_OPTS = [['$line', 'строка сцены'], ['$1', 'первая половина строк'], ['$2', 'вторая половина строк'], ['', 'свой текст']];
function renderBlocks(box, list) {
  const redraw = () => renderBlocks(box, list), ch = () => scheduleRebuild(350);
  box.innerHTML = list.map((b, i) => `<div class="bk" data-i="${i}"><div class="row"><b class="small" style="flex:1">${i + 1}. ${(BLK[b.type] || ['?'])[0]}</b><button class="small ghost" data-mv="-1" title="Выше">↑</button><button class="small ghost" data-mv="1" title="Ниже">↓</button><button class="small ghost" data-rm title="Удалить">✕</button></div><div class="bf"></div></div>`).join('')
    + `<div class="row"><select class="bkAdd"><option value="">+ добавить блок…</option>${Object.entries(BLK).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>`;
  box.querySelectorAll('.bk').forEach(el => {
    const i = +el.dataset.i, b = list[i], bf = el.querySelector('.bf');
    (BLK[b.type] || ['', []])[1].forEach(([k, label, kind]) => {
      const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<span class="muted small" style="width:96px;flex:none">${label}</span>`; bf.append(row);
      if (kind === 'src') {
        const isSrc = SRC_OPTS.some(o => o[0] && o[0] === b[k]), sel = document.createElement('select'); sel.innerHTML = SRC_OPTS.map(o => `<option value="${o[0]}">${o[1]}</option>`).join(''); sel.value = isSrc ? b[k] : '';
        const inp = document.createElement('input'); inp.value = isSrc ? '' : (b[k] || ''); inp.hidden = isSrc; inp.placeholder = 'текст';
        sel.onchange = () => { if (sel.value) { b[k] = sel.value; inp.hidden = true; } else { b[k] = inp.value; inp.hidden = false; } ch(); }; inp.oninput = () => { b[k] = inp.value; ch(); };
        row.append(sel, inp);
      } else if (kind === 'img') {
        const pk = document.createElement('div'); row.append(pk);
        const draw = () => imgPicker(pk, b[k], async () => { const a = await loadImage(false); if (a) { b[k] = a; draw(); ch(); } }, () => { delete b[k]; draw(); ch(); }, 'Выбрать…'); draw();
      } else if (kind.startsWith('sel:')) {
        const sel = document.createElement('select'); sel.innerHTML = kind.slice(4).split(',').map(x => { const [v, l] = x.split('='); return `<option value="${v}">${l}</option>`; }).join(''); sel.value = b[k] || sel.options[0].value; sel.onchange = () => { b[k] = sel.value; ch(); }; row.append(sel);
      } else { const inp = document.createElement('input'); if (kind === 'num') { inp.type = 'number'; inp.step = 'any'; } if (kind === 'emoji') inp.className = 'emo'; inp.value = b[k] ?? ''; inp.oninput = () => { b[k] = kind === 'num' ? (inp.value === '' ? undefined : +inp.value) : inp.value; ch(); }; row.append(inp); }
    });
    el.querySelectorAll('[data-mv]').forEach(x => x.onclick = () => { const j = i + +x.dataset.mv; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; redraw(); ch(); });
    el.querySelector('[data-rm]').onclick = () => { list.splice(i, 1); redraw(); ch(); };
  });
  box.querySelector('.bkAdd').onchange = e => { const t = e.target.value; if (!t) return; const d = { header: { title: 'melhor', sub: 'в сети', emoji: '😎' }, text: { text: '$line', size: 28 }, bubble: { text: '$line', side: 'right' }, image: { emoji: '🖼️', h: 200 }, counter: { label: 'просмотры', from: 0, to: 1000000 }, progress: { label: 'загрузка', value: 87 }, button: { label: 'Ответить' }, icons: { text: '😂 🔥 ❤️' }, divider: {} }[t];
    list.push(Object.assign({ type: t }, d)); redraw(); ch(); };
}
function renderFields(box, t, store) {
  box.innerHTML = '';
  t.fields.forEach(fd => {
    const v = store[fd.k] ?? defaultOf(t, fd), d = document.createElement('div'); d.className = 'fld';
    let inp;
    if (fd.type === 'blocks') { if (!Array.isArray(store[fd.k])) store[fd.k] = JSON.parse(JSON.stringify(fd.def)); d.innerHTML = `<label class="lbl">${esc(fd.label)}</label><div class="blk"></div>`; renderBlocks(d.querySelector('.blk'), store[fd.k]); }
    else if (fd.type === 'bool') { d.innerHTML = `<label class="chk"><input type="checkbox" ${v ? 'checked' : ''}> ${esc(fd.label)}</label>`; inp = d.querySelector('input'); inp.onchange = () => { store[fd.k] = inp.checked; scheduleRebuild(); }; }
    else if (fd.type === 'image') {
      d.innerHTML = `<label class="lbl">${esc(fd.label)}</label><div></div>`;
      const pb = d.lastChild, redraw = () => imgPicker(pb, store[fd.k] ?? defaultOf(t, fd), async () => { const a = await loadImage(false); if (a) { store[fd.k] = a; redraw(); scheduleRebuild(50); } }, () => { store[fd.k] = ''; redraw(); scheduleRebuild(50); }, undefined, v => { store[fd.k] = v; redraw(); scheduleRebuild(50); });
      redraw();
    }
    else {
      d.innerHTML = `<label class="lbl">${esc(fd.label)}</label>`;
      if (fd.type === 'select') { inp = document.createElement('select'); inp.innerHTML = fd.opts.map(o => `<option ${o === v ? 'selected' : ''} value="${o}">${SEL_LABEL[o] || o}</option>`).join(''); }
      else if (fd.type === 'font') { inp = document.createElement('select'); inp.innerHTML = fontOptions(v); }
      else { inp = document.createElement('input'); inp.type = fd.type === 'number' ? 'number' : fd.type === 'color' ? 'color' : 'text'; if (fd.type === 'number') { inp.step = 'any'; if (fd.opts) { inp.min = fd.opts.min; inp.max = fd.opts.max; } } inp.value = v; if (fd.type === 'emoji') inp.className = 'emo'; }
      inp.oninput = async () => {
        if (fd.type === 'font' && inp.value === '__load') { const fam = await loadFont(); if (fam) store[fd.k] = fam; renderScene(); scheduleRebuild(50); return; }
        store[fd.k] = fd.type === 'number' ? +inp.value : inp.value; scheduleRebuild();
      };
      d.append(inp);
    }
    box.append(d);
  });
}
function defScale(sc) { try { const w = TPL[sc.tpl].make(fieldsOf(sc), sceneCtx(sc)).widget; return (w && w.scale) || 1.3; } catch (e) { return 1.3; } }
$('#seTrans').onchange = e => { targets().forEach(i => proj.scenes[i].trans = e.target.value); scheduleRebuild(50); };
$('#seCam').onchange = e => { targets().forEach(i => proj.scenes[i].cam = e.target.value); scheduleRebuild(50); };
$('#seSnd').onchange = e => { targets().forEach(i => { if (e.target.value) proj.scenes[i].snd = e.target.value; else delete proj.scenes[i].snd; }); scheduleSfx(buildSpec(false)); touch(); };
$('#seBump').onchange = e => { proj.scenes[sel].bump = e.target.value; scheduleRebuild(); };
$('#seStamp').oninput = e => { proj.scenes[sel].stamp = e.target.value; scheduleRebuild(); };
$('#seStampAt').onchange = e => { proj.scenes[sel].stampAt = e.target.value; scheduleRebuild(); };
$('#seFx').oninput = e => { proj.scenes[sel].fx = e.target.value; scheduleRebuild(); };
$('#seFxAt').onchange = e => { proj.scenes[sel].fxAt = e.target.value; scheduleRebuild(); };
// дополнительные акценты: строка = вид + (текст или эмодзи) + слово, на котором сработает
const ACC_KINDS = [['bump', 'подпрыгнуть'], ['stamp', 'штамп'], ['fx', 'эмодзи']];
function renderAccents(sc, card) {
  const box = $('#seAccList'); box.innerHTML = '';
  (sc.accents || []).forEach((a, i) => {
    const kinds = ACC_KINDS.filter(([k]) => card || k === 'fx'), d = document.createElement('div'); d.className = 'row tight accRow';
    d.innerHTML = `<select data-f="k" style="width:auto;flex:none">${kinds.map(([k, n]) => `<option value="${k}" ${a.k === k ? 'selected' : ''}>${n}</option>`).join('')}</select>` +
      (a.k === 'bump' ? '' : `<input data-f="v" ${a.k === 'fx' ? 'class="emo" placeholder="✨"' : 'placeholder="Понятно ✓"'} value="${esc(a.v || '')}" style="flex:1;min-width:0">`) +
      `<select data-f="at" style="flex:1;min-width:0">${wordOptions(sc, a.at, a.k === 'bump' ? 'слово…' : 'авто')}</select><button class="del" title="Убрать акцент" style="flex:none">×</button>`;
    d.onchange = d.oninput = e => { const f = e.target.dataset.f; if (!f) return; a[f] = e.target.value; if (f === 'k') { if (a.k === 'bump') delete a.v; renderAccents(sc, card); } scheduleRebuild(); };
    d.querySelector('.del').onclick = () => { sc.accents.splice(i, 1); if (!sc.accents.length) delete sc.accents; renderAccents(sc, card); scheduleRebuild(); };
    box.append(d);
  });
  $('#seAccAdd').onclick = () => { const cur = curWordIn(sc); (sc.accents = sc.accents || []).push({ k: card ? 'bump' : 'fx', at: cur != null ? String(cur) : '', v: card ? undefined : '✨' }); renderAccents(sc, card); scheduleRebuild(); };
}
// слово сцены под курсором воспроизведения — новый акцент встаёт на него
function curWordIn(sc) { const t = curT(); let best = null; for (let i = sc.a; i < sc.b; i++) if (proj.words[i] && proj.words[i].t <= t + .05) best = i; return best; }
$('#seScale').oninput = e => { proj.scenes[sel].scale = +e.target.value; $('#seScaleV').textContent = (+e.target.value).toFixed(2); scheduleRebuild(200); };
// акценты сцены, чьё слово ушло в другую сцену (разделение, сдвиг границы), снимаются — иначе панель показывает «нет», а акцент срабатывает в соседней сцене
function fixRefs(sc) {
  const out = v => v !== '' && v != null && (+v < sc.a || +v >= sc.b);
  if (out(sc.bump)) { sc.bump = ''; delete sc.autoBump; } if (out(sc.stampAt)) sc.stampAt = ''; if (out(sc.fxAt)) sc.fxAt = '';
  if (sc.accents) { sc.accents = sc.accents.filter(a => !(a.k === 'bump' && out(a.at))).map(a => out(a.at) ? Object.assign({}, a, { at: '' }) : a); if (!sc.accents.length) delete sc.accents; }
}
// объединение: дополнительные акценты убранной сцены остаются на своих словах
function mergeScenes(i) { const p = proj.scenes[i], q = proj.scenes[i + 1]; p.b = q.b; if (q.accents && q.accents.length) p.accents = (p.accents || []).concat(q.accents); proj.scenes.splice(i + 1, 1); msel = new Set([...msel].filter(k => k !== i + 1).map(k => k > i + 1 ? k - 1 : k)); }
function mergePrev() { if (sel < 1) return; mergeScenes(sel - 1); sel--; renderAll(); scheduleRebuild(); }
function mergeNext() { if (sel >= proj.scenes.length - 1) return; mergeScenes(sel); renderAll(); scheduleRebuild(); }
function splitScene(atTime) {
  let i = atTime != null ? sceneAt(atTime) : sel; if (i < 0) i = sel; const sc = proj.scenes[i]; if (!sc || sc.b - sc.a < 2) return toast('Слишком короткая сцена');
  const ws = proj.words; let m = -1;
  if (atTime != null) { for (let k = sc.a + 1; k < sc.b; k++) if (ws[k].t >= atTime - .02) { m = k; break; } if (m < 0) return toast('Курсор после последнего слова сцены'); }
  else { m = sc.a + Math.floor((sc.b - sc.a) / 2); for (let d = 0; d < sc.b - sc.a; d++) { for (const k of [m + d, m - d]) if (k > sc.a && k < sc.b && ws[k].line !== ws[k - 1].line) { m = k; d = 1e9; break; } } }
  const nw = Object.assign(blankScene(m, sc.b, AUTO_TPL[1][(i + 3) % AUTO_TPL[1].length])); sc.b = m;
  const moved = (sc.accents || []).filter(a => a.at !== '' && a.at != null && +a.at >= m); if (moved.length) nw.accents = moved.map(a => Object.assign({}, a)); // акценты второй половины переходят вместе со словами
  fixRefs(sc); proj.scenes.splice(i + 1, 0, nw); sel = i; renderAll(); scheduleRebuild();
}
function sceneLook(sc) {
  const rel = v => v === '' || v == null ? '' : (+v - sc.a);
  return JSON.parse(JSON.stringify({ tpl: sc.tpl, f: sc.f, scale: sc.scale, stamp: sc.stamp, fx: sc.fx, bump: rel(sc.bump), stampAt: rel(sc.stampAt), fxAt: rel(sc.fxAt), trans: sc.trans || '', cam: sc.cam || '', tpl2: sc.tpl2 || '', f2: sc.f2 || {}, dx: sc.dx || 0, dy: sc.dy || 0, dx2: sc.dx2 || 0, dy2: sc.dy2 || 0, accents: (sc.accents || []).map(a => Object.assign({}, a, { at: rel(a.at) })) }));
}
function applyLook(sc, L) {
  const abs = v => v === '' || v == null ? '' : (sc.a + +v < sc.b ? sc.a + +v : '');
  Object.assign(sc, { tpl: L.tpl, f: JSON.parse(JSON.stringify(L.f || {})), scale: L.scale, stamp: L.stamp, fx: L.fx, bump: abs(L.bump), stampAt: abs(L.stampAt), fxAt: abs(L.fxAt), trans: L.trans || '', cam: L.cam || '', tpl2: L.tpl2 || '', f2: JSON.parse(JSON.stringify(L.f2 || {})), dx: L.dx || 0, dy: L.dy || 0, dx2: L.dx2 || 0, dy2: L.dy2 || 0 });
  if (L.accents && L.accents.length) sc.accents = L.accents.map(a => Object.assign({}, a, { at: abs(a.at) === '' ? '' : String(abs(a.at)) })); else delete sc.accents;
}
function targets() { return msel.size > 1 ? [...msel].sort((a, b) => a - b) : [sel]; }
function copyLook() { const sc = proj.scenes[sel]; if (!sc) return; clip = sceneLook(sc); const cs = JSON.stringify(clip); clip.__assets = {}; for (const k in proj.assets) if (cs.includes('asset:' + k)) clip.__assets[k] = proj.assets[k]; /* картинки вида едут с ним — можно вставить и в другой проект */ toast('Вид сцены скопирован — выделите сцены и нажмите Ctrl+V', 2600); }
function pasteLook() { if (!clip) return toast('Сначала скопируйте вид сцены (Ctrl+C)'); const ts = targets(); for (const k in clip.__assets || {}) if (!proj.assets[k]) proj.assets[k] = clip.__assets[k]; ts.forEach(i => applyLook(proj.scenes[i], clip)); renderAll(); scheduleRebuild(50); toast(ts.length > 1 ? `Вставлено в ${ts.length} сцен` : 'Вставлено'); }
$('#seCopy').onclick = copyLook; $('#sePaste').onclick = pasteLook;
// ---- повторы (припев) ----
function repeatsOf(i) { const sig = sceneSig(proj.scenes[i]); if (sig.split(' ').length < 2) return []; return proj.scenes.map((sc, k) => k).filter(k => k !== i && sceneSig(proj.scenes[k]) === sig); }
function propagateRepeats() {
  if (proj.linkRepeats === false || !proj.scenes[sel]) return;
  const reps = repeatsOf(sel); if (!reps.length) return; const L = sceneLook(proj.scenes[sel]);
  reps.forEach(k => applyLook(proj.scenes[k], L));
}
$('#seMergePrev').onclick = mergePrev; $('#seMergeNext').onclick = mergeNext;
$('#seSplit').onclick = () => { const sc = proj.scenes[sel], t = curT(); splitScene(sc && t > proj.words[sc.a].t + .05 && t < proj.words[sc.b - 1].t ? t : null); };

// ---------- галерея ----------
let gCat = null, gSecond = false;
function openGallery(second) {
  if (typeof second === 'boolean') gSecond = second;
  if (!proj.scenes[sel]) return;
  gCat = gCat || 'Все';
  $('#gCats').innerHTML = ['Все'].concat(Object.keys(USER_TPL).length ? ['Мои'] : []).concat(TEMPLATE_CATS).map(c => `<button class="${c === gCat ? 'on' : ''}">${c}</button>`).join('');
  $$('#gCats button').forEach(b => b.onclick = () => { gCat = b.textContent; openGallery(); });
  $('#gallery .mhead b').textContent = gSecond ? 'Шаблон второй карточки' : 'Шаблоны сцен';
  const list = TEMPLATES.filter(t => gCat === 'Все' || t.cat === gCat);
  $('#gGrid').innerHTML = list.map(t => `<div class="tp" data-id="${t.id}"><img src="${thumb(t.id)}" onerror="this.style.visibility='hidden'"><b>${esc(t.name)}</b><span>${t.lines === 1 ? '1 строка' : t.lines + ' строки'}${t.nocard ? ' · без карточки' : ''}</span></div>`).join('');
  if (gCat === 'Мои' || (gCat === 'Все' && Object.keys(USER_TPL).length)) $('#gGrid').insertAdjacentHTML('afterbegin', Object.entries(USER_TPL).map(([k, u]) => `<div class="tp" data-u="${esc(k)}"><img src="${u.thumb || thumb(u.base)}" onerror="this.style.visibility='hidden'"><i class="del" title="Удалить">✕</i><b>${esc(k)}</b><span>мой · ${esc((TPL[u.base] || {}).name || u.base)}</span></div>`).join(''));
  if (gCat === 'Мои') $$('#gGrid .tp:not([data-u])').forEach(x => x.remove());
  $$('#gGrid .tp').forEach(d => d.onclick = async e => {
    if (d.dataset.u && e.target.classList.contains('del')) { if (!await Dialogs.confirm(`Удалить шаблон «${d.dataset.u}»?`, { ok: 'Удалить', danger: true })) return; delete USER_TPL[d.dataset.u]; api.saveUserTemplates(USER_TPL); openGallery(); return; }
    const ts = targets();
    ts.forEach(i => { const sc = proj.scenes[i];
      if (gSecond) { const u = d.dataset.u && USER_TPL[d.dataset.u]; sc.tpl2 = u ? u.base : d.dataset.id; sc.f2 = u ? JSON.parse(JSON.stringify(u.f || {})) : {}; }
      else if (d.dataset.u) applyUserTpl(sc, USER_TPL[d.dataset.u]); else { sc.tpl = d.dataset.id; sc.f = {}; sc.scale = ''; } });
    $('#gallery').hidden = true; renderAll(); scheduleRebuild(50); if (ts.length > 1) toast(`Шаблон применён к ${ts.length} сценам`);
  });
  $('#gallery').hidden = false;
}
function applyUserTpl(sc, u) {
  const toAsset = o => { if (typeof o === 'string' && o.startsWith('data:')) { const id = uid(); proj.assets[id] = o; return 'asset:' + id; } if (Array.isArray(o)) return o.map(toAsset); if (o && typeof o === 'object') { for (const k in o) o[k] = toAsset(o[k]); } return o; };
  const f = toAsset(JSON.parse(JSON.stringify(u.f || {})));
  applyLook(sc, Object.assign({}, u, { f, tpl: u.base }));
}
$('#seSaveTpl').onclick = () => { $('#seSaveTplBox').hidden = !$('#seSaveTplBox').hidden; $('#seTplNameIn').focus(); };
$('#seSaveTplGo').onclick = async () => {
  const name = $('#seTplNameIn').value.trim(); if (!name) return toast('Впишите название шаблона');
  const sc = proj.scenes[sel], L = sceneLook(sc), f = {};
  for (const k in L.f) f[k] = deepAssets(L.f[k]); // и картинки внутри блоков конструктора — иначе в другом проекте их нет
  const u = { base: L.tpl, f, scale: L.scale, stamp: L.stamp, fx: L.fx, bump: L.bump, stampAt: L.stampAt, fxAt: L.fxAt };
  try { const r = $('#stage').getBoundingClientRect(); const th = await api.captureRect({ x: r.x, y: r.y + r.height * .15, width: r.width, height: r.height * .7 }); if (th) u.thumb = th; } catch (e) {}
  USER_TPL[name] = u; await api.saveUserTemplates(USER_TPL); $('#seSaveTplBox').hidden = true; $('#seTplNameIn').value = ''; toast(`Шаблон «${name}» сохранён — он в галерее, раздел «Мои»`, 3000);
};
$('#seTpl').onclick = () => openGallery(false);
$('#se2Add').onclick = $('#se2Tpl').onclick = () => openGallery(true);
$('#se2Del').onclick = () => { targets().forEach(i => { const sc = proj.scenes[i]; delete sc.tpl2; delete sc.f2; delete sc.dx2; delete sc.dy2; }); renderScene(); scheduleRebuild(50); }; $('#gClose').onclick = () => $('#gallery').hidden = true;

// ---------- стиль ----------
function renderPresets() {
  const all = Object.keys(PRESETS).concat(Object.keys(USER_PRESETS).filter(k => !PRESETS[k]));
  $('#presetGrid').innerHTML = all.map(k => `<div class="pr ${k === proj.style.preset ? 'on' : ''} ${PRESETS[k] ? '' : 'user'}" data-k="${esc(k)}" title="${esc(PRESET_INFO[k] || 'мой пресет')}"><img src="${USER_PRESETS[k] && USER_PRESETS[k].__thumb && !PRESETS[k] ? USER_PRESETS[k].__thumb : 'presets/' + esc(k) + '.jpg'}" onerror="this.style.visibility='hidden'">${esc(k)}${PRESETS[k] ? '' : '<i class="del" title="Удалить пресет">✕</i>'}</div>`).join('');
  $$('#presetGrid .pr').forEach(d => d.onclick = async e => {
    const k = d.dataset.k;
    if (e.target.classList.contains('del')) { if (!await Dialogs.confirm(`Удалить пресет «${k}»?`, { ok: 'Удалить', danger: true })) return; delete USER_PRESETS[k]; api.saveUserPresets(USER_PRESETS); if (proj.style.preset === k) proj.style.preset = 'melhor-lenta'; renderPresets(); scheduleRebuild(50); return; }
    proj.style.preset = k; // формат ролика выбирает пользователь: у всех встроенных пресетов записан 9:16, и клик по пресету сбрасывал 1:1 / 16:9 / 4:5
    if (USER_PRESETS[k] && USER_PRESETS[k].__fx) proj.style.fx = Object.assign({ grain: 0, vhs: 0, aberr: 0, shake: 0 }, USER_PRESETS[k].__fx);
    renderPresets(); fillStyle(); scheduleRebuild(50);
  });
}
function fillStyle() {
  const st = proj.style, c = st.custom, fx = st.fx;
  $$('#fmt button').forEach(b => b.classList.toggle('on', b.dataset.v === st.format)); $$('#perScene button').forEach(b => b.classList.toggle('on', +b.dataset.v === (proj.perScene || 2)));
  $('#vStart').value = st.start; $('#vEnd').value = st.end; $('#artist').value = st.artist; $('#songTitle').value = st.title; $('#wm').value = st.wm; $('#wmOp').value = st.wmOp;
  imgPicker($('#wmLogo'), st.wmImg, async () => { const a = await loadImage(true, 400); if (a) { st.wmImg = a; fillStyle(); scheduleRebuild(50); } }, () => { st.wmImg = ''; fillStyle(); scheduleRebuild(50); }, 'Логотип-картинка…', v => { st.wmImg = v; fillStyle(); scheduleRebuild(50); });
  $('#partType').value = st.part || ''; $('#partColor').value = st.partColor; const p = PRESETS[st.preset] || USER_PRESETS[st.preset] || {};
  $('#beat').value = st.beat ?? (p.beat || 0); $('#beatV').textContent = (+$('#beat').value).toFixed(3);
  $('#smokeOn').checked = !!st.smokeOn; $('#smokeA').value = st.smokeA; $('#smokeB').value = st.smokeB; $('#lead').value = st.lead ?? (p.lead ?? 0.2);
  $('#cOn').checked = !!c.on; $('#cBox').classList.toggle('off', !c.on); $('#cTheme').value = c.theme; $('#cBgType').value = c.bgType; $('#cBg1').value = c.bg1; $('#cBg2').value = c.bg2;
  $('#cFont').innerHTML = fontOptions(c.font); $('#cAccent').value = c.accent; $('#cTilt').value = c.tilt; $('#cTiltV').textContent = (+c.tilt).toFixed(1) + '°'; $('#cTrans').value = st.trans || '';
  [['grain', 2], ['vhs', 2], ['aberr', 2], ['shake', 2]].forEach(([k, d]) => { const id = 'fx' + k[0].toUpperCase() + k.slice(1); $('#' + id).value = fx[k] || 0; $('#' + id + 'V').textContent = +fx[k] ? (+fx[k]).toFixed(d) : 'выкл'; });
  const bm = st.bgMedia;
  const pickBg = async () => { const m = await pickMedia(); if (m) { st.bgMedia = Object.assign({ blur: 0, dim: 0.25, zoom: true }, bm || {}, m); fillStyle(); scheduleRebuild(50); } };
  const bp = $('#bgPick'); bp.className = 'imgPick';
  if (bm && (bm.asset || bm.path)) { bp.innerHTML = bm.type === 'video' ? `<span class="vchip">🎬 ${esc((bm.name || 'видео').slice(0, 26))}</span><button class="small">заменить</button><button class="small ghost">✕</button>` : `<img src="${asset('asset:' + bm.asset)}"><button class="small">заменить</button><button class="small ghost">✕</button>`;
    const bs = bp.querySelectorAll('button'); bs[0].onclick = pickBg; bs[1].onclick = () => { st.bgMedia = null; fillStyle(); scheduleRebuild(50); }; }
  else { bp.innerHTML = '<button class="small">Фото или видео…</button>'; bp.querySelector('button').onclick = pickBg; }
  $('#bgOpts').hidden = !(bm && (bm.asset || bm.path)); if (bm) { $('#bgBlur').value = bm.blur || 0; $('#bgBlurV').textContent = (bm.blur || 0) + ' px'; $('#bgDim').value = bm.dim || 0; $('#bgDimV').textContent = Math.round((bm.dim || 0) * 100) + '%'; $('#bgZoom').checked = !!bm.zoom; $('#bgZoomBox').hidden = bm.type === 'video'; }
  const io = st.intro, oo = st.outro; $('#inOn').checked = !!io.on; $('#inTitle').value = io.title || ''; $('#inTitle').placeholder = st.title || (proj.audioName || 'название трека').replace(/\.[^.]+$/, ''); $('#inDur').value = io.dur; $('#inLabel').value = io.label || '';
  $('#barSnap').checked = !!st.barSnap; $('#trAuto').checked = !!st.trim.auto; $('#trCutOn').checked = !!st.trim.cutOn; $('#trGap').value = st.trim.cutGap || 6; renderCuts();
  $('#fdIn').value = st.fadeIn ?? 0.3; $('#fdOut').value = st.fade ?? 1.2; $('#fdCurve').value = st.fadeCurve || 'smooth'; $('#quant').value = String(st.quant ?? 0); showBpm(); $('#fdVideo').checked = !!st.vfade;
  $('#fx3d').value = fx.tilt3d || 0; $('#fx3dV').textContent = +fx.tilt3d ? (+fx.tilt3d).toFixed(2) : 'выкл';
  $('#hookText').value = st.hook || ''; $('#hookDur').value = st.hookDur || 2.5; $('#fxEnergy').checked = !!(st.fx && st.fx.energy);
  const sx = st.sfx; $('#sfxOn').checked = !!sx.on; $('#sfxBox').classList.toggle('off', !sx.on); $('#sfxVol').value = sx.vol; $('#sfxVolV').textContent = Math.round(sx.vol * 100) + '%'; $('#sfxTrans').checked = !!sx.trans; $('#sfxEvents').checked = !!sx.events; $('#sfxAcc').checked = !!sx.acc;
  $('#sfxUi').checked = !!sx.ui; $('#sfxUiBox').classList.toggle('off', !sx.ui); $('#sfxUiVol').value = sx.uiVol ?? .7; $('#sfxUiVolV').textContent = Math.round((sx.uiVol ?? .7) * 100) + '%';
  $('#outOn').checked = !!oo.on; $('#outText').value = oo.text || ''; $('#outDur').value = oo.dur; $('#outSub').value = oo.sub || ''; $('#adlibs').value = st.adlibs || 'chip';
  updateTransport(curT());
}
async function pickMedia() { const f = await api.pickMedia(); if (!f) return null; return mediaFromFile(f); }
['bgBlur', 'bgDim'].forEach(id => $('#' + id).addEventListener('input', e => { const bm = proj.style.bgMedia; if (!bm) return; bm[id === 'bgBlur' ? 'blur' : 'dim'] = +e.target.value; $('#' + id + 'V').textContent = id === 'bgBlur' ? e.target.value + ' px' : Math.round(e.target.value * 100) + '%'; scheduleRebuild(250); }));
$('#bgZoom').onchange = e => { if (proj.style.bgMedia) { proj.style.bgMedia.zoom = e.target.checked; scheduleRebuild(50); } };
const bindIO = (sel, obj, key, conv = v => v, ev = 'input') => $(sel).addEventListener(ev, e => { proj.style[obj][key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); specCache = null; scheduleRebuild(300); });
bindIO('#inOn', 'intro', 'on', v => v, 'change'); bindIO('#inTitle', 'intro', 'title'); bindIO('#inDur', 'intro', 'dur', v => +v, 'change'); bindIO('#inLabel', 'intro', 'label');
bindIO('#outOn', 'outro', 'on', v => v, 'change'); bindIO('#outText', 'outro', 'text'); bindIO('#outDur', 'outro', 'dur', v => +v, 'change'); bindIO('#outSub', 'outro', 'sub');
$('#trAuto').onchange = e => { proj.style.trim.auto = e.target.checked; touch(); };
$('#trCutOn').onchange = e => { proj.style.trim.cutOn = e.target.checked; touch(); };
$('#trGap').onchange = e => { proj.style.trim.cutGap = +e.target.value || 6; touch(); };
$('#trNow').onclick = () => autoTrim(false);
$('#barSnap').onchange = e => { proj.style.barSnap = e.target.checked; if (e.target.checked && !beatInfo) toast('Нужен загруженный трек'); scheduleRebuild(50); };
$('#fdIn').onchange = e => { proj.style.fadeIn = Math.max(0, +e.target.value || 0); scheduleRebuild(50); };
$('#fdOut').onchange = e => { proj.style.fade = Math.max(0, +e.target.value || 0); scheduleRebuild(50); };
$('#fdCurve').onchange = e => { proj.style.fadeCurve = e.target.value; touch(); };
$('#quant').onchange = e => { proj.style.quant = +e.target.value; touch(); scheduleRebuild(50); };
$('#fdVideo').onchange = e => { proj.style.vfade = e.target.checked; scheduleRebuild(50); };
$('#hookText').addEventListener('input', e => { proj.style.hook = e.target.value; scheduleRebuild(400); });
$('#hookDur').addEventListener('change', e => { proj.style.hookDur = +e.target.value; scheduleRebuild(50); });
$('#fx3d').addEventListener('input', e => { proj.style.fx.tilt3d = +e.target.value; $('#fx3dV').textContent = +e.target.value ? (+e.target.value).toFixed(2) : 'выкл'; scheduleRebuild(250); });
$('#fxEnergy').onchange = e => { proj.style.fx.energy = e.target.checked; if (e.target.checked && !beatInfo) toast('Нужен загруженный трек'); scheduleRebuild(50); };
['On', 'Trans', 'Events', 'Acc'].forEach(k => $('#sfx' + k).addEventListener('change', e => { proj.style.sfx[k === 'On' ? 'on' : k.toLowerCase()] = e.target.checked; fillStyle(); scheduleRebuild(50); }));
$('#sfxUi').addEventListener('change', e => { proj.style.sfx.ui = e.target.checked; if (proj.style.sfx.uiVol == null) proj.style.sfx.uiVol = .7; fillStyle(); scheduleSfx(buildSpec(false)); touch(); });
$('#sfxUiVol').addEventListener('input', e => { proj.style.sfx.uiVol = +e.target.value; $('#sfxUiVolV').textContent = Math.round(e.target.value * 100) + '%'; });
$('#sfxUiVol').addEventListener('change', () => { scheduleSfx(buildSpec(false)); touch(); });
$('#sfxVol').addEventListener('input', e => { proj.style.sfx.vol = +e.target.value; $('#sfxVolV').textContent = Math.round(e.target.value * 100) + '%'; if (sfxGain) sfxGain.gain.value = +e.target.value; touch(); });
$('#litePrev').checked = localStorage.getItem('ls-lite') === '1'; $('#litePrev').onchange = e => { localStorage.setItem('ls-lite', e.target.checked ? '1' : '0'); rebuildPreview(); };
$('#adlibs').onchange = e => { proj.style.adlibs = e.target.value; renderScene(); scheduleRebuild(50); };
const bindStyle = (sel, key, conv = v => v, ev = 'input', rebuildSpec = false) => $(sel).addEventListener(ev, e => { proj.style[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); if (rebuildSpec) specCache = null; if (key === 'beat') $('#beatV').textContent = (+e.target.value).toFixed(3); scheduleRebuild(); if (rebuildSpec) Timeline.redraw(); });
bindStyle('#vStart', 'start', v => +v, 'change', true); bindStyle('#vEnd', 'end', v => +v, 'change', true);
bindStyle('#artist', 'artist'); bindStyle('#songTitle', 'title'); bindStyle('#wm', 'wm'); bindStyle('#wmOp', 'wmOp', v => +v);
bindStyle('#partType', 'part', v => v, 'change'); bindStyle('#partColor', 'partColor'); bindStyle('#beat', 'beat', v => +v);
bindStyle('#smokeOn', 'smokeOn', v => v, 'change'); bindStyle('#smokeA', 'smokeA'); bindStyle('#smokeB', 'smokeB'); bindStyle('#lead', 'lead', v => v === '' ? null : +v, 'change');
bindStyle('#cTrans', 'trans', v => v, 'change');
const bindC = (sel, key, conv = v => v, ev = 'input') => $(sel).addEventListener(ev, async e => {
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (key === 'font' && v === '__load') { const fam = await loadFont(); if (!fam) { fillStyle(); return; } v = fam; }
  proj.style.custom[key] = conv(v); if (key === 'on' || key === 'font' || key === 'tilt') fillStyle(); scheduleRebuild();
});
bindC('#cOn', 'on', v => v, 'change'); bindC('#cTheme', 'theme', v => v, 'change'); bindC('#cBgType', 'bgType', v => v, 'change'); bindC('#cBg1', 'bg1'); bindC('#cBg2', 'bg2');
bindC('#cFont', 'font', v => v, 'change'); bindC('#cAccent', 'accent'); bindC('#cTilt', 'tilt', v => +v);
function kmeans(px, k) {
  let C = []; for (let i = 0; i < k; i++) C.push(px[Math.floor((i + .5) / k * px.length)].slice());
  let lab = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < px.length; i++) { let bd = 1e9, bi = 0; for (let j = 0; j < k; j++) { const d = (px[i][0] - C[j][0]) ** 2 + (px[i][1] - C[j][1]) ** 2 + (px[i][2] - C[j][2]) ** 2; if (d < bd) { bd = d; bi = j; } } lab[i] = bi; }
    const S = C.map(() => [0, 0, 0, 0]); px.forEach((p, i) => { const s = S[lab[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }); C = S.map((s, j) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : C[j]);
  }
  const cnt = C.map(() => 0); lab.forEach(l => cnt[l]++); return C.map((c, j) => ({ c, n: cnt[j] })).sort((a, b) => b.n - a.n);
}
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c, d, q) => c.map((v, i) => v * (1 - q) + d[i] * q), lumOf = c => (.2126 * c[0] + .7152 * c[1] + .0722 * c[2]) / 255;
const satOf = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
async function paletteFromCover() {
  const a = await loadImage(false, 400); if (!a) return; const img = new Image(); img.src = proj.assets[a.slice(6)]; await img.decode();
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data, px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  const K = kmeans(px, 6), dom = K[0].c, acc = K.slice().sort((x, y) => (satOf(y.c) * (.4 + lumOf(y.c)) * Math.sqrt(y.n)) - (satOf(x.c) * (.4 + lumOf(x.c)) * Math.sqrt(x.n)))[0].c, sec = (K[1] || K[0]).c;
  const st = proj.style, c = st.custom, dark = lumOf(dom) < .38;
  c.on = true; c.theme = dark ? 'dark' : 'cards'; c.bgType = 'gradient';
  c.bg1 = hex(dark ? mix(dom, [0, 0, 0], .45) : mix(dom, [255, 255, 255], .78)); c.bg2 = hex(dark ? mix(sec, [0, 0, 0], .3) : mix(sec, [255, 255, 255], .6)); c.accent = hex(acc);
  st.partColor = hex(mix(acc, [255, 255, 255], .4)); st.smokeOn = true; st.smokeA = hex(acc); st.smokeB = hex(sec);
  delete proj.assets[a.slice(6)]; fillStyle(); scheduleRebuild(50);
  toast('Цвета взяты с обложки: ' + [c.bg1, c.bg2, c.accent].join(' · '), 3500);
}
$('#cCover').onclick = paletteFromCover;
$('#cFontLoad').onclick = async () => { const fam = await loadFont(); if (fam) { proj.style.custom.font = fam; proj.style.custom.on = true; fillStyle(); scheduleRebuild(50); toast('Шрифт «' + fam + '» добавлен'); } };
['grain', 'vhs', 'aberr', 'shake'].forEach(k => { const id = '#fx' + k[0].toUpperCase() + k.slice(1); $(id).addEventListener('input', e => { proj.style.fx[k] = +e.target.value; $(id + 'V').textContent = +e.target.value ? (+e.target.value).toFixed(2) : 'выкл'; scheduleRebuild(250); }); });
$('#fxReset').onclick = () => { proj.style.fx = { grain: 0, vhs: 0, aberr: 0, shake: 0, energy: false }; fillStyle(); scheduleRebuild(50); };
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
  const list = await api.importPreset(); if (!list) return; await addPresets(list);
};
async function addPresets(list) {
  let n = 0, last = null;
  for (const it of list) {
    try { const j = JSON.parse(it.json), p = j && typeof j === 'object' && 'preset' in j ? j.preset : j; if (!p || typeof p !== 'object' || Array.isArray(p)) throw 0; let name = (j.name || it.name || 'пресет').slice(0, 40); while (PRESETS[name] || (USER_PRESETS[name] && JSON.stringify(USER_PRESETS[name]) !== JSON.stringify(p))) name += ' 2'; USER_PRESETS[name] = p; n++; last = name; }
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
// пока кнопка мыши зажата (тянут слово, границу сцены, ползунок), шаг истории не записывается — всё перетаскивание отменяется одним Ctrl+Z
let ptrHeld = false; window.addEventListener('pointerdown', () => { ptrHeld = true; }, true); ['pointerup', 'pointercancel', 'blur'].forEach(ev => window.addEventListener(ev, () => { ptrHeld = false; }, true)); window.addEventListener('pointermove', e => { if (!e.buttons) ptrHeld = false; }, true);
function histCommit(force) { if (!force && (ptrHeld || Timeline.dragging)) { clearTimeout(histTimer); histTimer = setTimeout(histCommit, 300); return; } const s = snap(); if (s === hist[hpos]) return; hist = hist.slice(0, hpos + 1); hist.push(s); if (hist.length > 120) hist.shift(); hpos = hist.length - 1; updUndo(); }
function touch() { dirty = true; clearTimeout(histTimer); histTimer = setTimeout(histCommit, 400); updTitle(); }
function histGo(d) {
  if (Timeline.dragging) return; // Ctrl+Z посреди перетаскивания на таймлайне подменил бы слова под мышью
  clearTimeout(histTimer); histCommit(true); const np = hpos + d; if (np < 0 || np >= hist.length) return;
  hpos = np; const keep = proj.assets, wasAudio = proj.audioPath, wasBpm = proj.bpm; proj = JSON.parse(hist[hpos]); proj.assets = keep; dirty = true; $('#lyrics').value = proj.lyrics || '';
  // отменили или вернули выбор трека — играть должен трек из восстановленного состояния
  if (proj.audioPath !== wasAudio) { audio.pause(); playing = false; $('#bPlay').textContent = '▶'; if (proj.audioPath) loadAudio({ path: proj.audioPath, name: proj.audioName }).then(() => { $('#audioName').textContent = proj.audioName; Timeline.fit(); scheduleRebuild(50, true); }).catch(e => toastErr('Не удалось прочитать файл: ' + e.message)); else { audio.removeAttribute('src'); audioData = null; beatInfo = null; specCache = null; showBpm(); $('#audioName').textContent = 'не выбран'; } }
  if (sel >= proj.scenes.length) sel = Math.max(0, proj.scenes.length - 1); specCache = null;
  if (proj.audioPath === wasAudio && (proj.bpm || null) !== (wasBpm || null) && audioData) analyzeBeats(); // отменили смену темпа — сетка битов тоже прежняя
  renderAll(); updUndo(); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildPreview, 60); toast(d < 0 ? 'Отменено' : 'Повторено', 900);
}
function updUndo() { $('#bUndo').disabled = hpos <= 0; $('#bRedo').disabled = hpos >= hist.length - 1; }
$('#bUndo').onclick = () => histGo(-1); $('#bRedo').onclick = () => histGo(1);

// ---------- проект, автосохранение, недавние ----------
function updTitle() { $('#projName').textContent = (projPath ? projPath.split(/[\\/]/).pop() : 'новый проект') + (dirty ? ' •' : ''); }
function renderAll() { renderStickers(); msel = new Set([...msel].filter(i => i < proj.scenes.length)); if (!msel.size || !msel.has(sel)) msel = new Set([sel]); renderStrip(); renderScene(); renderPresets(); fillStyle(); updTitle(); }
function applyProject(p, path) {
  proj = merge(newProject(), p); proj.style = merge(newProject().style, p.style || {}); proj.assets = p.assets || {}; proj.fonts = p.fonts || [];
  // проекты старых версий: у сцен могло не быть полей (f и т. п.), сцены за пределами слов не показываются и ломали таймлайн
  if (!Array.isArray(proj.words)) proj.words = []; if (!Array.isArray(proj.scenes)) proj.scenes = []; if (!Array.isArray(proj.style.cuts)) proj.style.cuts = [];
  proj.scenes = proj.scenes.filter(sc => sc && +sc.a >= 0 && +sc.a < proj.words.length && +sc.b > +sc.a).map(sc => Object.assign(blankScene(+sc.a, Math.min(+sc.b, proj.words.length), sc.tpl || 'chat'), sc, { a: +sc.a, b: Math.min(+sc.b, proj.words.length), f: sc.f && typeof sc.f === 'object' ? sc.f : {} }));
  projPath = path || null; $('#alLang').value = proj.lang || 'ru'; $('#alVocals').checked = !!proj.vocals; $('#alVocalsQ').value = proj.vocalsQ || 'fast'; $('#alVocalsQ').hidden = !proj.vocals; $('#alVocHint').hidden = !proj.vocals; $('#lyrics').value = proj.lyrics; $('#alFrom').value = proj.alFrom; $('#alTo').value = proj.alTo; $('#audioName').textContent = proj.audioName || 'не выбран';
  sel = 0; specCache = null; beatInfo = null; showBpm(); registerFonts();
}
async function afterLoad() {
  if (!proj.audioPath) { audio.pause(); playing = false; audio.removeAttribute('src'); audioData = null; $('#bPlay').textContent = '▶'; } // у открытого проекта трека нет — прежний трек не должен играть
  if (proj.audioPath) { try { await loadAudio({ path: proj.audioPath, name: proj.audioName }); } catch (e) { audio.removeAttribute('src'); audioData = null; $('#audioName').textContent = (proj.audioName || 'трек') + ' — не найден';
      if (await Dialogs.confirm(`Трек «${proj.audioName || ''}» не найден по старому пути: файл переместили или переименовали. Указать, где он лежит?`, { ok: 'Указать файл…', cancel: 'Не сейчас' })) { const info = await api.pickAudio(); if (info) { try { await loadAudio(info); touch(); toast('Трек подключён заново'); } catch (x) { toastErr('Не удалось прочитать файл: ' + x.message); } } }
      else toast('Трек не подключён — выберите его кнопкой «Выбрать файл…»', 4500); } }
  renderAll(); Timeline.fit(); histReset(); dirty = false; updTitle(); rebuildPreview();
}
// В файл проекта идут только те картинки и шрифты, что сейчас используются. Заменённые и «вырезанные» версии
// остаются в памяти (для отмены), но в файл и в автосохранение не попадают — проект не разбухает.
function projJSON() {
  const { assets, ...rest } = proj, body = JSON.stringify(rest), used = {};
  for (const k in assets || {}) { const q = JSON.stringify(k).slice(1, -1); if (body.includes('asset:' + q) || body.includes('"asset":"' + q + '"')) used[k] = assets[k]; }
  return JSON.stringify(Object.assign({}, rest, { assets: used }));
}
async function saveProject(as) {
  proj.lyrics = $('#lyrics').value;
  const p = await api.saveProject(projJSON(), (proj.audioName || 'проект').replace(/\.[^.]+$/, '') + '.lsp', as ? null : projPath);
  if (p) { projPath = p; dirty = false; updTitle(); api.clearAutosave(); toast('Сохранено'); }
}
async function openProject(path) {
  if (dirty && (proj.words.length || (proj.lyrics || '').trim()) && !await Dialogs.confirm('Текущий проект не сохранён. Открыть другой?', { ok: 'Открыть' })) return; // вставленный, но ещё не синхронизированный текст тоже работа
  const r = await api.openProject(path); if (!r) return;
  let p; try { p = JSON.parse(r.json); } catch (e) { return toastErr('Файл проекта повреждён'); }
  applyProject(p, r.path); await afterLoad();
}
async function newFrom(keepStyle) {
  if (dirty && (proj.words.length || (proj.lyrics || '').trim()) && !await Dialogs.confirm('Начать новый проект? Несохранённые изменения пропадут.', { ok: 'Начать новый' })) return;
  const old = proj, np = newProject();
  if (keepStyle) {
    np.style = JSON.parse(JSON.stringify(old.style)); Object.assign(np.style, { start: 0, end: 0, title: '', hook: '' }); np.style.intro.title = '';
    np.perScene = old.perScene; np.lang = old.lang; np.vocals = old.vocals; np.fonts = old.fonts;
    const used = JSON.stringify(np.style) + JSON.stringify(np.fonts); for (const id in old.assets) if (used.includes(id)) np.assets[id] = old.assets[id];
  } else if (PROFILE.logo || PROFILE.color) { proj = np; applyProfileToProject(); }
  applyProject(np, null); audio.removeAttribute('src'); audioData = null; beatInfo = null; $('#alignStatus').textContent = ''; renderAll(); Timeline.fit(); histReset(); dirty = false; updTitle(); rebuildPreview();
  if (keepStyle) toast('Новый проект в том же стиле — выберите трек и вставьте текст', 3000);
}
const menuBtn = (btn, menu, acts) => { $(btn).onclick = e => { e.stopPropagation(); ['#openMenu', '#helpMenu', '#newMenu', '#saveMenu'].forEach(m => { if (m !== menu) $(m).hidden = true; }); $(menu).hidden = !$(menu).hidden; };
  $$(menu + ' button').forEach(b => b.onclick = () => { $(menu).hidden = true; acts[b.dataset.act](); }); };
menuBtn('#bNew', '#newMenu', { blank: () => newFrom(false), style: () => newFrom(true), batch: openBatch });
menuBtn('#bSave', '#saveMenu', { save: () => saveProject(false), as: () => saveProject(true), bundle: saveBundle, lrc: () => exportTimings('lrc'), srt: () => exportTimings('srt') });
async function saveBundle() {
  if (!proj.audioPath) return toast('В проекте нет трека');
  proj.lyrics = $('#lyrics').value; const name = (proj.audioName || 'проект').replace(/\.[^.]+$/, '');
  try { const p = await api.saveBundle(projJSON(), name + '.lspz'); if (p) toast('Сохранено вместе с треком: ' + p.split(/[\\/]/).pop(), 3000); } catch (e) { toastErr('Не удалось сохранить: ' + e.message); }
}
$('#bOpen').onclick = async e => {
  e.stopPropagation(); const m = $('#openMenu'); if (!m.hidden) { m.hidden = true; return; }
  const rec = await api.recent();
  m.innerHTML = `<button data-p="">Открыть файл…</button><button data-timing="1" title="Готовые тайминги строк: слова расставятся по ним без нейросети">Тайминги из LRC / SRT…</button>` + (rec.length ? '<div class="msep">Недавние</div>' + rec.map(r => `<button data-p="${esc(r.path)}" title="${esc(r.path)}">${esc(r.name)}<span class="muted small"> · ${new Date(r.time).toLocaleDateString('ru-RU')}</span></button>`).join('') : '');
  m.querySelectorAll('button').forEach(b => b.onclick = async () => { m.hidden = true; if (b.dataset.timing) { const f = await api.openText(['lrc', 'srt'], 'Тайминги: LRC или SRT'); if (f) importTimings(f.text, f.name); return; } openProject(b.dataset.p || undefined); }); m.hidden = false;
};
$('#bHelp').onclick = e => { e.stopPropagation(); const m = $('#helpMenu'); m.hidden = !m.hidden; };
document.addEventListener('click', () => { ['#openMenu', '#helpMenu', '#newMenu', '#saveMenu'].forEach(m => $(m).hidden = true); });
$$('#helpMenu button').forEach(b => b.onclick = () => {
  const a = b.dataset.act; $('#helpMenu').hidden = true;
  if (a === 'keys') $('#keysModal').hidden = false; else if (a === 'report') copyReport(); else if (a === 'logs') api.openLogFolder(); else if (a === 'update') checkUpdate(true); else if (a === 'selftest') openSelfTest(); else if (a === 'licenses') openLicenses(); else if (a === 'models') openModels(); else if (a === 'lang') setLang(LANG === 'en' ? 'ru' : 'en');
});
setInterval(() => { if (dirty && (proj.words.length || proj.lyrics)) { proj.lyrics = $('#lyrics').value; api.autosave(projJSON()).catch(() => {}); } }, 15000);
window.__beforeClose = async () => {
  if (dirty && (proj.words.length || proj.lyrics)) { proj.lyrics = $('#lyrics').value; try { await api.autosave(projJSON()); } catch (e) {} }
  else { try { await api.clearAutosave(); } catch (e) {} }
  return true;
};
$('#alVocals').onchange = e => { $('#alVocHint').hidden = !e.target.checked; $('#alVocalsQ').hidden = !e.target.checked; };
$('#alVocalsQ').onchange = e => { proj.vocalsQ = e.target.value; touch(); };
$('#lyrics').addEventListener('input', () => { proj.lyrics = $('#lyrics').value; touch(); });

// ---------- профиль артиста ----------
let pfDraft = {};
function renderProfile() {
  $('#pfNick').value = pfDraft.nick || ''; $('#pfColor').value = pfDraft.color || '#9B6BFF';
  imgPicker($('#pfAvatar'), pfDraft.avatar, async () => { const a = await loadImage(false, 400); if (a) { pfDraft.avatar = proj.assets[a.slice(6)]; renderProfile(); } }, () => { delete pfDraft.avatar; renderProfile(); }, 'Выбрать аватарку…', v => { pfDraft.avatar = proj.assets[v.slice(6)]; renderProfile(); });
  imgPicker($('#pfLogo'), pfDraft.logo, async () => { const a = await loadImage(true, 400); if (a) { pfDraft.logo = proj.assets[a.slice(6)]; renderProfile(); } }, () => { delete pfDraft.logo; renderProfile(); }, 'Выбрать логотип…', v => { pfDraft.logo = proj.assets[v.slice(6)]; renderProfile(); });
}
$('#bProfile').onclick = () => { pfDraft = Object.assign({}, PROFILE); renderProfile(); $('#profileModal').hidden = false; };
$('#pfNick').oninput = e => pfDraft.nick = e.target.value.trim(); $('#pfColor').oninput = e => pfDraft.color = e.target.value;
function applyProfileToProject() {
  const st = proj.style; if (PROFILE.nick) { st.artist = PROFILE.nick; st.wm = PROFILE.nick; }
  if (PROFILE.logo) { const id = uid(); proj.assets[id] = PROFILE.logo; st.wmImg = 'asset:' + id; }
  if (PROFILE.color) st.custom.accent = PROFILE.color;
}
$('#pfSave').onclick = async () => { PROFILE = Object.assign({}, pfDraft); await api.saveProfile(PROFILE); $('#profileModal').hidden = true; renderAll(); scheduleRebuild(50); toast('Профиль сохранён — ник и аватарка подставятся во все шаблоны'); };
$('#pfApply').onclick = async () => { PROFILE = Object.assign({}, pfDraft); await api.saveProfile(PROFILE); applyProfileToProject(); $('#profileModal').hidden = true; renderAll(); scheduleRebuild(50); toast('Профиль применён к проекту'); };

// ---------- проверка системы ----------
let stLines = [], stBusy = false;
const ST_ICON = { ok: '✓', warn: '!', err: '✕', info: 'i', run: '…' };
function stRender() {
  let g = '', h = '';
  for (const r of stLines) { if (r.group !== g) { g = r.group; h += `<div class="stg">${esc(g)}</div>`; } h += `<div class="sr ${r.level}"><i>${ST_ICON[r.level] || ''}</i><b>${esc(r.name)}</b><span>${esc(r.text)}</span></div>`; }
  $('#stRes').innerHTML = h;
}
// небольшой ролик для проверки: две сцены (виджет и типографика), переход, эффекты
function selfTestSpec() {
  const spec = buildSpec(true); delete spec.intro; delete spec.outro; delete spec.hook; delete spec.stickers; delete spec.vfade; delete spec.spec; delete spec.beats; delete spec.bgMedia;
  const en = LANG === 'en', ws = en ? ['system', 'check', 'all', 'good'] : ['проверка', 'системы', 'всё', 'работает'];
  spec.start = 0; spec.end = 3; spec.duration = 3; spec.words = ws.map((w, i) => ({ w, t: .15 + i * .55, e: .55 + i * .55, line: i < 2 ? 0 : 1 }));
  spec.scenes = [{ words: [0, 2], t0: 0, t1: 1.4, widget: { type: 'player', title: en ? 'system check' : 'проверка системы', artist: 'Lyric Studio', emoji: '🎧' } }, { words: [2, 4], t0: 1.4, t1: 3, kinetic: { mode: 'stack', accent: '#E10600', words: ws[3], rot: 4 } }];
  return spec;
}
// контрольный ролик для автоматической проверки экспорта
window.__ciJob = (fmt, alpha) => { const keep = proj.style.format; proj.style.format = fmt; let spec; try { spec = selfTestSpec(); if (alpha) spec.transparent = true; } finally { proj.style.format = keep; } const [W, H] = FMT[fmt]; return { html: engineHTML(spec, 'app://app/'), W, H }; };
// проверка вёрстки кадров в настоящем Electron (ciRun): проект из тестовых слов, нужный пресет, формат и шаблон первых двух сцен
window.__ciGeomJob = (W0, fmt, pk, tpl) => { const keep = JSON.stringify(proj); try {
  proj.words = JSON.parse(JSON.stringify(W0)); proj.duration = Math.max(10, proj.words[proj.words.length - 1].e + 2); proj.style.start = 0; proj.style.end = proj.duration; proj.style.cuts = [];
  autoScenes(); proj.style.preset = pk; const p = PRESETS[pk] || {}; if (p.fx) proj.style.fx = Object.assign({}, p.fx); proj.style.format = fmt;
  proj.scenes.slice(0, 2).forEach(s => { s.tpl = tpl; s.f = {}; delete s.dx; delete s.dy; delete s.scale; delete s.capY; });
  const spec = buildSpec(false), ts = [0, 1].map(i => { const sc = proj.scenes[i], nx = proj.words[sc.b] ? proj.words[sc.b].t : 1e9; return Math.max(proj.words[sc.a].t + .1, Math.min(proj.words[sc.b - 1].t + .2, nx - .5)); });
  const [W, H] = FMT[fmt]; return { html: engineHTML(spec, 'app://app/'), W, H, ts };
} finally { proj = JSON.parse(keep); } };
async function runSelfTest() {
  if (stBusy) return; stBusy = true; $('#stRun').disabled = true; $('#stBar').style.width = '0'; const st = $('#stStatus'); st.className = 'status'; st.textContent = 'Проверяю компоненты…';
  stLines = [{ group: 'Проверка', name: 'Компоненты', level: 'run', text: 'проверяю…' }]; stRender();
  try { stLines = await api.selfTest(); } catch (e) { stLines = [{ group: 'Проверка', name: 'Компоненты', level: 'err', text: e.message || String(e) }]; }
  stRender();
  // звуковые эффекты: синтез в окне программы
  let sfx = null;
  try { const buf = await SFX.render([{ t: .2, type: 'whoosh' }, { t: .8, type: 'pop' }, { t: 1.4, type: 'hit' }, { t: 2, type: 'ding' }], 0, 3); let peak = 0; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i += 7) peak = Math.max(peak, Math.abs(d[i]));
    sfx = { data: SFX.wav(buf), vol: .7 }; stLines.push({ group: 'Звук', name: 'Звуковые эффекты', level: peak > .01 ? 'ok' : 'err', text: peak > .01 ? 'синтезируются' : 'получилась тишина' }); }
  catch (e) { stLines.push({ group: 'Звук', name: 'Звуковые эффекты', level: 'err', text: e.message || String(e) }); }
  try { const ctx = new OfflineAudioContext(1, 4410, 44100); await ctx.startRendering(); stLines.push({ group: 'Звук', name: 'Воспроизведение', level: 'ok', text: 'WebAudio работает' }); } catch (e) { stLines.push({ group: 'Звук', name: 'Воспроизведение', level: 'err', text: e.message }); }
  stLines.push({ group: 'Пробный экспорт', name: '3 секунды, MP4 со звуком', level: 'run', text: 'рендерю…' }); stRender();
  const row = stLines[stLines.length - 1], [W, H] = FMT[proj.style.format];
  try {
    const spec = selfTestSpec(), job = { html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? 960 : 540, start: 0, end: 3, outDur: 3, cuts: [], fade: .5, fadeIn: .2, fadeOut: .5, fadeCurve: 'smooth', fps: 30, draft: false, container: 'mp4', gpu: true, name: 'selftest', sfx };
    const r = await api.selfTestExport(job, p => { if (p) { $('#stBar').style.width = Math.round((p.frac || 0) * 100) + '%'; st.textContent = p.text || ''; } });
    if (r && r.ok) { const okDur = Math.abs(r.duration - 3) < .3, bad = !okDur || !r.audio;
      Object.assign(row, { level: bad ? 'err' : r.viaCpu ? 'warn' : 'ok', text: bad ? `файл получился неправильный: ${r.duration.toFixed(2)} с${r.audio ? '' : ', без звука'}` : `готово за ${r.seconds.toFixed(1)} с · ${(r.size / 1024).toFixed(0)} КБ · ${r.duration.toFixed(2)} с со звуком` + (r.viaCpu ? ' · видеокарта не справилась, сработал процессор' : r.gpu ? ' · через ' + r.gpu : '') }); }
    else Object.assign(row, { level: 'err', text: (r && r.error) || 'не получилось' });
  } catch (e) { Object.assign(row, { level: 'err', text: e.message || String(e) }); }
  try { const spec = selfTestSpec(), url = await api.renderFrame({ html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? 640 : 360, t: 2.2 }); stLines.push({ group: 'Пробный экспорт', name: 'Кадр в PNG', level: url && /^data:image\/png;base64,.{60}/.test(url) ? 'ok' : 'err', text: url && /^data:image\/png;base64,.{60}/.test(url) ? 'сохраняется' : 'пустой кадр' }); }
  catch (e) { stLines.push({ group: 'Пробный экспорт', name: 'Кадр в PNG', level: 'err', text: e.message || String(e) }); }
  stRender(); $('#stBar').style.width = '100%';
  const errs = stLines.filter(r => r.level === 'err').length, warns = stLines.filter(r => r.level === 'warn').length;
  st.className = 'status ' + (errs ? 'err' : 'ok'); st.textContent = errs ? `Есть проблемы: ${errs}. Скопируйте результат и пришлите его вместе с отчётом об ошибке.` : warns ? `Всё работает. Замечаний: ${warns} — на работу не влияют, но могут замедлять.` : 'Всё в порядке.';
  api.log('info', 'проверка системы: ' + stLines.map(r => `${r.name}=${r.level}`).join(', '));
  stBusy = false; $('#stRun').disabled = false;
}
// язык интерфейса: перевод применяется при загрузке окна, поэтому проект переносится через перезагрузку
function setLang(l) {
  try { localStorage.setItem('ls-lang', l); } catch (e) {}
  proj.lyrics = $('#lyrics').value;
  try { sessionStorage.setItem('ls-reload', JSON.stringify({ proj, path: projPath, dirty })); } catch (e) {}
  api.setLang(l).catch(() => {}).finally(() => location.reload());
}
// ---------- тайминги: экспорт LRC / SRT и импорт ----------
function timingLines() { const L = []; proj.words.forEach(w => { const l = L[L.length - 1]; if (!l || l.line !== w.line) L.push({ line: w.line, t: w.t, e: w.e, text: w.w }); else { l.text += ' ' + w.w; l.e = Math.max(l.e, w.e); } }); return L; }
async function exportTimings(kind) {
  if (!proj.words.length) return toast('Сначала синхронизируйте слова');
  const L = timingLines(), p2 = n => String(n).padStart(2, '0'), base = (proj.audioName || 'lyrics').replace(/\.[^.]+$/, ''); let out = '';
  if (kind === 'lrc') { out = L.map(l => { const cs = Math.round(Math.max(0, l.t) * 100); return `[${p2(Math.floor(cs / 6000))}:${((cs % 6000) / 100).toFixed(2).padStart(5, '0')}]${l.text}`; }).join('\n') + '\n'; } // 59,996 с → [01:00.00], не [00:60.00]
  else {
    // субтитры идут по времени готового ролика: от начала отрезка и без вырезанных проигрышей
    const [a, b] = effRange(), cuts = activeCuts(a, b), vt = t => Math.max(0, s2o(Math.min(Math.max(t, a), b), cuts) - s2o(a, cuts)), f = t => { const ms = Math.round(t * 1000); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`; };
    const V = L.filter(l => l.e > a && l.t < b && !cuts.some(c => l.t >= c.a && l.e <= c.b)); if (!V.length) return toast('В выбранном отрезке ролика нет строк');
    out = V.map((l, i) => { const t0 = vt(l.t), t1 = Math.max(t0 + .3, Math.min(V[i + 1] ? vt(V[i + 1].t) - .02 : 1e9, vt(l.e) + .7)); return `${i + 1}\n${f(t0)} --> ${f(t1)}\n${l.text}\n`; }).join('\n');
  }
  try { const p = await api.saveText(out, base, kind, kind === 'lrc' ? 'Сохранить тайминги LRC' : 'Сохранить субтитры SRT'); if (p) toast(kind === 'lrc' ? 'LRC сохранён — время строк по треку' : 'SRT сохранён — время по готовому ролику', 3200); } catch (e) { toastErr('Не удалось сохранить: ' + e.message); }
}
function parseTimings(text) {
  const L = [], sec = (h, m, s2) => (+h || 0) * 3600 + (+m || 0) * 60 + parseFloat(String(s2).replace(',', '.'));
  if (/-->/.test(text)) { text.replace(/\r/g, '').split(/\n\s*\n/).forEach(bl => { const ls = bl.split('\n').filter(x => x.trim() !== ''), i = ls.findIndex(x => x.includes('-->')); if (i < 0) return; const m = ls[i].match(/(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)\s*-->\s*(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)/); if (!m) return; const tx = ls.slice(i + 1).join(' ').replace(/<[^>]+>|\{[^}]+\}/g, '').trim(); if (tx) L.push({ t: sec(m[1], m[2], m[3]), e: sec(m[4], m[5], m[6]), text: tx }); }); L.sort((x, y) => x.t - y.t); } // субтитры бывают не по порядку
  else { text.split(/\r?\n/).forEach(ln => { const ts = [...ln.matchAll(/\[(?:(\d+):(?=\d+:\d+\.))?(\d+):(\d+(?:[.:]\d+)?)\]/g)], tx = ln.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim(); if (!ts.length || !tx) return; ts.forEach(m => L.push({ t: (+m[1] || 0) * 3600 + +m[2] * 60 + parseFloat(m[3].replace(':', '.')), text: tx })); }); L.sort((x, y) => x.t - y.t); }
  return L;
}
async function importTimings(text, name) {
  const L = parseTimings(text); if (!L.length) return toastErr('В файле не нашлось строк с временем — нужен LRC или SRT');
  if (proj.words.length && !await Dialogs.confirm('Заменить текст и тайминги проекта данными из файла?', { ok: 'Заменить' })) return;
  const words = [];
  L.forEach((l, i) => { const ws = l.text.split(/\s+/).filter(Boolean), next = L[i + 1] ? L[i + 1].t : 1e9, end = Math.max(l.t + .3, Math.min(l.e != null ? l.e : 1e9, next - .05, l.t + Math.max(1.2, ws.length * .55))), total = ws.reduce((a, w) => a + [...w].length + 1, 0); let acc = 0;
    ws.forEach(w => { const d = ([...w].length + 1) / total * (end - l.t); words.push({ w, t: +(l.t + acc).toFixed(2), e: +(l.t + acc + d * .9).toFixed(2), line: i }); acc += d; }); });
  // строки, начавшиеся почти одновременно, не должны перепутать порядок слов
  for (let k = 1; k < words.length; k++) if (words[k].t <= words[k - 1].t) { words[k].t = +(words[k - 1].t + .01).toFixed(2); words[k].e = Math.max(words[k].e, +(words[k].t + .05).toFixed(2)); }
  proj.lyrics = L.map(l => l.text).join('\n'); $('#lyrics').value = proj.lyrics; proj.words = words; markAdlibs(proj.words);
  if (!proj.duration) proj.duration = words[words.length - 1].e + 2;
  if (!beatInfo && audioData) analyzeBeats(); if (proj.style.trim.auto) autoTrim(true); else autoRange(); autoScenes();
  const st = $('#alignStatus'); st.className = 'status ok'; st.textContent = `Тайминги из «${name}»: ${L.length} строк, ${words.length} слов. Начала строк — из файла, слова внутри строки расставлены равномерно. Для точности по словам нажмите «Синхронизировать слова».`;
  fillStyle(); renderAll(); Timeline.fit(); scheduleRebuild(50); touch();
}
// ---------- файлы, брошенные в окно ----------
window.__openPath = p => openProject(p);
async function mediaFromFile(f) {
  if (f.kind === 'video') return { type: 'video', path: f.path, name: f.name, asset: undefined };
  const bmp = await createImageBitmap(new Blob([f.data])), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const id = uid(); proj.assets[id] = c.toDataURL('image/jpeg', 0.9); return { type: 'image', asset: id, name: f.name, path: undefined };
}
async function dropFile(path) {
  let f = null; try { f = await api.fileKind(path); } catch (e) {}
  if (!f) return toast('Этот файл не подходит. Можно бросать: трек, проект, пресет, LRC/SRT, картинку или видео для фона', 4500);
  if (f.kind === 'project') return openProject(f.path);
  if (f.kind === 'audio') { try { await loadAudio({ path: f.path, name: f.name }); proj.duration = audioData.duration; fillStyle(); Timeline.fit(); touch(); toast('Трек загружен'); } catch (e) { toastErr('Не удалось прочитать файл: ' + e.message); } return; }
  if (f.kind === 'preset') return addPresets([{ name: f.name.replace(/\.(lspreset|json)$/i, ''), json: f.text }]);
  if (f.kind === 'timing') return importTimings(f.text, f.name);
  try { const m = await mediaFromFile(f), st = proj.style; st.bgMedia = Object.assign({ blur: 0, dim: 0.25, zoom: true }, st.bgMedia || {}, m); fillStyle(); scheduleRebuild(50); toast(f.kind === 'video' ? 'Видео поставлено фоном' : 'Картинка поставлена фоном'); } catch (e) { toastErr('Не удалось открыть файл: ' + e.message); }
}
{ let depth = 0; const ov = $('#dropOv'), files = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (!files(e)) return; e.preventDefault(); depth++; ov.hidden = false; });
  window.addEventListener('dragover', e => { if (files(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', e => { if (!files(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; });
  window.addEventListener('pointermove', () => { if (depth || !ov.hidden) { depth = 0; ov.hidden = true; } }); // во время перетаскивания мышь не шлёт событий — значит, оно кончилось
  window.addEventListener('drop', e => { if (!files(e)) return; e.preventDefault(); depth = 0; ov.hidden = true; const f = e.dataTransfer.files[0], p = f && api.pathOf ? api.pathOf(f) : ''; if (p) dropFile(p); else if (f) toast('Не удалось получить путь к файлу'); }); }
// ---------- модели нейросетей: что скачано, сколько занимает ----------
let mdBusy = false;
async function openModels() { $('#mdModal').hidden = false; $('#mdStatus').textContent = ''; await renderModels(); }
async function renderModels() {
  const box = $('#mdList'); let list = []; try { list = await api.modelsInfo(); } catch (e) { box.textContent = String(e.message || e); return; }
  const MB = LANG === 'en' ? ' MB' : ' МБ', mb = b => (b / 2 ** 20).toFixed(0) + MB, total = list.reduce((a, m) => a + m.size, 0);
  box.innerHTML = list.map(m => `<div class="md"><div><b>${esc(T(m.name))}</b><div class="muted small">${m.have ? T('скачана') + ' · ' + mb(m.size) : T('не скачана') + ' · ≈' + m.mb + MB}</div></div><button class="small ${m.have ? 'ghost' : ''}" data-k="${esc(m.key)}" data-a="${m.have ? 'del' : 'get'}">${m.have ? T('удалить') : T('скачать')}</button></div>`).join('');
  $('#mdTotal').textContent = T('Всего на диске') + ': ' + mb(total);
  box.querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (mdBusy) return; const st = $('#mdStatus');
    if (b.dataset.a === 'del') { if (!await Dialogs.confirm('Удалить модель с диска? Она скачается заново, когда понадобится.', { ok: 'Удалить', danger: true })) return; await api.modelDelete(b.dataset.k); st.className = 'status'; st.textContent = ''; return renderModels(); }
    mdBusy = true; $('#mdCancel').hidden = false; st.className = 'status'; st.textContent = 'Готовлюсь…';
    try { await api.modelGet(b.dataset.k, t => { st.textContent = t; }); st.className = 'status ok'; st.textContent = 'Модель скачана.'; }
    catch (e) { if (wasCancelled(e)) { st.className = 'status'; st.textContent = 'Отменено.'; } else { st.className = 'status err'; st.textContent = 'Ошибка: ' + (e.message || e); } }
    mdBusy = false; $('#mdCancel').hidden = true; renderModels();
  });
}
$('#mdClose').onclick = () => { $('#mdModal').hidden = true; }; $('#mdCancel').onclick = () => api.cancelModel().catch(() => {});
async function openLicenses() { $('#licModal').hidden = false; try { $('#licText').textContent = await (await fetch('licenses.txt')).text(); } catch (e) { $('#licText').textContent = String(e); } }
$('#licClose').onclick = () => $('#licModal').hidden = true;
function openSelfTest() { $('#stModal').hidden = false; runSelfTest(); }
$('#stRun').onclick = runSelfTest;
$('#stClose').onclick = () => { if (stBusy) api.cancelExport(); $('#stModal').hidden = true; };
$('#stLogs').onclick = () => api.openLogFolder();
$('#stCopy').onclick = async () => { const txt = stLines.map(r => `[${r.level}] ${r.group} / ${r.name}: ${r.text}`).join('\n'); try { await api.copyReport('проверка системы:\n' + txt); toast('Результат и журнал скопированы — вставьте в сообщение (Ctrl+V)', 3500); } catch (e) { toast('Не удалось скопировать'); } };

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
try { $('#xLoud').checked = localStorage.getItem('ls-loud') === '1'; } catch (e) {} $('#xLoud').onchange = e => { try { localStorage.setItem('ls-loud', e.target.checked ? '1' : '0'); } catch (x) {} };
$$('#xPlat button').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.v; if (!v) return;
  if (proj.style.format !== '9:16') { proj.style.format = '9:16'; fillStyle(); scheduleRebuild(50); }
  $$('#xRes button').forEach(x => x.classList.toggle('on', x.dataset.v === '1080')); $$('#xCont button').forEach(x => x.classList.toggle('on', x.dataset.v === 'mp4'));
  $('#safeSel').value = v; drawSafe(); exportInfo();
}));
function exportOpts() {
  const draft = $('#xDraft').checked, cont = segOn('#xCont').dataset.v;
  if (cont === 'sticker') return { draft: false, container: 'sticker', res: 512, fps: 30 };
  return { draft, container: cont, res: draft ? 360 : cont === 'gif' ? Math.min(+segOn('#xRes').dataset.v, 540) : +segOn('#xRes').dataset.v, fps: draft ? 15 : cont === 'gif' ? 15 : +segOn('#xFps').dataset.v };
}
const EXT_LABEL = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', gif: 'GIF' };
// собрать задание экспорта для формата (можно отличный от текущего)
function makeJob(o, format) {
  const keep = proj.style.format; if (format) proj.style.format = format;
  try {
    const alpha = o.container === 'mov' || o.container === 'webm' || o.container === 'sticker', spec = buildSpec(true, { transparent: alpha }), [W, H] = FMT[proj.style.format];
    if (o.container === 'sticker') { const u0 = s2o(Math.max(spec._srcA, curT()), spec._cuts), dur = Math.min(3, +spec.end - u0); if (dur < .3) throw new Error('поставьте курсор внутрь ролика — стикер берёт 3 секунды от курсора');
      return { _spec: spec, html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? 512 : Math.round(512 * W / H / 2) * 2, start: spec._srcA, end: spec._srcB, vStart: u0, outDur: dur, fps: 30, container: 'sticker', name: (proj.audioName || 'sticker').replace(/\.[^.]+$/, '') + T('-стикер') }; }
    return { _spec: spec, html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? Math.round(o.res * W / H / 2) * 2 : o.res, start: spec._srcA, end: spec._srcB, outDur: +spec.end - +spec.start, cuts: spec._cuts,
      fade: +proj.style.fade || 0, fadeIn: +proj.style.fadeIn || 0, fadeOut: +proj.style.fade || 0, fadeCurve: proj.style.fadeCurve || 'smooth', audioPath: proj.audioPath,
      fps: o.fps, draft: o.draft, container: o.container, gpu: $('#xGpu').checked, loud: $('#xLoud').checked, name: (proj.audioName || 'video').replace(/\.[^.]+$/, '') + (o.draft ? T('-черновик') : '') + (format ? '-' + format.replace(':', 'x') : '') };
  } finally { proj.style.format = keep; }
}
function exportInfo() {
  const o = exportOpts(), [ra, rb] = effRange(), d = rb - ra, [W, H] = FMT[proj.style.format];
  const w = W >= H ? Math.round(o.res * W / H / 2) * 2 : o.res, h = Math.round(w * H / W / 2) * 2, plat = segOn('#xPlat').dataset.v;
  $('#xAlphaHint').hidden = o.container === 'mp4' || o.container === 'gif';
  if (o.container === 'sticker') { $('#xInfo').innerHTML = `Видеостикер для Telegram: WebM с прозрачным фоном, 512 px по длинной стороне, 3 секунды от курсора (${fmtT(curT())}), без звука, до 256 КБ. Загрузите его боту @Stickers.`; $('#xAlphaHint').hidden = true; return; }
  if (o.container === 'gif') { $('#xInfo').innerHTML = `GIF без звука · до ${w}×${h} · 15 кадров/с · ${d.toFixed(1)} с. Для Telegram и превью лучше держать ролик короче 15 секунд.`; return; }
  $('#xInfo').innerHTML = `Длина ${d.toFixed(1)} с · ${proj.scenes.length} сцен · ${w}×${h} · ${o.fps} кадров/с · ${Math.round(d * o.fps)} кадров` + (plat ? `<br>${SAFE[plat].name}: вертикальное 1080×1920. Включены зоны интерфейса на превью — держите текст вне красных областей.` : '') + (o.res >= 2160 && !o.draft ? '<br>4K рендерится в несколько раз дольше 1080p.' : '');
}
$('#bExport').onclick = () => {
  if (!proj.words.length || !proj.audioPath) return toast('Сначала трек, текст и синхронизация');
  api.gpuInfo().then(g => { $('#xGpuV').textContent = g ? `(${g.name})` : '(не найдена — кодирует процессор)'; }).catch(() => {});
  exportInfo(); $('#xBar').style.width = '0'; $('#xStatus').textContent = ''; $('#xStatus').className = 'status'; $('#xShow').hidden = true; $('#exportModal').hidden = false;
};
$('#xClose').onclick = () => { if (!exporting) $('#exportModal').hidden = true; };
$('#xCancel').onclick = () => api.cancelExport();
$('#xShow').onclick = () => lastExportPath && api.showFile(lastExportPath);
$('#xGo').onclick = async () => {
  await ensureSpectrum(); const o = exportOpts(), st = $('#xStatus'); let job;
  try { job = makeJob(o); job.sfx = await sfxForExport(job._spec, o.container); delete job._spec; } catch (e) { st.className = 'status err'; st.textContent = e.message || String(e); return; }
  exporting = true; $('#xGo').disabled = true; $('#xCancel').hidden = false; $('#xShow').hidden = true; st.className = 'status';
  try {
    const r = await api.exportVideo(job, p => { $('#xBar').style.width = Math.round(p.frac * 100) + '%'; st.textContent = p.text; });
    if (r && r.ok) { st.className = 'status ok'; st.textContent = `Готово за ${Math.round(r.seconds || 0)} с: ` + r.path; $('#xBar').style.width = '100%'; lastExportPath = r.path; $('#xShow').hidden = false; }
    else st.textContent = r && r.cancelled ? 'Отменено' : 'Не сохранено';
  } catch (e) { st.className = 'status err'; st.innerHTML = 'Ошибка: ' + esc(e.message || e) + ' <button class="small" id="xRep">Скопировать отчёт</button>'; $('#xRep').onclick = copyReport; }
  exporting = false; $('#xGo').disabled = false; $('#xCancel').hidden = true;
};

// ---------- очередь экспорта ----------
let queue = [];
function renderQueue() {
  $('#xQn').textContent = queue.length ? `(${queue.length})` : '';
  $('#xQList').innerHTML = queue.map((q, i) => `<div class="q ${q.state || ''}"><span>${i + 1}. ${q.format} · ${q.o.draft ? 'черновик' : q.o.res + 'p'} · ${q.o.fps} к/с · ${EXT_LABEL[q.o.container]}${q.msg ? ' — ' + esc(T(q.msg)) : ''}</span><button class="small ghost" data-i="${i}">✕</button></div>`).join('');
  $$('#xQList button').forEach(b => b.onclick = () => { if (exporting) return; queue.splice(+b.dataset.i, 1); renderQueue(); });
}
$('#xQAdd').onclick = () => { queue.push({ o: exportOpts(), format: proj.style.format }); renderQueue(); };
$('#xQ3').onclick = () => { const o = exportOpts(); ['9:16', '1:1', '16:9'].forEach(f => queue.push({ o: Object.assign({}, o), format: f })); renderQueue(); };
$('#xQGo').onclick = async () => {
  if (!queue.length) return toast('Очередь пуста — добавьте версии');
  const dir = await api.pickFolder(); if (!dir) return;
  await ensureSpectrum(); exporting = true; $('#xGo').disabled = true; $('#xQGo').disabled = true; $('#xCancel').hidden = false; const st = $('#xStatus'); st.className = 'status';
  const sep = dir.includes('\\') ? '\\' : '/'; let ok = 0; const used = new Set();
  for (const q of queue) {
    if (q.state === 'done') continue; q.state = 'run'; q.msg = ''; renderQueue();
    try {
      // две версии одного формата (другое разрешение, частота кадров, черновик) не перезаписывают друг друга
      const job = makeJob(q.o, q.format); job.sfx = await sfxForExport(job._spec, q.o.container); delete job._spec; let nm = job.name, k = 2;
      if (used.has(nm.toLowerCase())) nm = `${job.name}-${q.o.res}p${q.o.fps !== 30 ? '-' + q.o.fps + 'fps' : ''}`; while (used.has(nm.toLowerCase())) nm = `${job.name}-${k++}`; used.add(nm.toLowerCase()); job.outPath = dir + sep + nm + '.' + q.o.container;
      const r = await api.exportVideo(job, p => { $('#xBar').style.width = Math.round(p.frac * 100) + '%'; st.textContent = `${q.format}: ${p.text}`; });
      if (r && r.ok) { q.state = 'done'; q.msg = 'готово'; ok++; lastExportPath = r.path; } else { q.state = ''; q.msg = r && r.cancelled ? 'отменено' : 'не сохранено'; renderQueue(); break; }
    } catch (e) { q.state = 'err'; q.msg = e.message || String(e); api.log('error', 'очередь: ' + q.msg); }
    renderQueue();
  }
  st.className = 'status ok'; st.textContent = `Очередь: готово ${ok} из ${queue.length}`; $('#xShow').hidden = !lastExportPath;
  exporting = false; $('#xGo').disabled = false; $('#xQGo').disabled = false; $('#xCancel').hidden = true;
};
// ---------- кадр и обложка ----------
async function saveFrame() {
  if (!proj.words.length) return toast('Сначала синхронизируйте слова');
  await ensureSpectrum(); const [W, H] = FMT[proj.style.format], spec = buildSpec(true);
  try { const r = await api.exportFrame({ html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? 1920 : 1080, t: s2o(curT(), spec._cuts), name: (proj.audioName || T('кадр')).replace(/\.[^.]+$/, '') + T('-кадр'), title: 'Сохранить кадр' });
    if (r && r.ok) { lastExportPath = r.path; toast('Сохранено: ' + r.path.split(/[\\/]/).pop(), 3000); } }
  catch (e) { toastErr('Не удалось сохранить картинку: ' + (e.message || e)); }
}
// три варианта обложки: крупное название, типографика с выделением, карточка плеера
function coverSpec(kind, title, artist) {
  const spec = buildSpec(true); delete spec.player; delete spec.outro; delete spec.intro; delete spec.hook; delete spec.beats; delete spec.spec; delete spec.stickers; delete spec.vfade;
  spec.start = 0; spec.end = 60; spec.duration = 60; const ws = String(title || 'трек').split(/\s+/).filter(Boolean);
  if (kind === 'intro') { spec.words = [{ w: '·', t: 50, e: 50.2, line: 0 }]; spec.scenes = [{ words: [0, 1], caption: false }]; spec.intro = { t0: 0, title, artist, label: '', bar: false }; return [spec, 2.2]; }
  if (kind === 'type') { spec.words = ws.map((w, i) => ({ w, t: .1 + i * .05, e: .15 + i * .05, line: 0 })); spec.scenes = [{ words: [0, ws.length], t0: 0, t1: 59, kinetic: { mode: 'stack', accent: proj.style.custom.accent, words: ws[ws.length - 1], rot: 6 } }];
    if (artist) spec.hook = { text: artist, t0: 0, t1: 59, y: .8, size: .045 }; return [spec, 2]; }
  spec.words = [{ w: '·', t: .2, e: .3, line: 0 }]; spec.scenes = [{ words: [0, 1], t0: 0, t1: 59, caption: false, widget: { type: 'player', title, artist, emoji: '🎧', img: PROFILE.avatar || undefined, scale: 1.6 } }]; return [spec, 2];
}
async function openCovers() {
  if (!proj.words.length) return toast('Сначала синхронизируйте слова');
  $('#cvTitle').value = $('#cvTitle').value || proj.style.intro.title || proj.style.title || (proj.audioName || '').replace(/\.[^.]+$/, ''); $('#cvArtist').value = $('#cvArtist').value || proj.style.artist || PROFILE.nick || '';
  $('#coverModal').hidden = false; await renderCovers();
}
async function renderCovers() {
  const [W, H] = FMT[proj.style.format], title = $('#cvTitle').value.trim(), artist = $('#cvArtist').value.trim(), kinds = [['intro', 'Крупное название'], ['type', 'Типографика'], ['player', 'Карточка плеера']];
  $('#cvGrid').innerHTML = kinds.map(([k, n]) => `<div class="cv" data-k="${k}"><img alt=""><b class="small">${n}</b><button class="small" disabled>Сохранить PNG…</button></div>`).join('');
  for (const [k] of kinds) {
    const el = $(`#cvGrid .cv[data-k="${k}"]`), [spec, t] = coverSpec(k, title, artist);
    try { const url = await api.renderFrame({ html: engineHTML(spec, 'app://app/'), W, H, width: W >= H ? 1920 : 1080, t }); el.querySelector('img').src = url; const b = el.querySelector('button'); b.disabled = false;
      b.onclick = async () => { const p = await api.saveImage(url, (proj.audioName || T('обложка')).replace(/\.[^.]+$/, '') + T('-обложка-') + k); if (p) toast('Сохранено: ' + p.split(/[\\/]/).pop(), 3000); }; }
    catch (e) { el.querySelector('b').textContent = 'ошибка: ' + (e.message || e); }
  }
}
$('#cvRedo').onclick = renderCovers;
$('#xFrame').onclick = saveFrame; $('#xCover').onclick = openCovers;

// ---------- пакетная обработка ----------
let batch = [], batchStop = false, batchRunning = false;
function openBatch() { renderBatch(); $('#batchModal').hidden = false; }
function renderBatch() {
  $('#bmList').innerHTML = batch.length ? batch.map((b, i) => `<div class="bi ${b.state || ''}" data-i="${i}"><div class="row"><b class="small" style="flex:1" data-notr>${i + 1}. ${esc(b.name)}</b><span class="muted small">${esc(b.msg || '')}</span><button class="small ghost" data-x="${i}">✕</button></div><textarea placeholder="текст песни этого трека — одна строка = одна строка на экране; пусто — распознать с трека">${esc(b.lyrics || '')}</textarea></div>`).join('') : '<div class="muted small">Добавьте треки и вставьте текст к каждому — или оставьте поле пустым, тогда текст распознается с трека.</div>';
  $$('#bmList .bi').forEach(el => { const b = batch[+el.dataset.i]; el.querySelector('textarea').oninput = e => b.lyrics = e.target.value; el.querySelector('[data-x]').onclick = () => { if (batchRunning) return; batch.splice(+el.dataset.i, 1); renderBatch(); }; });
}
$('#bmAdd').onclick = async () => { const L = await api.pickAudios(); L.forEach(f => batch.push({ path: f.path, name: f.name, lyrics: '' })); renderBatch(); };
$('#bmClose').onclick = () => { if (!batchRunning) $('#batchModal').hidden = true; };
$('#bmStop').onclick = () => { batchStop = true; $('#bmStop').disabled = true; };
$('#bmGo').onclick = async () => {
  const todo = batch.filter(b => b.state !== 'done'); if (!todo.length) return toast('Нет треков для обработки');
  const formats = $$('.bmF').filter(x => x.checked).map(x => x.value); if (!formats.length) return toast('Выберите хотя бы один формат');
  const dir = await api.pickFolder(); if (!dir) return;
  const sep = dir.includes('\\') ? '\\' : '/', saved = JSON.stringify(proj), savedPath = projPath, savedDirty = dirty, st = $('#bmStatus');
  batchRunning = true; batchStop = false; $('#bmGo').disabled = true; $('#bmStop').hidden = false; $('#bmStop').disabled = false; let ok = 0;
  for (const b of todo) {
    if (batchStop) break; b.state = 'run'; b.msg = 'синхронизация…'; renderBatch();
    try {
      const base = JSON.parse(saved), np = newProject(); np.style = JSON.parse(JSON.stringify(base.style)); Object.assign(np.style, { start: 0, end: 0, title: '', hook: '', cuts: [] }); np.style.intro.title = '';
      np.fonts = base.fonts; np.perScene = base.perScene; np.lang = base.lang; np.vocals = base.vocals; np.assets = {}; const used = JSON.stringify(np.style) + JSON.stringify(np.fonts); for (const id in base.assets) if (used.includes(id)) np.assets[id] = base.assets[id];
      applyProject(np, null); await loadAudio({ path: b.path, name: b.name }); proj.duration = audioData.duration; analyzeBeats(); await loadNetBeats();
      // без текста — распознать с трека, с текстом — синхронизировать; язык — по тексту
      if (b.lyrics && b.lyrics.trim()) { proj.lang = guessLang(b.lyrics) || proj.lang || 'ru'; proj.lyrics = b.lyrics; const r = await api.align({ audioPath: b.path, lyrics: b.lyrics, from: null, to: null, lang: proj.lang, vocals: !!proj.vocals, vocalsQ: proj.vocalsQ }, t => { b.msg = t; renderBatch(); }); proj.words = r.words; }
      else { const r = await api.transcribe({ audioPath: b.path, from: null, to: null, lang: proj.lang || 'ru', vocals: !!proj.vocals, vocalsQ: proj.vocalsQ }, t => { b.msg = t; renderBatch(); }); const ws = r.words.map(w => ({ w: w.w, t: w.t, e: w.e, e0: w.e0 })); proj.lyrics = wordsToLines(ws); proj.words = ws.map(w => ({ w: w.w, t: w.t, e: w.e, line: w.line })); b.lyrics = proj.lyrics; }
      markAdlibs(proj.words); autoTrim(true); autoScenes(); if ($('#bmAcc').checked) autoAccents();
      const name = b.name.replace(/\.[^.]+$/, '');
      await api.saveProject(projJSON(), name + '.lsp', dir + sep + name + '.lsp');
      await ensureSpectrum();
      for (const f of formats) {
        b.msg = `экспорт ${f}…`; renderBatch(); const o = { draft: false, container: 'mp4', res: +$('#bmRes').value, fps: 30 }, job = makeJob(o, f);
        job.sfx = await sfxForExport(job._spec, 'mp4'); delete job._spec; job.outPath = dir + sep + name + (formats.length > 1 ? '-' + f.replace(':', 'x') : '') + '.mp4';
        const res = await api.exportVideo(job, p => { $('#bmBar').style.width = Math.round(p.frac * 100) + '%'; st.textContent = `${b.name} · ${f}: ${p.text}`; });
        if (!res || !res.ok) throw new Error(res && res.cancelled ? 'отменено' : 'не сохранено'); lastExportPath = res.path;
      }
      b.state = 'done'; b.msg = 'готово'; ok++;
    } catch (e) { b.state = 'err'; b.msg = 'ошибка: ' + (e.message || e); api.log('error', 'пакет: ' + b.name + ': ' + (e.message || e)); }
    renderBatch();
  }
  st.className = 'status ok'; st.textContent = `Готово ${ok} из ${todo.length}. Видео и проекты — в выбранной папке.`;
  applyProject(JSON.parse(saved), savedPath); await afterLoad(); dirty = savedDirty; updTitle(); // несохранённый проект остаётся несохранённым (иначе при закрытии автосохранение стиралось)
  batchRunning = false; $('#bmGo').disabled = false; $('#bmStop').hidden = true;
};

// ---------- горячие клавиши ----------
document.addEventListener('keydown', e => {
  const inField = Focus.eatsKey(document.activeElement, e);
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), code = e.code;
  if (mod && code === 'KeyS') { e.preventDefault(); saveProject(e.shiftKey); return; }
  if (mod && code === 'KeyO') { e.preventDefault(); openProject(); return; }
  if (mod && code === 'KeyE') { e.preventDefault(); $('#bExport').click(); return; }
  if (document.querySelector('.modal:not([hidden])')) { const m = [...document.querySelectorAll('.modal:not([hidden])')].pop(), x = m.querySelector('.mhead button.ghost:last-child'); if (e.key === 'Escape' && x) { e.preventDefault(); x.click(); } return; }
  if (inField) return;
  if (mod && code === 'KeyZ') { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); return; }
  if (mod && code === 'KeyY') { e.preventDefault(); histGo(1); return; }
  if (mod && code === 'KeyC') { e.preventDefault(); copyLook(); return; }
  if (mod && code === 'KeyV') { e.preventDefault(); pasteLook(); return; }
  if (mod && code === 'KeyA') { e.preventDefault(); msel = new Set(proj.scenes.map((x, i) => i)); renderStrip(); renderScene(); return; }
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

// ---------- стикеры и надписи ----------
function addSticker(type, value) {
  const t = curT(); proj.stickers = proj.stickers || [];
  proj.stickers.push({ id: uid(), type, value, x: .5, y: type === 'text' ? .2 : .32, size: type === 'text' ? 54 : type === 'image' ? 200 : 110, rot: type === 'text' ? -3 : 0, t0: +t.toFixed(2), t1: +(t + 2.5).toFixed(2), anim: 'pop', color: '#ffffff', bg: type === 'text' ? '#000000' : '' });
  renderStickers(); scheduleRebuild(50);
}
$('#stEmoji').onclick = () => addSticker('emoji', '🔥');
$('#stText').onclick = () => addSticker('text', 'надпись');
$('#stImage').onclick = async () => { const a = await loadImage(true, 800); if (a) addSticker('image', a); };
function renderStickers() {
  const box = $('#stList'), L = proj.stickers || []; if (!box) return;
  box.innerHTML = L.map((x, i) => `<div class="st" data-i="${i}">${x.type === 'image' ? `<img src="${asset(x.value)}" style="height:26px;border-radius:5px">` : `<input data-k="value" value="${esc(x.value)}" ${x.type === 'emoji' ? 'class="emo"' : ''}>`}
    <input data-k="t0" type="number" step="0.1" value="${x.t0}" title="с какой секунды"><input data-k="t1" type="number" step="0.1" value="${x.t1}" title="до какой секунды"><input data-k="size" type="number" step="2" value="${x.size}" title="размер">
    <button class="small ghost" data-del="${i}" title="Удалить">✕</button>
    <div class="opt"><select data-k="anim"><option value="pop">выпрыгивает</option><option value="fade">проявляется</option><option value="wiggle">качается</option><option value="none">без анимации</option></select>
    ${x.type === 'text' ? `<input data-k="color" type="color" value="${x.color || '#ffffff'}" title="цвет текста"><label class="chk small"><input data-k="bgOn" type="checkbox" ${x.bg ? 'checked' : ''}> плашка</label>` : ''}
    <input data-k="rot" type="number" step="1" value="${x.rot || 0}" title="наклон, °" style="width:54px">${x.type === 'image' ? `<button class="small" data-cut title="Нейросеть уберёт фон и оставит человека или предмет">✂ без фона</button>` : ''}<button class="small ghost" data-go="${i}" title="Перейти к стикеру">▶</button></div></div>`).join('');
  box.querySelectorAll('.st').forEach(row => { const x = L[+row.dataset.i];
    row.querySelector('select').value = x.anim || 'pop';
    row.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = inp.dataset.k; if (k === 'bgOn') x.bg = inp.checked ? '#000000' : ''; else x[k] = inp.type === 'number' ? +inp.value : inp.value; scheduleRebuild(300); }));
    row.querySelector('[data-del]').onclick = () => { L.splice(+row.dataset.i, 1); renderStickers(); scheduleRebuild(50); };
    row.querySelector('[data-go]').onclick = () => seekTo(x.t0 + .4);
    const cb = row.querySelector('[data-cut]'); if (cb) cb.onclick = async () => { const v = await cutBackground(x.value, cb); if (v) { x.value = v; renderStickers(); scheduleRebuild(50); } }; });
}
// ---------- перетаскивание в превью ----------
function attachPreviewDrag() {
  const fr = $('#preview'), doc = fr.contentDocument; if (!doc || doc.__drag) return; doc.__drag = true;
  const css = doc.createElement('style'); css.textContent = '.wscale{cursor:move}.stk{cursor:move}'; doc.head.append(css);
  let D = null;
  doc.addEventListener('pointerdown', e => {
    if (playing || e.button !== 0) return;
    const st = e.target.closest('.stk'), card = !st && e.target.closest('.wscale'), slot = card && card.closest('.wslot');
    if (st) { const x = (proj.stickers || []).find(q => q.id === st.dataset.st); if (!x) return; D = { kind: 'st', el: st, x, x0: e.clientX, y0: e.clientY, ox: x.x, oy: x.y }; }
    else if (slot) { const sc = proj.scenes[+slot.dataset.k]; if (!sc) return; const two = slot.dataset.second === '1'; D = { kind: 'card', el: slot, sc, two, x0: e.clientX, y0: e.clientY }; }
    if (D) { e.preventDefault(); doc.documentElement.setPointerCapture && doc.documentElement.setPointerCapture(e.pointerId); }
  });
  doc.addEventListener('pointermove', e => { if (!D) return; const dx = e.clientX - D.x0, dy = e.clientY - D.y0, [W, H] = FMT[proj.style.format];
    if (D.kind === 'st') { D.el.style.left = ((D.ox + dx / W) * 100) + '%'; D.el.style.top = ((D.oy + dy / H) * 100) + '%'; }
    else D.el.style.transform = `translate(${dx}px,${dy}px)`; D.moved = Math.abs(dx) + Math.abs(dy) > 3; });
  doc.addEventListener('pointerup', e => { if (!D) return; const dx = e.clientX - D.x0, dy = e.clientY - D.y0, [W, H] = FMT[proj.style.format];
    if (D.moved) { if (D.kind === 'st') { D.x.x = +Math.max(0, Math.min(1, D.ox + dx / W)).toFixed(4); D.x.y = +Math.max(0, Math.min(1, D.oy + dy / H)).toFixed(4); }
      else { const kx = D.two ? 'dx2' : 'dx', ky = D.two ? 'dy2' : 'dy'; D.sc[kx] = Math.round((D.sc[kx] || 0) + dx); D.sc[ky] = Math.round((D.sc[ky] || 0) + dy); }
      scheduleRebuild(30); } D = null; });
  doc.addEventListener('wheel', e => {
    if (playing) return; const st = e.target.closest('.stk'), card = !st && e.target.closest('.wscale'), slot = card && card.closest('.wslot'); if (!st && !slot) return; e.preventDefault();
    const k = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    if (st) { const x = (proj.stickers || []).find(q => q.id === st.dataset.st); if (!x) return; x.size = Math.round(Math.max(12, Math.min(900, x.size * k))); st.firstChild.style.scale = String(((+st.firstChild.style.scale || 1) * k).toFixed(3)); }
    else { const sc = proj.scenes[+slot.dataset.k]; if (!sc) return; if (slot.dataset.second === '1') sc.k2scale = +(((sc.k2scale || .8) * k).toFixed(3)); else sc.scale = +((+(sc.scale || defScale(sc)) * k).toFixed(3)); slot.style.scale = String(((+slot.style.scale || 1) * k).toFixed(3)); if (sc === proj.scenes[sel]) renderScene(); }
    clearTimeout(attachPreviewDrag._w); attachPreviewDrag._w = setTimeout(() => { renderStickers(); scheduleRebuild(30); }, 450);
  }, { passive: false });
  doc.addEventListener('dblclick', e => { if (playing) return; const card = e.target.closest('.wscale'), slot = card && card.closest('.wslot'); if (!slot) return; const sc = proj.scenes[+slot.dataset.k]; if (!sc) return;
    if (slot.dataset.second === '1') { delete sc.dx2; delete sc.dy2; delete sc.k2scale; } else { delete sc.dx; delete sc.dy; sc.scale = ''; } renderScene(); scheduleRebuild(30); toast('Положение карточки сброшено', 1200); });
}

// ---------- акцент на слове ----------
let wmIdx = -1;
function openWordMenu(i, x, y) {
  const w = proj.words[i]; if (!w) return; wmIdx = i; const a = w.acc || {};
  $('#wmWord').textContent = w.w; $('#wmColorOn').checked = !!a.color; $('#wmColor').value = a.color || '#FF2D55'; $('#wmZoom').checked = !!a.zoom; $('#wmShake').checked = !!a.shake; $('#wmEmoji').value = a.emoji || '';
  const m = $('#wordMenu'); m.hidden = false; m.style.left = Math.min(innerWidth - 260, x) + 'px'; m.style.top = Math.max(10, y - 250) + 'px';
}
function applyWordMenu() {
  const w = proj.words[wmIdx]; if (!w) return; const a = { color: $('#wmColorOn').checked ? $('#wmColor').value : undefined, zoom: $('#wmZoom').checked || undefined, shake: $('#wmShake').checked || undefined, emoji: $('#wmEmoji').value.trim() || undefined };
  Object.keys(a).forEach(k => a[k] === undefined && delete a[k]); if (Object.keys(a).length) w.acc = a; else delete w.acc; scheduleRebuild(150);
}
['#wmColorOn', '#wmZoom', '#wmShake'].forEach(id => $(id).onchange = applyWordMenu); $('#wmColor').oninput = () => { $('#wmColorOn').checked = true; applyWordMenu(); }; $('#wmEmoji').oninput = applyWordMenu;
$('#wmReset').onclick = () => { if (proj.words[wmIdx]) delete proj.words[wmIdx].acc; $('#wordMenu').hidden = true; scheduleRebuild(100); };
$('#wmOk').onclick = $('#wmClose').onclick = () => { $('#wordMenu').hidden = true; };

// ---------- таймлайн ----------
Timeline.init($('#timeline'), {
  proj: () => proj, env: () => beatInfo, beats: () => beatInfo, time: () => curT(), seek: t => seekTo(t),
  range: () => { const [a, b] = effRange(); return [a, b || 10]; },
  changed: (kind, live) => { if (kind === 'scenes') { renderStrip(); renderScene(); scheduleRebuild(250); } else if (kind === 'scenes-done') { proj.scenes.forEach(fixRefs); renderScene(); scheduleRebuild(60); } else scheduleRebuild(live ? 400 : 120); },
  select: i => { sel = i; renderStrip(); renderScene(); }, selected: () => sel, playing: () => playing, wordMenu: openWordMenu, cuts: () => proj.style.cuts || [], snap: () => $('#snapBeats').checked
});
$('#tlFit').onclick = () => Timeline.fit();

// ---------- старт ----------
(async function init() {
  ENGINE = await (await fetch('engine.html')).text();
  PRESETS = await (await fetch('presets.json')).json();
  try { USER_PRESETS = (await api.loadUserPresets()) || {}; } catch (e) { USER_PRESETS = {}; }
  try { USER_TPL = (await api.loadUserTemplates()) || {}; } catch (e) { USER_TPL = {}; }
  try { PROFILE = (await api.loadProfile()) || {}; if (!proj.words.length) { proj = newProject(); applyProfileToProject(); } } catch (e) { PROFILE = {}; }
  try { const v = await api.version(); $('#verLabel').textContent = 'Версия ' + v.version + (v.portable ? ' · portable' : ''); } catch (e) {}
  try { api.setLang(LANG); } catch (e) {}
  $('#langBtn').textContent = LANG === 'en' ? 'Русский интерфейс' : 'English interface'; $('#langBtn').dataset.notr = '';
  if (LANG === 'en') $('#lyrics').placeholder = 'paste the lyrics here\none line = one line on screen\n…';
  renderAll(); histReset(); dirty = false; updTitle(); rebuildPreview(); loop();
  window.__ls = { get proj() { return proj; }, set proj(v) { proj = v; }, loadAudio, renderAll, rebuildPreview, buildSpec, engineHTML, autoScenes, autoRange, seek, seekTo, ensureSpectrum, analyzeBeats, get beatInfo() { return beatInfo; }, histGo, applyProject, afterLoad, currentPreset, splitScene, touch, scheduleRebuild };
  Object.defineProperties(window.__ls, { sel: { get: () => sel }, msel: { get: () => [...msel] }, histLen: { value: () => hist.length }, histPos: { value: () => hpos }, histReset: { value: histReset }, histCommit: { value: histCommit }, projJSON: { value: projJSON }, parseTimings: { value: parseTimings }, importTimings: { value: importTimings }, exportTimings: { value: exportTimings }, mergePrev: { value: mergePrev }, mergeNext: { value: mergeNext }, copyLook: { value: copyLook }, pasteLook: { value: pasteLook }, newFrom: { value: newFrom }, openProject: { value: openProject }, saveProject: { value: saveProject }, autoTrim: { value: autoTrim }, audioSrc: { value: () => audio.getAttribute('src') || '' }, hasAudioData: { value: () => !!audioData } });
  let reloaded = null; try { reloaded = JSON.parse(sessionStorage.getItem('ls-reload') || 'null'); sessionStorage.removeItem('ls-reload'); } catch (e) {}
  if (reloaded && reloaded.proj) { applyProject(reloaded.proj, reloaded.path || null); await afterLoad(); dirty = !!reloaded.dirty; updTitle(); return; }
  let crash = null; try { crash = await api.lastCrash(); } catch (e) {}
  try {
    const a = await api.loadAutosave();
    if (crash) { const p = a && a.json ? JSON.parse(a.json) : null, hasP = p && ((p.words && p.words.length) || p.lyrics);
      banner(esc(T(`Прошлый запуск завершился аварийно${crash.reason ? ' (' + crash.reason + ')' : ''}.`)) + ' ' + esc(T(hasP ? `Есть автосохранение${p.audioName ? ' «' + p.audioName + '»' : ''}.` : 'Отправьте отчёт — это поможет найти причину.')), // два предложения переводятся по отдельности
        [...(hasP ? [['Восстановить проект', async () => { hideBanner(); applyProject(p, null); await afterLoad(); dirty = true; updTitle(); toast('Проект восстановлен'); }, 'primary']] : []),
         ['Скопировать отчёт', () => { api.copyReport('аварийное завершение прошлого запуска' + (crash.version ? ' (' + crash.version + ')' : '') + (crash.reason ? ': ' + crash.reason : '')).then(() => toast('Отчёт скопирован — вставьте его в сообщение (Ctrl+V)', 4000)); }, hasP ? '' : 'primary'],
         ['Проверка системы', () => { openSelfTest(); }, ''], ['Закрыть', () => { hideBanner(); }, 'ghost']]);
    } else
    if (a && a.json) { const p = JSON.parse(a.json); if ((p.words && p.words.length) || p.lyrics) banner(`Найден несохранённый проект от ${new Date(a.time).toLocaleString('ru-RU')}${p.audioName ? ' («' + esc(p.audioName) + '»)' : ''}.`, [['Восстановить', async () => { hideBanner(); applyProject(p, null); await afterLoad(); dirty = true; updTitle(); }, 'primary'], ['Не нужно', () => { hideBanner(); api.clearAutosave(); }, 'ghost']]); }
  } catch (e) {}
  setTimeout(() => { if ($('#banner').hidden) checkUpdate(false); }, 4000);
})();
