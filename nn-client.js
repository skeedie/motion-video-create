// Клиент процесса нейросетей (nn-host.js) для главного процесса: запускает процесс лениво, при падении отклоняет ожидающие
// вызовы понятной ошибкой и при следующем вызове запускает его заново, по отмене останавливает долгий расчёт,
// после долгого простоя завершает процесс, чтобы вернуть память.
// create(o): o.fork() -> процесс с postMessage/kill/on('message'|'exit') (Electron utilityProcess или nodeFork ниже),
// o.log, o.cancelled() — флаг отмены программы, o.idleMs (по умолчанию 5 минут), o.startTimeoutMs.
'use strict';
const EventEmitter = require('events');

const OOM_MSG = 'нейросети не хватило памяти — закройте другие программы или выберите режим попроще';
const OOM_RE = /bad[_ ]alloc|bad allocation|out of memory|failed to allocate|allocation failed|not enough memory|ENOMEM/i;

// ---------- тензор, совместимый с ort.Tensor по конструктору и полям type / data / dims ----------
const TYPES = [['float32', Float32Array], ['float64', Float64Array], ['int64', BigInt64Array], ['uint64', BigUint64Array], ['int32', Int32Array], ['uint32', Uint32Array],
  ['int16', Int16Array], ['uint16', Uint16Array], ['int8', Int8Array], ['uint8', Uint8Array], ['bool', Uint8Array]];
const typeOf = d => { for (const [t, C] of TYPES) if (d instanceof C) return t; if (d instanceof Uint8ClampedArray) return 'uint8'; throw new TypeError('тензор: неподдерживаемый тип данных'); };
class Tensor {
  // как у onnxruntime: new Tensor(type, data, dims) | new Tensor(type, data) | new Tensor(data, dims)
  constructor(type, data, dims) {
    if (typeof type !== 'string') { dims = data; data = type; type = typeOf(data); }
    if (Array.isArray(data)) { const C = (TYPES.find(x => x[0] === type) || [])[1]; if (!C) throw new TypeError('тензор: неизвестный тип ' + type); data = C === BigInt64Array || C === BigUint64Array ? C.from(data, BigInt) : C.from(data); }
    dims = dims ? Array.from(dims, Number) : [data.length];
    const size = dims.reduce((a, b) => a * b, 1);
    if (size !== data.length) throw new RangeError(`тензор: форма [${dims}] не совпадает с длиной данных ${data.length}`);
    this.type = type; this.data = data; this.dims = dims; this.size = size;
  }
}
// часть большого массива (subarray) копируем, иначе структурное клонирование перешлёт весь исходный буфер
const compact = d => {
  if (!ArrayBuffer.isView(d) || d instanceof DataView || (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength)) return d;
  return new ((typeof Buffer !== 'undefined' && Buffer.isBuffer(d)) ? Uint8Array : d.constructor)(d);
};
const compactArgs = a => { if (!a || typeof a !== 'object' || ArrayBuffer.isView(a)) return compact(a); const r = Array.isArray(a) ? [] : {}; for (const k in a) r[k] = compact(a[k]); return r; };
const packFeeds = feeds => { const r = {}; for (const k in feeds) { const t = feeds[k]; r[k] = { type: t.type || typeOf(t.data), dims: Array.from(t.dims), data: compact(t.data) }; } return r; };
const unpack = out => { const r = {}; for (const k in out) { const t = out[k]; r[k] = new Tensor(t.type, t.data, t.dims); } return r; };

