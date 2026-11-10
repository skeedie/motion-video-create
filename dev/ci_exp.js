'use strict';
// временные опыты: как получить кадр нужного размера, когда окно больше экрана (Windows обрезает окно по экрану)
const { BrowserWindow, nativeImage } = require('electron'), fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('таймаут: ' + what)), ms))]);
async function ready(win) { for (let i = 0; i < 300; i++) { if (await win.webContents.executeJavaScript('window.READY===true||!!window.__err')) break; await sleep(100); } await win.webContents.executeJavaScript('document.fonts.ready.then(()=>1)'); }
const frameAt = (win, t) => win.webContents.executeJavaScript(`(window.seekAsync||((t)=>Promise.resolve(seek(t))))(${t.toFixed(5)}).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
module.exports = async function (dir, job, rep) {
  const W = job.W, H = job.H, outW = 1080, outH = 1920, dsf = outW / W, out = rep.exp = [];
  const note = (name, o) => { out.push(Object.assign({ name }, o)); };
  // A: окно без рамки изменения размера
  for (const [name, opts] of [['A1 resizable:false', { resizable: false }], ['A2 thickFrame:false', { thickFrame: false }], ['A3 thickFrame:false+larger', { thickFrame: false, resizable: false, enableLargerThanScreen: true }]]) {
    try { const win = new BrowserWindow(Object.assign({ show: false, width: outW, height: outH, useContentSize: true, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: dsf } }, opts));
      win.setContentSize(outW, outH); await win.loadURL('app://job/engine.html'); win.webContents.setZoomFactor(dsf); await ready(win); await frameAt(win, .9); win.webContents.invalidate(); await sleep(150);
      const img = await win.webContents.capturePage(); note(name, { content: win.getContentSize(), got: img.getSize() }); fs.writeFileSync(path.join(dir, name.slice(0, 2) + '.jpg'), img.toJPEG(80)); win.destroy(); } catch (e) { note(name, { error: e.message }); }
  }
  // B: устройство задаётся через отладчик, окно маленькое
  for (const [name, o] of [['B1 osr beyond', { offscreen: true, beyond: true }], ['B2 osr viewport', { offscreen: true, beyond: false }], ['B3 hidden beyond', { offscreen: false, beyond: true }], ['B4 osr beyond alpha', { offscreen: true, beyond: true, alpha: true }]]) {
    let win = null;
    try { win = new BrowserWindow({ show: false, width: 640, height: 640, useContentSize: true, frame: false, transparent: !!o.alpha, backgroundColor: o.alpha ? '#00000000' : '#000000', webPreferences: { offscreen: o.offscreen, backgroundThrottling: false } });
      if (o.offscreen) win.webContents.setFrameRate(60);
      const dbg = win.webContents.debugger; dbg.attach('1.3');
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dsf, mobile: false });
      if (o.alpha) await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await win.loadURL('app://job/engine.html'); await withTimeout(ready(win), 40000, 'готовность');
      const inner = await win.webContents.executeJavaScript('[innerWidth,innerHeight,devicePixelRatio]');
      const shot = async t => { await withTimeout(frameAt(win, t), 15000, 'кадр'); const p = { format: o.alpha ? 'png' : 'jpeg', captureBeyondViewport: o.beyond }; if (!o.alpha) p.quality = 92; if (o.beyond) p.clip = { x: 0, y: 0, width: W, height: H, scale: 1 }; const r = await withTimeout(dbg.sendCommand('Page.captureScreenshot', p), 20000, 'снимок'); return Buffer.from(r.data, 'base64'); };
      const b = await shot(.9), sz = nativeImage.createFromBuffer(b).getSize(); fs.writeFileSync(path.join(dir, name.slice(0, 2) + (o.alpha ? '.png' : '.jpg')), b);
      const t0 = Date.now(); let n = 0, bytes = 0; for (let i = 0; i < 20; i++) { const x = await shot(.5 + i / 30); n++; bytes += x.length; }
      note(name, { inner, got: sz, msPerFrame: Math.round((Date.now() - t0) / n), kb: Math.round(bytes / n / 1024) });
    } catch (e) { note(name, { error: e.message }); } finally { if (win) try { win.destroy(); } catch (e) {} }
  }
  // C: окно, уменьшенное под экран, с тем же макетом (запасной путь) + время прежнего способа
  try { const { screen } = require('electron'), wa = screen.getPrimaryDisplay().workAreaSize, k = Math.min(1, (wa.width - 40) / outW, (wa.height - 40) / outH), w = Math.floor(outW * k), hh = Math.floor(outH * k);
    const win = new BrowserWindow({ show: false, width: w, height: hh, useContentSize: true, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: w / W } });
    win.webContents.setFrameRate(60); await win.loadURL('app://job/engine.html'); win.webContents.setZoomFactor(w / W); await ready(win); await frameAt(win, .9); win.webContents.invalidate(); await sleep(150);
    const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, 'C1.jpg'), img.toJPEG(80));
    const inner = await win.webContents.executeJavaScript('[innerWidth,innerHeight,devicePixelRatio]');
    const t0 = Date.now(); for (let i = 0; i < 20; i++) { await frameAt(win, .5 + i / 30); win.webContents.invalidate(); (await win.webContents.capturePage()).toJPEG(92); }
    note('C1 fit-to-screen', { k, want: [w, hh], content: win.getContentSize(), got: img.getSize(), inner, msPerFrame: Math.round((Date.now() - t0) / 20) }); win.destroy(); } catch (e) { note('C1', { error: e.message }); }
};
