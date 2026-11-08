// Синхронизация текста с треком: GigaAM-v2 CTC + forced alignment (порт align.py на JS).
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19.tar.bz2';

function load16k(ffmpeg, file, from, to) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error'];
    if (from != null) args.push('-ss', String(from));
    if (to != null) args.push('-to', String(to));
    args.push('-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-');
    const p = spawn(ffmpeg, args), chunks = []; let err = '';
    p.stdout.on('data', d => chunks.push(d)); p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg: ' + err.slice(0, 300)));
      const b = Buffer.concat(chunks), n = b.length >> 1, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(i * 2) / 32768;
      resolve(x);
    });
  });
}

// log-mel fbank как в align.py: n=400, hop=160, 64 полосы, окно Ханна, DFT длины 400
function fbank(x, sr = 16000, n = 400, hop = 160, nb = 64) {
  const nf = Math.max(0, 1 + Math.floor((x.length - n) / hop)), half = n / 2;
  const win = new Float64Array(n); for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  const cosT = new Float64Array(half * n), sinT = new Float64Array(half * n);
  for (let k = 0; k < half; k++) for (let i = 0; i < n; i++) { const a = -2 * Math.PI * k * i / n; cosT[k * n + i] = Math.cos(a); sinT[k * n + i] = Math.sin(a); }
  const mel = f => 1127 * Math.log(1 + f / 700), lo = mel(0), hi = mel(8000), d = (hi - lo) / (nb + 1);
  const fm = new Float64Array(half); for (let k = 0; k < half; k++) fm[k] = mel(k * sr / n);
  const W = []; for (let b = 0; b < nb; b++) { const l = lo + b * d, c = lo + (b + 1) * d, r = lo + (b + 2) * d, row = new Float64Array(half);
    for (let k = 0; k < half; k++) { const f = fm[k]; row[k] = (f > l && f < r) ? (f <= c ? (f - l) / (c - l) : (r - f) / (r - c)) : 0; } W.push(row); }
  const eps = 1.1920928955078125e-7, out = new Float32Array(nf * nb), fr = new Float64Array(n), sp = new Float64Array(half);
  for (let t = 0; t < nf; t++) {
    const o = t * hop; for (let i = 0; i < n; i++) fr[i] = x[o + i] * win[i];
    for (let k = 0; k < half; k++) { let re = 0, im = 0; const base = k * n; for (let i = 0; i < n; i++) { re += fr[i] * cosT[base + i]; im += fr[i] * sinT[base + i]; } sp[k] = re * re + im * im; }
    for (let b = 0; b < nb; b++) { let s = 0; const row = W[b]; for (let k = 0; k < half; k++) s += sp[k] * row[k]; out[t * nb + b] = Math.log(Math.max(s, eps)); }
  }
  return { data: out, frames: nf, bands: nb };
}

// runChunk(featuresTransposed Float32Array [64*T], T) -> {data: Float32Array, T2, V}
async function logprobs(F, runChunk) {
  const nb = F.bands, CH = 3000, OV = 400, T = F.frames;
  const sub = (a, b) => { const L = b - a, tr = new Float32Array(nb * L); for (let t = 0; t < L; t++) for (let j = 0; j < nb; j++) tr[j * L + t] = F.data[(a + t) * nb + j]; return runChunk(tr, L); };
  if (T <= CH + OV) return await sub(0, T);
  const parts = []; let pos = 0, V = 0;
  while (pos < T) {
    const a = Math.max(0, pos - OV), b = Math.min(T, pos + CH + OV), r = await sub(a, b); V = r.V;
    const k0 = Math.floor((pos - a) / 4), k1 = Math.min(r.T2, k0 + Math.floor((Math.min(pos + CH, T) - pos) / 4));
    parts.push(r.data.subarray(k0 * V, k1 * V)); pos += CH;
  }
  const tot = parts.reduce((s, p) => s + p.length, 0), data = new Float32Array(tot); let o = 0; for (const p of parts) { data.set(p, o); o += p.length; }
  return { data, T2: tot / V, V };
}

function readTokens(dir) {
  const t = {};
  for (const line of fs.readFileSync(path.join(dir, 'tokens.txt'), 'utf8').split('\n')) {
    if (!line.length) continue;
    const f = line.split(' '); t[+f[f.length - 1]] = (f.length === 1 || f[0] === '') ? ' ' : f[0];
  }
  return t;
}

const LAT = [['sch', 'ш'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['th', 'з'], ['ph', 'ф'], ['kh', 'х'], ['ts', 'ц'], ['oo', 'у'], ['ee', 'и'], ['ea', 'и'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'ё'], ['ck', 'к'], ['qu', 'кв'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'дж'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'й'], ['z', 'з']];
const NUM = { '0': 'ноль', '1': 'один', '2': 'два', '3': 'три', '4': 'четыре', '5': 'пять', '6': 'шесть', '7': 'семь', '8': 'восемь', '9': 'девять', '%': 'процентов', '$': 'долларов', '₽': 'рублей', '&': 'и' };
function spoken(word) {
  const m = word.match(/\{([^}]*)\}/);
  let w = (m ? m[1] : word).toLowerCase().replace(/ё/g, 'е');
  if (!m) { for (const k in NUM) w = w.split(k).join(' ' + NUM[k] + ' '); for (const [a, b] of LAT) w = w.split(a).join(b); }
  return w.replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}
