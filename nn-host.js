// Процесс нейросетей Lyric Studio: держит сессии onnxruntime и выполняет тяжёлые расчёты отдельно от главного процесса,
// чтобы окно не подвисало, а нехватка памяти у модели роняла только этот процесс, а не всю программу с несохранённой работой.
// Запускается из main.js через Electron utilityProcess.fork (связь — process.parentPort) или, в проверках на обычном node,
// через child_process.fork с serialization: 'advanced' (связь — process.on('message') / process.send).
// Протокол (все сообщения — структурное клонирование):
//   → { id, op: 'create', file, opts }        ← { sid, inputNames, outputNames }
//   → { id, op: 'run', sid, feeds }           ← { имя: { type, dims, data } } (feeds в том же виде)
//   → { id, op: 'release', sid } / { id, op: 'drop', file } / { id, op: 'ping' } / { id, op: 'exit' }
//   → { id, op: 'job', name, args }           ← результат операции из nn-jobs.js; по ходу — { type: 'progress', id, value }
//   ответы: { type: 'res', id, ok, value | error: { message, stack } }; служебные: ready, log, fatal
'use strict';
const fs = require('fs'), cp = require('child_process');

const port = process.parentPort || null;
function post(m) {
  try { if (port) port.postMessage(m); else if (process.send && process.connected) process.send(m); }
  catch (e) { if (m && m.type === 'res' && m.ok) post({ type: 'res', id: m.id, ok: false, error: { message: 'не удалось передать результат нейросети: ' + e.message } }); }
}
const log = (...args) => post({ type: 'log', args: args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a)) });

// ffmpeg, который запускают расчёты (чтение звука), — без окна консоли и закрывается вместе с этим процессом.
// Подмена до загрузки align.js / separate.js: они берут spawn при подключении.
const KIDS = new Set(), _spawn = cp.spawn;
cp.spawn = function (cmd, args, opts) {
  if (!Array.isArray(args)) { opts = args; args = []; }
  const p = _spawn.call(this, cmd, args, Object.assign({ windowsHide: true }, opts));
  KIDS.add(p); p.on('exit', () => KIDS.delete(p)); p.on('error', () => KIDS.delete(p));
  return p;
};
const killKids = () => { for (const p of KIDS) { try { p.kill('SIGKILL'); } catch (e) {} } KIDS.clear(); };
process.on('exit', killKids);
if (!port) process.on('disconnect', () => process.exit(0)); // главный процесс закрылся — уходим и мы

// onnxruntime подключается при первом обращении; LYRIC_NN_ORT — заглушка для проверок без настоящего onnxruntime
const ORT_MOD = process.env.LYRIC_NN_ORT || 'onnxruntime-node';
let ORT = null;
const ort = () => ORT || (ORT = require(ORT_MOD));
function ortVersion(o) {
  const v = o.env && o.env.versions; if (v && (v.node || v.common)) return v.node || v.common;
  try { return require(ORT_MOD + '/package.json').version; } catch (e) { return '?'; }
}

// opts — настройки onnxruntime как в главном процессе раньше: тяжёлым моделям (Demucs, вырезание фона) отключают
// оптимизацию графа и пул памяти, иначе они просят в разы больше оперативной памяти
async function open(file, opts) {
  try { return await ort().InferenceSession.create(file, Object.assign({ executionProviders: ['cpu'] }, opts || {})); }
  catch (e) {
    // файл модели не читается (обычно — повреждён на диске): удаляем, при следующем запуске он скачается заново
    if (/protobuf|parse|invalid|corrupt|load model|No such file|not a valid/i.test(String(e && e.message))) { log('модель не читается, удаляю:', file, String(e && e.message)); try { fs.unlinkSync(file); } catch (x) {} throw new Error('файл нейросети был повреждён и удалён — запустите ещё раз, он скачается заново'); }
    throw e;
  }
}
const SID = new Map(); let nsid = 0;        // сессии по номеру (op: create/run/release)
const CACHE = new Map();                     // сессии операций по файлу модели: file -> Promise<сессия>
function cached(file, opts) {
  if (!CACHE.has(file)) { const p = open(file, opts); CACHE.set(file, p); p.catch(() => { if (CACHE.get(file) === p) CACHE.delete(file); }); }
  return CACHE.get(file);
}
async function dropFile(file) {
  const p = CACHE.get(file); CACHE.delete(file);
  if (p) { try { await (await p).release(); } catch (e) {} }
  for (const [sid, x] of SID) if (x.file === file) { SID.delete(sid); try { await x.s.release(); } catch (e) {} }
}
const packOut = out => { const r = {}; for (const k in out) { const t = out[k]; r[k] = { type: t.type, dims: Array.from(t.dims), data: t.data }; } return r; };

const OPS = {
  async ping() {
    let ver = null, ortError = null;
    try { ver = ortVersion(ort()); } catch (e) { ortError = String(e && e.message || e).split('\n')[0]; }
    let maxRss = 0; try { maxRss = process.resourceUsage().maxRSS * 1024; } catch (e) {}
    return { pid: process.pid, ort: ver, ortError, rss: process.memoryUsage().rss, maxRss, sessions: SID.size + CACHE.size };
  },
  async create({ file, opts }) {
    const s = await open(file, opts), sid = ++nsid; SID.set(sid, { file, s });
    return { sid, inputNames: Array.from(s.inputNames), outputNames: Array.from(s.outputNames) };
  },
  async run({ sid, feeds, fetches }) {
    const x = SID.get(sid); if (!x) throw new Error('сессия нейросети уже закрыта — запустите ещё раз');
    const T = ort().Tensor, f = {};
    for (const k in feeds) { const t = feeds[k]; f[k] = new T(t.type, t.data, t.dims); }
    return packOut(fetches ? await x.s.run(f, fetches) : await x.s.run(f));
  },
  async release({ sid }) { const x = SID.get(sid); SID.delete(sid); if (x) { try { await x.s.release(); } catch (e) {} } return true; },
  async drop({ file }) { await dropFile(file); return true; },
  async job({ name, args }, id) {
    const J = require('./nn-jobs');
    if (!Object.prototype.hasOwnProperty.call(J, name)) throw new Error('неизвестная операция нейросети: ' + name);
    return J[name](args || {}, { ort: ort(), session: cached, drop: dropFile, progress: v => post({ type: 'progress', id, value: v }), log });
  },
  async exit() { setTimeout(() => process.exit(0), 20); return true; }
};

function onMessage(m) {
  if (!m || typeof m !== 'object' || !OPS[m.op]) { if (m && m.id) post({ type: 'res', id: m.id, ok: false, error: { message: 'неизвестная команда: ' + (m && m.op) } }); return; }
  Promise.resolve().then(() => OPS[m.op](m, m.id)).then(
    value => post({ type: 'res', id: m.id, ok: true, value }),
    e => post({ type: 'res', id: m.id, ok: false, error: { message: String(e && e.message || e), stack: e && e.stack ? String(e.stack).slice(0, 3000) : '' } }));
}
process.on('uncaughtException', e => { try { post({ type: 'fatal', message: String(e && e.message || e).slice(0, 500) }); log('uncaughtException', e); } catch (x) {} setTimeout(() => process.exit(70), 50); });
process.on('unhandledRejection', e => log('unhandledRejection', e));

if (port) port.on('message', e => onMessage(e && e.data)); else process.on('message', onMessage);
post({ type: 'ready', pid: process.pid });
