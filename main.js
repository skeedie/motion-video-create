'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell, clipboard, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process'), { pathToFileURL } = require('url');
// все запущенные ffmpeg запоминаются и завершаются при выходе: в Windows дочерние процессы сами не закрываются и держат файлы программы
const CHILDREN = new Set(), _spawn = cp.spawn;
cp.spawn = function (...a) { const p = _spawn.apply(this, a); const o = a[2] || (Array.isArray(a[1]) ? null : a[1]) || {}; if (!o.detached) { CHILDREN.add(p); p.on('exit', () => CHILDREN.delete(p)); p.on('error', () => CHILDREN.delete(p)); } return p; };
const killChildren = () => { for (const p of CHILDREN) { try { p.kill('SIGKILL'); } catch (e) {} } CHILDREN.clear(); };
const { spawn } = cp;
const A = require('./align');

// вторая копия программы не запускается: она бы затирала автосохранение первой и оставляла ложный «аварийный» флаг
// путь от второй копии считается от её рабочей папки (запуск «LyricStudio.exe проект.lspz» из папки проекта)
const projArg = (argv, cwd) => { const a = (argv || []).slice(1).find(x => /\.(lsp|lspz)$/i.test(x) && fs.existsSync(path.resolve(cwd || process.cwd(), x))); return a ? path.resolve(cwd || process.cwd(), a) : null; };
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', (e, argv, cwd) => { if (!mainWin || mainWin.isDestroyed()) return; if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); const p = projArg(argv, cwd); if (p) mainWin.webContents.executeJavaScript(`window.__openPath&&window.__openPath(${JSON.stringify(p)})`).catch(() => {}); });
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const REPO = 'skeedie/motion-video-create';
const APP_DIR = path.join(__dirname, 'app');
const unpacked = p => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const UD = (...p) => path.join(app.getPath('userData'), ...p);
const MODEL_DIR = () => UD('giga-ctc');
const USER_PRESETS = () => UD('user-presets.json');
let JOB_HTML = '<html></html>', mainWin = null, cancelFlag = false, LANG = 'ru';
// подписи системных диалогов на английском (остальной интерфейс переводит окно)
const DLG_EN = { 'Да': 'Yes', 'Отмена': 'Cancel', 'Сохранить тайминги LRC': 'Save LRC timings', 'Сохранить субтитры SRT': 'Save SRT subtitles', 'Тайминги: LRC или SRT': 'Timings: LRC or SRT', 'Сохранить файл': 'Save file', 'Открыть файл': 'Open file', 'Сохранить видео': 'Save video', 'Сохранить обложку': 'Save cover', 'Сохранить кадр': 'Save frame', 'Папка для видео': 'Folder for videos', 'Видео MP4': 'MP4 video', 'MOV с прозрачностью (ProRes 4444)': 'MOV with alpha (ProRes 4444)', 'WebM с прозрачностью (VP9)': 'WebM with alpha (VP9)', 'GIF-анимация': 'GIF animation', 'Видеостикер Telegram (WebM)': 'Telegram video sticker (WebM)', 'Выберите трек': 'Choose a track', 'Выберите треки': 'Choose tracks', 'Аудио': 'Audio', 'Картинки': 'Images', 'Шрифты': 'Fonts', 'Проект Lyric Studio': 'Lyric Studio project', 'Сохранить проект': 'Save project', 'Открыть проект': 'Open project', 'Пресет Lyric Studio': 'Lyric Studio preset', 'Проект с треком': 'Project with track', 'Фото и видео': 'Photos and videos', 'Открыть пресет': 'Open preset', 'Сохранить пресет в файл': 'Save preset to file', 'Сохранить проект вместе с треком': 'Save project with track', 'Треки для пакетной обработки': 'Tracks for batch', 'Фон: фото или видео': 'Background: photo or video', 'Выберите картинку': 'Choose an image', 'Выберите шрифт': 'Choose a font' };
const tr = s => LANG === 'en' && DLG_EN[s] || s;

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
process.on('uncaughtException', e => { log('uncaughtException', e); try { fs.writeFileSync(UD('running.flag'), JSON.stringify({ time: Date.now(), version: app.getVersion(), reason: String(e && e.message || e).slice(0, 200) })); } catch (x) {} });
process.on('unhandledRejection', e => log('unhandledRejection', e));
// Операции, которые пользователь может остановить. Флаг отмены сбрасывается только когда запускается новая операция,
// а других в работе нет, и когда закончилась последняя: фоновый разбор битов больше не «съедает» нажатие «остановить»,
// а старая отмена не обрывает следующую загрузку модели.
const CANCELLABLE = new Set(['align', 'transcribe', 'removeBg', 'modelGet', 'installUpdate']); let userOps = 0;
const handle = (name, fn) => ipcMain.handle(name, async (...a) => {
  const op = CANCELLABLE.has(name); if (op && !userOps++) modelCancel = false;
  try { return await fn(...a); } catch (e) { if (e && e.message !== '__cancel') log(`ошибка в ${name}:`, e); throw e; }
  finally { if (op && !--userOps) modelCancel = false; }
});

function refocus() { try { if (mainWin && !mainWin.isDestroyed() && mainWin.isFocused()) mainWin.webContents.focus(); } catch (e) {} }
for (const k of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) { const orig = dialog[k].bind(dialog); dialog[k] = async (...a) => { try { return await orig(...a); } finally { setTimeout(refocus, 30); } }; }
// подтверждения — системным окном из главного процесса (встроенный confirm() страницы в Electron ломает фокус полей на Windows)
ipcMain.on('confirmSync', (e, msg) => { let ok = false; try { ok = dialog.showMessageBoxSync(mainWin, { type: 'question', buttons: [tr('Да'), tr('Отмена')], defaultId: 0, cancelId: 1, noLink: true, title: 'Lyric Studio', message: String(msg) }) === 0; } catch (x) {} e.returnValue = ok; setTimeout(refocus, 30); });
function createWindow() {
  mainWin = new BrowserWindow({ width: 1500, height: 940, minWidth: 1150, minHeight: 720, backgroundColor: '#0E0F12', title: 'Lyric Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  Menu.setApplicationMenu(null);
  // Поля ввода «не срабатывали»: после системных окон (подтверждения, выбор файла) и после скрытых окон рендера
  // Windows возвращает фокус окну, но не странице — клавиатура шла мимо, пока не свернёшь и не развернёшь окно.
  mainWin.on('focus', refocus);
  mainWin.loadURL('app://app/index.html');
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('render-process-gone', (e, d) => { log('окно редактора упало:', d); try { fs.writeFileSync(RUN_FLAG(), JSON.stringify({ time: Date.now(), version: app.getVersion(), reason: 'окно редактора: ' + (d && d.reason) })); } catch (x) {} if (d && d.reason !== 'clean-exit' && mainWin && !mainWin.isDestroyed()) setTimeout(() => { try { mainWin.reload(); } catch (x) {} }, 500); });
  mainWin.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 3) log('консоль:', msg, src ? `(${path.basename(src)}:${line})` : ''); });
  mainWin.on('close', e => {
    if (mainWin.__canClose) return;
    e.preventDefault();
    const done = () => { if (mainWin && !mainWin.isDestroyed()) { mainWin.__canClose = true; mainWin.close(); } };
    Promise.race([mainWin.webContents.executeJavaScript('window.__beforeClose ? window.__beforeClose() : true'), new Promise(r => setTimeout(() => r(true), 1500))]).then(done, done);
  });
}

// ---------- проверка экспорта в автоматической сборке: LS_CI_OUT=папка ----------
// Рендерит контрольные кадры и короткий ролик на настоящей Windows, чтобы ошибки экспорта ловились до выпуска.
async function ciRun(dir) {
  const { screen } = require('electron'), sleep = ms => new Promise(r => setTimeout(r, ms)), rep = { frames: [], errors: [] };
  try {
    fs.mkdirSync(dir, { recursive: true }); const d = screen.getPrimaryDisplay(); rep.display = { size: d.size, workArea: d.workAreaSize, scale: d.scaleFactor };
    for (let i = 0; i < 300; i++) { if (await mainWin.webContents.executeJavaScript('!!(window.__ls&&window.__ciJob)').catch(() => false)) break; await sleep(100); }
    const small = {}, thumb = png => nativeImage.createFromBuffer(png).resize({ width: 90, height: 160, quality: 'best' }).toBitmap();
    for (const [fmt, width, t, alpha] of [['9:16', 720, .9], ['9:16', 1080, .9], ['9:16', 1080, 2.4], ['9:16', 1080, 1.5], ['9:16', 1440, .9], ['9:16', 2160, .9], ['16:9', 1920, .9], ['1:1', 1080, .9], ['9:16', 1080, .9, true]]) {
      const job = await mainWin.webContents.executeJavaScript(`window.__ciJob(${JSON.stringify(fmt)})`), outW = width, outH = Math.round(width * job.H / job.W / 2) * 2, name = `frame-${fmt.replace(':', 'x')}-${width}-${t}${alpha ? '-alpha' : ''}.png`;
      try {
        JOB_HTML = job.html; const png = await grabFrame(job, outW, outH, t, !!alpha), sc = rep.display.scale || 1;
        fs.writeFileSync(path.join(dir, name), png.data); rep.frames.push({ name, want: [outW, outH], got: png.size, info: png.info });
        if (Math.abs(png.size[0] / sc - outW) > 2 || Math.abs(png.size[1] / sc - outH) > 2) rep.errors.push(`${name}: кадр ${png.size.join('×')} вместо ${outW}×${outH}`);
        // один и тот же момент в разном разрешении должен выглядеть одинаково
        if (fmt === '9:16' && t === .9 && !alpha) { const b = thumb(png.data); if (!small.ref) small.ref = b; else { let d = 0; for (let i = 0; i < b.length; i++) d += Math.abs(b[i] - small.ref[i]); d /= b.length; rep.frames[rep.frames.length - 1].diff720 = +d.toFixed(2); if (d > 6) rep.errors.push(`${name}: картинка отличается от 720p (${d.toFixed(1)})`); } }
      } catch (e) { rep.errors.push(name + ': ' + (e.stack || e.message)); }
    }
    try {
      const job = await mainWin.webContents.executeJavaScript(`window.__ciJob('9:16')`), wav = path.join(dir, 'silence.wav'), out = path.join(dir, 'export-1080.mp4');
      await runFF(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '4', wav]);
      const r = await exportVideoImpl({ sender: mainWin.webContents }, { html: job.html, W: job.W, H: job.H, width: 1080, start: 0, end: 3, outDur: 3, cuts: [], fade: .5, fps: 30, container: 'mp4', name: 'ci', loud: true, audioPath: wav, outPath: out });
      rep.export = r; if (r && r.ok) { await runFF(['-v', 'error', '-y', '-ss', '0.9', '-i', out, '-frames:v', '1', path.join(dir, 'export-1080-0.9.png')]); rep.probe = await runFFOut(['-hide_banner', '-i', out, '-f', 'null', '-']).then(x => (x.match(/Stream #0:0.*/) || [''])[0]);
        for (const tt of ['1.5', '2.4']) { await runFF(['-v', 'error', '-y', '-ss', tt, '-i', out, '-frames:v', '1', path.join(dir, `export-1080-${tt}.png`)]);
          const x = thumb(fs.readFileSync(path.join(dir, `export-1080-${tt}.png`))), y = thumb(fs.readFileSync(path.join(dir, `frame-9x16-1080-${tt}.png`))); let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); d /= x.length; rep['exportDiff' + tt] = +d.toFixed(2); if (d > 8) rep.errors.push(`кадр ${tt} с ролика отличается от отдельного кадра (${d.toFixed(1)})`); }
        const b = thumb(fs.readFileSync(path.join(dir, 'export-1080-0.9.png'))); let d = 0; for (let i = 0; i < b.length; i++) d += Math.abs(b[i] - small.ref[i]); d /= b.length; rep.exportDiff = +d.toFixed(2);
        if (d > 8) rep.errors.push(`кадр готового ролика отличается от контрольного (${d.toFixed(1)})`); if (!/bt709/.test(rep.probe)) rep.errors.push('в ролике нет метки цвета BT.709: ' + rep.probe); }
      else rep.errors.push('экспорт не удался: ' + JSON.stringify(r));
    } catch (e) { rep.errors.push('export: ' + (e.stack || e.message)); }
    await ciEdge(dir, rep).catch(e => rep.errors.push('краевые случаи: ' + (e.stack || e.message)));
  } catch (e) { rep.errors.push(e.stack || e.message); }
  try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1)); } catch (e) {}
  markClean(); killChildren(); app.exit(rep.errors.length ? 1 : 0);
}

