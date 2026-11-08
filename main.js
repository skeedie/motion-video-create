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
    mainWin.webContents.executeJavaScript('window.__beforeClose ? window.__beforeClose() : true').then(ok => { if (ok) { mainWin.__canClose = true; mainWin.close(); } }).catch(() => { mainWin.__canClose = true; mainWin.close(); });
  });
}

app.whenReady().then(() => {
  log(`запуск ${app.getVersion()} · ${process.platform} ${os.release()} · electron ${process.versions.electron}`);
  protocol.handle('app', req => {
    const u = new URL(req.url);
    if (u.host === 'job') return new Response(JOB_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const p = path.normalize(path.join(APP_DIR, decodeURIComponent(u.pathname)));
    if (!p.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

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
handle('saveProject', async (ev, json, name, existing) => {
  let fp = existing && fs.existsSync(path.dirname(existing)) ? existing : null;
  if (!fp) {
    const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить проект', defaultPath: name, filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp'] }] });
    if (r.canceled || !r.filePath) return null; fp = r.filePath;
  }
  writeAtomic(fp, json); pushRecent(fp); return fp;
});
handle('openProject', async (ev, given) => {
  let fp = given;
  if (!fp) {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Открыть проект', properties: ['openFile'], filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null; fp = r.filePaths[0];
  }
  const json = fs.readFileSync(fp, 'utf8'); pushRecent(fp); return { json, path: fp };
});
handle('recent', async () => readRecent());
handle('autosave', async (ev, json) => { writeAtomic(UD('autosave.lsp'), json); return true; });
handle('loadAutosave', async () => { try { const f = UD('autosave.lsp'); return { json: fs.readFileSync(f, 'utf8'), time: fs.statSync(f).mtimeMs }; } catch (e) { return null; } });
handle('clearAutosave', async () => { try { fs.unlinkSync(UD('autosave.lsp')); } catch (e) {} return true; });

// ---------- пресеты ----------
handle('loadUserPresets', async () => { try { return JSON.parse(fs.readFileSync(USER_PRESETS(), 'utf8')); } catch (e) { return {}; } });
handle('saveUserPresets', async (ev, p) => { writeAtomic(USER_PRESETS(), JSON.stringify(p, null, 1)); return true; });
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
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { if (mainWin) mainWin.__canClose = true; app.quit(); }, 700);
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
let ortSession = null;
async function getSession(dir) {
  if (ortSession) return ortSession;
  const ort = require('onnxruntime-node');
  ortSession = { ort, s: await ort.InferenceSession.create(path.join(dir, 'model.int8.onnx'), { executionProviders: ['cpu'] }) };
  return ortSession;
}
handle('align', async (ev, args) => {
  const progress = t => send(ev, 'progress:align', t);
  const dir = await ensureModel(progress), { ort, s } = await getSession(dir);
  const runChunk = async (feats, T) => {
    const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) });
    const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] };
  };
  return await A.align({ ffmpeg: FFMPEG, modelDir: dir, audioPath: args.audioPath, lyrics: args.lyrics, from: args.from, to: args.to, runChunk, progress });
});

