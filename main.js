'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell, clipboard } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process'), { pathToFileURL } = require('url');
const A = require('./align');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const REPO = 'skeedie/motion-video-create';
const APP_DIR = path.join(__dirname, 'app');
const unpacked = p => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const UD = (...p) => path.join(app.getPath('userData'), ...p);
const MODEL_DIR = () => UD('giga-ctc');
const USER_PRESETS = () => UD('user-presets.json');
let JOB_HTML = '<html></html>', mainWin = null, cancelFlag = false;

// ---------- журнал ----------
let logStream = null;
function log(...a) {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + a.map(x => x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n';
  try {
    if (!logStream) {
      const f = UD('lyric-studio.log');
      try { if (fs.statSync(f).size > 1.5e6) { const keep = fs.readFileSync(f, 'utf8').slice(-4e5); fs.writeFileSync(f, keep); } } catch (e) {}
      logStream = fs.createWriteStream(f, { flags: 'a' });
    }
    logStream.write(line);
  } catch (e) {}
}
process.on('uncaughtException', e => log('uncaughtException', e));
process.on('unhandledRejection', e => log('unhandledRejection', e));
const handle = (name, fn) => ipcMain.handle(name, async (...a) => {
  try { return await fn(...a); } catch (e) { if (e && e.message !== '__cancel') log(`ошибка в ${name}:`, e); throw e; }
});

function createWindow() {
  mainWin = new BrowserWindow({ width: 1500, height: 940, minWidth: 1150, minHeight: 720, backgroundColor: '#0E0F12', title: 'Lyric Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  Menu.setApplicationMenu(null);
  mainWin.loadURL('app://app/index.html');
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('render-process-gone', (e, d) => log('окно редактора упало:', d));
  mainWin.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 3) log('консоль:', msg, src ? `(${path.basename(src)}:${line})` : ''); });
  mainWin.on('close', e => {
    if (mainWin.__canClose) return;
    e.preventDefault();
    const done = () => { if (mainWin && !mainWin.isDestroyed()) { mainWin.__canClose = true; mainWin.close(); } };
    Promise.race([mainWin.webContents.executeJavaScript('window.__beforeClose ? window.__beforeClose() : true'), new Promise(r => setTimeout(() => r(true), 1500))]).then(done, done);
  });
}