function create(o) {
  const log = o.log || (() => {}), cancelled = o.cancelled || (() => false);
  const idleMs = o.idleMs == null ? 5 * 60e3 : o.idleMs, startMs = o.startTimeoutMs || 60e3;
  let cur = null, gen = 0, seq = 0, afterCrash = false, idleT = null, pollT = null;
  const fmtIdle = () => idleMs >= 60e3 ? Math.round(idleMs / 60e3) + ' мин' : (idleMs / 1e3) + ' с';

  function start() {
    if (cur) return cur;
    const h = { gen: ++gen, proc: null, ready: false, queue: [], pending: new Map(), stopping: null, fatal: null, recycle: false, tail: [], pid: null };
    log(afterCrash ? 'нейросети: перезапуск процесса после сбоя' : 'нейросети: запуск процесса'); afterCrash = false;
    try { h.proc = o.fork(); } catch (e) { log('нейросети: процесс не запускается:', e); throw new Error('не удалось запустить процесс нейросетей: ' + e.message); }
    cur = h;
    h.proc.on('message', m => onMessage(h, m));
    h.proc.on('exit', code => onExit(h, code));
    if (typeof h.proc.on === 'function') h.proc.on('error', e => log('нейросети: ошибка процесса:', e && e.message || e));
    // вывод процесса (предупреждения onnxruntime, сообщения о нехватке памяти) — последние строки попадут в журнал при падении
    for (const s of [h.proc.stdout, h.proc.stderr]) if (s && s.on) s.on('data', d => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { h.tail.push(l.slice(0, 300)); if (h.tail.length > 20) h.tail.shift(); } });
    h.startT = setTimeout(() => { if (!h.ready) { h.stopping = 'timeout'; kill(h); } }, startMs); if (h.startT.unref) h.startT.unref();
    return h;
  }
  function kill(h) { if (cur === h) cur = null; try { h.proc.kill(); } catch (e) {} updatePoll(); }
  function post(h, m) { try { h.proc.postMessage(m); } catch (e) { const p = h.pending.get(m.id); if (p) { h.pending.delete(m.id); p.reject(new Error('не удалось передать данные нейросети: ' + e.message)); settled(h); } } }

  function onMessage(h, m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready') {
      h.ready = true; h.pid = m.pid; clearTimeout(h.startT); log(`нейросети: процесс запущен (pid ${m.pid})`);
      const q = h.queue; h.queue = []; for (const x of q) post(h, x); return;
    }
    if (m.type === 'log') return log('нейросети:', ...(m.args || []));
    if (m.type === 'fatal') { h.fatal = m.message; return; }
    const p = h.pending.get(m.id); if (!p) return;
    if (m.type === 'progress') {
      if (p.progress) try { p.progress(m.value); } catch (e) { if (e && e.message === '__cancel') cancel(); else log('нейросети: ошибка в обработчике прогресса:', e); }
      return;
    }
    if (m.type !== 'res') return;
    h.pending.delete(m.id);
    if (m.ok) p.resolve(m.value, h);
    else {
      let msg = String(m.error && m.error.message || 'ошибка нейросети');
      if (OOM_RE.test(msg)) { log('нейросети: не хватило памяти:', msg); msg = OOM_MSG; h.recycle = true; }
      const e = new Error(msg); if (m.error && m.error.stack) e.hostStack = m.error.stack; p.reject(e);
    }
    settled(h);
  }
  // после нехватки памяти процесс перезапускаем, как только он освободится: память у него могла остаться раздробленной
  function settled(h) {
    if (h.pending.size) return updatePoll();
    if (h.recycle && cur === h) { h.stopping = 'recycle'; log('нейросети: перезапускаю процесс, чтобы вернуть память'); kill(h); }
    armIdle(); updatePoll();
  }
  function onExit(h, code) {
    clearTimeout(h.startT); if (cur === h) cur = null;
    const why = h.stopping, list = [...h.pending.values()]; h.pending.clear(); h.queue = [];
    if (why === 'cancel') {
      for (const p of list) {
        if (p.retry && !p.retried) { p.retried = true; try { dispatch(p); } catch (e) { p.reject(e); } }
        else p.reject(new Error('расчёт нейросети прерван отменой другой операции — запустите ещё раз'));
      }
    } else if (why === 'idle' || why === 'shutdown' || why === 'recycle') {
      for (const p of list) p.reject(new Error('процесс нейросетей был остановлен — запустите ещё раз'));
    } else {
      afterCrash = true;
      const msg = h.fatal ? 'сбой в процессе нейросетей: ' + h.fatal
        : why === 'timeout' ? 'процесс нейросетей не запустился вовремя — возможно, его блокирует антивирус'
          : !h.ready ? `не удалось запустить процесс нейросетей (код ${code}) — переустановите программу` : OOM_MSG;
      log(`нейросети: процесс ${h.ready ? 'упал' : 'не запустился'} (код ${code})` + (list.length ? `, прервано вызовов: ${list.length}` : '') + (h.tail.length ? '\n  ' + h.tail.join('\n  ') : ''));
      for (const p of list) p.reject(new Error(msg));
    }
    armIdle(); updatePoll();
  }

  function armIdle() {
    clearTimeout(idleT); idleT = null;
    if (!cur || cur.pending.size || !(idleMs > 0)) return;
    const h = cur;
    idleT = setTimeout(() => { if (cur === h && !h.pending.size) { h.stopping = 'idle'; log(`нейросети: простой ${fmtIdle()} — процесс завершён, память возвращена`); kill(h); } }, idleMs);
    if (idleT.unref) idleT.unref();
  }
  // пока идёт расчёт, который можно отменить, следим за флагом отмены программы
  function updatePoll() {
    const need = !!cur && [...cur.pending.values()].some(p => p.cancellable);
    if (need && !pollT) { pollT = setInterval(() => { if (cancelled()) cancel(); }, 150); if (pollT.unref) pollT.unref(); }
    else if (!need && pollT) { clearInterval(pollT); pollT = null; }
  }
  function dispatch(p) {
    const h = start(); h.pending.set(p.id, p);
    clearTimeout(idleT); idleT = null;
    if (h.ready) post(h, p.msg); else h.queue.push(p.msg);
    updatePoll();
  }
  // opt: cancellable (по умолчанию да) — прерывается отменой; retry — если процесс остановлен отменой другой операции, повторить
  function request(msg, opt = {}) {
    const cancellable = opt.cancellable !== false;
    if (cancellable && cancelled()) return Promise.reject(new Error('__cancel'));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      dispatch({ id, msg: Object.assign({ id }, msg), cancellable, retry: !!opt.retry, progress: opt.progress, resolve: (value, h) => resolve({ value, gen: h.gen }), reject });
    });
  }
  // остановить долгий расчёт: процесс убивается, отменяемые вызовы отклоняются с '__cancel'
  function cancel() {
    const h = cur; if (!h) return false;
    const c = [...h.pending.values()].filter(p => p.cancellable); if (!c.length) return false;
    for (const p of c) { h.pending.delete(p.id); p.reject(new Error('__cancel')); }
    h.stopping = 'cancel'; log('нейросети: отмена — процесс остановлен' + (h.pending.size ? `, фоновых вызовов к повтору: ${h.pending.size}` : ''));
    kill(h); return true;
  }

  // сессия-посредник: inputNames / outputNames / run(feeds) / release(), как у ort.InferenceSession.
  // Если процесс перезапускался (падение, отмена, простой), сессия открывается заново при следующем run.
  class Session {
    constructor(file, opts) { this.file = file; this.opts = opts || {}; this.sid = null; this.gen = 0; this.inputNames = []; this.outputNames = []; this.released = false; }
    get stale() { return !cur || cur.gen !== this.gen; }
    async _open() { const r = await request({ op: 'create', file: this.file, opts: this.opts }); this.sid = r.value.sid; this.inputNames = r.value.inputNames; this.outputNames = r.value.outputNames; this.gen = r.gen; }
    async run(feeds, fetches) {
      if (this.released) throw new Error('сессия нейросети уже закрыта');
      if (this.stale) await this._open();
      const msg = { op: 'run', sid: this.sid, feeds: packFeeds(feeds) }; if (fetches) msg.fetches = fetches;
      return unpack((await request(msg)).value);
    }
    async release() { const was = !this.released; this.released = true; if (was && !this.stale && this.sid != null) await request({ op: 'release', sid: this.sid }, { cancellable: false }).catch(() => {}); }
  }

  return {
    Tensor,
    async create(file, opts) { const s = new Session(file, opts); await s._open(); return s; },
    // целая операция из nn-jobs.js; opt: { progress, cancellable, retry }
    async job(name, args, opt) { return (await request({ op: 'job', name, args: compactArgs(args) }, opt)).value; },
    // закрыть все сессии файла (перед удалением модели); процесс ради этого не запускается
    async drop(file) { if (!cur) return false; return (await request({ op: 'drop', file }, { cancellable: false })).value; },
    async ping(timeoutMs = 60e3) {
      const t0 = Date.now(); let t;
      const r = await Promise.race([request({ op: 'ping' }, { cancellable: false }), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('процесс нейросетей не отвечает')), timeoutMs); if (t.unref) t.unref(); })]).finally(() => clearTimeout(t));
      return Object.assign(r.value, { ms: Date.now() - t0 });
    },
    cancel,
    shutdown() { clearTimeout(idleT); if (cur) { cur.stopping = 'shutdown'; kill(cur); } },
    state() { return { running: !!cur, ready: !!(cur && cur.ready), pid: cur && cur.pid, pending: cur ? cur.pending.size : 0, gen }; }
  };
}

// процесс-хост под обычным node (проверки и CI): child_process.fork с тем же интерфейсом, что у Electron utilityProcess
function nodeFork(file, opt = {}) {
  const cp = require('child_process'), os = require('os'), e = new EventEmitter();
  const c = cp.fork(file, opt.args || [], { serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: opt.env || process.env, execArgv: opt.execArgv || [] });
  e.pid = c.pid; e.stdout = c.stdout; e.stderr = c.stderr; e.child = c;
  e.postMessage = m => { if (!c.connected) throw new Error('процесс уже завершён'); c.send(m, err => { if (err) e.emit('error', err); }); };
  e.kill = () => c.kill('SIGKILL');
  c.on('message', m => e.emit('message', m));
  c.on('error', err => e.emit('error', err));
  c.on('exit', (code, sig) => e.emit('exit', code != null ? code : 128 + ((sig && os.constants.signals[sig]) || 1)));
  return e;
}

module.exports = { create, nodeFork, Tensor, OOM_MSG };
