// Спектр трека для движка (полоски плеера, диктофон, пульс фона) — то же, что spectrum() в render.py.
(function () {
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  // mono: Float32Array, sr: частота; t0/t1 в секундах
  function spectrum(mono, sr, t0, t1, fps = 30, bands = 24) {
    const n = 2048, win = new Float32Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    const edges = []; for (let i = 0; i <= bands; i++) edges.push(40 * Math.pow(11000 / 40, i / bands));
    const binOf = f => f * n / sr, masks = [];
    for (let b = 0; b < bands; b++) { const lo = Math.ceil(binOf(edges[b])), hi = Math.ceil(binOf(edges[b + 1])); masks.push([lo, Math.max(lo + 1, hi)]); }
    const frames = Math.floor((t1 - t0) * fps) + 1, out = [], re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 0; k < frames; k++) {
      const s0 = Math.floor((t0 + k / fps) * sr);
      for (let i = 0; i < n; i++) { const v = mono[s0 + i]; re[i] = (v === undefined ? 0 : v) * win[i]; im[i] = 0; }
      fft(re, im);
      const row = [];
      for (const [lo, hi] of masks) { let s = 0, c = 0; for (let i = lo; i < hi && i < n / 2; i++) { s += Math.hypot(re[i], im[i]); c++; } row.push(c ? s / c : 0); }
      out.push(row);
    }
    const flat = []; out.forEach(r => r.forEach(v => flat.push(Math.log1p(v * 20))));
    const sorted = flat.slice().sort((a, b) => a - b), p99 = sorted[Math.floor(sorted.length * 0.99)] || 1;
    const data = out.map(r => r.map(v => Math.round(Math.min(1, Math.max(0, Math.log1p(v * 20) / (p99 + 1e-6))) * 100) / 100));
    return { fps, t0, bands, data };
  }
  async function decodeMono(arrayBuffer) {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 22050);
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const sr = buf.sampleRate, L = buf.length, mono = new Float32Array(L);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < L; i++) mono[i] += d[i] / buf.numberOfChannels; }
    return { mono, sr, duration: buf.duration };
  }
  window.Spectrum = { spectrum, decodeMono };
})();
