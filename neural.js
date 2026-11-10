// Локальные нейросети: подготовка входа и разбор выхода. Сам запуск модели передаётся снаружи (run),
// поэтому всё здесь — чистые функции без onnxruntime.
'use strict';
const { makeFFT } = require('./separate');

// ---------- общие ----------
const hannPeriodic = n => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
// треугольные мел-фильтры как в torchaudio.functional.melscale_fbanks (norm=None); результат [nFreqs][nMels]
function melFbanks(nFreqs, fMin, fMax, nMels, sr, scale) {
  const toMel = scale === 'slaney'
    ? f => f < 1000 ? f * 3 / 200 : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27)
    : f => 2595 * Math.log10(1 + f / 700);
  const toHz = scale === 'slaney'
    ? m => m < 15 ? m * 200 / 3 : 1000 * Math.exp((m - 15) * Math.log(6.4) / 27)
    : m => 700 * (Math.pow(10, m / 2595) - 1);
  const mMin = toMel(fMin), mMax = toMel(fMax), pts = [];
  for (let i = 0; i < nMels + 2; i++) pts.push(toHz(mMin + (mMax - mMin) * i / (nMels + 1)));
  const fb = new Float64Array(nFreqs * nMels);
  for (let k = 0; k < nFreqs; k++) {
    const f = (sr / 2) * k / (nFreqs - 1);
    for (let m = 0; m < nMels; m++) {
      const up = (f - pts[m]) / (pts[m + 1] - pts[m]), down = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
      fb[k * nMels + m] = Math.max(0, Math.min(up, down));
    }
  }
  return fb;
}

// ---------- Beat This! (биты и сильные доли) ----------
// вход: 22050 Гц моно (среднее каналов). STFT 1024 / hop 441, center+reflect, |X|/sqrt(1024), slaney-мел 128 (30–11000 Гц), log1p(1000·x)
const BT = { sr: 22050, nfft: 1024, hop: 441, mels: 128, fps: 50, chunk: 1500, border: 6 };
let BT_FB = null;
function* beatFrames(x, out) {
  const N = BT.nfft, half = N / 2, nf = N / 2 + 1, M = BT.mels, win = hannPeriodic(N), fft = makeFFT(N);
  if (!BT_FB) BT_FB = melFbanks(nf, 30, 11000, M, BT.sr, 'slaney');
  const T = out.length / M;
  const xr = new Float64Array(N), xi = new Float64Array(N), yr = new Float64Array(N), yi = new Float64Array(N), mag = new Float64Array(nf);
  const L = x.length, at = i => { // отражение на краях (torch reflect)
    if (L === 1) return x[0];
    while (i < 0 || i >= L) i = i < 0 ? -i : 2 * (L - 1) - i;
    return x[i];
  };
  const norm = 1 / Math.sqrt(N);
  for (let t = 0; t < T; t++) {
    const o = t * BT.hop - half;
    for (let i = 0; i < N; i++) { const j = o + i; xr[i] = (j >= 0 && j < L ? x[j] : at(j)) * win[i]; xi[i] = 0; }
    fft(xr, xi, yr, yi);
    for (let k = 0; k < nf; k++) mag[k] = Math.hypot(yr[k], yi[k]) * norm;
    for (let m = 0; m < M; m++) { let s = 0; for (let k = 0; k < nf; k++) { const w = BT_FB[k * M + m]; if (w) s += mag[k] * w; } out[t * M + m] = Math.log1p(1000 * s); }
    if (t % 300 === 299) yield t;
  }
}
function beatFeatures(x) {
  const T = 1 + Math.floor(x.length / BT.hop), out = new Float32Array(T * BT.mels);
  for (const _ of beatFrames(x, out)); // eslint-disable-line no-unused-vars
  return { data: out, frames: T };
}
// то же, но отдаёт управление каждые 300 кадров, чтобы не подвешивать окно программы
async function beatFeaturesAsync(x) {
  const T = 1 + Math.floor(x.length / BT.hop), out = new Float32Array(T * BT.mels);
  for (const _ of beatFrames(x, out)) await new Promise(r => setImmediate(r)); // eslint-disable-line no-unused-vars
  return { data: out, frames: T };
}
// run(Float32Array [1, n, 128], n) -> { beat: Float32Array(n), downbeat: Float32Array(n) } (логиты)
async function beatActivations(F, run, progress) {
  const { chunk: C, border: B } = BT, T = F.frames, M = BT.mels;
  const starts = []; for (let s = -B; s < T - B; s += C - 2 * B) starts.push(s);
  if (T > C - 2 * B) starts[starts.length - 1] = T - (C - B);
  const beat = new Float32Array(T).fill(-1000), down = new Float32Array(T).fill(-1000);
  const res = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], a = Math.max(s, 0), b = Math.min(s + C, T), left = Math.max(0, -s), right = Math.max(0, Math.min(B, s + C - T));
    const n = left + (b - a) + right, buf = new Float32Array(n * M);
    buf.set(F.data.subarray(a * M, b * M), left * M);
    res.push({ s, n, out: await run(buf, n) });
    if (progress) progress((i + 1) / starts.length);
  }
  // keep_first: более ранние куски перекрывают поздние
  for (let i = res.length - 1; i >= 0; i--) {
    const { s, n, out } = res[i];
    for (let j = B; j < n - B; j++) { const p = s + j; if (p >= 0 && p < T) { beat[p] = out.beat[j]; down[p] = out.downbeat[j]; } }
  }
  return { beat, down, fps: BT.fps };
}