// Краевые случаи экспорта: папка и трек с кириллицей, пробелом и апострофом (в том числе временная папка), вырезки, громкость,
// MOV с прозрачностью, WebM, GIF, стикер, 60 к/с и 1 с, длинный ролик, файл занят, видео поверх трека, нет трека, отмена, запуск установщика.
async function ciEdge(dir, rep) {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), E = rep.edge = {}, err = (k, m) => rep.errors.push(`${k}: ${m}`), win = process.platform === 'win32';
  const K = path.join(dir, "Тест О'Нил проект"), TMP = path.join(K, 'временные файлы'), keepEnv = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  fs.mkdirSync(TMP, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = TMP;
  const leftovers = () => fs.readdirSync(TMP).filter(d => /^lyric-/.test(d)), ffKids = () => [...CHILDREN].filter(p => /ffmpeg/i.test(p.spawnfile || '')).length;
  const info = f => runFFOut(['-hide_banner', '-i', f, '-f', 'null', '-']), durOf = s => { const m = s.match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
  const lufsOf = async f => { const s = await runFFOut(['-hide_banner', '-nostats', '-i', f, '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-']); const m = s.match(/I:\s+(-?[\d.]+) LUFS/g); return m ? +m.pop().match(/-?[\d.]+/)[0] : null; };
  const alphaShare = png => { const b = nativeImage.createFromBuffer(png).toBitmap(); let t = 0; for (let i = 3; i < b.length; i += 4) if (b[i] < 250) t++; return t / (b.length / 4); };
  const job = JSON.parse(JSON.stringify(await mainWin.webContents.executeJavaScript(`window.__ciJob('9:16')`))), jobA = await mainWin.webContents.executeJavaScript(`window.__ciJob('9:16', true)`);
  const track = path.join(K, "трек «О'Нил» 1.flac"), longTrack = path.join(K, 'длинный трек.mp3'), sfxWav = path.join(TMP, 'sfx.wav');
  await runFF(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-ac', '1', '-ar', '48000', track]);
  await runFF(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=330:d=200', '-ac', '2', '-ar', '44100', '-b:a', '128k', longTrack]);
  await runFF(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=900:d=4,volume=0.5', '-ac', '2', '-ar', '44100', sfxWav]);
  const sfx = { data: fs.readFileSync(sfxWav), vol: .7 };
  const ex = (o, ev) => exportVideoImpl(ev || { sender: mainWin.webContents }, Object.assign({}, job, { width: 720, fps: 30, cuts: [], fade: .5, fadeIn: .2, fadeOut: .5, fadeCurve: 'smooth', container: 'mp4', name: 'ci', audioPath: track }, o));
  const step = async (k, fn) => { const t0 = Date.now(); E[k] = {}; try { await fn(E[k]); } catch (e) { err(k, e.stack || e.message); } E[k].sec = +((Date.now() - t0) / 1000).toFixed(1); };
  // 1. кириллица + пробел + апостроф в пути трека, видео и временной папки; вырезка в середине; громкость; звуковые эффекты
  await step('kir-cuts-loud-sfx', async R => {
    const out = path.join(K, "видео О'Нил итог.mp4"), r = await ex({ start: 1, end: 7, outDur: 4, cuts: [{ a: 2.5, b: 4.5 }], loud: true, sfx, outPath: out });
    if (!r || !r.ok) throw new Error('не удался: ' + JSON.stringify(r));
    const s = await info(out); R.dur = durOf(s); R.lufs = await lufsOf(out); R.left = leftovers();
    if (Math.abs(R.dur - 4) > 0.15) err('kir-cuts-loud-sfx', `длина ${R.dur} вместо 4`); if (!/Audio:/.test(s)) err('kir-cuts-loud-sfx', 'нет звука');
    if (R.lufs == null || R.lufs < -16 || R.lufs > -12) err('kir-cuts-loud-sfx', `громкость ${R.lufs} LUFS вместо −14`); if (R.left.length) err('kir-cuts-loud-sfx', 'не удалены временные папки: ' + R.left);
  });
  // 2. MOV ProRes 4444 с прозрачностью: альфа на месте
  await step('mov-alpha', async R => {
    const out = path.join(K, 'альфа.mov'), r = await ex({ html: jobA.html, container: 'mov', start: 0, end: 2, outDur: 2, outPath: out }); if (!r || !r.ok) throw new Error('не удался: ' + JSON.stringify(r));
    const s = await info(out); R.stream = (s.match(/Stream #0:0.*/) || [''])[0]; if (!/prores/.test(R.stream) || !/yuva444/.test(R.stream)) err('mov-alpha', 'не ProRes 4444 с альфой: ' + R.stream); if (!/Audio:/.test(s)) err('mov-alpha', 'нет звука');
    const png = path.join(dir, 'edge-mov-alpha-1.0.png'); await runFF(['-v', 'error', '-y', '-ss', '1', '-i', out, '-frames:v', '1', '-pix_fmt', 'rgba', png]); R.transparent = +alphaShare(fs.readFileSync(png)).toFixed(3);
    if (!(R.transparent > 0.05 && R.transparent < 0.995)) err('mov-alpha', `доля прозрачных точек ${R.transparent}`);
  });
  // 3. прозрачный PNG-кадр
  await step('png-alpha', async R => { JOB_HTML = jobA.html; const p = await grabFrame(jobA, 540, 960, .9, true); fs.writeFileSync(path.join(dir, 'edge-png-alpha.png'), p.data); R.transparent = +alphaShare(p.data).toFixed(3); if (!(R.transparent > 0.05 && R.transparent < 0.995)) err('png-alpha', `доля прозрачных точек ${R.transparent}`); });
  // 4. WebM (VP9 + Opus), GIF, стикер (имя «.sticker» из очереди должно стать .webm)
  await step('webm', async R => { const out = path.join(K, 'ролик.webm'), r = await ex({ html: jobA.html, container: 'webm', start: 0, end: 2, outDur: 2, width: 540, outPath: out }); if (!r || !r.ok) throw new Error(JSON.stringify(r)); const s = await info(out); R.vp9 = /vp9/.test(s); R.opus = /opus/.test(s); if (!R.vp9 || !R.opus) err('webm', s.slice(0, 300)); });
  await step('gif', async R => { const out = path.join(K, 'анимация.gif'), r = await ex({ container: 'gif', start: 0, end: 2, outDur: 2, width: 540, fps: 15, audioPath: '', outPath: out }); if (!r || !r.ok) throw new Error(JSON.stringify(r)); const s = await info(out); R.gif = /Video: gif/.test(s); R.dur = durOf(s); if (!R.gif) err('gif', s.slice(0, 300)); });
  await step('sticker', async R => { const r = await ex({ html: jobA.html, container: 'sticker', width: 512, start: 0, end: 3, vStart: .5, outDur: 2.5, audioPath: '', outPath: path.join(K, 'стикер.sticker') }); if (!r || !r.ok) throw new Error(JSON.stringify(r)); R.path = path.basename(r.path); R.size = fs.statSync(r.path).size; if (!/\.webm$/.test(r.path) || R.size > 256 * 1024) err('sticker', `${R.path} ${R.size} байт`); });
  // 5. 60 к/с и ролик в 1 секунду, затухание длиннее ролика
  await step('fps60-1s', async R => { const out = path.join(K, '60 кадров.mp4'), r = await ex({ fps: 60, start: 0, end: 1, outDur: 1, fadeOut: 5, fadeIn: 3, outPath: out }); if (!r || !r.ok) throw new Error(JSON.stringify(r));
    const s = await runFFOut(['-hide_banner', '-i', out, '-map', '0:v', '-f', 'null', '-']), fr = s.match(/frame=\s*(\d+)/g); R.frames = fr ? +fr.pop().match(/\d+/)[0] : 0; R.fps60 = /60 fps/.test(s); if (Math.abs(R.frames - 60) > 1 || !R.fps60) err('fps60-1s', `кадров ${R.frames}, 60 fps: ${R.fps60}`); });
  // 6. трек короче отрезка: звук добивается тишиной, ролик нужной длины
  await step('short-track', async R => { const out = path.join(K, 'короткий трек.mp4'), r = await ex({ start: 10, end: 14, outDur: 4, outPath: out }); if (!r || !r.ok) throw new Error(JSON.stringify(r)); const s = await runFFOut(['-hide_banner', '-i', out, '-map', '0:a', '-f', 'null', '-']), t = s.match(/time=(\d+):(\d+):([\d.]+)/g); R.audioSec = t ? durOf('Duration: ' + t.pop().slice(5)) : 0; if (R.audioSec < 3.8) err('short-track', `звук ${R.audioSec} с вместо 4`); });
  // 7. ошибки, которые должны приходить сразу и по-русски
  const mustFail = async (k, o, re) => step(k, async R => { const t0 = Date.now(); let msg = ''; try { const r = await ex(o); msg = 'не отказал: ' + JSON.stringify(r); } catch (e) { msg = e.message; } R.msg = msg; R.sec = (Date.now() - t0) / 1000; if (!re.test(msg)) err(k, 'сообщение: ' + msg); if (R.sec > 15) err(k, `ошибка пришла через ${R.sec} с`); });
  await mustFail('empty-range', { start: 5, end: 5, outDur: 0, outPath: path.join(K, 'пусто.mp4') }, /отрезок ролика пустой/);
  await mustFail('no-track', { start: 0, end: 2, outDur: 2, audioPath: path.join(K, 'нет такого.mp3'), outPath: path.join(K, 'без трека.mp4') }, /не найден файл трека/);
  { const tr4 = path.join(K, "трек О'Нил.mp4"); await runFF(['-v', 'error', '-y', '-i', track, '-c:a', 'aac', tr4]); const sz = fs.statSync(tr4).size;
    await mustFail('over-track', { start: 0, end: 2, outDur: 2, audioPath: tr4, outPath: path.join(K, win ? "ТРЕК О'НИЛ.MP4" : "трек О'Нил.mp4") }, /поверх файла трека/);
    if (!fs.existsSync(tr4) || fs.statSync(tr4).size !== sz) err('over-track', 'трек испорчен или удалён'); }
  if (win) { const lk = path.join(dir, 'locked.mp4'); fs.writeFileSync(lk, 'old'); const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${lk}','Open','ReadWrite','None'); Start-Sleep 40`], { windowsHide: true });
    let locked = false; for (let i = 0; i < 60 && !locked; i++) { try { fs.closeSync(fs.openSync(lk, 'r+')); await sleep(250); } catch (e) { locked = true; } }
    if (!locked) err('locked', 'не удалось занять файл для проверки'); else await mustFail('locked', { start: 0, end: 2, outDur: 2, outPath: lk }, /открыт в другой программе/);
    try { ps.kill(); } catch (e) {} }
  // 8. отмена во время рендера: процессы убиты, временные файлы удалены, прежний файл с тем же именем цел
  await step('cancel-render', async R => { const out = path.join(K, 'отмена.mp4'); fs.writeFileSync(out, 'old'); let tC = 0;
    const r = await ex({ start: 0, end: 20, outDur: 20, outPath: out }, { sender: { send: (ch, d) => { if (d && d.frac > 0.03 && !tC) { tC = Date.now(); cancelFlag = true; } } } });
    R.result = r; R.afterCancel = tC ? (Date.now() - tC) / 1000 : null; await sleep(500); R.left = leftovers(); R.ff = ffKids(); R.old = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === 'old';
    if (!r || !r.cancelled) err('cancel-render', 'не отменился: ' + JSON.stringify(r)); if (R.left.length || R.ff || !R.old) err('cancel-render', JSON.stringify(R)); });
  // 9. отмена во время сборки (кодирование WebM): ffmpeg убит, недоделанный файл удалён
  await step('cancel-final', async R => { const out = path.join(K, 'отмена сборки.webm'); let tC = 0, t97 = 0;
    const r = await ex({ html: jobA.html, container: 'webm', width: 1080, start: 0, end: 8, outDur: 8, outPath: out }, { sender: { send: (ch, d) => { if (d && d.frac >= 0.97 && !t97) { t97 = Date.now(); setTimeout(() => { tC = Date.now(); cancelFlag = true; }, 600); } } } });
    R.result = r; R.afterCancel = tC ? (Date.now() - tC) / 1000 : null; await sleep(500); R.left = leftovers(); R.ff = ffKids(); R.exists = fs.existsSync(out);
    if (!tC) R.note = 'сборка закончилась раньше отмены'; else if (!r || !r.cancelled || R.afterCancel > 3 || R.exists) err('cancel-final', JSON.stringify(R)); if (R.left.length || R.ff) err('cancel-final', JSON.stringify(R)); });
  // 10. длинный ролик (больше 3 минут) из середины трека, черновик
  await step('long-draft', async R => { const out = path.join(K, 'длинный.mp4'), r = await ex({ draft: true, width: 360, fps: 15, start: 10, end: 196, outDur: 185, cuts: [{ a: 100, b: 101 }], audioPath: longTrack, loud: true, outPath: out }); if (!r || !r.ok) throw new Error(JSON.stringify(r)); const s = await info(out); R.dur = durOf(s); if (Math.abs(R.dur - 185) > 0.3) err('long-draft', `длина ${R.dur} вместо 185`); });
  // 11. запуск установщика после выхода: путь с кириллицей и пробелом
  if (win) await step('update-launch', async R => { const f = path.join(K, "LyricStudio-Setup-тест О'Нил.cmd"), mk = path.join(K, 'marker.txt');
    fs.writeFileSync(f, '@echo ok> "%~dp0marker.txt"\r\nexit\r\n'); startLater(f, 2); for (let i = 0; i < 50 && !fs.existsSync(mk); i++) await sleep(200); R.started = fs.existsSync(mk);
    if (!R.started) err('update-launch', 'установщик не запустился бы'); });
  rep.edgeLeft = leftovers(); if (rep.edgeLeft.length) rep.errors.push('после всех проверок остались временные папки: ' + rep.edgeLeft);
  Object.assign(process.env, keepEnv); for (const k in keepEnv) if (keepEnv[k] === undefined) delete process.env[k];
  try { fs.rmSync(K, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); fs.rmSync(path.join(dir, 'locked.mp4'), { force: true }); } catch (e) {}
}

// флаг «программа работает»: если при следующем запуске он остался — прошлый сеанс завершился аварийно
const RUN_FLAG = () => UD('running.flag');
let LAST_CRASH = null;
function markClean() { try { fs.unlinkSync(RUN_FLAG()); } catch (e) {} }
app.whenReady().then(() => {
  try { if (fs.existsSync(RUN_FLAG())) { const f = JSON.parse(fs.readFileSync(RUN_FLAG(), 'utf8') || '{}');
    // другая версия — значит, программу закрыл установщик обновления, это не сбой
    if (!f.version || f.version === app.getVersion()) { LAST_CRASH = { time: f.time || 0, version: f.version || '', reason: f.reason || '' }; log('прошлый запуск завершился аварийно', LAST_CRASH); } } } catch (e) { LAST_CRASH = { time: 0, version: '', reason: '' }; }
  try { fs.writeFileSync(RUN_FLAG(), JSON.stringify({ time: Date.now(), version: app.getVersion() })); } catch (e) {}
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
  if (process.env.LS_CI_OUT) ciRun(process.env.LS_CI_OUT);
  else { const p = projArg(process.argv); if (p) mainWin.webContents.once('did-finish-load', () => setTimeout(() => mainWin.webContents.executeJavaScript(`window.__openPath&&window.__openPath(${JSON.stringify(p)})`).catch(() => {}), 1200)); }
  setTimeout(cleanDisk, 8000);
});
// уборка: распакованные проекты с треком, кэш битов и временные файлы, к которым давно не обращались
function cleanDisk() {
  const old = (f, days) => { try { return Date.now() - fs.statSync(f).mtimeMs > days * 864e5; } catch (e) { return false; } }, rm = f => { try { fs.rmSync(f, { recursive: true, force: true }); return 1; } catch (e) { return 0; } };
  let n = 0;
  // трек распакованного проекта может быть нужен и без .lspz: автосохранение и недавние .lsp ссылаются прямо на папку bundles —
  // такие папки не трогаем, иначе после уборки проект открывался без трека
  const keep = new Set(), noteRefs = json => { try { const p = JSON.parse(json); for (const f of [p.audioPath, p.style && p.style.bgMedia && p.style.bgMedia.path]) { const rel = f ? path.relative(UD('bundles'), f) : ''; if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) keep.add(rel.split(/[\\/]/)[0].toLowerCase()); } } catch (e) {} };
  try { noteRefs(fs.readFileSync(UD('autosave.lsp'), 'utf8')); } catch (e) {}
  for (const r of readRecent()) if (/\.(lsp|json)$/i.test(r.path)) try { noteRefs(fs.readFileSync(r.path, 'utf8')); } catch (e) {}
  try { for (const d of fs.readdirSync(UD('bundles'))) { const f = UD('bundles', d); if (!keep.has(d.toLowerCase()) && old(f, 30)) n += rm(f); } } catch (e) {}
  try { for (const d of fs.readdirSync(UD('beatcache'))) { const f = UD('beatcache', d); if (old(f, 90)) n += rm(f); } } catch (e) {}
  try { for (const d of fs.readdirSync(os.tmpdir())) { if (/^(lyric-|ls-selftest-|ls-test-)/.test(d) || /^LyricStudio-Setup-.*\.exe(\.part)?$/.test(d)) { const f = path.join(os.tmpdir(), d); if (old(f, 2)) n += rm(f); } } } catch (e) {}
  for (const d of ['giga-ctc', 'w2v-en', 'uvr', 'models2']) { try { for (const x of fs.readdirSync(UD(d))) if (x.endsWith('.part') && old(UD(d, x), 1)) n += rm(UD(d, x)); } catch (e) {} }
  if (n) log(`уборка: удалено старых временных файлов и папок — ${n}`);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { cancelFlag = true; BrowserWindow.getAllWindows().forEach(w => { if (w !== mainWin) try { w.destroy(); } catch (e) {} }); });
app.on('will-quit', () => { markClean(); killChildren(); setTimeout(() => process.exit(0), 2000).unref(); });
process.on('exit', killChildren);

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
  const r = await dialog.showOpenDialog(mainWin, { title: tr('Фон: фото или видео'), properties: ['openFile'], filters: [{ name: tr('Фото и видео'), extensions: Object.keys(MEDIA_EXT) }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0], ext = path.extname(p).slice(1).toLowerCase(), kind = MEDIA_EXT[ext].startsWith('video') ? 'video' : 'image';
  return { kind, path: p, name: path.basename(p), data: kind === 'image' ? toAB(fs.readFileSync(p)) : null };
});
const send = (ev, ch, data) => { try { ev.sender.send(ch, data); } catch (e) {} };
const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const writeAtomic = (f, data) => { fs.writeFileSync(f + '.tmp', data); fs.renameSync(f + '.tmp', f); };

// ---------- файлы ----------
handle('pickAudio', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: tr('Выберите трек'), properties: ['openFile'], filters: [{ name: tr('Аудио'), extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p), data: toAB(fs.readFileSync(p)) };
});
handle('readFile', async (ev, p) => toAB(fs.readFileSync(p)));
handle('pickAudios', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: tr('Треки для пакетной обработки'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('Аудио'), extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] }] });
  if (r.canceled) return []; return r.filePaths.map(p => ({ path: p, name: path.basename(p) }));
});
const pickBinary = async (title, name, extensions) => {
  const r = await dialog.showOpenDialog(mainWin, { title: tr(title), properties: ['openFile'], filters: [{ name: tr(name), extensions }] });
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
  fs.closeSync(fd); try { const now = new Date(); fs.utimesSync(dir, now, now); } catch (e) {} return JSON.stringify(proj);
}
handle('saveBundle', async (ev, json, name) => {
  const r = await dialog.showSaveDialog(mainWin, { title: tr('Сохранить проект вместе с треком'), defaultPath: name, filters: [{ name: tr('Проект с треком'), extensions: ['lspz'] }] });
  if (r.canceled || !r.filePath) return null; writeBundle(r.filePath, json); pushRecent(r.filePath); return r.filePath;
});
handle('saveProject', async (ev, json, name, existing) => {
  let fp = existing && fs.existsSync(path.dirname(existing)) ? existing : null;
  if (!fp) {
    const r = await dialog.showSaveDialog(mainWin, { title: tr('Сохранить проект'), defaultPath: name, filters: [{ name: tr('Проект Lyric Studio'), extensions: ['lsp'] }] });
    if (r.canceled || !r.filePath) return null; fp = r.filePath;
  }
  if (/\.lspz$/i.test(fp)) writeBundle(fp, json); else writeAtomic(fp, json); pushRecent(fp); return fp;
});
handle('openProject', async (ev, given) => {
  let fp = given;
  if (!fp) {
    const r = await dialog.showOpenDialog(mainWin, { title: tr('Открыть проект'), properties: ['openFile'], filters: [{ name: tr('Проект Lyric Studio'), extensions: ['lsp', 'lspz', 'json'] }] });
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
  const r = await dialog.showSaveDialog(mainWin, { title: tr('Сохранить пресет в файл'), defaultPath: name + '.lspreset', filters: [{ name: tr('Пресет Lyric Studio'), extensions: ['lspreset'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, json, 'utf8'); return r.filePath;
});
handle('importPreset', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: tr('Открыть пресет'), properties: ['openFile', 'multiSelections'], filters: [{ name: tr('Пресет Lyric Studio'), extensions: ['lspreset', 'json'] }] });
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
handle('lastCrash', async () => { const c = LAST_CRASH; LAST_CRASH = null; return c; });
handle('setLang', async (ev, l) => { LANG = l === 'en' ? 'en' : 'ru'; return true; });
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
    const a = {}; for (const as of r.assets || []) { const m = as.name.match(/^LyricStudio-(Setup|Portable)-(\d+\.\d+\.\d+)\.exe$/); if (m) { a.v = m[2]; a[m[1]] = { url: as.browser_download_url, size: as.size, sha: /^sha256:[0-9a-f]{64}$/.test(as.digest || '') ? as.digest : null }; } }
    if (a.v && a.Setup && a.Portable && (!best || cmpVer(a.v, best.version) > 0)) best = { version: a.v, setup: a.Setup, portable: a.Portable, page: r.html_url, notes: r.body || '' };
  }
  if (best && cmpVer(best.version, app.getVersion()) > 0) return best;
  return null;
});
// Запуск файла через несколько секунд, уже после выхода программы (установщик обновления). Строка команды передаётся cmd.exe
// как есть (/s + windowsVerbatimArguments): Node экранировал кавычки как \", cmd этого не понимает, и установщик не запускался вовсе.
function startLater(file, sec) {
  spawn('cmd.exe', ['/d', '/s', '/c', `"ping 127.0.0.1 -n ${sec} > nul & start "" "${file}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}
handle('installUpdate', async (ev, info) => {
  const progress = t => send(ev, 'progress:update', t);
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe) {
    const dest = path.join(path.dirname(portableExe), `LyricStudio-Portable-${info.version}.exe`);
    await download(info.portable.url, dest, 'обновление', progress, info.portable.sha || null);
    shell.showItemInFolder(dest);
    return { portable: true, path: dest };
  }
  const dest = path.join(os.tmpdir(), `LyricStudio-Setup-${info.version}.exe`);
  await download(info.setup.url, dest, 'обновление', progress, info.setup.sha || null);
  log('запускаю установщик', dest);
  try { await Promise.race([mainWin.webContents.executeJavaScript('window.__beforeClose ? window.__beforeClose() : true'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  // установщик стартует, когда эта программа уже полностью закрылась
  startLater(dest, 3);
  setTimeout(() => { markClean(); killChildren(); app.exit(0); }, 300);
  return { installer: true };
});
handle('openExternal', async (ev, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });

// ---------- загрузка файлов ----------
// контрольные суммы файлов моделей (SHA-256): обрыв связи или прокси не подсунут битый файл
const SHA = {
  'model-v1/model.int8.onnx': 'd0ce4aef25f58d495781ee8f05320d9e51b821f47804e07aa6549b53a72f67e8', 'model-v1/tokens.txt': '17cc514451bcceac9c280068c71502f8448f99e9fb1456b8d0761651fd0392f2',
  'model-en-v1/model.int8.onnx': '9d639433b6f76766047eeac3f104c16adfcf188bd2dcbdbe05ea9ca248f2fc36', 'model-en-v1/vocab.json': '19727f8944fe6459fc3f240ae2c198395b740f6a029bd23e06656266b83bcf64',
  'models-v2/beat_this_small.onnx': 'a5f8d39d989f31859454ba27afe61c5317ca95e4d9373e6853e5361b8937172f', 'models-v2/v3_e2e_ctc.int8.onnx': '2e3fcb7a7b66030336fd10c2fcfb033bd1dc7e1bf238fe5cfd83b1d0cfc9d28e',
  'models-v2/v3_e2e_ctc_vocab.txt': '142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd', 'models-v2/htdemucs_ft_vocals_htdemucs_ft_vocals_fp16weights.onnx': '0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce',
  'models-v2/birefnet_lite.onnx': '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333', 'models-v2/isnet-general-use.onnx': '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
};
// отмена синхронизации, распознавания, отделения вокала и загрузки моделей
let modelCancel = false;
const guard = () => { if (modelCancel) throw new Error('__cancel'); };
handle('cancelModel', () => { modelCancel = true; return true; });
async function download(url, dest, label, progress, sha) {
  if (sha === undefined) { const m = url.match(/releases\/download\/(.+)$/); sha = m && SHA[m[1]] || null; }
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`не удалось скачать ${label}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0, part = dest + '.part', out = fs.createWriteStream(part), reader = res.body.getReader(), hash = require('crypto').createHash('sha256');
  let got = 0, last = -1, ok = false;
  try {
    for (;;) {
      if (modelCancel) { try { await reader.cancel(); } catch (e) {} throw new Error('__cancel'); }
      const { done, value } = await reader.read(); if (done) break;
      got += value.length; hash.update(value); if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      const pct = total ? Math.floor(got / total * 100) : Math.floor(got / 1e6);
      if (pct !== last) { last = pct; progress(total ? `Скачиваю ${label}: ${pct}%` : `Скачиваю ${label}: ${pct} МБ`); }
    }
    ok = true;
  } finally { await new Promise(r => out.end(r)); if (!ok) try { fs.unlinkSync(part); } catch (e) {} }
  if (total && got !== total) { try { fs.unlinkSync(part); } catch (e) {} throw new Error(`загрузка ${label} прервалась, попробуйте ещё раз`); }
  if (sha && hash.digest('hex') !== String(sha).replace(/^sha256:/, '')) { try { fs.unlinkSync(part); } catch (e) {} throw new Error(`файл «${label}» скачался с ошибкой (не сошлась контрольная сумма) — попробуйте ещё раз`); }
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
// opts — настройки onnxruntime: тяжёлым моделям (Demucs, вырезание фона) отключаем оптимизацию графа и пул памяти,
// иначе они просят в разы больше оперативной памяти
async function getSession(file, opts = {}) {
  if (SESS[file]) return SESS[file];
  const ort = require('onnxruntime-node');
  let sess;
  try { sess = await ort.InferenceSession.create(file, Object.assign({ executionProviders: ['cpu'] }, opts)); }
  catch (e) {
    // файл модели не читается (обычно — повреждён на диске): удаляем, при следующем запуске он скачается заново
    if (/protobuf|parse|invalid|corrupt|load model|No such file|not a valid/i.test(String(e && e.message))) { log('модель не читается, удаляю:', file, e.message); try { fs.unlinkSync(file); } catch (x) {} throw new Error('файл нейросети был повреждён и удалён — запустите ещё раз, он скачается заново'); }
    throw e;
  }
  SESS[file] = { ort, s: sess };
  return SESS[file];
}
async function dropSession(file) { const x = SESS[file]; delete SESS[file]; if (x) try { await x.s.release(); } catch (e) {} }

// ---------- модели v2: биты, распознавание v3, Demucs, вырезание фона ----------
const N = require('./neural');
const M2_BASE = `https://github.com/${REPO}/releases/download/models-v2/`;
const M2 = {
  beat: { files: ['beat_this_small.onnx'], label: 'модель битов (≈10 МБ, один раз)' },
  ru3: { files: ['v3_e2e_ctc_vocab.txt', 'v3_e2e_ctc.int8.onnx'], label: 'модель распознавания текста (≈225 МБ, один раз)' },
  demucs: { files: ['htdemucs_ft_vocals_htdemucs_ft_vocals_fp16weights.onnx'], label: 'модель качественного отделения вокала (≈166 МБ, один раз)' },
  birefnet: { files: ['birefnet_lite.onnx'], label: 'модель вырезания фона (≈225 МБ, один раз)' },
  isnet: { files: ['isnet-general-use.onnx'], label: 'модель вырезания фона (≈180 МБ, один раз)' }
};
const M2_DIR = () => UD('models2');
const hasM2 = key => M2[key].files.every(f => fs.existsSync(path.join(M2_DIR(), f)));
async function ensureM2(key, progress) {
  const dir = M2_DIR(); fs.mkdirSync(dir, { recursive: true });
  for (const f of M2[key].files) { const p = path.join(dir, f); if (!fs.existsSync(p)) await download(M2_BASE + f, p, f.endsWith('.txt') ? 'словарь модели' : M2[key].label, progress || (() => {})); }
  return M2[key].files.map(f => path.join(dir, f));
}
// вырезание фона: BiRefNet точнее, но на картинке 1024×1024 занимает ~6 ГБ памяти — берём его только на компьютерах с 16 ГБ и больше
const bgKind = () => os.totalmem() >= 15.5 * 2 ** 30 ? 'birefnet' : 'isnet';
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
async function vocalsFile(audioPath, from, to, progress, quality) {
  const best = quality === 'best';
  const f = best ? (await ensureM2('demucs', progress))[0] : await ensureMdx(progress);
  // Demucs с оптимизацией графа просит больше 7 ГБ памяти, без неё — около 1 ГБ
  const { ort, s } = await getSession(f, best ? { graphOptimizationLevel: 'disabled', enableCpuMemArena: false } : {});
  progress('Читаю трек для отделения вокала…');
  const a = from != null ? Math.max(0, +from) : null, st = await SEP.loadStereo44(FFMPEG, audioPath, a, to != null ? +to : null);
  const t0 = Date.now();
  const tick = q => { guard(); const el = (Date.now() - t0) / 1000, left = q > 0.02 ? el / q * (1 - q) : 0; progress(`Отделяю вокал от бита${best ? ' (качественно)' : ''}: ${Math.round(q * 100)}%${left ? ' · осталось ~' + (left > 90 ? Math.ceil(left / 60) + ' мин' : Math.ceil(left) + ' с') : ''}`); };
  let v;
  try {
    v = best ? await N.demucsVocals(st, async buf => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, 2, N.DM.N]) }))[s.outputNames[0]].data, tick)
      : await SEP.separate(st, async (arr, dims) => { const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', arr, dims) }); return out[s.outputNames[0]].data; }, tick);
  } finally { if (best) await dropSession(f); }
  const out = path.join(os.tmpdir(), `lyric-vocals-${Date.now()}.wav`); SEP.writeWav(out, v, 44100);
  log(`вокал отделён за ${((Date.now() - t0) / 1000).toFixed(1)} с`); return { file: out, offset: a || 0 };
}
// синхронизация готового текста (align) и распознавание текста с трека (transcribe) идут одним путём
async function runModel(ev, args, what) {
  const progress = t => { guard(); send(ev, 'progress:align', t); }, en = args.lang === 'en';
  let audioPath = args.audioPath, from = args.from, to = args.to, offset = null, tmp = null;
  if (args.vocals) { const r = await vocalsFile(args.audioPath, args.from, args.to, progress, args.vocalsQ); tmp = audioPath = r.file; offset = r.offset; from = null; to = null; }
  const fn = what === 'transcribe' ? A.transcribe : A.align;
  try {
    if (en) {
      const dir = await ensureEn(progress), { ort, s } = await getSession(path.join(dir, 'model.int8.onnx'));
      const runRaw = async x => { guard(); const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, [1, x.length]) }); const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] }; };
      return await fn({ ffmpeg: FFMPEG, modelDir: dir, audioPath, lyrics: args.lyrics, from, to, offset, lang: 'en', runRaw, progress });
    }
    if (what === 'transcribe') {
      // распознавание русского — GigaAM v3: текст сразу с пунктуацией и заглавными
      const [voc, onnx] = await ensureM2('ru3', progress), { ort, s } = await getSession(onnx);
      const run3 = async (feats, T) => { guard(); const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) }); const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] }; };
      return await A.transcribeV3({ ffmpeg: FFMPEG, vocab: fs.readFileSync(voc, 'utf8'), audioPath, from, to, offset, runChunk: run3, progress });
    }
    const dir = await ensureModel(progress), { ort, s } = await getSession(path.join(dir, 'model.int8.onnx'));
    const runChunk = async (feats, T) => {
      guard(); const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) });
      const t = out[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] };
    };
    return await fn({ ffmpeg: FFMPEG, modelDir: dir, audioPath, lyrics: args.lyrics, from, to, offset, runChunk, progress });
  } finally { if (tmp) try { fs.unlinkSync(tmp); } catch (e) {} }
}
handle('align', (ev, args) => runModel(ev, args, 'align'));
handle('transcribe', (ev, args) => runModel(ev, args, 'transcribe'));


