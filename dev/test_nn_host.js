// Проверка процесса нейросетей (nn-host.js + nn-client.js) на обычном node, без Electron и без onnxruntime:
// utilityProcess заменён child_process.fork (nodeFork), onnxruntime-node — заглушкой dev/ort_stub.js.
// Каждая проверка идёт дважды: хост общается через process.on('message') (режим node) и через process.parentPort
// (режим Electron, parentPort подставляет dev/parentport_shim.js). Запуск: node dev/test_nn_host.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const NN = require('../nn-client');
const ROOT = path.join(__dirname, '..'), HOST = path.join(ROOT, 'nn-host.js'), STUB = path.join(__dirname, 'ort_stub.js'), SHIM = path.join(__dirname, 'parentport_shim.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-host-test-')), model = k => path.join(TMP, k + '.onnx');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rejects = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return e; } assert.fail('ожидалась ошибка ' + re); };

let MODE = 'node';
const clients = [];
function mk(o = {}) {
  const logs = [], env = Object.assign({}, process.env, { LYRIC_NN_ORT: STUB });
  const fork = MODE === 'node' ? () => NN.nodeFork(o.host || HOST, { env }) : () => NN.nodeFork(SHIM, { env, args: [o.host || HOST] });
  const c = NN.create(Object.assign({ log: (...a) => logs.push(a.join(' ')), fork }, o)); c.logs = logs; clients.push(c);
  c.has = re => logs.some(l => re.test(l));
  return c;
}
const echoFeeds = (c, x, dims) => ({ x: new c.Tensor('float32', x, dims), n: new c.Tensor('int64', BigInt64Array.from([10n]), [1]) });

