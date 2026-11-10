// Проверка нейросетей на настоящем onnxruntime-node (тот же пакет, что в программе). Запускается в GitHub Actions.
'use strict';
const ort = require('onnxruntime-node'), fs = require('fs'), path = require('path'), cp = require('child_process');
const N = require('../neural'), A = require('../align'), SEP = require('../separate');
const FF = require('ffmpeg-static'), M = process.argv[2] || 'models';
const ok = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exitCode = 1; } else console.log('ok:', m); };
const mem = () => Math.round(process.memoryUsage().rss / 2 ** 20) + ' МБ';
(async () => {
  // 1. биты: щелчки 120 BPM
  cp.execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*60*t)*exp(-25*mod(t\\,0.5))+0.5*(random(0)-0.5)*exp(-40*mod(t+0.5\\,1))':s=44100:d=30", '-ac', '2', 'clicks.wav']);
  const raw = cp.execFileSync(FF, ['-v', 'error', '-i', 'clicks.wav', '-ac', '2', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const st = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), x = new Float32Array(st.length / 2); for (let i = 0; i < x.length; i++) x[i] = (st[2 * i] + st[2 * i + 1]) / 2;
  let s = await ort.InferenceSession.create(path.join(M, 'beat_this_small.onnx'), { executionProviders: ['cpu'] });
  const F = await N.beatFeaturesAsync(x);
  const r = await N.beatActivations(F, async (buf, n) => { const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, n, 128]) }); return { beat: o.beat.data, downbeat: o.downbeat.data }; });
  // пики как в эталоне: максимум в окне ±3 кадра и логит > 0
  const P = []; for (let i = 0; i < r.beat.length; i++) { if (r.beat[i] <= 0) continue; let m = true; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < r.beat.length && r.beat[j] > r.beat[i]) m = false; } if (m && (!P.length || i - P[P.length - 1] > 1)) P.push(i); }
  const med = P.length > 1 ? (P[P.length - 1] - P[0]) / (P.length - 1) / 50 : 1;
  ok(Math.abs(60 / med - 120) < 6 || Math.abs(60 / med - 240) < 12, `Beat This!: ${P.length} битов, средний интервал ${med.toFixed(3)} с → ${(60 / med).toFixed(1)} BPM (щелчки 120 BPM)`); await s.release();
  // 2. GigaAM v3: запуск на синтетическом звуке — проверяем вход/выход и int64
  const sp = path.join('clicks.wav'); s = await ort.InferenceSession.create(path.join(M, 'v3_e2e_ctc.int8.onnx'), { executionProviders: ['cpu'] });
  const res = await A.transcribeV3({ ffmpeg: FF, vocab: fs.readFileSync(path.join(M, 'v3_e2e_ctc_vocab.txt'), 'utf8'), audioPath: sp, from: 0, to: 10, progress: () => {},
    runChunk: async (feats, T) => { const o = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) }); const t = o[s.outputNames[0]]; return { data: t.data, T2: t.dims[1], V: t.dims[2] }; } }).catch(e => ({ err: e.message }));
  ok(res.words || /расслышать/.test(res.err || ''), 'GigaAM v3 запускается: ' + (res.words ? res.words.length + ' слов' : res.err)); await s.release();
  // 3. HT-Demucs: один кусок, без оптимизации графа — память
  s = await ort.InferenceSession.create(path.join(M, 'htdemucs_ft_vocals_htdemucs_ft_vocals_fp16weights.onnx'), { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false });
  const st44 = await SEP.loadStereo44(FF, 'clicks.wav', 0, 8); const t0 = Date.now();
  const v = await N.demucsVocals(st44, async buf => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, 2, N.DM.N]) }))[s.outputNames[0]].data);
  ok(v[0].length === st44[0].length && v[0].every(Number.isFinite), `HT-Demucs: ${(Date.now() - t0) / 1000} с на 8 с звука, память ${mem()}`); await s.release();
  // 4. вырезание фона IS-Net: белый круг на сером
  const w = 300, h = 200, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4, inC = (xx - 150) ** 2 + (y - 100) ** 2 < 60 ** 2; px[i] = px[i + 1] = px[i + 2] = inC ? 240 : 90; px[i + 3] = 255; }
  s = await ort.InferenceSession.create(path.join(M, 'isnet-general-use.onnx'), { executionProviders: ['cpu'], enableCpuMemArena: false, enableMemPattern: false });
  const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', N.bgInput(px, w, h, 'bgra', 'isnet'), [1, 3, 1024, 1024]) });
  const al = N.bgAlpha(o[s.outputNames[0]].data, w, h, 'isnet');
  ok(al[100 * w + 150] > al[10 * w + 10], `IS-Net: центр ${al[100 * w + 150]}, угол ${al[10 * w + 10]}, память ${mem()}`); await s.release();
})().catch(e => { console.error(e); process.exitCode = 1; });
