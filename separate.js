// Отделение вокала от бита: MDX-Net (UVR, Kim Vocal 2), STFT 7680 / hop 1024, 3072 полосы × 256 кадров — как в UVR/audio-separator.
'use strict';
const fs = require('fs'), { spawn } = require('child_process');

const MDX = { url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx', file: 'Kim_Vocal_2.onnx', nfft: 7680, hop: 1024, dimF: 3072, dimT: 256, sr: 44100, compensate: 1.009 };

// ---------- БПФ смешанного основания (2,3,4,5) ----------
function makeFFT(N) {
  const fac = []; let n = N; for (const p of [4, 2, 3, 5]) while (n % p === 0) { fac.push(p); n /= p; }
  if (n !== 1) throw new Error('FFT: неподдерживаемая длина ' + N);
  const cs = new Float64Array(N), sn = new Float64Array(N);
  for (let i = 0; i < N; i++) { cs[i] = Math.cos(-2 * Math.PI * i / N); sn[i] = Math.sin(-2 * Math.PI * i / N); }
  const tr = new Float64Array(5), ti = new Float64Array(5);
  function rec(n, fi, xr, xi, io, is, yr, yi, oo) {
    if (n === 1) { yr[oo] = xr[io]; yi[oo] = xi[io]; return; }
    const p = fac[fi], m = n / p, step = N / n;
    for (let q = 0; q < p; q++) rec(m, fi + 1, xr, xi, io + q * is, is * p, yr, yi, oo + q * m);
    const ps = N / p;
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) { const a = yr[oo + q * m + k], b = yi[oo + q * m + k], w = (q * k * step) % N, c = cs[w], s = sn[w]; tr[q] = a * c - b * s; ti[q] = a * s + b * c; }
      for (let s2 = 0; s2 < p; s2++) { let re = 0, im = 0; for (let q = 0; q < p; q++) { const w = (q * s2 * ps) % N, c = cs[w], s = sn[w]; re += tr[q] * c - ti[q] * s; im += tr[q] * s + ti[q] * c; } yr[oo + s2 * m + k] = re; yi[oo + s2 * m + k] = im; }
    }
  }
  return (xr, xi, yr, yi) => rec(N, 0, xr, xi, 0, 1, yr, yi, 0);
}

function makeSTFT(cfg) {
  const { nfft: N, hop, dimF, dimT } = cfg, fft = makeFFT(N), win = new Float64Array(N), half = N / 2;
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const xr = new Float64Array(N), xi = new Float64Array(N), yr = new Float64Array(N), yi = new Float64Array(N);
  const L = hop * (dimT - 1), padded = new Float64Array(L + N);
  // x (L сэмплов) -> out[ch*2 + 0/1][f][t] записывается в dst с offset (layout [4][dimF][dimT])
  function forward(x, dst, chOff) {
    for (let i = 0; i < L; i++) padded[half + i] = x[i];
    for (let i = 1; i <= half; i++) { padded[half - i] = x[Math.min(L - 1, i)]; padded[half + L - 1 + i] = x[Math.max(0, L - 1 - i)]; }
    for (let t = 0; t < dimT; t++) {
      const o = t * hop; for (let i = 0; i < N; i++) { xr[i] = padded[o + i] * win[i]; xi[i] = 0; }
      fft(xr, xi, yr, yi);
      for (let f = 0; f < dimF; f++) { dst[(chOff * dimF + f) * dimT + t] = yr[f]; dst[((chOff + 1) * dimF + f) * dimT + t] = yi[f]; }
    }
  }
  const acc = new Float64Array(L + N), env = new Float64Array(L + N);
  for (let t = 0; t < dimT; t++) for (let i = 0; i < N; i++) env[t * hop + i] += win[i] * win[i];
  // обратное: src layout [4][dimF][dimT], каналы chOff (re) и chOff+1 (im) -> out (L сэмплов)
  function inverse(src, chOff, out) {
    acc.fill(0);
    for (let t = 0; t < dimT; t++) {
      xr.fill(0); xi.fill(0);
      for (let f = 0; f < dimF; f++) { const re = src[(chOff * dimF + f) * dimT + t], im = src[((chOff + 1) * dimF + f) * dimT + t]; xr[f] = re; xi[f] = -im; if (f > 0) { xr[N - f] = re; xi[N - f] = im; } }
      fft(xr, xi, yr, yi); // conj(X) -> БПФ -> conj = обратное ×N; нужна только действительная часть
      const o = t * hop; for (let i = 0; i < N; i++) acc[o + i] += yr[i] / N * win[i];
    }
    for (let i = 0; i < L; i++) { const e = env[half + i]; out[i] = e > 1e-11 ? acc[half + i] / e : 0; }
  }
  return { forward, inverse, L };
}

// stereo: [Float32Array left, Float32Array right] 44.1 кГц. run(Float32Array [1,4,dimF,dimT]) -> Float32Array той же формы
async function separate(stereo, run, progress) {
  const cfg = MDX, st = makeSTFT(cfg), L = st.L, trim = cfg.nfft / 2, gen = L - 2 * trim, n = stereo[0].length;
  const pad = gen + trim - (n % gen), total = trim + n + pad, chans = stereo.map(c => { const p = new Float32Array(total); p.set(c, trim); return p; });
  const out = [new Float32Array(n + gen), new Float32Array(n + gen)], inp = new Float32Array(4 * cfg.dimF * cfg.dimT), tmp = new Float64Array(L);
  const steps = Math.ceil((n + pad) / gen); let k = 0;
  for (let i = 0; i + L <= total; i += gen, k++) {
    progress && progress(k / steps);
    for (let c = 0; c < 2; c++) st.forward(chans[c].subarray(i, i + L), inp, c * 2);
    const res = await run(inp, [1, 4, cfg.dimF, cfg.dimT]);
    for (let c = 0; c < 2; c++) { st.inverse(res, c * 2, tmp); const o = out[c]; for (let j = 0; j < gen && i + j < o.length; j++) o[i + j] = tmp[trim + j] * cfg.compensate; }
  }
  progress && progress(1);
  return out.map(o => o.subarray(0, n));
}

function loadStereo44(ffmpeg, file, from, to) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error']; if (from != null) args.push('-ss', String(from)); if (to != null) args.push('-to', String(to));
    args.push('-i', file, '-ac', '2', '-ar', '44100', '-f', 'f32le', '-');
    const p = spawn(ffmpeg, args, { windowsHide: true }), ch = []; let err = '';
    p.stdout.on('data', d => ch.push(d)); p.stderr.on('data', d => err += d); p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg: ' + err.slice(0, 300)));
      const b = Buffer.concat(ch), n = b.length >> 3, l = new Float32Array(n), r = new Float32Array(n);
      for (let i = 0; i < n; i++) { l[i] = b.readFloatLE(i * 8); r[i] = b.readFloatLE(i * 8 + 4); }
      resolve([l, r]);
    });
  });
}
function writeWav(file, chans, sr) {
  const n = chans[0].length, C = chans.length, data = Buffer.alloc(n * C * 2);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), (i * C + c) * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(C, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * C * 2, 28); h.writeUInt16LE(C * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
module.exports = { MDX, makeFFT, makeSTFT, separate, loadStereo44, writeWav };