const TESTS = {
  async 'create / run / release, тензоры и формы, настройки сессии'() {
    const c = mk(), s = await c.create(model('echo'), { graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false });
    assert.deepStrictEqual(s.inputNames, ['x', 'n']); assert.deepStrictEqual(s.outputNames, ['y', 'len']);
    const o = await s.run(echoFeeds(c, Float32Array.from([1, 2, 3, 4, 5, 6]), [1, 2, 3]));
    assert.ok(o.y instanceof c.Tensor); assert.strictEqual(o.y.type, 'float32'); assert.deepStrictEqual(o.y.dims, [1, 2, 3]);
    assert.deepStrictEqual(Array.from(o.y.data), [2, 4, 6, 8, 10, 12]); assert.ok(o.y.data instanceof Float32Array);
    assert.strictEqual(o.len.type, 'int64'); assert.ok(o.len.data instanceof BigInt64Array); assert.strictEqual(o.len.data[0], 16n);
    const opts = JSON.parse(fs.readFileSync(model('echo') + '.opts.json', 'utf8'));
    assert.deepStrictEqual(opts, { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false });
    // часть большого массива уходит без остального буфера
    const big = new Float32Array(1 << 20).map((_, i) => i), o2 = await s.run(echoFeeds(c, big.subarray(10, 14), [4]));
    assert.deepStrictEqual(Array.from(o2.y.data), [20, 22, 24, 26]);
    const p = await c.ping(); assert.strictEqual(p.ort, 'stub'); assert.strictEqual(p.sessions, 1); assert.ok(p.pid > 0);
    await s.release(); assert.strictEqual((await c.ping()).sessions, 0);
    await rejects(s.run(echoFeeds(c, Float32Array.from([1]), [1])), /закрыта/);
    assert.ok(c.has(/процесс запущен \(pid \d+\)/));
  },
  async 'Tensor совместим с ort.Tensor'() {
    const T = NN.Tensor;
    let t = new T(Float32Array.from([1, 2])); assert.strictEqual(t.type, 'float32'); assert.deepStrictEqual(t.dims, [2]);
    t = new T('int64', [1, 2, 3, 4], [2, 2]); assert.ok(t.data instanceof BigInt64Array); assert.strictEqual(t.size, 4);
    t = new T(Int32Array.from([1, 2, 3]), [3, 1]); assert.strictEqual(t.type, 'int32');
    assert.throws(() => new T('float32', new Float32Array(5), [2, 2]), /не совпадает/);
  },
  async 'падение хоста посреди run: понятная ошибка, перезапуск, сессии открываются заново'() {
    const c = mk(), s = await c.create(model('echo')), cr = await c.create(model('crash')), pid1 = c.state().pid;
    const e = await rejects(cr.run({ x: new c.Tensor('float32', Float32Array.from([1]), [1]) }), /не хватило памяти/);
    assert.strictEqual(e.message, NN.OOM_MSG);
    assert.ok(c.has(/процесс упал \(код \d+\), прервано вызовов: 1/)); assert.strictEqual(c.state().running, false);
    const o = await s.run(echoFeeds(c, Float32Array.from([3]), [1])); // та же сессия-посредник после перезапуска
    assert.strictEqual(o.y.data[0], 6); assert.notStrictEqual(c.state().pid, pid1);
    assert.ok(c.has(/перезапуск процесса после сбоя/));
  },
  async 'нехватка памяти без падения: русская ошибка и перезапуск процесса'() {
    const c = mk(), s = await c.create(model('oom'));
    await rejects(s.run({ x: new c.Tensor('float32', Float32Array.from([1]), [1]) }), /не хватило памяти/);
    await sleep(200); assert.strictEqual(c.state().running, false); assert.ok(c.has(/перезапускаю процесс/));
    assert.ok((await c.ping()).pid > 0);
  },
  async 'повреждённая модель удаляется'() {
    const c = mk(), f = model('corrupt'); fs.writeFileSync(f, 'мусор');
    await rejects(c.create(f), /повреждён и удалён/);
    assert.ok(!fs.existsSync(f)); assert.ok(c.has(/модель не читается, удаляю/));
  },
  async 'отмена прерывает долгий расчёт, фоновая операция повторяется'() {
    let flag = false; const c = mk({ cancelled: () => flag });
    const slow = await c.create(model('slow')), x = new Float32Array(22050 * 4).map((_, i) => Math.sin(i / 7));
    assert.strictEqual(c.cancel(), false); // отменять нечего — процесс не трогаем
    const t0 = Date.now(), run = slow.run({ x: new c.Tensor('float32', Float32Array.from([5000]), [1]) });
    const bg = c.job('beats', { file: model('beat_slow'), x }, { cancellable: false, retry: true });
    await sleep(300); const pid = c.state().pid; flag = true;
    await rejects(run, /^__cancel$/); assert.ok(Date.now() - t0 < 1500, 'отмена должна сработать быстро');
    assert.ok(c.has(/отмена — процесс остановлен, фоновых вызовов к повтору: 1/));
    await rejects(slow.run({ x: new c.Tensor('float32', Float32Array.from([1]), [1]) }), /^__cancel$/); // пока флаг стоит — сразу отказ
    flag = false;
    const r = await bg; assert.strictEqual(r.beat.length, 1 + Math.floor(x.length / 441)); assert.strictEqual(r.fps, 50);
    assert.notStrictEqual(c.state().pid, pid);
    // nn.cancel() напрямую и отмена из обработчика прогресса (guard() бросает '__cancel')
    const long = new Float32Array(22050 * 40);
    await rejects(c.job('beats', { file: model('beat_slow'), x: long }, { progress: () => { throw new Error('__cancel'); } }), /^__cancel$/);
    const p2 = c.job('beats', { file: model('beat_slow'), x: long }); await sleep(200); assert.strictEqual(c.cancel(), true); await rejects(p2, /^__cancel$/);
  },
  async 'завершение по простою и запуск заново'() {
    const c = mk({ idleMs: 300 });
    await c.ping(); assert.strictEqual(c.state().running, true);
    await sleep(800); assert.strictEqual(c.state().running, false); assert.ok(c.has(/простой 0.3 с — процесс завершён/));
    assert.strictEqual(await c.drop(model('echo')), false); assert.strictEqual(c.state().running, false); // ради drop процесс не запускается
    await c.ping(); assert.strictEqual(c.logs.filter(l => /запуск процесса/.test(l)).length, 2);
    // долгий расчёт простоем не считается
    const s = await c.create(model('slow')); await s.run({ x: new c.Tensor('float32', Float32Array.from([700]), [1]) }); assert.strictEqual(c.state().running, true);
  },
  async 'операции целиком: биты и вырезание фона'() {
    const c = mk(), x = new Float32Array(22050 * 40).map((_, i) => Math.sin(i / 5)), prog = [];
    const r = await c.job('beats', { file: model('beat'), x }, { progress: v => prog.push(v) });
    assert.ok(r.beat instanceof Float32Array && r.down instanceof Float32Array); assert.strictEqual(r.beat.length, 2001);
    assert.ok(prog.length >= 2 && prog[prog.length - 1] === 1);
    const w = 300, h = 200, px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4, inC = (xx - 150) ** 2 + (y - 100) ** 2 < 60 ** 2; px[i] = px[i + 1] = px[i + 2] = inC ? 240 : 90; px[i + 3] = 255; }
    const al = await c.job('cutout', { file: model('cutout'), px: Buffer.from(px), w, h, order: 'rgba', kind: 'isnet' });
    assert.ok(al instanceof Uint8ClampedArray); assert.strictEqual(al.length, w * h); assert.ok(al[100 * w + 150] > 200 && al[10 * w + 10] < 50);
    assert.strictEqual((await c.ping()).sessions, 1); // сессия вырезания фона закрыта сразу, битов — осталась в кэше
    await c.drop(model('beat')); assert.strictEqual((await c.ping()).sessions, 0);
    await rejects(c.job('nope', {}), /неизвестная операция/);
  },
  async 'хост не запускается'() {
    const c = mk({ host: path.join(TMP, 'нет-такого.js') });
    await rejects(c.ping(), /не удалось запустить процесс нейросетей \(код \d+\)/); assert.ok(c.has(/не запустился/));
  }
};

(async () => {
  let fail = 0;
  for (MODE of ['node', 'parentPort']) for (const name in TESTS) {
    const t0 = Date.now();
    try { await TESTS[name](); console.log(`ok   [${MODE}] ${name} (${Date.now() - t0} мс)`); }
    catch (e) { fail++; console.error(`FAIL [${MODE}] ${name}\n`, e); }
    finally { for (const c of clients.splice(0)) c.shutdown(); }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fail ? `ОШИБОК: ${fail}` : 'все проверки пройдены'); process.exitCode = fail ? 1 : 0;
})();
