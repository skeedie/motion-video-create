// Заглушка onnxruntime-node для dev/test_nn_host.js: поведение «модели» задаётся именем файла.
//   echo  — y = 2·x той же формы, len (int64) = длина x + n; настройки сессии пишутся в <файл>.opts.json
//   slow  — ждёт x[0] мс и возвращает x;  crash — процесс падает посреди run (как при нехватке памяти)
//   oom   — run выбрасывает bad allocation;  corrupt — создание сессии падает с ошибкой разбора protobuf
//   beat / beat_slow — выход как у Beat This! ([1,n] beat и downbeat), beat_slow ждёт 400 мс на кусок
//   cutout — выход [1,1,1024,1024] = первый канал входа
'use strict';
const fs = require('fs'), path = require('path');
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = { echo: [['x', 'n'], ['y', 'len']], slow: [['x'], ['y']], crash: [['x'], ['y']], oom: [['x'], ['y']], beat: [['spect'], ['beat', 'downbeat']], beat_slow: [['spect'], ['beat', 'downbeat']], cutout: [['input'], ['mask']] };
class InferenceSession {
  static async create(file, opts) {
    const kind = path.basename(file).replace(/\.onnx$/, '');
    if (kind === 'corrupt') throw new Error(`Load model from ${file} failed:Protobuf parsing failed.`);
    if (!NAMES[kind]) throw new Error('заглушка: неизвестная модель ' + kind);
    if (kind === 'echo') fs.writeFileSync(file + '.opts.json', JSON.stringify(opts));
    const s = new InferenceSession(); s.kind = kind; s.inputNames = NAMES[kind][0]; s.outputNames = NAMES[kind][1]; return s;
  }
  async run(f) {
    const k = this.kind;
    if (k === 'echo') { const x = f.x; return { y: new Tensor('float32', x.data.map(v => v * 2), x.dims), len: new Tensor('int64', BigInt64Array.from([BigInt(x.data.length) + f.n.data[0]]), [1]) }; }
    if (k === 'slow') { await sleep(f.x.data[0]); return { y: new Tensor('float32', f.x.data, f.x.dims) }; }
    if (k === 'crash') { process.kill(process.pid, 'SIGKILL'); await sleep(10000); }
    if (k === 'oom') throw new Error('Non-zero status code returned while running Conv node. Status Message: bad allocation');
    if (k === 'beat' || k === 'beat_slow') {
      if (k === 'beat_slow') await sleep(400);
      const n = f.spect.dims[1], b = new Float32Array(n).map((_, i) => i % 25 === 0 ? 5 : -5);
      return { beat: new Tensor('float32', b, [1, n]), downbeat: new Tensor('float32', b.map(v => v - 1), [1, n]) };
    }
    if (k === 'cutout') { const S = 1024; return { mask: new Tensor('float32', f.input.data.slice(0, S * S), [1, 1, S, S]) }; }
    throw new Error('заглушка: ' + k);
  }
  async release() { this.released = true; }
}
module.exports = { Tensor, InferenceSession, env: { versions: { common: 'stub', node: 'stub' } } };
