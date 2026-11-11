// Тяжёлые операции нейросетей целиком: чтение звука, подготовка признаков (STFT / мел), запуск модели и разбор выхода.
// Выполняются в процессе нейросетей (nn-host.js), главный процесс получает только готовый результат.
// ctx: { ort, session(file, opts) -> сессия onnxruntime (кэш по файлу), drop(file), progress(value), log }
'use strict';
const fs = require('fs');
const N = require('./neural'), A = require('./align'), SEP = require('./separate');

const lp = t => ({ data: t.data, T2: t.dims[1], V: t.dims[2] });

module.exports = {
  // синхронизация текста и распознавание. a: { what: 'align' | 'transcribe' | 'transcribeV3', lang: 'ru' | 'en', file — модель,
  // modelDir (словарь GigaAM v2 / wav2vec2), vocab — файл словаря GigaAM v3, ffmpeg, audioPath, lyrics, from, to, offset }
  async speech(a, ctx) {
    const { ort } = ctx, s = await ctx.session(a.file, a.opts);
    const runChunk = async (feats, T) => { const out = await s.run({ features: new ort.Tensor('float32', feats, [1, 64, T]), feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]) }); return lp(out[s.outputNames[0]]); };
    const runRaw = async x => { const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, [1, x.length]) }); return lp(out[s.outputNames[0]]); };
    const o = { ffmpeg: a.ffmpeg, audioPath: a.audioPath, from: a.from, to: a.to, offset: a.offset, progress: ctx.progress };
    if (a.what === 'transcribeV3') return A.transcribeV3(Object.assign(o, { vocab: fs.readFileSync(a.vocab, 'utf8'), runChunk }));
    const fn = a.what === 'transcribe' ? A.transcribe : A.align;
    return fn(Object.assign(o, { modelDir: a.modelDir, lyrics: a.lyrics, lang: a.lang, runChunk, runRaw }));
  },

  // отделение вокала: MDX (Kim Vocal 2) или HT-Demucs. a: { kind: 'mdx' | 'demucs', file, opts, ffmpeg, audioPath, from, to, out — куда записать wav }
  // прогресс: -1 — трек прочитан, дальше доля 0..1
  async vocals(a, ctx) {
    const { ort } = ctx, s = await ctx.session(a.file, a.opts);
    try {
      const st = await SEP.loadStereo44(a.ffmpeg, a.audioPath, a.from, a.to);
      ctx.progress(-1);
      const v = a.kind === 'demucs'
        ? await N.demucsVocals(st, async buf => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, 2, N.DM.N]) }))[s.outputNames[0]].data, ctx.progress)
        : await SEP.separate(st, async (arr, dims) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', arr, dims) }))[s.outputNames[0]].data, ctx.progress);
      SEP.writeWav(a.out, v, 44100);
      return { samples: v[0].length };
    } finally { if (a.kind === 'demucs') await ctx.drop(a.file); } // Demucs держит много памяти — сессию не храним
  },

  // биты и сильные доли (Beat This!). a: { file, opts, x — моно 22050 Гц } -> { beat, down, fps }
  async beats(a, ctx) {
    const { ort } = ctx, s = await ctx.session(a.file, a.opts), F = await N.beatFeaturesAsync(a.x);
    return N.beatActivations(F, async (buf, n) => { const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', buf, [1, n, 128]) }); return { beat: o.beat.data, downbeat: o.downbeat.data }; }, ctx.progress);
  },

  // вырезание фона (BiRefNet / IS-Net). a: { file, opts, px — 4 байта на точку, w, h, order ('bgra' | 'rgba'), kind } -> альфа Uint8ClampedArray(w·h)
  async cutout(a, ctx) {
    const { ort } = ctx, s = await ctx.session(a.file, a.opts);
    try {
      const inp = N.bgInput(a.px, a.w, a.h, a.order || 'bgra', a.kind);
      const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, N.BG.size, N.BG.size]) });
      return N.bgAlpha(o[s.outputNames[0]].data, a.w, a.h, a.kind);
    } finally { await ctx.drop(a.file); }
  }
};