app.whenReady().then(() => {
  log(`запуск ${app.getVersion()} · ${process.platform} ${os.release()} · electron ${process.versions.electron}`);
  protocol.handle('app', req => {
    const u = new URL(req.url);
    if (u.host === 'job') return new Response(JOB_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (u.host === 'media') return serveMedia(u.searchParams.get('p') || '', req);
    const p = path.normalize(path.join(APP_DIR, decodeURIComponent(u.pathname)));
    if (!p.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { cancelFlag = true; BrowserWindow.getAllWindows().forEach(w => { if (w !== mainWin) try { w.destroy(); } catch (e) {} }); });
app.on('will-quit', () => { setTimeout(() => process.exit(0), 2000).unref(); });

// видео и картинки для фона: отдаём файл с поддержкой Range (перемотка видео)
const MEDIA_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
function serveMedia(p, req) {
  const ext = path.extname(p).slice(1).toLowerCase(), type = MEDIA_EXT[ext];
  if (!type || !fs.existsSync(p)) return new Response('not found', { status: 404 });
  const size = fs.statSync(p).size, range = req.headers.get('range');
  const stream = (a, b) => { const rs = fs.createReadStream(p, { start: a, end: b }); return new ReadableStream({ start(c) { rs.on('data', d => c.enqueue(new Uint8Array(d))); rs.on('end', () => c.close()); rs.on('error', e => c.error(e)); }, cancel() { rs.destroy(); } }); };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/); let a = m && m[1] ? +m[1] : 0, b = m && m[2] ? +m[2] : size - 1; b = Math.min(b, size - 1, a + 8 * 2 ** 20 - 1);
    return new Response(stream(a, b), { status: 206, headers: { 'content-type': type, 'content-length': String(b - a + 1), 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes' } });
  }
  return new Response(stream(0, size - 1), { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
}
handle('pickMedia', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Фон: фото или видео', properties: ['openFile'], filters: [{ name: 'Фото и видео', extensions: Object.keys(MEDIA_EXT) }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0], ext = path.extname(p).slice(1).toLowerCase(), kind = MEDIA_EXT[ext].startsWith('video') ? 'video' : 'image';
  return { kind, path: p, name: path.basename(p), data: kind === 'image' ? toAB(fs.readFileSync(p)) : null };
});
const send = (ev, ch, data) => { try { ev.sender.send(ch, data); } catch (e) {} };
const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const writeAtomic = (f, data) => { fs.writeFileSync(f + '.tmp', data); fs.renameSync(f + '.tmp', f); };

// ---------- файлы ----------
handle('pickAudio', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Выберите трек', properties: ['openFile'], filters: [{ name: 'Аудио', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), data: toAB(fs.readFileSync(p)) };
});
handle('readFile', async (ev, p) => toAB(fs.readFileSync(p)));
const pickBinary = async (title, name, extensions) => {
  const r = await dialog.showOpenDialog(mainWin, { title, properties: ['openFile'], filters: [{ name, extensions }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0]; return { name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), data: toAB(fs.readFileSync(p)) };
};
handle('pickImage', () => pickBinary('Выберите картинку', 'Картинки', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']));
handle('pickFont', () => pickBinary('Выберите шрифт', 'Шрифты', ['ttf', 'otf', 'woff', 'woff2']));

// ---------- проекты, автосохранение, недавние ----------
const RECENT = () => UD('recent.json');
function readRecent() { try { return JSON.parse(fs.readFileSync(RECENT(), 'utf8')).filter(r => r && r.path && fs.existsSync(r.path)); } catch (e) { return []; } }
function pushRecent(p) { const list = readRecent().filter(r => r.path !== p); list.unshift({ path: p, name: path.basename(p), time: Date.now() }); try { fs.writeFileSync(RECENT(), JSON.stringify(list.slice(0, 10), null, 1)); } catch (e) {} }
// проект вместе с треком и видеофоном: LSPZ1 + длина манифеста + манифест JSON + файлы подряд
function writeBundle(fp, json) {
  const proj = JSON.parse(json), files = [];
  if (proj.audioPath && fs.existsSync(proj.audioPath)) files.push({ key: 'audio', name: path.basename(proj.audioPath), src: proj.audioPath });
  const bm = proj.style && proj.style.bgMedia; if (bm && bm.type === 'video' && bm.path && fs.existsSync(bm.path)) files.push({ key: 'bg', name: path.basename(bm.path), src: bm.path });
  files.forEach(f => f.size = fs.statSync(f.src).size);
  const man = Buffer.from(JSON.stringify({ project: json, files: files.map(({ key, name, size }) => ({ key, name, size })) }), 'utf8'), head = Buffer.alloc(9); head.write('LSPZ1', 0); head.writeUInt32LE(man.length, 5);
  const tmp = fp + '.tmp', fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, head); fs.writeSync(fd, man);
  for (const f of files) { const rd = fs.openSync(f.src, 'r'), buf = Buffer.alloc(4 * 2 ** 20); let n; while ((n = fs.readSync(rd, buf, 0, buf.length, null)) > 0) fs.writeSync(fd, buf, 0, n); fs.closeSync(rd); }
  fs.closeSync(fd); fs.renameSync(tmp, fp);
}
function readBundle(fp) {
  const fd = fs.openSync(fp, 'r'), head = Buffer.alloc(9); fs.readSync(fd, head, 0, 9, 0);
  if (head.toString('utf8', 0, 5) !== 'LSPZ1') { fs.closeSync(fd); throw new Error('это не файл проекта с треком'); }
  const ml = head.readUInt32LE(5), mb = Buffer.alloc(ml); fs.readSync(fd, mb, 0, ml, 9); const man = JSON.parse(mb.toString('utf8')), proj = JSON.parse(man.project);
  const dir = UD('bundles', path.basename(fp).replace(/\.lspz$/i, '') + '-' + fs.statSync(fp).size); fs.mkdirSync(dir, { recursive: true });
  let pos = 9 + ml;
  for (const f of man.files) {
    const out = path.join(dir, f.name.replace(/[\\/:*?"<>|]/g, '_'));
    if (!fs.existsSync(out) || fs.statSync(out).size !== f.size) { const wd = fs.openSync(out, 'w'), buf = Buffer.alloc(4 * 2 ** 20); let left = f.size, p = pos; while (left > 0) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), p); if (!n) break; fs.writeSync(wd, buf, 0, n); left -= n; p += n; } fs.closeSync(wd); }
    pos += f.size;
    if (f.key === 'audio') proj.audioPath = out; if (f.key === 'bg' && proj.style && proj.style.bgMedia) proj.style.bgMedia.path = out;
  }
  fs.closeSync(fd); return JSON.stringify(proj);
}
handle('saveBundle', async (ev, json, name) => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить проект вместе с треком', defaultPath: name, filters: [{ name: 'Проект с треком', extensions: ['lspz'] }] });
  if (r.canceled || !r.filePath) return null; writeBundle(r.filePath, json); pushRecent(r.filePath); return r.filePath;
});
handle('saveProject', async (ev, json, name, existing) => {
  let fp = existing && fs.existsSync(path.dirname(existing)) ? existing : null;
  if (!fp) {
    const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить проект', defaultPath: name, filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp'] }] });
    if (r.canceled || !r.filePath) return null; fp = r.filePath;
  }
  if (/\.lspz$/i.test(fp)) writeBundle(fp, json); else writeAtomic(fp, json); pushRecent(fp); return fp;
});
handle('openProject', async (ev, given) => {
  let fp = given;
  if (!fp) {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Открыть проект', properties: ['openFile'], filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp', 'lspz', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null; fp = r.filePaths[0];
  }
  const json = /\.lspz$/i.test(fp) ? readBundle(fp) : fs.readFileSync(fp, 'utf8'); pushRecent(fp); return { json, path: fp };
});
handle('recent', async () => readRecent());
handle('autosave', async (ev, json) => { writeAtomic(UD('autosave.lsp'), json); return true; });
handle('loadAutosave', async () => { try { const f = UD('autosave.lsp'); return { json: fs.readFileSync(f, 'utf8'), time: fs.statSync(f).mtimeMs }; } catch (e) { return null; } });
handle('clearAutosave', async () => { try { fs.unlinkSync(UD('autosave.lsp')); } catch (e) {} return true; });

// ---------- пресеты ----------
handle('loadUserPresets', async () => { try { return JSON.parse(fs.readFileSync(USER_PRESETS(), 'utf8')); } catch (e) { return {}; } });
handle('saveUserPresets', async (ev, p) => { writeAtomic(USER_PRESETS(), JSON.stringify(p, null, 1)); return true; });
const PROFILE_F = () => UD('profile.json');
handle('loadProfile', async () => { try { return JSON.parse(fs.readFileSync(PROFILE_F(), 'utf8')); } catch (e) { return {}; } });
handle('saveProfile', async (ev, p) => { writeAtomic(PROFILE_F(), JSON.stringify(p)); return true; });
const USER_TPL = () => UD('user-templates.json');
handle('loadUserTemplates', async () => { try { return JSON.parse(fs.readFileSync(USER_TPL(), 'utf8')); } catch (e) { return {}; } });
handle('saveUserTemplates', async (ev, p) => { writeAtomic(USER_TPL(), JSON.stringify(p)); return true; });
handle('exportPreset', async (ev, json, name) => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить пресет в файл', defaultPath: name + '.lspreset', filters: [{ name: 'Пресет Lyric Studio', extensions: ['lspreset'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, json, 'utf8'); return r.filePath;
});
handle('importPreset', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Открыть пресет', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Пресет Lyric Studio', extensions: ['lspreset', 'json'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths.map(p => ({ name: path.basename(p).replace(/\.(lspreset|json)$/i, ''), json: fs.readFileSync(p, 'utf8') }));
});

// ---------- отчёт об ошибке ----------
handle('log', async (ev, level, msg) => { log(`[${level}]`, msg); return true; });
handle('copyReport', async (ev, extra) => {
  let tail = ''; try { tail = fs.readFileSync(UD('lyric-studio.log'), 'utf8').split('\n').slice(-160).join('\n'); } catch (e) {}
  const model = fs.existsSync(path.join(MODEL_DIR(), 'model.int8.onnx'));
  const txt = ['=== Lyric Studio: отчёт ===',
    `Версия: ${app.getVersion()}${process.env.PORTABLE_EXECUTABLE_FILE ? ' (portable)' : ''}`,
    `Система: ${process.platform} ${os.release()} ${os.arch()} · ${os.cpus()[0] ? os.cpus()[0].model : ''} · ${os.cpus().length} ядер · ОЗУ ${(os.totalmem() / 2 ** 30).toFixed(1)} ГБ (свободно ${(os.freemem() / 2 ** 30).toFixed(1)})`,
    `Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
    `ffmpeg: ${fs.existsSync(FFMPEG) ? 'есть' : 'НЕ НАЙДЕН ' + FFMPEG} · модель синхронизации: ${model ? 'скачана' : 'нет'}`,
    extra ? 'Состояние: ' + extra : '', '--- журнал (последние строки) ---', tail].join('\n');
  clipboard.writeText(txt); return txt.length;
});
handle('openLogFolder', async () => { shell.openPath(app.getPath('userData')); return true; });

// ---------- обновления ----------
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
handle('version', async () => ({ version: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_FILE }));
handle('checkUpdate', async () => {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { 'User-Agent': 'LyricStudio', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GitHub ответил ' + res.status);
  const list = await res.json(); let best = null;
  for (const r of list) {
    if (r.draft || r.prerelease) continue;
    const a = {}; for (const as of r.assets || []) { const m = as.name.match(/^LyricStudio-(Setup|Portable)-(\d+\.\d+\.\d+)\.exe$/); if (m) { a.v = m[2]; a[m[1]] = { url: as.browser_download_url, size: as.size }; } }
    if (a.v && a.Setup && a.Portable && (!best || cmpVer(a.v, best.version) > 0)) best = { version: a.v, setup: a.Setup, portable: a.Portable, page: r.html_url, notes: r.body || '' };
  }
  if (best && cmpVer(best.version, app.getVersion()) > 0) return best;
  return null;
});
handle('installUpdate', async (ev, info) => {
  const progress = t => send(ev, 'progress:update', t);
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe) {
    const dest = path.join(path.dirname(portableExe), `LyricStudio-Portable-${info.version}.exe`);
    await download(info.portable.url, dest, 'обновление', progress);
    shell.showItemInFolder(dest);
    return { portable: true, path: dest };
  }
  const dest = path.join(os.tmpdir(), `LyricStudio-Setup-${info.version}.exe`);
  await download(info.setup.url, dest, 'обновление', progress);
  log('запускаю установщик', dest);
  try { await Promise.race([mainWin.webContents.executeJavaScript('window.__beforeClose ? window.__beforeClose() : true'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  // установщик стартует, когда эта программа уже полностью закрылась
  spawn('cmd.exe', ['/d', '/c', `ping 127.0.0.1 -n 3 > nul & start "" "${dest}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.exit(0), 300);
  return { installer: true };
});
handle('openExternal', async (ev, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });

// ---------- загрузка файлов ----------
async function download(url, dest, label, progress) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`не удалось скачать ${label}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0, part = dest + '.part', out = fs.createWriteStream(part), reader = res.body.getReader();
  let got = 0, last = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      got += value.length; if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      const pct = total ? Math.floor(got / total * 100) : Math.floor(got / 1e6);
      if (pct !== last) { last = pct; progress(total ? `Скачиваю ${label}: ${pct}%` : `Скачиваю ${label}: ${pct} МБ`); }
    }
  } finally { await new Promise(r => out.end(r)); }
  if (total && got !== total) throw new Error(`загрузка ${label} прервалась, попробуйте ещё раз`);
  try { fs.unlinkSync(dest); } catch (e) {}
  fs.renameSync(part, dest);
}

// ---------- модель синхронизации ----------
const MODEL_BASE = `https://github.com/${REPO}/releases/download/model-v1/`;
async function ensureModel(progress) {
  const dir = MODEL_DIR(), onnx = path.join(dir, 'model.int8.onnx'), tok = path.join(dir, 'tokens.txt');
  if (fs.existsSync(onnx) && fs.existsSync(tok)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(tok)) await download(MODEL_BASE + 'tokens.txt', tok, 'словарь модели', progress);
  if (!fs.existsSync(onnx)) await download(MODEL_BASE + 'model.int8.onnx', onnx, 'модель синхронизации (≈230 МБ, один раз)', progress);
  return dir;
}
const SESS = {};
async function getSession(file) {
  if (SESS[file]) return SESS[file];
  const ort = require('onnxruntime-node');
  SESS[file] = { ort, s: await ort.InferenceSession.create(file, { executionProviders: ['cpu'] }) };
  return SESS[file];
}
const EN_BASE = `https://github.com/${REPO}/releases/download/model-en-v1/`;
async function ensureEn(progress) {
  const dir = UD('w2v-en'), onnx = path.join(dir, 'model.int8.onnx'), voc = path.join(dir, 'vocab.json');
  if (fs.existsSync(onnx) && fs.existsSync(voc)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(voc)) await download(EN_BASE + 'vocab.json', voc, 'словарь английской модели', progress);
  if (!fs.existsSync(onnx)) await download(EN_BASE + 'model.int8.onnx', onnx, 'английская модель (≈120 МБ, один раз)', progress);
  return dir;
}
const SEP = require('./separate');
async function ensureMdx(progress) {
  const dir = UD('uvr'), f = path.join(dir, SEP.MDX.file);
  if (fs.existsSync(f)) return f; fs.mkdirSync(dir, { recursive: true });
  await download(SEP.MDX.url, f, 'модель отделения вокала (≈65 МБ, один раз)', progress); return f;
}
// вырезать вокал из отрезка трека и сохранить во временный wav
async function vocalsFile(audioPath, from, to, progress) {
  const f = await ensureMdx(progress), { ort, s } = await getSession(f);
  progress('Читаю трек для отделения вокала…');
  const a = from != null ? Math.max(0, +from) : null, st = await SEP.loadStereo44(FFMPEG, audioPath, a, to != null ? +to : null);
  const t0 = Date.now();
  const v = await SEP.separate(st, async (arr, dims) => { const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', arr, dims) }); return out[s.outputNames[0]].data; },
    q => { const el = (Date.now() - t0) / 1000, left = q > 0.02 ? el / q * (1 - q) : 0; progress(`Отделяю вокал от бита: ${Math.round(q * 100)}%${left ? ' · осталось ~' + (left > 90 ? Math.ceil(left / 60) + ' мин' : Math.ceil(left) + ' с') : ''}`); });
  const out = path.join(os.tmpdir(), `lyric-vocals-${Date.now()}.wav`); SEP.writeWav(out, v, 44100);
  log(`вокал отделён за ${((Date.now() - t0) / 1000).toFixed(1)} с`); return { file: out, offset: a || 0 };
}
handle('align', async (ev, args) => {
  const progress = t => send(ev, 'progress:align', t), en = args.lang === 'en';
  let audioPath = args.audioPath, from = args.from, to = args.to, offset = null, tmp = null;
  if (args.vocals) { const r = await vocalsFile(args.audioPath, args.from, args.to, progress); tmp = audioPath = r.file; offset = r.offset; from = null; to = null; }
  try {
    if (en) {
      const dir = await ensureEn(progress), { ort, s } = await getSession(path.join(dir, 'model.int8.onnx'));
      const runRaw = async x => { const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, [1, x.length]) }); const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] }; };
      return await A.align({ ffmpeg: FFMPEG, modelDir: dir, audioPath, lyrics: args.lyrics, from, to, offset, lang: 'en', runRaw, progress });
    }
    const dir = await ensureModel(progress), { ort, s } = await getSession(path.join(dir, 'model.int8.onnx'));
    const runChunk = async (feats, T) => {
      const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) });
      const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] };
    };
    return await A.align({ ffmpeg: FFMPEG, modelDir: dir, audioPath, lyrics: args.lyrics, from, to, offset, runChunk, progress });
  } finally { if (tmp) try { fs.unlinkSync(tmp); } catch (e) {} }
});