// ---------- GigaAM v3 (распознавание с пунктуацией) ----------
// 16 кГц; STFT 320 / hop 160 без center, окно Ханна, мощность, HTK-мел 64 (0–8000 Гц), log(clip(1e-9))
let G3_FB = null;
function gigaV3Features(x) {
  const N = 320, hop = 160, nf = N / 2 + 1, M = 64, win = hannPeriodic(N), fft = makeFFT(N);
  if (!G3_FB) G3_FB = melFbanks(nf, 0, 8000, M, 16000, 'htk');
  const T = x.length >= N ? Math.floor((x.length - N) / hop) + 1 : 0, out = new Float32Array(T * M);
  const xr = new Float64Array(N), xi = new Float64Array(N), yr = new Float64Array(N), yi = new Float64Array(N), pw = new Float64Array(nf);
  for (let t = 0; t < T; t++) {
    const o = t * hop; for (let i = 0; i < N; i++) { xr[i] = x[o + i] * win[i]; xi[i] = 0; }
    fft(xr, xi, yr, yi);
    for (let k = 0; k < nf; k++) pw[k] = yr[k] * yr[k] + yi[k] * yi[k];
    for (let m = 0; m < M; m++) { let s = 0; for (let k = 0; k < nf; k++) { const w = G3_FB[k * M + m]; if (w) s += pw[k] * w; } out[t * M + m] = Math.log(Math.min(1e9, Math.max(1e-9, s))); }
  }
  return { data: out, frames: T, bands: M };
}
function readVocab(text) { const v = {}; for (const line of text.split('\n')) { if (!line.trim()) continue; const i = line.lastIndexOf(' '); v[+line.slice(i + 1)] = line.slice(0, i); } return v; }
// жадное CTC-декодирование словаря BPE («▁» — начало слова); слова со временем по кадрам (40 мс)
function decodeBpeWords(lp, T, V, vocab, fs, off = 0) {
  let blank = V - 1; for (const k in vocab) if (vocab[k] === '<blk>') blank = +k;
  const words = []; let cur = null, pv = -1, sum = 0, cnt = 0;
  const close = () => { if (cur && cur.w.trim()) { cur.w = cur.w.trim(); cur.conf = +Math.exp(sum / Math.max(1, cnt)).toFixed(2); words.push(cur); } cur = null; sum = 0; cnt = 0; };
  for (let t = 0; t < T; t++) {
    let bi = 0, bv = -Infinity; for (let v = 0; v < V; v++) { const q = lp[t * V + v]; if (q > bv) { bv = q; bi = v; } }
    if (bi !== blank && bi !== pv) {
      const tok = vocab[bi];
      if (tok && tok !== '<unk>') {
        if (tok.startsWith('▁')) { close(); const rest = tok.slice(1); cur = { w: rest, t: t * fs, e: (t + 1) * fs }; }
        else { if (!cur) cur = { w: '', t: t * fs, e: 0 }; cur.w += tok; cur.e = (t + 1) * fs; }
        sum += bv; cnt++;
      }
    }
    pv = bi;
  }
  close();
  const dur = T * fs;
  return words.filter(w => /[\p{L}\p{N}]/u.test(w.w)).map((w, i, a) => {
    const nxt = i + 1 < a.length ? a[i + 1].t : dur, e0 = w.e;
    return { w: w.w, t: +(w.t + off).toFixed(3), e: +(Math.max(e0, Math.min(nxt - 0.02, w.t + 0.45)) + off).toFixed(3), e0: +(e0 + off).toFixed(3), conf: w.conf };
  });
}