function parseLyrics(text) {
  const words = [], lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  // скобки с пробелами внутри {один ноль} склеиваем в одно слово
  lines.forEach((line, li) => {
    const toks = line.replace(/\{([^}]*)\}/g, (m, g) => '{' + g.replace(/\s+/g, ' ') + '}').split(/\s+/).filter(Boolean);
    for (let tok of toks) {
      tok = tok.replace(/ /g, ' ');
      const disp = tok.replace(/\{[^}]*\}/g, ''), sp = spoken(tok);
      if (!sp && words.length && words[words.length - 1].line === li) { const last = words[words.length - 1]; last.w += /^[,.!?…:;)»"]+$/.test(disp) ? disp : ' ' + disp; continue; }
      words.push({ w: disp, say: sp, line: li });
    }
  });
  return { words, lines };
}
function viterbi(lp, T, V, seq, B) {
  const S = [B]; for (const t of seq) S.push(t, B);
  const N = S.length, NEG = -1e9, skip = new Uint8Array(N);
  for (let i = 2; i < N; i++) skip[i] = (S[i] !== B && S[i] !== S[i - 2]) ? 1 : 0;
  let prev = new Float64Array(N).fill(NEG); prev[0] = lp[S[0]]; if (N > 1) prev[1] = lp[S[1]];
  const bp = new Uint8Array(T * N), cur = new Float64Array(N);
  for (let t = 1; t < T; t++) {
    const row = t * V;
    for (let i = 0; i < N; i++) {
      let best = prev[i], k = 0;
      if (i >= 1 && prev[i - 1] > best) { best = prev[i - 1]; k = 1; }
      if (i >= 2 && skip[i] && prev[i - 2] > best) { best = prev[i - 2]; k = 2; }
      cur[i] = best + lp[row + S[i]]; bp[t * N + i] = k;
    }
    prev.set(cur);
  }
  let n = N > 1 && prev[N - 1] <= prev[N - 2] ? N - 2 : N - 1;
  const p = new Int32Array(T); for (let t = T - 1; t >= 0; t--) { p[t] = n; n -= bp[t * N + n]; }
  return p;
}

// Главная функция. opts: {ffmpeg, modelDir, audioPath, lyrics, from, to, runChunk, progress}
async function align(opts) {
  const P = opts.progress || (() => {});
  P('Читаю звук…');
  const off = opts.from != null ? +opts.from : 0;
  const x = await load16k(opts.ffmpeg, opts.audioPath, opts.from, opts.to), dur = x.length / 16000;
  P('Считаю спектр…'); const F = fbank(x);
  P('Слушаю вокал (нейросеть)…'); const L = await logprobs(F, opts.runChunk);
  const { data: lp, T2: T, V } = L, fs_ = dur / T;
  const tk = readTokens(opts.modelDir), B = Math.max(...Object.keys(tk).map(Number)), c2i = {};
  for (const k in tk) if (tk[k].trim()) c2i[tk[k]] = +k;
  let greedy = '', pv = -1; const ids = new Int32Array(T);
  for (let t = 0; t < T; t++) { let bi = 0, bv = -Infinity; for (let v = 0; v < V; v++) { const q = lp[t * V + v]; if (q > bv) { bv = q; bi = v; } } ids[t] = bi; if (bi !== B && bi !== pv) greedy += tk[bi]; pv = bi; }
  greedy = greedy.replace(/ +/g, ' ').trim();
  P('Расставляю слова…');
  const { words, lines } = parseLyrics(opts.lyrics), seq = [], wid = [];
  words.forEach((w, i) => { for (const ch of w.say) { if (c2i[ch] == null) continue; seq.push(c2i[ch]); wid.push(i); } });
  if (!seq.length) throw new Error('в тексте нет русских букв для выравнивания');
  const pathArr = viterbi(lp, T, V, seq, B), first = {}, last = {}, score = {};
  for (let t = 0; t < T; t++) { const n = pathArr[t]; if (n % 2 === 1) { const j = (n - 1) >> 1; if (first[j] == null) first[j] = t; last[j] = t; (score[wid[j]] = score[wid[j]] || []).push(lp[t * V + seq[j]]); } }
  for (const j in first) if (words[wid[j]].t == null) words[wid[j]].t = +(first[j] * fs_).toFixed(3);
  for (const j in last) words[wid[j]].e = +((last[j] + 1) * fs_).toFixed(3);
  words.forEach((w, i) => { if (w.t == null) { w.t = i ? words[i - 1].e : 0; w.e = w.t + 0.1; } const s = score[i] || [-9]; w.conf = +Math.exp(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2); });
  words.forEach((w, i) => { const nxt = i + 1 < words.length ? words[i + 1].t : dur; w.e = +Math.max(w.e, Math.min(nxt, w.t + 1.2)).toFixed(3); });
  const confs = words.map(w => w.conf).sort((a, b) => a - b), median = confs.length ? confs[Math.floor(confs.length / 2)] : 0;
  words.forEach(w => { w.t = +(w.t + off).toFixed(3); w.e = +(w.e + off).toFixed(3); delete w.say; });
  return { words, lines, transcript: greedy, median, duration: null };
}

module.exports = { align, fbank, viterbi, parseLyrics, spoken, readTokens, logprobs, load16k, MODEL_URL };