// ---------- экспорт видео ----------
// job: { html, W, H, width, fps, start, end, fade, audioPath, name, container: 'mp4'|'mov'|'webm'|'gif', draft, outPath? }
// Кадры рендерятся параллельно в нескольких скрытых окнах, каждое пишет свой кусок; куски склеиваются без перекодирования и сводятся со звуком.
const SEG = { mp4: 'mp4', mov: 'mov', webm: 'mov', gif: 'mp4' };
let GPU = undefined;
async function detectGpu() {
  if (GPU !== undefined) return GPU; GPU = null;
  for (const [enc, name] of [['h264_nvenc', 'NVIDIA'], ['h264_qsv', 'Intel'], ['h264_amf', 'AMD']]) {
    try { await runFF(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.3', '-c:v', enc, '-f', 'null', '-']); GPU = { enc, name }; break; } catch (e) {}
  }
  log('видеокарта для кодирования:', GPU ? GPU.enc : 'нет'); return GPU;
}
handle('gpuInfo', async () => await detectGpu());
const GPU_ARGS = { h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p'], h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', '20', '-pix_fmt', 'nv12'], h264_amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20', '-pix_fmt', 'yuv420p'] };
function segCodec(job, outW, outH) {
  if (job.container === 'mp4' && job.gpuEnc && GPU_ARGS[job.gpuEnc]) return GPU_ARGS[job.gpuEnc];
  if (job.container === 'mov' || job.container === 'webm') return ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'];
  if (job.container === 'gif') return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libx264', '-preset', job.draft ? 'ultrafast' : outH * outW > 2.2e6 ? 'faster' : 'veryfast', '-crf', job.draft ? '28' : '18', '-pix_fmt', 'yuv420p'];
}
function segArgs(job, inW, inH, outW, outH, out) {
  const alpha = job.container === 'mov' || job.container === 'webm', fps = String(job.fps);
  const input = alpha ? ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${inW}x${inH}`, '-framerate', fps, '-i', '-'] : ['-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-'];
  return ['-v', 'error', '-y', ...input, '-vf', `scale=${outW}:${outH}:flags=${job.draft ? 'bilinear' : 'lanczos'}`, ...segCodec(job, outW, outH), '-r', fps, out];
}
function finalArgs(job, list, out, outW) {
  const dur = job.end - job.start, fade = Math.min(job.fade || 0.4, dur / 3), af = ['-af', `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`];
  const vin = ['-f', 'concat', '-safe', '0', '-i', list], ain = ['-ss', String(job.start), '-t', String(dur), '-i', job.audioPath];
  if (job.container === 'gif') return ['-v', 'error', '-y', ...vin, '-vf', `fps=${Math.min(job.fps, 20)},scale=${Math.min(outW, 720)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', out];
  const v = job.container === 'webm' ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0'] : ['-c:v', 'copy'];
  const a = job.container === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', job.draft ? '128k' : job.container === 'mov' ? '256k' : '192k'];
  const tail = ['-shortest', ...(job.container === 'mp4' ? ['-movflags', '+faststart'] : []), out];
  if (job.sfxPath) {
    const fd = `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`;
    return ['-v', 'error', '-y', ...vin, ...ain, '-i', job.sfxPath, '-filter_complex', `[1:a]${fd}[m];[2:a]volume=${(+job.sfxVol || .7).toFixed(2)},${fd}[s];[m][s]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]', ...v, ...a, ...tail];
  }
  return ['-v', 'error', '-y', ...vin, ...ain, '-map', '0:v', '-map', '1:a', ...v, ...a, ...af, ...tail];
}
const runFF = args => new Promise((res, rej) => { const p = spawn(FFMPEG, args, { windowsHide: true }); let e = ''; p.stderr.on('data', d => e += d); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg: ' + e.slice(0, 500)))); });
async function openEngine(outW, outH, zoom, alpha) {
  const win = new BrowserWindow({ show: false, width: outW, height: outH, useContentSize: true, frame: false, transparent: alpha, backgroundColor: alpha ? '#00000000' : '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: zoom } });
  win.webContents.setFrameRate(60);
  await win.loadURL('app://job/engine.html'); win.webContents.setZoomFactor(zoom);
  for (let i = 0; i < 300; i++) { if (await win.webContents.executeJavaScript('window.READY===true||!!window.__err')) break; await new Promise(r => setTimeout(r, 100)); }
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
  const err = await win.webContents.executeJavaScript('window.__err||""'); if (err) { win.destroy(); throw new Error('движок: ' + err); }
  return win;
}
const frameAt = (win, t) => win.webContents.executeJavaScript(`(window.seekAsync||((t)=>Promise.resolve(seek(t))))(${t.toFixed(5)}).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
async function renderSegment(job, k0, k1, file, dims, onFrame) {
  const { outW, outH, zoom } = dims, alpha = job.container === 'mov' || job.container === 'webm', q = job.draft ? 70 : 92;
  const win = await openEngine(outW, outH, zoom, alpha); let ff = null, ffErr = '', done = null;
  try {
    for (let i = k0; i < k1; i++) {
      if (cancelFlag) throw new Error('__cancel');
      await frameAt(win, job.start + i / job.fps); win.webContents.invalidate();
      const img = await win.webContents.capturePage();
      if (!ff) {
        const sz = img.getSize(); if (!sz.width || !sz.height) throw new Error('пустой кадр при захвате окна');
        ff = spawn(FFMPEG, segArgs(job, sz.width, sz.height, outW, outH, file), { windowsHide: true }); ff.stderr.on('data', d => ffErr += d); ff.stdin.on('error', () => {});
        done = new Promise(r => ff.on('close', r));
      }
      if (ff.exitCode !== null) throw new Error('ffmpeg: ' + (ffErr.slice(0, 500) || 'остановился'));
      const buf = alpha ? img.toBitmap() : img.toJPEG(q);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      onFrame();
    }
    if (ff) { ff.stdin.end(); const code = await done; if (code !== 0) throw new Error('ffmpeg: ' + ffErr.slice(0, 500)); }
  } catch (e) { if (ff) { try { ff.stdin.destroy(); ff.kill(); } catch (x) {} } throw e; }
  finally { win.destroy(); }
}
handle('cancelExport', () => { cancelFlag = true; });
handle('pickFolder', async () => { const r = await dialog.showOpenDialog(mainWin, { title: 'Папка для видео', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
const FNAME = { mp4: 'Видео MP4', mov: 'MOV с прозрачностью (ProRes 4444)', webm: 'WebM с прозрачностью (VP9)', gif: 'GIF-анимация' };
async function exportVideoImpl(ev, job) {
  const ext = job.container || 'mp4';
  let out = job.outPath;
  if (!out) { const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить видео', defaultPath: (job.name || 'video') + '.' + ext, filters: [{ name: FNAME[ext], extensions: [ext] }] }); if (r.canceled || !r.filePath) return { ok: false }; out = r.filePath; }
  const progress = (frac, text) => send(ev, 'progress:export', { frac, text });
  cancelFlag = false;
  const fps = job.fps || 30, outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2, zoom = outW / job.W, n = Math.max(1, Math.round((job.end - job.start) * fps));
  const cores = os.cpus().length, maxW = outW * outH > 2.2e6 ? 2 : 4, workers = Math.max(1, Math.min(maxW, Math.floor(cores / 3), Math.ceil(n / 60), job.workers || 99));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lyric-')), t0 = Date.now(); let doneFrames = 0;
  if (job.gpu && ext === 'mp4') { const g = await detectGpu(); if (g) job.gpuEnc = g.enc; }
  if (job.sfx && job.sfx.data && ext !== 'gif') { job.sfxPath = path.join(tmp, 'sfx.wav'); fs.writeFileSync(job.sfxPath, Buffer.from(job.sfx.data)); job.sfxVol = job.sfx.vol; }
  log(`экспорт: ${outW}x${outH} ${fps}fps ${ext}${job.draft ? ' черновик' : ''}, окон: ${workers}${job.gpuEnc ? ', ' + job.gpuEnc : ''}${job.sfxPath ? ', звуки' : ''} → ${out}`);
  JOB_HTML = job.html;
  try {
    progress(0, `Готовлю движок (${workers} ${workers === 1 ? 'окно' : 'окна'})…`);
    const segs = [], per = Math.ceil(n / workers), tick = () => { doneFrames++; if (doneFrames % 5 === 0) { const el = (Date.now() - t0) / 1000, left = el / doneFrames * (n - doneFrames); progress(doneFrames / n * .96, `Кадр ${doneFrames} из ${n} · осталось ~${left > 90 ? Math.ceil(left / 60) + ' мин' : Math.ceil(left) + ' с'}`); } };
    const jobs = [];
    for (let w = 0; w < workers; w++) { const k0 = w * per, k1 = Math.min(n, k0 + per); if (k1 <= k0) break; const f = path.join(tmp, `seg${w}.${SEG[ext]}`); segs.push(f); jobs.push(renderSegment(job, k0, k1, f, { outW, outH, zoom }, tick)); }
    const res = await Promise.allSettled(jobs); const bad = res.find(r => r.status === 'rejected'); if (bad) { cancelFlag = true; throw bad.reason; }
    progress(0.97, ext === 'gif' ? 'Собираю GIF…' : ext === 'webm' ? 'Кодирую WebM со звуком…' : 'Склеиваю видео со звуком…');
    const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    await runFF(finalArgs(Object.assign({}, job, { fps }), list, out, outW));
    log('экспорт готов', ((Date.now() - t0) / 1000).toFixed(1) + ' с');
    progress(1, 'Готово'); return { ok: true, path: out, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    try { fs.unlinkSync(out); } catch (x) {}
    if (e.message === '__cancel') return { ok: false, cancelled: true };
    if (job.gpuEnc) { log('видеокарта не справилась, повторяю на процессоре:', e.message); GPU = null; return { retry: true, out }; }
    throw e;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
}
handle('exportVideo', async (ev, job) => {
  const r = await exportVideoImpl(ev, job);
  if (r && r.retry) { send(ev, 'progress:export', { frac: 0, text: 'Видеокарта не справилась — повторяю на процессоре…' }); return await exportVideoImpl(ev, Object.assign({}, job, { gpu: false, gpuEnc: undefined, outPath: r.out })); }
  return r;
});
// один кадр в PNG (кадр из ролика или обложка)
handle('exportFrame', async (ev, job) => {
  const r = await dialog.showSaveDialog(mainWin, { title: job.title || 'Сохранить кадр', defaultPath: (job.name || 'кадр') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2; JOB_HTML = job.html;
  const win = await openEngine(outW, outH, outW / job.W, !!job.transparent);
  try { await frameAt(win, job.t); win.webContents.invalidate(); await new Promise(r => setTimeout(r, 120)); const img = await win.webContents.capturePage(); fs.writeFileSync(r.filePath, img.resize({ width: outW, height: outH }).toPNG()); return { ok: true, path: r.filePath }; }
  finally { win.destroy(); }
});
handle('captureRect', async (ev, r) => {
  const img = await mainWin.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  return 'data:image/jpeg;base64,' + img.resize({ width: 180 }).toJPEG(80).toString('base64');
});
handle('showFile', async (ev, p) => { shell.showItemInFolder(p); return true; });
