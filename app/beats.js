// Поиск битов: огибающая атак по трём полосам → темп по автокорреляции → сетка битов динамическим программированием (Эллис, 2007).
// Beats.detect(mono, sr) -> { bpm, beats: [сек...], env: Float32Array (громкость 100 раз в секунду для волны) }
(function () {
  const FPS = 100;
  function onePole(x, sr, fc) { const a = Math.exp(-2 * Math.PI * fc / sr), y = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; } return y; }
  function detect(mono, sr) {
    const hop = Math.round(sr / FPS), n = Math.floor(mono.length / hop);
    const low = onePole(onePole(mono, sr, 150), sr, 150), mid = onePole(mono, sr, 1500);
    const eL = new Float32Array(n), eH = new Float32Array(n), eF = new Float32Array(n), env = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let sl = 0, sh = 0, sf = 0, pk = 0; const o = k * hop;
      for (let i = o; i < o + hop; i++) { const x = mono[i], l = low[i], hgh = x - mid[i]; sl += l * l; sh += hgh * hgh; sf += x * x; const a = x < 0 ? -x : x; if (a > pk) pk = a; }
      eL[k] = Math.log(1e-7 + sl / hop); eH[k] = Math.log(1e-7 + sh / hop); eF[k] = Math.log(1e-7 + sf / hop); env[k] = pk;
    }
    const on = new Float32Array(n);
    for (let k = 1; k < n; k++) on[k] = Math.max(0, eL[k] - eL[k - 1]) + 0.6 * Math.max(0, eH[k] - eH[k - 1]) + 0.4 * Math.max(0, eF[k] - eF[k - 1]);
    // убрать медленный фон и нормировать
    const W = 25, o2 = new Float32Array(n); let acc = 0;
    for (let k = 0; k < n; k++) { acc += on[k]; if (k >= 2 * W + 1) acc -= on[k - 2 * W - 1]; const c = k - W; if (c >= 0) o2[c] = Math.max(0, on[c] - acc / (2 * W + 1)); }
    let sd = 0; for (let k = 0; k < n; k++) sd += o2[k] * o2[k]; sd = Math.sqrt(sd / Math.max(1, n)) || 1;
    for (let k = 0; k < n; k++) o2[k] /= sd;
    // темп
    const minLag = Math.round(FPS * 60 / 180), maxLag = Math.round(FPS * 60 / 66); let best = 0, bestLag = 60;
    for (let L = minLag; L <= maxLag; L++) {
      let s = 0; for (let k = L; k < n; k++) s += o2[k] * o2[k - L];
      const bpm = 60 * FPS / L, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.85, 2));
      const v = s / (n - L) * prior; if (v > best) { best = v; bestLag = L; }
    }
    // уточнить период по параболе
    const P = bestLag, alpha = 400;
    // динамическое программирование
    const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      let mx = 0, arg = -1; const a = t - Math.round(2 * P), b = t - Math.round(P / 2);
      for (let p = Math.max(0, a); p <= b; p++) { const r = Math.log((t - p) / P), v = score[p] - alpha * r * r; if (v > mx || arg < 0) { mx = v; arg = p; } }
      score[t] = o2[t] + (arg >= 0 ? mx : 0); back[t] = arg >= 0 && mx > 0 ? arg : -1;
    }
    let t = 0, m = -1e9; for (let k = Math.max(0, n - 2 * P); k < n; k++) if (score[k] > m) { m = score[k]; t = k; }
    const beats = []; while (t >= 0) { beats.push(t / FPS); t = back[t]; }
    beats.reverse();
    // первые биты до начала музыки (в тишине) выбросить
    const thr = 0.02 * Math.max(...env.slice(0, Math.min(n, FPS * 60)).filter(Number.isFinite), 1e-6);
    const out = beats.filter(b => env[Math.round(b * FPS)] > thr || env[Math.round(b * FPS) + 3] > thr);
    return { bpm: Math.round(60 * FPS / P), beats: out.map(b => +(b + 0.005).toFixed(3)), env, fps: FPS };
  }
  window.Beats = { detect };
})();