// ---------- HT-Demucs FT (вокал) ----------
// 44.1 кГц стерео, куски по 7,8 с с перекрытием 1/4 и треугольным окном; выход модели [1,4,2,N], вокал — строка 3
const DM = { N: 343980 };
async function demucsVocals(stereo, run, progress) {
  const N = DM.N, OV = Math.floor(N / 4), STRIDE = N - OV, total = stereo[0].length;
  const chunks = Math.max(1, Math.ceil(total / STRIDE)), out = [new Float32Array(total), new Float32Array(total)], wsum = new Float32Array(total);
  const win = new Float32Array(N).fill(1); for (let i = 0; i < OV; i++) { const v = i / OV; win[i] = v; win[N - 1 - i] = v; }
  const buf = new Float32Array(2 * N);
  for (let i = 0; i < chunks; i++) {
    const a = i * STRIDE, b = Math.min(a + N, total), len = b - a; if (len <= 0) break;
    buf.fill(0); for (let c = 0; c < 2; c++) buf.set(stereo[c].subarray(a, b), c * N);
    const stems = await run(buf), vo = 3 * 2 * N;
    // первый кусок без нарастания в начале, последний — без затухания в конце, иначе края трека тише
    for (let c = 0; c < 2; c++) { const row = vo + c * N, o = out[c]; for (let s = 0; s < len; s++) { const w = (i === 0 && s < OV) || (b === total && s >= len - OV) ? 1 : win[s]; o[a + s] += stems[row + s] * w; } }
    for (let s = 0; s < len; s++) { const w = (i === 0 && s < OV) || (b === total && s >= len - OV) ? 1 : win[s]; wsum[a + s] += w; }
    if (progress) progress((i + 1) / chunks);
  }
  for (let c = 0; c < 2; c++) for (let s = 0; s < total; s++) out[c][s] /= Math.max(wsum[s], 1e-8);
  return out;
}

// ---------- BiRefNet (вырезать фон) ----------
// birefnet — лучше, но на 1024×1024 занимает ~6 ГБ памяти; isnet — ~1 ГБ. Нормировка и выход — как в rembg
const BG = { size: 1024, birefnet: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], sigmoid: true }, isnet: { mean: [0.5, 0.5, 0.5], std: [1, 1, 1], sigmoid: false } };
// билинейное масштабирование одного канала
function resize1(src, w, h, W, H) {
  const out = new Float32Array(W * H), sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.min(h - 1, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.min(w - 1, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), dx = fx - x0;
      out[y * W + x] = (src[y0 * w + x0] * (1 - dx) + src[y0 * w + x1] * dx) * (1 - dy) + (src[y1 * w + x0] * (1 - dx) + src[y1 * w + x1] * dx) * dy;
    }
  }
  return out;
}
// px — пиксели 4 байта на точку; order — порядок каналов ('bgra' у Electron, 'rgba' в тестах)
function bgInput(px, w, h, order = 'bgra', kind = 'birefnet') {
  const S = BG.size, K = BG[kind], idx = order === 'bgra' ? [2, 1, 0] : [0, 1, 2], ch = [];
  let mx = 1e-6; for (let c = 0; c < 3; c++) { const a = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { a[i] = px[i * 4 + idx[c]]; if (a[i] > mx) mx = a[i]; } ch.push(a); }
  const out = new Float32Array(3 * S * S);
  for (let c = 0; c < 3; c++) { const r = resize1(ch[c], w, h, S, S); for (let i = 0; i < S * S; i++) out[c * S * S + i] = (r[i] / mx - K.mean[c]) / K.std[c]; }
  return out;
}
// логиты [1024×1024] -> альфа 0..255 размера w×h
function bgAlpha(logits, w, h, kind = 'birefnet') {
  const S = BG.size, p = new Float32Array(S * S), sg = BG[kind].sigmoid; let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < S * S; i++) { const v = sg ? 1 / (1 + Math.exp(-logits[i])) : logits[i]; p[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const d = Math.max(1e-6, mx - mn); for (let i = 0; i < S * S; i++) p[i] = (p[i] - mn) / d;
  const r = resize1(p, S, S, w, h), a = new Uint8ClampedArray(w * h); for (let i = 0; i < w * h; i++) a[i] = Math.round(r[i] * 255);
  return a;
}

module.exports = { melFbanks, BT, beatFeatures, beatFeaturesAsync, beatActivations, gigaV3Features, readVocab, decodeBpeWords, DM, demucsVocals, BG, bgInput, bgAlpha, resize1 };
