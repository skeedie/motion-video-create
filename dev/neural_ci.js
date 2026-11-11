// Проверка нейросетей на настоящем onnxruntime-node (тот же пакет, что в программе). Запускается в GitHub Actions.
// Модели идут через процесс нейросетей (nn-host.js + nn-jobs.js) — тем же путём, что в программе; вместо Electron utilityProcess
// здесь child_process.fork (nodeFork). Запуск: node dev/neural_ci.js <папка моделей>; ffmpeg — ffmpeg-static или $FFMPEG.
// Необязательные модели (если есть в папке): Kim_Vocal_2.onnx, giga-ctc/{model.int8.onnx,tokens.txt}, w2v-en/{model.int8.onnx,vocab.json}.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const NN = require('../nn-client'), N = require('../neural');
const FF = process.env.FFMPEG || require('ffmpeg-static'), M = path.resolve(process.argv[2] || 'models');
const ok = (c, m) => { if (!c) { console.error('ОШИБКА:', m); process.exitCode = 1; } else console.log('ok:', m); };
const skip = m => console.log('пропуск:', m);
let flag = false;
const nn = NN.create({ log: (...a) => console.log('  журнал:', a.join(' ')), cancelled: () => flag, fork: () => NN.nodeFork(path.join(__dirname, '..', 'nn-host.js')) });
const mem = async () => { const p = await nn.ping(); return `память процесса нейросетей ${Math.round(p.rss / 2 ** 20)} МБ, пик ${Math.round(p.maxRss / 2 ** 20)} МБ`; };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'neural-ci-'));
const readWav = f => { const b = fs.readFileSync(f), C = b.readUInt16LE(22), n = b.readUInt32LE(40) / 2 / C, x = new Float32Array(n * C); for (let i = 0; i < n * C; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768; return { C, n, x }; };
(async () => {
  const p0 = await nn.ping(); ok(p0.ort && !p0.ortError, `процесс нейросетей запускается за ${p0.ms} мс, onnxruntime ${p0.ort}`);
  // 1. биты: щелчки 120 BPM
  cp.execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*60*t)*exp(-25*mod(t\\,0.5))+0.5*(random(0)-0.5)*exp(-40*mod(t+0.5\\,1))':s=44100:d=30", '-ac', '2', 'clicks.wav']);
  const raw = cp.execFileSync(FF, ['-v', 'error', '-i', 'clicks.wav', '-ac', '2', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const st = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), x = new Float32Array(st.length / 2); for (let i = 0; i < x.length; i++) x[i] = (st[2 * i] + st[2 * i + 1]) / 2;
  const beatFile = path.join(M, 'beat_this_small.onnx'), r = await nn.job('beats', { file: beatFile, x }, { cancellable: false, retry: true });
  // пики как в эталоне: максимум в окне ±3 кадра и логит > 0
  const P = []; for (let i = 0; i < r.beat.length; i++) { if (r.beat[i] <= 0) continue; let m = true; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < r.beat.length && r.beat[j] > r.beat[i]) m = false; } if (m && (!P.length || i - P[P.length - 1] > 1)) P.push(i); }
  const med = P.length > 1 ? (P[P.length - 1] - P[0]) / (P.length - 1) / 50 : 1;
  ok(Math.abs(60 / med - 120) < 6 || Math.abs(60 / med - 240) < 12, `Beat This!: ${P.length} битов, средний интервал ${med.toFixed(3)} с → ${(60 / med).toFixed(1)} BPM (щелчки 120 BPM)`);
  // та же модель через сессию-посредник (как getSession в main.js: ort.Tensor -> nn.Tensor, s.run, .data / .dims)
  { const ort = nn, s = await nn.create(beatFile), F = N.beatFeatures(x.subarray(0, 22050 * 10)), n = F.frames;
    const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', F.data, [1, n, 128]) });
    ok(o.beat instanceof nn.Tensor && o.beat.dims.join() === `1,${n}` && o.downbeat.data.length === n && o.beat.data.every(Number.isFinite) && o.beat.data.some(v => v > 0),
      `сессия-посредник: выход beat [${o.beat.dims}], есть биты`); await s.release(); await nn.drop(beatFile); }
  // 2. GigaAM v3: запуск на синтетическом звуке — проверяем вход/выход и int64
  const res = await nn.job('speech', { what: 'transcribeV3', lang: 'ru', file: path.join(M, 'v3_e2e_ctc.int8.onnx'), vocab: path.join(M, 'v3_e2e_ctc_vocab.txt'), ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 10 }).catch(e => ({ err: e.message }));
  ok(res.words || /расслышать/.test(res.err || ''), 'GigaAM v3 запускается: ' + (res.words ? res.words.length + ' слов' : res.err)); await nn.drop(path.join(M, 'v3_e2e_ctc.int8.onnx'));
  // 3. HT-Demucs: без оптимизации графа — память; чтение звука, нейросеть и запись wav — в процессе нейросетей
  const DMF = path.join(M, 'htdemucs_ft_vocals_htdemucs_ft_vocals_fp16weights.onnx'), DMO = { graphOptimizationLevel: 'disabled', enableCpuMemArena: false };
  let out = path.join(TMP, 'dm.wav'), prog = [], t0 = Date.now();
  await nn.job('vocals', { kind: 'demucs', file: DMF, opts: DMO, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 8, out }, { progress: q => prog.push(q) });
  let w = readWav(out);
  ok(w.C === 2 && Math.abs(w.n - 8 * 44100) < 64 && w.x.every(Number.isFinite) && prog[0] === -1 && prog[prog.length - 1] === 1, `HT-Demucs: ${(Date.now() - t0) / 1000} с на 8 с звука, ${await mem()}`);
  // 4. вырезание фона IS-Net: белый круг на сером
  const W = 300, H = 200, px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const i = (y * W + xx) * 4, inC = (xx - 150) ** 2 + (y - 100) ** 2 < 60 ** 2; px[i] = px[i + 1] = px[i + 2] = inC ? 240 : 90; px[i + 3] = 255; }
  const al = await nn.job('cutout', { file: path.join(M, 'isnet-general-use.onnx'), opts: { enableCpuMemArena: false, enableMemPattern: false }, px, w: W, h: H, order: 'bgra', kind: 'isnet' });
  ok(al[100 * W + 150] > al[10 * W + 10], `IS-Net: центр ${al[100 * W + 150]}, угол ${al[10 * W + 10]}, ${await mem()}`);
  // 5. быстрое отделение вокала (Kim Vocal 2)
  const MDXF = path.join(M, 'Kim_Vocal_2.onnx');
  if (fs.existsSync(MDXF)) {
    out = path.join(TMP, 'mdx.wav'); t0 = Date.now();
    await nn.job('vocals', { kind: 'mdx', file: MDXF, opts: {}, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 8, out });
    w = readWav(out); ok(w.C === 2 && Math.abs(w.n - 8 * 44100) < 64 && w.x.every(Number.isFinite), `MDX Kim Vocal 2: ${(Date.now() - t0) / 1000} с на 8 с звука`);
  } else skip('нет Kim_Vocal_2.onnx');
  // 6. синхронизация текста: GigaAM v2 (русский) и wav2vec2 (английский) — проверяем, что путь целиком работает
  for (const [lang, dir, lyrics] of [['ru', 'giga-ctc', 'раз два три\nчетыре пять'], ['en', 'w2v-en', 'one two three\nfour five']]) {
    const d = path.join(M, dir); if (!fs.existsSync(path.join(d, 'model.int8.onnx'))) { skip(`нет модели ${dir}`); continue; }
    const a = await nn.job('speech', { what: 'align', lang, file: path.join(d, 'model.int8.onnx'), modelDir: d, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), lyrics, from: 0, to: 10 }).catch(e => ({ err: e.message }));
    ok(a.words && a.words.length === 5 && a.lines.length === 2 && a.words.every((q, i) => Number.isFinite(q.t) && q.e >= q.t && (!i || q.t >= a.words[i - 1].t)), `синхронизация (${lang}): ` + (a.words ? a.words.map(q => `${q.w}@${q.t}`).join(' ') : a.err));
    const tr = await nn.job('speech', { what: 'transcribe', lang, file: path.join(d, 'model.int8.onnx'), modelDir: d, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 10 }).catch(e => ({ err: e.message }));
    ok(tr.words || /расслышать/.test(tr.err || ''), `распознавание (${lang}) запускается: ` + (tr.words ? tr.words.length + ' слов' : tr.err));
  }
  // 7. падение процесса посреди расчёта (как при нехватке памяти): понятная ошибка, затем процесс запускается заново
  let pid = 0;
  const crash = await nn.job('vocals', { kind: 'demucs', file: DMF, opts: DMO, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 30, out: path.join(TMP, 'x.wav') },
    { progress: q => { if (q > 0 && !pid) { pid = nn.state().pid; process.kill(pid, 'SIGKILL'); } } }).then(() => null, e => e.message);
  const p1 = await nn.ping();
  ok(crash === NN.OOM_MSG && p1.pid !== pid && p1.ort, `падение посреди Demucs: «${crash}», новый процесс ${p1.pid}`);
  // 8. отмена долгого расчёта: процесс останавливается, вызов отклоняется '__cancel'
  let tc = 0;
  const cancel = await nn.job('vocals', { kind: 'demucs', file: DMF, opts: DMO, ffmpeg: FF, audioPath: path.resolve('clicks.wav'), from: 0, to: 30, out: path.join(TMP, 'y.wav') },
    { progress: q => { if (q > 0 && !tc) { tc = Date.now(); flag = true; } } }).then(() => null, e => e.message);
  flag = false;
  ok(cancel === '__cancel' && Date.now() - tc < 2000 && !nn.state().running, `отмена Demucs: «${cancel}» через ${Date.now() - tc} мс`);
  ok((await nn.ping()).ort, 'после отмены процесс нейросетей запускается снова');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { nn.shutdown(); fs.rmSync(TMP, { recursive: true, force: true }); });
