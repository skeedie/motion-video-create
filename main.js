'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } = require('electron');
const path = require('path'), fs = require('fs'), { spawn } = require('child_process'), { pathToFileURL } = require('url');
const A = require('./align');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const APP_DIR = path.join(__dirname, 'app');
const unpacked = p => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const MODEL_DIR = () => path.join(app.getPath('userData'), 'giga-ctc');
const USER_PRESETS = () => path.join(app.getPath('userData'), 'user-presets.json');
let JOB_HTML = '<html></html>', mainWin = null, cancelFlag = false;

function createWindow() {
  mainWin = new BrowserWindow({ width: 1500, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#0E0F12', title: 'Lyric Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  Menu.setApplicationMenu(null);
  mainWin.loadURL('app://app/index.html');
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
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

ipcMain.handle('pickAudio', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Выберите трек', properties: ['openFile'], filters: [{ name: 'Аудио', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0], b = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
});
ipcMain.handle('readFile', async (ev, p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });

ipcMain.handle('saveProject', async (ev, json, name) => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить проект', defaultPath: name, filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, json, 'utf8'); return r.filePath;
});
ipcMain.handle('openProject', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Открыть проект', properties: ['openFile'], filters: [{ name: 'Проект Lyric Studio', extensions: ['lsp', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return null; return { json: fs.readFileSync(r.filePaths[0], 'utf8'), path: r.filePaths[0] };
});
ipcMain.handle('loadUserPresets', async () => { try { return JSON.parse(fs.readFileSync(USER_PRESETS(), 'utf8')); } catch (e) { return {}; } });
ipcMain.handle('saveUserPresets', async (ev, p) => { fs.writeFileSync(USER_PRESETS(), JSON.stringify(p, null, 1), 'utf8'); return true; });

// ---------- модель синхронизации ----------
const MODEL_BASE = 'https://github.com/skeedie/motion-video-create/releases/download/model-v1/';
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
      if (pct !== last) { last = pct; progress(total ? `Скачиваю ${label}: ${pct}% (один раз)` : `Скачиваю ${label}: ${pct} МБ (один раз)`); }
    }
  } finally { await new Promise(r => out.end(r)); }
  if (total && got !== total) throw new Error(`загрузка ${label} прервалась, попробуйте ещё раз`);
  fs.renameSync(part, dest);
}
async function ensureModel(progress) {
  const dir = MODEL_DIR(), onnx = path.join(dir, 'model.int8.onnx'), tok = path.join(dir, 'tokens.txt');
  if (fs.existsSync(onnx) && fs.existsSync(tok)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(tok)) await download(MODEL_BASE + 'tokens.txt', tok, 'словарь модели', progress);
  if (!fs.existsSync(onnx)) await download(MODEL_BASE + 'model.int8.onnx', onnx, 'модель синхронизации (≈230 МБ)', progress);
  return dir;
}
let ortSession = null;
async function getSession(dir) {
  if (ortSession) return ortSession;
  const ort = require('onnxruntime-node');
  ortSession = { ort, s: await ort.InferenceSession.create(path.join(dir, 'model.int8.onnx'), { executionProviders: ['cpu'] }) };
  return ortSession;
}
ipcMain.handle('align', async (ev, args) => {
  const progress = t => send(ev, 'progress:align', t);
  const dir = await ensureModel(progress), { ort, s } = await getSession(dir);
  const runChunk = async (feats, T) => {
    const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) });
    const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] };
  };
  return await A.align({ ffmpeg: FFMPEG, modelDir: dir, audioPath: args.audioPath, lyrics: args.lyrics, from: args.from, to: args.to, runChunk, progress });
});

// ---------- экспорт видео ----------
ipcMain.handle('cancelExport', () => { cancelFlag = true; });
ipcMain.handle('exportVideo', async (ev, job) => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Сохранить видео', defaultPath: job.name || 'video.mp4', filters: [{ name: 'MP4', extensions: ['mp4'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const out = r.filePath, progress = (frac, text) => send(ev, 'progress:export', { frac, text });
  cancelFlag = false;
  const outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2, zoom = outW / job.W;
  JOB_HTML = job.html;
  const win = new BrowserWindow({ show: false, width: outW, height: outH, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: zoom } });
  win.webContents.setFrameRate(60);
  let ff = null;
  try {
    progress(0, 'Готовлю движок…');
    await win.loadURL('app://job/engine.html');
    win.webContents.setZoomFactor(zoom);
    for (let i = 0; i < 300; i++) { if (await win.webContents.executeJavaScript('window.READY===true')) break; await new Promise(r => setTimeout(r, 100)); }
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
    const err = await win.webContents.executeJavaScript('window.__err||""'); if (err) throw new Error('движок: ' + err);
    const fps = job.fps || 30, dur = job.end - job.start, n = Math.round(dur * fps), fade = Math.min(job.fade || 0.4, dur / 3);
    ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-ss', String(job.start), '-t', String(dur), '-i', job.audioPath, '-map', '0:v', '-map', '1:a',
      '-vf', `scale=${outW}:${outH}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`, '-shortest', '-movflags', '+faststart', out], { windowsHide: true });
    let ffErr = ''; ff.stderr.on('data', d => ffErr += d);
    const ffDone = new Promise(res => ff.on('close', res));
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      if (cancelFlag) throw new Error('__cancel');
      await win.webContents.executeJavaScript(`seek(${(job.start + i / fps).toFixed(5)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      win.webContents.invalidate();
      const img = await win.webContents.capturePage();
      const jpg = img.toJPEG(92);
      if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 5 === 0) { const el = (Date.now() - t0) / 1000, left = i ? el / i * (n - i) : 0; progress(i / n, `Кадр ${i} из ${n} · осталось ~${Math.ceil(left)} с`); }
    }
    ff.stdin.end(); progress(0.99, 'Склеиваю видео со звуком…');
    const code = await ffDone; if (code !== 0) throw new Error('ffmpeg: ' + ffErr.slice(0, 400));
    progress(1, 'Готово'); return { ok: true, path: out };
  } catch (e) {
    if (ff) { try { ff.stdin.destroy(); ff.kill(); } catch (x) {} }
    try { fs.unlinkSync(out); } catch (x) {}
    if (e.message === '__cancel') return { ok: false, cancelled: true };
    throw e;
  } finally { win.destroy(); }
});
