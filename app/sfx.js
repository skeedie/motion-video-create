// Звуковые эффекты: синтез без файлов (WebAudio), дорожка на весь ролик для превью и экспорта.
// SFX.render(events [{t, type, v}], t0, t1) -> Promise<AudioBuffer>; SFX.wav(AudioBuffer) -> ArrayBuffer (16 бит)
(function () {
  const SR = 44100;
  function noiseBuf(ctx, dur) { const b = ctx.createBuffer(1, Math.ceil(SR * dur), SR), d = b.getChannelData(0); let s = 1234567; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; } return b; }
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  const SOUNDS = {
    whoosh(ctx, out, t, v) { const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx, .5); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(3200, t + .28); const g = ctx.createGain(); env(g, t, .12, .5 * v, .3); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + .5); },
    ding(ctx, out, t, v) { [[1318.5, .32], [1975.5, .18], [2637, .08]].forEach(([fr, a]) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr; const g = ctx.createGain(); env(g, t, .005, a * v, .45); o.connect(g).connect(out); o.start(t); o.stop(t + .5); }); },
    pop(ctx, out, t, v) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(180, t + .09); const g = ctx.createGain(); env(g, t, .004, .45 * v, .1); o.connect(g).connect(out); o.start(t); o.stop(t + .15); },
    click(ctx, out, t, v) { const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx, .04); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500; const g = ctx.createGain(); env(g, t, .001, .35 * v, .025); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + .05); },
    tick(ctx, out, t, v) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1760; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; const g = ctx.createGain(); env(g, t, .002, .12 * v, .05); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + .08); },
    blip(ctx, out, t, v) { [880, 1320].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; const g = ctx.createGain(); env(g, t + i * .07, .003, .12 * v, .07); o.connect(f).connect(g).connect(out); o.start(t + i * .07); o.stop(t + i * .07 + .1); }); },
    thump(ctx, out, t, v) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(55, t + .18); const g = ctx.createGain(); env(g, t, .003, .8 * v, .22); o.connect(g).connect(out); o.start(t); o.stop(t + .3);
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx, .08); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; const g2 = ctx.createGain(); env(g2, t, .001, .3 * v, .06); n.connect(f).connect(g2).connect(out); n.start(t); n.stop(t + .1); },
    hit(ctx, out, t, v) { SOUNDS.thump(ctx, out, t, v * .7); SOUNDS.whoosh(ctx, out, t - .02, v * .35); },
    chime(ctx, out, t, v) { [1046.5, 1318.5, 1568, 2093].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr; const g = ctx.createGain(); env(g, t + i * .06, .004, .16 * v, .5); o.connect(g).connect(out); o.start(t + i * .06); o.stop(t + i * .06 + .6); }); },
    ring(ctx, out, t, v) { for (let k = 0; k < 2; k++) { const tt = t + k * .45; [440, 480].forEach(fr => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(.12 * v, tt + .02); g.gain.setValueAtTime(.12 * v, tt + .3); g.gain.exponentialRampToValueAtTime(0.0001, tt + .36); o.connect(g).connect(out); o.start(tt); o.stop(tt + .4); }); } }
  };
  async function render(events, t0, t1) {
    const len = Math.max(1, Math.ceil((t1 - t0) * SR)), ctx = new OfflineAudioContext(2, len, SR), master = ctx.createGain(); master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; master.connect(comp).connect(ctx.destination);
    for (const e of events) { const t = e.t - t0; if (t < 0 || t > t1 - t0) continue; try { (SOUNDS[e.type] || SOUNDS.pop)(ctx, master, Math.max(0.001, t), e.v ?? 1); } catch (x) {} }
    return await ctx.startRendering();
  }
  function wav(buf) {
    const n = buf.length, C = buf.numberOfChannels, out = new ArrayBuffer(44 + n * C * 2), dv = new DataView(out), ch = [...Array(C)].map((_, c) => buf.getChannelData(c));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * C * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, C, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * C * 2, true); dv.setUint16(32, C * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * C * 2, true);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * 32767))), true); o += 2; }
    return out;
  }
  window.SFX = { render, wav, types: Object.keys(SOUNDS) };
})();