// ---------- экспорт видео ----------
// job: { html, W, H, width, fps, start, end, fade, audioPath, name, container: 'mp4'|'mov'|'webm', draft }
function ffArgs(job, inW, inH, outW, outH, out) {
  const fps = String(job.fps), dur = job.end - job.start, fade = Math.min(job.fade || 0.4, dur / 3);
  const alpha = job.container === 'mov' || job.container === 'webm';
  const input = alpha ? ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${inW}x${inH}`, '-framerate', fps, '-i', '-']
    : ['-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-'];
  const audio = ['-ss', String(job.start), '-t', String(dur), '-i', job.audioPath];
  const vf = ['-vf', `scale=${outW}:${outH}:flags=${job.draft ? 'bilinear' : 'lanczos'}`];
  const af = ['-af', `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`];
  let codec;
  if (job.container === 'mov') codec = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-c:a', 'aac', '-b:a', '256k'];
  else if (job.container === 'webm') codec = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0', '-c:a', 'libopus', '-b:a', '160k'];
  else codec = ['-c:v', 'libx264', '-preset', job.draft ? 'ultrafast' : outH * outW > 2.2e6 ? 'faster' : 'veryfast', '-crf', job.draft ? '28' : '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', job.draft ? '128k' : '192k', '-movflags', '+faststart'];
  return ['-v', 'error', '-y', ...input, ...audio, '-map', '0:v', '-map', '1:a', ...vf, ...codec, '-r', fps, ...af, '-shortest', out];
}
handle('cancelExport', () => { cancelFlag = true; });
handle('exportVideo', async (ev, job) => {
  const ext = job.container || 'mp4', FN = { mp4: 'Видео MP4', mov: 'MOV с прозрачностью (ProRes 4444)', webm: 'WebM с прозрачностью (VP9)' }[ext];
  const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить видео', defaultPath: (job.name || 'video') + '.' + ext, filters: [{ name: FN, extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const out = r.filePath, progress = (frac, text) => send(ev, 'progress:export', { frac, text });
  cancelFlag = false;
  const alpha = ext !== 'mp4', fps = job.fps || 30;
  const outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2, zoom = outW / job.W;
  log(`экспорт: ${outW}x${outH} ${fps}fps ${ext}${job.draft ? ' черновик' : ''} → ${out}`);
  JOB_HTML = job.html;
  const win = new BrowserWindow({ show: false, width: outW, height: outH, useContentSize: true, frame: false, transparent: alpha, backgroundColor: alpha ? '#00000000' : '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: zoom } });
  win.webContents.setFrameRate(60);
  let ff = null, ffErr = '', ffDone = null;
  try {
    progress(0, 'Готовлю движок…');
    await win.loadURL('app://job/engine.html');
    win.webContents.setZoomFactor(zoom);
    for (let i = 0; i < 300; i++) { if (await win.webContents.executeJavaScript('window.READY===true||!!window.__err')) break; await new Promise(r => setTimeout(r, 100)); }
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
    const err = await win.webContents.executeJavaScript('window.__err||""'); if (err) throw new Error('движок: ' + err);
    const dur = job.end - job.start, n = Math.round(dur * fps), t0 = Date.now(), q = job.draft ? 70 : 92;
    for (let i = 0; i < n; i++) {
      if (cancelFlag) throw new Error('__cancel');
      await win.webContents.executeJavaScript(`seek(${(job.start + i / fps).toFixed(5)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      win.webContents.invalidate();
      const img = await win.webContents.capturePage();
      if (!ff) {
        const sz = img.getSize();
        if (!sz.width || !sz.height) throw new Error('пустой кадр при захвате окна');
        ff = spawn(FFMPEG, ffArgs(job, sz.width, sz.height, outW, outH, out), { windowsHide: true });
        ff.stderr.on('data', d => ffErr += d); ff.stdin.on('error', () => {});
        ffDone = new Promise(res => ff.on('close', res));
        log(`кадр захвата ${sz.width}x${sz.height}`);
      }
      const buf = alpha ? img.toBitmap() : img.toJPEG(q);
      if (ff.exitCode !== null) throw new Error('ffmpeg: ' + (ffErr.slice(0, 500) || 'остановился'));
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 5 === 0) { const el = (Date.now() - t0) / 1000, left = i ? el / i * (n - i) : 0; progress(i / n, `Кадр ${i} из ${n} · осталось ~${left > 90 ? Math.ceil(left / 60) + ' мин' : Math.ceil(left) + ' с'}`); }
    }
    ff.stdin.end(); progress(0.99, 'Склеиваю видео со звуком…');
    const code = await ffDone; if (code !== 0) throw new Error('ffmpeg: ' + ffErr.slice(0, 500));
    log('экспорт готов', ((Date.now() - t0) / 1000).toFixed(1) + ' с');
    progress(1, 'Готово'); return { ok: true, path: out };
  } catch (e) {
    if (ff) { try { ff.stdin.destroy(); ff.kill(); } catch (x) {} }
    try { fs.unlinkSync(out); } catch (x) {}
    if (e.message === '__cancel') return { ok: false, cancelled: true };
    throw e;
  } finally { win.destroy(); }
});
handle('captureRect', async (ev, r) => {
  const img = await mainWin.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  return 'data:image/jpeg;base64,' + img.resize({ width: 180 }).toJPEG(80).toString('base64');
});
handle('showFile', async (ev, p) => { shell.showItemInFolder(p); return true; });