// ---------- экспорт видео ----------
// job: { html, W, H, width, fps, start, end, fade, audioPath, name, container: 'mp4'|'mov'|'webm'|'gif', draft, outPath? }
// Кадры рендерятся параллельно в нескольких скрытых окнах, каждое пишет свой кусок; куски склеиваются без перекодирования и сводятся со звуком.
const SEG = { mp4: 'mp4', mov: 'mov', webm: 'mov', gif: 'mp4', sticker: 'mov' };
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
  if (job.container === 'mov' || job.container === 'webm' || job.container === 'sticker') return ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'];
  if (job.container === 'gif') return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libx264', '-preset', job.draft ? 'ultrafast' : outH * outW > 2.2e6 ? 'faster' : 'veryfast', '-crf', job.draft ? '28' : '18', '-pix_fmt', 'yuv420p'];
}
// Цвет. Кадры приходят как JPEG (матрица BT.601) или RGB; HD-видео по стандарту — BT.709. Без пересчёта и меток
// плеер или площадка, которые не читают метку файла, показывали цвета со сдвигом (зелёный темнел, красный уходил в оранжевый).
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
function segArgs(job, inW, inH, outW, outH, out) {
  const alpha = job.container === 'mov' || job.container === 'webm' || job.container === 'sticker', fps = String(job.fps);
  const input = alpha ? ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${inW}x${inH}`, '-framerate', fps, '-i', '-'] : ['-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-'];
  return ['-v', 'error', '-y', ...input, '-vf', `scale=${outW}:${outH}:flags=${job.draft ? 'bilinear' : 'lanczos'}:${alpha ? '' : 'in_color_matrix=bt601:'}out_color_matrix=bt709,setsar=1`, ...segCodec(job, outW, outH), ...COLOR_TAGS, '-r', fps, out];
}
// звук ролика: куски трека без вырезанных проигрышей (склейка с микро-затуханием, без щелчков) → затухание на входе/выходе → звуковые эффекты
const CURVE = { smooth: 'qsin', linear: 'tri', fast: 'exp', soft: 'log' };
function audioGraph(job, dur, tail) {
  const segs = [], cuts = (job.cuts || []).filter(c => c.b > job.start && c.a < job.end).sort((x, y) => x.a - y.a); let pos = job.start;
  for (const c of cuts) { if (c.a > pos) segs.push([pos, c.a]); pos = Math.max(pos, c.b); } if (job.end > pos) segs.push([pos, job.end]);
  const f = [], cv = CURVE[job.fadeCurve] || 'qsin';
  segs.forEach(([a, b], i) => { const L = b - a, m = Math.min(0.012, L / 4); f.push(`[1:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS${segs.length > 1 ? `,afade=t=in:d=${m.toFixed(3)},afade=t=out:st=${(L - m).toFixed(3)}:d=${m.toFixed(3)}` : ''}[s${i}]`); });
  f.push(segs.length > 1 ? `${segs.map((_, i) => `[s${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[cat]` : `[s0]anull[cat]`);
  const fi = Math.min(+job.fadeIn || 0, dur / 3), fo = Math.min(job.fadeOut != null ? +job.fadeOut : (job.fade || 0.4), dur / 3), fx = [];
  if (fi > 0) fx.push(`afade=t=in:st=0:d=${fi.toFixed(3)}:curve=${cv}`); if (fo > 0) fx.push(`afade=t=out:st=${(dur - fo).toFixed(3)}:d=${fo.toFixed(3)}:curve=${cv}`);
  // трек короче отрезка (замена трека, другой подсчёт длины mp3): тишина до конца ролика, иначе звук обрывался без затухания
  f.push(`[cat]${[`apad=whole_dur=${dur.toFixed(3)}`, ...fx].join(',')}[m]`);
  // выравнивание громкости: общий сдвиг до −14 LUFS (без «дыхания» компрессора) и ограничитель пиков на случай тихого трека
  const gain = typeof job.gainDb === 'number' && Math.abs(job.gainDb) > 0.05 ? `volume=${job.gainDb.toFixed(2)}dB,alimiter=limit=0.84:level=false` : 'anull', last = tail || 'a';
  if (job.sfxPath) f.push(`[2:a]volume=${(+job.sfxVol || .7).toFixed(2)}${fo > 0 ? `,afade=t=out:st=${(dur - fo).toFixed(3)}:d=${fo.toFixed(3)}` : ''}[s]`, `[m][s]amix=inputs=2:duration=first:normalize=0[mx]`, `[mx]${gain}[${last}]`);
  else f.push(`[m]${gain}[${last}]`);
  return f.join(';');
}
function finalArgs(job, list, out, outW) {
  const dur = job.outDur || (job.end - job.start), vin = ['-f', 'concat', '-safe', '0', '-i', list];
  if (job.container === 'gif') return ['-v', 'error', '-y', ...vin, '-vf', `fps=${Math.min(job.fps, 20)},scale=${Math.min(outW, 720)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', out];
  if (job.container === 'sticker') return ['-v', 'error', '-y', ...vin, '-t', String(Math.min(3, dur)), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(job.crf || 36), '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-an', '-r', String(Math.min(30, job.fps)), out];
  const v = job.container === 'webm' ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0'] : ['-c:v', 'copy'];
  const a = job.container === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', job.draft ? '128k' : job.container === 'mov' ? '256k' : '192k'];
  return ['-v', 'error', '-y', ...vin, '-i', job.audioPath, ...(job.sfxPath ? ['-i', job.sfxPath] : []), '-filter_complex', audioGraph(job, dur), '-map', '0:v', '-map', '[a]', ...v, ...a, '-t', dur.toFixed(3), ...(job.container === 'mp4' ? ['-movflags', '+faststart'] : []), out];
}
// измерить громкость готовой звуковой дорожки ролика (LUFS) — первый проход для выравнивания
async function measureLoudness(job, dur) {
  const args = ['-hide_banner', '-nostats', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-i', job.audioPath, ...(job.sfxPath ? ['-i', job.sfxPath] : []), '-filter_complex', audioGraph(Object.assign({}, job, { gainDb: null }), dur, 'pre') + ';[pre]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[o]', '-map', '[o]', '-t', dur.toFixed(3), '-f', 'null', '-'];
  const txt = await runFFOut(args), m = txt.match(/"input_i"\s*:\s*"(-?[\d.]+|-inf)"/); if (!m || m[1] === '-inf') return null; return +m[1];
}
// Ошибки ffmpeg и файловой системы — понятным текстом; исходный текст ffmpeg остаётся в журнале (err.raw)
function ffHuman(e) {
  const s = String(e || ''), nf = /No such file or directory/.test(s) && ((s.match(/Error opening (?:input|output) file (.+?)\.?\s*$/m) || s.match(/^(?:\[[^\]]*\]\s*)?(.+?): No such file or directory/m) || [])[1] || '?');
  if (/No space left|ENOSPC|There is not enough space/i.test(s)) return 'на диске закончилось место — освободите место и повторите экспорт';
  if (/same as Input|cannot edit existing files in-place/i.test(s)) return 'нельзя сохранить видео поверх файла трека — выберите другое имя';
  if (/Permission denied|Access is denied|Operation not permitted|EPERM|EACCES|EBUSY/i.test(s)) return 'нет доступа к файлу — возможно, он открыт в другой программе (плеере, редакторе) или папка защищена от записи. Закройте файл или выберите другую папку';
  if (nf) return `не найден файл «${nf.trim().split(/[\\/]/).pop()}» — возможно, его переместили или удалили`;
  if (/matches no streams|does not contain any stream|Stream map .* matches no/i.test(s)) return 'в файле трека нет звуковой дорожки — выберите другой трек';
  if (/Invalid data found|moov atom not found|could not find codec parameters|Error while decoding|Invalid argument.*input/i.test(s)) return 'файл трека повреждён или его формат не поддерживается — сохраните трек в MP3 или WAV и выберите его заново';
  if (/Unknown encoder|Encoder not found|encoder .* not found/i.test(s)) return 'в сборке ffmpeg нет нужного кодека — переустановите программу';
  if (/Cannot allocate memory|out of memory|ENOMEM/i.test(s)) return 'не хватило памяти — закройте другие программы или выберите разрешение ниже';
  if (/spawn .*ENOENT|spawn .*EACCES|spawn UNKNOWN/i.test(s)) return 'не запускается ffmpeg — переустановите программу или добавьте её папку в исключения антивируса';
  const last = s.split(/\r?\n/).map(l => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean).pop() || 'неизвестная ошибка';
  return 'ffmpeg остановился с ошибкой: ' + last.slice(0, 200);
}
function fsHuman(e, file) {
  const c = e && e.code, n = file ? `«${path.basename(file)}»` : '';
  if (c === 'EBUSY' || c === 'EPERM' || c === 'EACCES') return `не удаётся записать файл ${n}: он открыт в другой программе (например, в плеере) или нет прав на запись в папку. Закройте файл или выберите другое имя или папку`;
  if (c === 'ENOSPC') return 'на диске закончилось место — освободите место и повторите';
  if (c === 'ENOENT') return `папка для файла ${n} не найдена — выберите другую папку`;
  if (c === 'EROFS') return 'диск доступен только для чтения — выберите другую папку';
  return (e && e.message) || String(e);
}
// cancellable: ffmpeg завершается по кнопке «Отменить» (склейка длинного WebM или GIF идёт минутами)
const runFF = (args, cancellable) => new Promise((res, rej) => { const p = spawn(FFMPEG, args, { windowsHide: true }); let e = '', tm = null; p.stderr.on('data', d => { e += d; if (e.length > 2e5) e = e.slice(-1e5); });
  if (cancellable) tm = setInterval(() => { if (cancelFlag) try { p.kill(); } catch (x) {} }, 150);
  p.on('error', x => { clearInterval(tm); const er = new Error(ffHuman(x && x.message)); er.raw = String(x && x.message); rej(er); });
  p.on('close', c => { clearInterval(tm); if (c === 0) return res(); if (cancellable && cancelFlag) return rej(new Error('__cancel')); const er = new Error(ffHuman(e)); er.raw = e.slice(-1500); rej(er); }); });
// Окно рендера. resizable:false обязателен: окну с рамкой изменения размера Windows не даёт стать больше экрана,
// и ролик 1080×1920 на мониторе 1080p выходил обрезанным и растянутым.
async function openEngine(outW, outH, zoom, alpha) {
  const mk = (w, h, z) => { const x = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, frame: false, resizable: false, focusable: false, skipTaskbar: true, transparent: alpha, backgroundColor: alpha ? '#00000000' : '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: z } });
    // при создании Windows всё равно подгоняет окно под экран; повторная установка размера у окна без рамки уже не ограничивается
    try { x.setContentSize(w, h); } catch (e) {} x.__zoom = z; return x; };
  let win = mk(outW, outH, zoom), [cw, ch] = win.getContentSize();
  if (Math.abs(cw - outW) > 1 || Math.abs(ch - outH) > 1) {
    // система всё же урезала окно: берём окно поменьше с тем же макетом — кадр выйдет мягче, но не искажённым
    const k = Math.min(cw / outW, ch / outH), w = Math.max(2, Math.floor(outW * k / 2) * 2), h = Math.max(2, Math.round(w * outH / outW));
    log(`окно рендера ${outW}x${outH} урезано системой до ${cw}x${ch} — рендерю в ${w}x${h} и увеличиваю`); win.destroy(); win = mk(w, h, zoom * w / outW);
  }
  win.webContents.setFrameRate(120);
  await win.loadURL('app://job/engine.html'); win.webContents.setZoomFactor(win.__zoom);
  for (let i = 0; i < 300; i++) { if (await win.webContents.executeJavaScript('window.READY===true||!!window.__err')) break; await new Promise(r => setTimeout(r, 100)); }
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)');
  const err = await win.webContents.executeJavaScript('window.__err||""'); if (err) { win.destroy(); throw new Error('движок: ' + err); }
  // макет должен совпасть с форматом ролика; если нет — лучше остановиться, чем сохранить перекошенное видео
  const [iw, ih] = await win.webContents.executeJavaScript('[innerWidth,innerHeight]'), want = outW / outH, got = iw / Math.max(1, ih);
  if (Math.abs(got / want - 1) > 0.02) { win.destroy(); throw new Error(`окно рендера получило размер ${iw}×${ih} вместо формата ${outW}×${outH} — нажмите «?» → «Скопировать отчёт» и пришлите его`); }
  return win;
}
// Снимок кадра только после того, как окно его действительно перерисовало. Раньше снимок брался сразу, и в больших
// размерах (1080p и выше) перерисовка не успевала: в ролик попадал предыдущий кадр — анимации дёргались и «отставали».
// Первая перерисовка после перемотки может быть ещё старой (уже стояла в очереди), поэтому ждём две.
function waitPaint(wc, ms) { return new Promise(res => { let done = false; const fin = () => { if (done) return; done = true; clearTimeout(tm); wc.removeListener('paint', fin); res(); }, tm = setTimeout(fin, ms); wc.on('paint', fin); wc.invalidate(); }); }
async function freshCapture(win) { const wc = win.webContents; await waitPaint(wc, 2500); await waitPaint(wc, 1000); return wc.capturePage(); }
// Одиночный кадр (обложка, PNG, проверка) — через отладчик страницы: он всегда рисует кадр заново
async function cdpCapture(win, alpha) {
  const dbg = win.webContents.debugger; if (!dbg.isAttached()) dbg.attach('1.3');
  if (alpha) await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true });
  return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
}
const frameAt = (win, t) => win.webContents.executeJavaScript(`(window.seekAsync||((t)=>Promise.resolve(seek(t))))(${t.toFixed(5)}).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
async function renderSegment(job, k0, k1, file, dims, onFrame) {
  const { outW, outH, zoom } = dims, alpha = job.container === 'mov' || job.container === 'webm' || job.container === 'sticker', q = job.draft ? 70 : 92;
  const win = await openEngine(outW, outH, zoom, alpha); let ff = null, ffErr = '', done = null, ffClosed = false;
  try {
    for (let i = k0; i < k1; i++) {
      if (cancelFlag) throw new Error('__cancel');
      await frameAt(win, (job.vStart ?? job.start) + i / job.fps);
      const img = await freshCapture(win);
      if (!ff) {
        const sz = img.getSize(); if (!sz.width || !sz.height) throw new Error('пустой кадр при захвате окна');
        ff = spawn(FFMPEG, segArgs(job, sz.width, sz.height, outW, outH, file), { windowsHide: true }); ff.stderr.on('data', d => ffErr += d); ff.stdin.on('error', () => {});
        done = new Promise(r => { ff.on('close', c => { ffClosed = true; r(c); }); ff.on('error', x => { ffErr += '\n' + (x && x.message); ffClosed = true; r(-1); }); });
      }
      const ffFail = () => { const er = new Error(ffHuman(ffErr || 'остановился')); er.raw = ffErr.slice(-1500); return er; };
      if (ffClosed || ff.exitCode !== null) throw ffFail();
      const buf = alpha ? img.toBitmap() : img.toJPEG(q);
      // ffmpeg мог упасть (кончилось место) при полном канале: 'drain' тогда не придёт никогда — ждём и завершения процесса, иначе экспорт висел вечно
      if (!ff.stdin.write(buf)) await Promise.race([new Promise(r => ff.stdin.once('drain', r)), done]);
      if (ffClosed || ff.exitCode !== null) throw ffFail();
      onFrame();
    }
    if (ff) { ff.stdin.end(); const code = await done; if (code !== 0) { const er = new Error(ffHuman(ffErr)); er.raw = ffErr.slice(-1500); throw er; } }
  } catch (e) { if (ff) { try { ff.stdin.destroy(); ff.kill(); } catch (x) {} await Promise.race([done, new Promise(r => setTimeout(r, 3000))]); } throw e; }
  finally { win.destroy(); }
}
handle('cancelExport', () => { cancelFlag = true; });

// ---------- биты нейросетью (Beat This!) ----------
function decodeMean22k(file) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-ac', '2', '-ar', '22050', '-f', 'f32le', '-'], { windowsHide: true }), ch = []; let err = '';
    p.stdout.on('data', d => ch.push(d)); p.stderr.on('data', d => err += d); p.on('error', rej);
    p.on('close', c => { if (c !== 0) return rej(new Error('ffmpeg: ' + err.slice(0, 200))); const b = Buffer.concat(ch), n = b.length >> 3, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = (b.readFloatLE(i * 8) + b.readFloatLE(i * 8 + 4)) / 2; res(x); });
  });
}
const BEAT_CACHE = () => UD('beatcache');
handle('netBeats', async (ev, a) => {
  const st = fs.statSync(a.audioPath), key = require('crypto').createHash('md5').update(a.audioPath + '|' + st.size + '|' + st.mtimeMs).digest('hex'), cf = path.join(BEAT_CACHE(), key + '.json');
  try { const c = JSON.parse(fs.readFileSync(cf, 'utf8')); return { beat: Float32Array.from(c.beat), down: Float32Array.from(c.down), fps: c.fps }; } catch (e) {}
  const [file] = await ensureM2('beat'), { ort, s } = await getSession(file);
  const t0 = Date.now(), x = await decodeMean22k(a.audioPath), F = await N.beatFeaturesAsync(x);
  const r = await N.beatActivations(F, async (buf, n) => { const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, n, 128]) }); return { beat: o.beat.data, downbeat: o.downbeat.data }; });
  log(`биты нейросетью: ${(x.length / 22050).toFixed(0)} с трека за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  try { fs.mkdirSync(BEAT_CACHE(), { recursive: true }); fs.writeFileSync(cf, JSON.stringify({ beat: Array.from(r.beat, v => +v.toFixed(3)), down: Array.from(r.down, v => +v.toFixed(3)), fps: r.fps })); } catch (e) {}
  return r;
});

// ---------- вырезать фон с картинки ----------
handle('removeBg', async (ev, a) => {
  const progress = t => { guard(); send(ev, 'progress:bg', t); };
  let img = nativeImage.createFromDataURL(a.dataUrl); if (img.isEmpty()) throw new Error('не удалось открыть картинку');
  let { width: w, height: h } = img.getSize(); const k = Math.min(1, 1600 / Math.max(w, h));
  if (k < 1) { img = img.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: 'best' }); ({ width: w, height: h } = img.getSize()); }
  const kind = bgKind(), [file] = await ensureM2(kind, progress); progress('Нейросеть ищет, где фон…');
  const { ort, s } = await getSession(file, { enableCpuMemArena: false, enableMemPattern: false });
  try {
    const px = img.toBitmap(), inp = N.bgInput(px, w, h, 'bgra', kind);
    const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, N.BG.size, N.BG.size]) });
    const al = N.bgAlpha(o[s.outputNames[0]].data, w, h, kind), out = Buffer.from(px);
    for (let i = 0; i < w * h; i++) { const q = al[i]; out[i * 4] = out[i * 4] * q / 255; out[i * 4 + 1] = out[i * 4 + 1] * q / 255; out[i * 4 + 2] = out[i * 4 + 2] * q / 255; out[i * 4 + 3] = q; }
    return { dataUrl: nativeImage.createFromBitmap(out, { width: w, height: h }).toDataURL(), model: kind };
  } finally { await dropSession(file); }
});

// ---------- управление моделями ----------
const MODELS = () => [
  { key: 'ru', name: 'Синхронизация: русский (GigaAM CTC)', files: [path.join(MODEL_DIR(), 'model.int8.onnx'), path.join(MODEL_DIR(), 'tokens.txt')], mb: 230, get: p => ensureModel(p) },
  { key: 'en', name: 'Синхронизация и распознавание: английский (wav2vec 2.0)', files: [UD('w2v-en', 'model.int8.onnx'), UD('w2v-en', 'vocab.json')], mb: 120, get: p => ensureEn(p) },
  { key: 'ru3', name: 'Распознавание текста: русский (GigaAM v3)', files: M2.ru3.files.map(f => path.join(M2_DIR(), f)), mb: 225, get: p => ensureM2('ru3', p) },
  { key: 'beat', name: 'Биты и сильные доли (Beat This!)', files: M2.beat.files.map(f => path.join(M2_DIR(), f)), mb: 10, get: p => ensureM2('beat', p) },
  { key: 'mdx', name: 'Отделение вокала: быстро (Kim Vocal 2)', files: [UD('uvr', SEP.MDX.file)], mb: 65, get: p => ensureMdx(p) },
  { key: 'demucs', name: 'Отделение вокала: качественно (HT-Demucs)', files: M2.demucs.files.map(f => path.join(M2_DIR(), f)), mb: 166, get: p => ensureM2('demucs', p) },
  { key: bgKind(), name: 'Вырезание фона (' + (bgKind() === 'birefnet' ? 'BiRefNet' : 'IS-Net') + ')', files: M2[bgKind()].files.map(f => path.join(M2_DIR(), f)), mb: bgKind() === 'birefnet' ? 225 : 180, get: p => ensureM2(bgKind(), p) }
];
handle('modelsInfo', async () => MODELS().map(m => { let size = 0, have = true; for (const f of m.files) { try { size += fs.statSync(f).size; } catch (e) { have = false; } } return { key: m.key, name: m.name, have, size, mb: m.mb }; }));
handle('modelDelete', async (ev, key) => { const m = MODELS().find(x => x.key === key); if (!m) return false; for (const f of m.files) { await dropSession(f); try { fs.unlinkSync(f); } catch (e) {} } return true; });
handle('modelGet', async (ev, key) => { const m = MODELS().find(x => x.key === key); if (!m) return false; await m.get(t => { guard(); send(ev, 'progress:models', t); }); return true; });
// ---------- текстовые файлы: тайминги LRC / SRT ----------
handle('saveText', async (ev, text, name, ext, title) => {
  const r = await dialog.showSaveDialog(mainWin, { title: tr(title || 'Сохранить файл'), defaultPath: name + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, text, 'utf8'); return r.filePath;
});
handle('openText', async (ev, exts, title) => {
  const r = await dialog.showOpenDialog(mainWin, { title: tr(title || 'Открыть файл'), properties: ['openFile'], filters: [{ name: exts.map(x => x.toUpperCase()).join(' / '), extensions: exts }] });
  if (r.canceled || !r.filePaths[0]) return null; const b = fs.readFileSync(r.filePaths[0]);
  return { name: path.basename(r.filePaths[0]), text: b[0] === 0xFF && b[1] === 0xFE ? b.toString('utf16le') : b.toString('utf8').replace(/^\uFEFF/, '') };
});
// что за файл бросили в окно: трек, проект, пресет, картинка или видео
handle('fileKind', async (ev, p) => { const ext = path.extname(p).slice(1).toLowerCase(); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
  const kind = ['lsp', 'lspz'].includes(ext) ? 'project' : ext === 'lspreset' ? 'preset' : ['lrc', 'srt'].includes(ext) ? 'timing' : ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext) ? 'audio' : MEDIA_EXT[ext] ? (MEDIA_EXT[ext].startsWith('video') ? 'video' : 'image') : ['bmp'].includes(ext) ? 'image' : null;
  if (!kind) return null; const o = { kind, path: p, name: path.basename(p), ext };
  if (kind === 'image') o.data = toAB(fs.readFileSync(p)); if (kind === 'preset' || kind === 'timing') o.text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); return o; });

// ---------- проверка системы ----------
const runFFOut = args => new Promise((res, rej) => { const p = spawn(FFMPEG, args, { windowsHide: true }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('error', rej); p.on('close', c => c === 0 ? res(o + e) : rej(new Error(e.slice(0, 300)))); });
handle('selfTest', async () => {
  const r = [], add = (group, name, level, text) => r.push({ group, name, level, text: text || '' });
  const gb = b => (b / 2 ** 30).toFixed(1) + ' ГБ';
  add('Компьютер', 'Система', 'ok', `${process.platform} ${os.release()} ${os.arch()} · ${os.cpus().length} ядер`);
  const mem = os.totalmem(); add('Компьютер', 'Память', mem < 6 * 2 ** 30 ? 'warn' : 'ok', `${gb(mem)} всего, свободно ${gb(os.freemem())}` + (mem < 6 * 2 ** 30 ? ' — 4K и отделение вокала могут идти медленно' : ''));
  try { const st = fs.statfsSync(os.tmpdir()), free = st.bavail * st.bsize; add('Компьютер', 'Место на диске', free < 3 * 2 ** 30 ? 'warn' : 'ok', `свободно ${gb(free)} во временной папке` + (free < 3 * 2 ** 30 ? ' — для длинного экспорта может не хватить' : '')); } catch (e) {}
  try { const f = path.join(os.tmpdir(), 'ls-test-' + Date.now()); fs.writeFileSync(f, 'ok'); fs.unlinkSync(f); add('Компьютер', 'Временная папка', 'ok', 'запись работает'); } catch (e) { add('Компьютер', 'Временная папка', 'err', 'не удаётся записать: ' + e.message); }
  let encs = '';
  if (!fs.existsSync(FFMPEG)) add('Видео', 'ffmpeg', 'err', 'не найден — переустановите программу');
  else { try { const v = await runFFOut(['-version']); add('Видео', 'ffmpeg', 'ok', (v.split('\n')[0].match(/version (\S+)/) || [])[1] || 'работает'); encs = await runFFOut(['-hide_banner', '-encoders']); } catch (e) { add('Видео', 'ffmpeg', 'err', 'не запускается: ' + e.message + ' — возможно, его блокирует антивирус'); } }
  const encList = new Set((encs.match(/^\s*[VAS][.A-Z]{5}\s+(\S+)/gm) || []).map(l => l.trim().split(/\s+/)[1]));
  if (encs) for (const [e, label] of [['libx264', 'H.264 — MP4'], ['prores_ks', 'ProRes 4444 — MOV с прозрачностью'], ['libvpx-vp9', 'VP9 — WebM и стикеры'], ['gif', 'GIF'], ['aac', 'AAC — звук в MP4'], ['libopus', 'Opus — звук в WebM']]) add('Видео', label, encList.has(e) ? 'ok' : 'err', encList.has(e) ? 'есть' : 'нет в сборке ffmpeg');
  GPU = undefined; const g = encs ? await detectGpu() : null; add('Видео', 'Кодирование видеокартой', g ? 'ok' : 'warn', g ? `${g.name} (${g.enc})` : 'не найдено — видео кодирует процессор (медленнее, но работает)');
  try { require('onnxruntime-node'); add('Синхронизация', 'Нейросеть (onnxruntime)', 'ok', 'загружается'); } catch (e) { add('Синхронизация', 'Нейросеть (onnxruntime)', 'err', /Cannot find module/.test(e.message) ? 'не найдена — переустановите программу' : 'не загружается: ' + e.message.split('\n')[0] + ' — установите Microsoft Visual C++ Redistributable'); }
  const has = (...p) => fs.existsSync(UD(...p));
  add('Синхронизация', 'Модель для русского', has('giga-ctc', 'model.int8.onnx') ? 'ok' : 'info', has('giga-ctc', 'model.int8.onnx') ? 'скачана' : 'скачается при первой синхронизации (≈230 МБ)');
  add('Синхронизация', 'Модель для английского', has('w2v-en', 'model.int8.onnx') ? 'ok' : 'info', has('w2v-en', 'model.int8.onnx') ? 'скачана' : 'скачается при первой синхронизации на английском (≈120 МБ)');
  add('Синхронизация', 'Отделение вокала', has('uvr', SEP.MDX.file) ? 'ok' : 'info', has('uvr', SEP.MDX.file) ? 'модель скачана' : 'модель скачается при первом использовании (≈65 МБ)');
  add('Синхронизация', 'Распознавание текста (GigaAM v3)', hasM2('ru3') ? 'ok' : 'info', hasM2('ru3') ? 'скачана' : 'скачается при первом распознавании (≈225 МБ)');
  add('Синхронизация', 'Качественное отделение вокала (HT-Demucs)', hasM2('demucs') ? 'ok' : 'info', hasM2('demucs') ? 'скачана' : 'скачается при первом использовании (≈166 МБ)');
  add('Синхронизация', 'Биты (Beat This!)', hasM2('beat') ? 'ok' : 'info', hasM2('beat') ? 'скачана' : 'скачается при первой загрузке трека (≈10 МБ)');
  { const k = bgKind(); add('Картинки', 'Вырезание фона', hasM2(k) ? 'ok' : 'info', (k === 'birefnet' ? 'BiRefNet' : 'IS-Net — для BiRefNet нужно от 16 ГБ памяти') + (hasM2(k) ? ', скачана' : `, скачается при первом использовании (≈${k === 'birefnet' ? 225 : 180} МБ)`)); }
  try { const res = await Promise.race([net.fetch(`https://api.github.com/repos/${REPO}`, { method: 'HEAD', headers: { 'User-Agent': 'LyricStudio' } }), new Promise((_, j) => setTimeout(() => j(new Error('нет ответа за 6 с')), 6000))]); add('Сеть', 'Доступ к GitHub', res.ok ? 'ok' : 'warn', res.ok ? 'обновления и модели скачиваются' : 'GitHub ответил ' + res.status); }
  catch (e) { add('Сеть', 'Доступ к GitHub', 'warn', 'нет связи (' + e.message + ') — обновления и модели не скачаются'); }
  return r;
});
// пробный экспорт 3 секунд на тишине: проверяет окна рендера, кодирование и сведение звука
handle('selfTestExport', async (ev, job) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-selftest-')), wav = path.join(tmp, 'silence.wav'), out = path.join(tmp, 'test.' + (job.container === 'mov' ? 'mov' : job.container === 'webm' ? 'webm' : 'mp4'));
  try {
    await runFF(['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String((job.end || 3) + 1), wav]);
    const t0 = Date.now(); let r = await exportVideoImpl(ev, Object.assign({}, job, { audioPath: wav, outPath: out })), viaCpu = false;
    if (r && r.retry) { viaCpu = true; r = await exportVideoImpl(ev, Object.assign({}, job, { gpu: false, gpuEnc: undefined, audioPath: wav, outPath: out })); }
    if (!r || !r.ok) return { ok: false, error: r && r.cancelled ? 'отменено' : 'файл не создан' };
    const info = await runFFOut(['-hide_banner', '-i', out, '-f', 'null', '-']).catch(e => { throw new Error('готовый файл не читается: ' + e.message); });
    const dur = info.match(/Duration: (\d+):(\d+):([\d.]+)/), sec = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
    return { ok: true, seconds: (Date.now() - t0) / 1000, size: fs.statSync(out).size, duration: sec, audio: /Audio:/.test(info), viaCpu, gpu: job.gpuEnc || (GPU && GPU.enc) || null };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
});
handle('pickFolder', async () => { const r = await dialog.showOpenDialog(mainWin, { title: tr('Папка для видео'), properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
const FNAME = { mp4: 'Видео MP4', mov: 'MOV с прозрачностью (ProRes 4444)', webm: 'WebM с прозрачностью (VP9)', gif: 'GIF-анимация', sticker: 'Видеостикер Telegram (WebM)' };
async function exportVideoImpl(ev, job) {
  const cont = job.container || 'mp4', ext = cont === 'sticker' ? 'webm' : cont;
  let out = job.outPath;
  // очередь и пакет сами составляют имя: у стикера оно выходило «.sticker» — расширение всегда по формату
  if (out && path.extname(out).toLowerCase() !== '.' + ext) out = (/\.(mp4|mov|webm|gif|sticker)$/i.test(out) ? out.replace(/\.[^.\\/]+$/, '') : out) + '.' + ext;
  // проверки до рендера: раньше ошибка всплывала только после того, как все кадры уже отрисованы
  const outDur0 = job.outDur != null ? +job.outDur : (job.end - job.start), needAudio = cont !== 'gif' && cont !== 'sticker';
  if (!(outDur0 > 0.04) || !(+job.width > 0)) throw new Error('отрезок ролика пустой — проверьте начало и конец ролика и вырезанные куски');
  if (needAudio && (!job.audioPath || !fs.existsSync(job.audioPath))) throw new Error(`не найден файл трека${job.audioPath ? ' «' + path.basename(job.audioPath) + '»' : ''} — возможно, его переместили, переименовали или диск отключён. Откройте трек заново`);
  if (!out) { const r = await dialog.showSaveDialog(mainWin, { title: tr('Сохранить видео'), defaultPath: (job.name || 'video') + '.' + ext, filters: [{ name: tr(FNAME[cont]), extensions: [ext] }] }); if (r.canceled || !r.filePath) return { ok: false }; out = r.filePath; }
  const samePath = (a, b) => !!a && !!b && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
  // видео поверх собственного трека: ffmpeg отказывался, а затем «неудачный» файл удалялся — пропадал сам трек
  if (samePath(out, job.audioPath)) throw new Error('нельзя сохранить видео поверх файла трека — выберите другое имя');
  // файл занят (открыт в плеере) или папка без прав — сообщаем сразу, а не после рендера
  { const existed = fs.existsSync(out); try { fs.closeSync(fs.openSync(out, existed ? 'r+' : 'wx')); if (!existed) fs.unlinkSync(out); } catch (e) { throw new Error(fsHuman(e, out)); } }
  const progress = (frac, text) => send(ev, 'progress:export', { frac, text });
  cancelFlag = false;
  const fps = job.fps || 30, outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2, zoom = outW / job.W, n = Math.max(1, Math.round((job.outDur || (job.end - job.start)) * fps));
  const cores = os.cpus().length, maxW = outW * outH > 2.2e6 ? 2 : 4, workers = Math.max(1, Math.min(maxW, Math.floor(cores / 3), Math.ceil(n / 60), job.workers || 99));
  if (job.gpu && ext === 'mp4') { const g = await detectGpu(); if (g) job.gpuEnc = g.enc; }
  let tmp; try { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lyric-')); } catch (e) { throw new Error('временная папка недоступна: ' + fsHuman(e)); }
  const t0 = Date.now(); let doneFrames = 0, wrote = false;
  // свободное место: видео с прозрачностью (ProRes 4444) занимает во временной папке гигабайты
  { const durS = n / fps, mbps = (cont === 'mov' || cont === 'webm' || cont === 'sticker') ? 30 * outW * outH / 2.07e6 * fps / 30 : 3 * outW * outH / 2.07e6, need = durS * mbps * 2 ** 20 * (cont === 'mov' ? 2.2 : 1.4) + 200 * 2 ** 20;
    for (const d of [...new Set([os.tmpdir(), path.dirname(out)])]) { let free = null; try { const st = fs.statfsSync(d); free = st.bavail * st.bsize; } catch (e) {} if (free != null && free < need) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} throw new Error(`не хватает места на диске (${d}): нужно примерно ${(need / 2 ** 30).toFixed(1)} ГБ, свободно ${(free / 2 ** 30).toFixed(1)} ГБ. Освободите место или выберите качество ниже`); } } }
  log(`экспорт: ${outW}x${outH} ${fps}fps ${ext}${job.draft ? ' черновик' : ''}, окон: ${workers}${job.gpuEnc ? ', ' + job.gpuEnc : ''}${job.sfxPath ? ', звуки' : ''} → ${out}`);
  JOB_HTML = job.html;
  try {
    if (job.sfx && job.sfx.data && cont !== 'gif' && cont !== 'sticker') { job.sfxPath = path.join(tmp, 'sfx.wav'); fs.writeFileSync(job.sfxPath, Buffer.from(job.sfx.data)); job.sfxVol = job.sfx.vol; }
    progress(0, `Готовлю движок (${workers} ${workers === 1 ? 'окно' : 'окна'})…`);
    const segs = [], per = Math.ceil(n / workers), tick = () => { doneFrames++; if (doneFrames % 5 === 0) { const el = (Date.now() - t0) / 1000, left = el / doneFrames * (n - doneFrames); progress(doneFrames / n * .96, `Кадр ${doneFrames} из ${n} · осталось ~${left > 90 ? Math.ceil(left / 60) + ' мин' : Math.ceil(left) + ' с'}`); } };
    const jobs = [];
    for (let w = 0; w < workers; w++) { const k0 = w * per, k1 = Math.min(n, k0 + per); if (k1 <= k0) break; const f = path.join(tmp, `seg${w}.${SEG[cont]}`); segs.push(f); jobs.push(renderSegment(job, k0, k1, f, { outW, outH, zoom }, tick).catch(e => { cancelFlag = true; throw e; })); }
    // сбой одного окна сразу останавливает остальные (раньше они дорисовывали свои куски до конца); пользователю — настоящая причина, а не «отменено»
    const res = await Promise.allSettled(jobs), bads = res.filter(r => r.status === 'rejected').map(r => r.reason); if (bads.length) throw bads.find(e => e && e.message !== '__cancel') || bads[0];
    progress(0.97, cont === 'gif' ? 'Собираю GIF…' : cont === 'sticker' ? 'Кодирую стикер…' : ext === 'webm' ? 'Кодирую WebM со звуком…' : 'Склеиваю видео со звуком…');
    if (job.loud && cont !== 'gif' && cont !== 'sticker') { try { const dur = job.outDur || (job.end - job.start), lufs = await measureLoudness(job, dur); if (lufs != null) { job.gainDb = Math.max(-14, Math.min(12, -14 - lufs)); log(`громкость ролика ${lufs.toFixed(1)} LUFS → сдвиг ${job.gainDb.toFixed(1)} дБ`); } } catch (e) { log('громкость не измерена:', e.message, e.raw || ''); } }
    if (cancelFlag) throw new Error('__cancel');
    const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    wrote = true; await runFF(finalArgs(Object.assign({}, job, { fps }), list, out, outW), true);
    if (cont === 'sticker') for (const crf of [44, 52]) { if (fs.statSync(out).size <= 256 * 1024) break; progress(0.98, 'Ужимаю стикер до 256 КБ…'); await runFF(finalArgs(Object.assign({}, job, { fps, crf }), list, out, outW), true); }
    log('экспорт готов', ((Date.now() - t0) / 1000).toFixed(1) + ' с');
    progress(1, 'Готово'); return { ok: true, path: out, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    // недоделанный файл удаляем; прежний файл с тем же именем не трогаем, если запись в него ещё не начиналась (отмена во время рендера)
    if (wrote) try { fs.unlinkSync(out); } catch (x) {}
    if (e && e.raw) log('ffmpeg сообщил:', e.raw);
    if (e.message === '__cancel') return { ok: false, cancelled: true };
    if (job.gpuEnc) { log('видеокарта не справилась, повторяю на процессоре:', e.message); GPU = null; return { retry: true, out }; }
    throw e;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); } catch (e) { log('временная папка экспорта не удалилась:', e.message); } }
}
handle('exportVideo', async (ev, job) => {
  const r = await exportVideoImpl(ev, job);
  if (r && r.retry) { send(ev, 'progress:export', { frac: 0, text: 'Видеокарта не справилась — повторяю на процессоре…' }); return await exportVideoImpl(ev, Object.assign({}, job, { gpu: false, gpuEnc: undefined, outPath: r.out })); }
  return r;
});
// один кадр в PNG — общий путь для обложек, кадров и проверки экспорта
async function grabFrame(job, outW, outH, t, alpha) {
  const win = await openEngine(outW, outH, outW / job.W, alpha);
  try {
    await frameAt(win, t); let img; try { img = await cdpCapture(win, alpha); if (img.isEmpty()) throw new Error('пустой снимок'); } catch (e) { log('снимок через отладчик не вышел:', e.message); img = await freshCapture(win); } const size = img.getSize();
    const info = await win.webContents.executeJavaScript('[innerWidth,innerHeight,devicePixelRatio]').catch(() => null);
    return { data: (size.width === outW && size.height === outH ? img : img.resize({ width: outW, height: outH })).toPNG(), size: [size.width, size.height], info: { inner: info, content: win.getContentSize() } };
  } finally { win.destroy(); setTimeout(refocus, 30); }
}
// кадр в PNG без диалога — для вариантов обложки
handle('renderFrame', async (ev, job) => {
  const outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2; JOB_HTML = job.html;
  return 'data:image/png;base64,' + (await grabFrame(job, outW, outH, job.t, false)).data.toString('base64');
});
handle('saveImage', async (ev, dataUrl, name) => {
  const r = await dialog.showSaveDialog(mainWin, { title: tr('Сохранить обложку'), defaultPath: name + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return null; try { fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64')); } catch (e) { throw new Error(fsHuman(e, r.filePath)); } return r.filePath;
});
// один кадр в PNG (кадр из ролика или обложка)
handle('exportFrame', async (ev, job) => {
  const r = await dialog.showSaveDialog(mainWin, { title: tr(job.title || 'Сохранить кадр'), defaultPath: (job.name || 'кадр') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const outW = job.width, outH = Math.round(job.width * job.H / job.W / 2) * 2; JOB_HTML = job.html;
  const png = (await grabFrame(job, outW, outH, job.t, !!job.transparent)).data; try { fs.writeFileSync(r.filePath, png); } catch (e) { throw new Error(fsHuman(e, r.filePath)); } return { ok: true, path: r.filePath };
});
handle('captureRect', async (ev, r) => {
  // пустая область (превью свёрнуто) захватывала всё окно или давала пустую картинку вместо миниатюры
  if (!r || !(r.width >= 2 && r.height >= 2)) return null;
  const img = await mainWin.webContents.capturePage({ x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(r.height) }); if (img.isEmpty()) return null;
  return 'data:image/jpeg;base64,' + img.resize({ width: 180 }).toJPEG(80).toString('base64');
});
handle('showFile', async (ev, p) => { shell.showItemInFolder(p); return true; });
