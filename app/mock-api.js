// Заглушка API для запуска интерфейса в обычном браузере (разработка/проверка). В приложении window.api даёт preload.js.
if (!window.api) {
  const files = {};
  const pick = accept => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); const data = await f.arrayBuffer(); files[f.name] = data; res({ path: f.name, name: f.name, ext: f.name.split('.').pop().toLowerCase(), data }); }; i.click(); });
  const ls = (k, v) => { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); };
  window.api = {
    pickAudio: () => pick('audio/*'),
    pickImage: () => pick('image/*'),
    async pickAudios() { return window.__batchFiles || []; },
    async renderFrame(job) { window.__frames = (window.__frames || []).concat([job]); return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; },
    async saveImage(d, n) { return n + '.png'; },
    pickFont: () => pick('.ttf,.otf,.woff,.woff2'),
    async pickMedia() { const f = await pick('image/*,video/*'); if (!f) return null; const vid = /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name); if (vid) { const u = URL.createObjectURL(new Blob([f.data], { type: 'video/mp4' })); return { kind: 'video', path: u, name: f.name }; } return { kind: 'image', path: f.name, name: f.name, data: f.data }; },
    mediaUrl: p => p,
    async readFile(p) { if (files[p]) return files[p]; const r = await fetch('/__file?path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('нет файла'); return await r.arrayBuffer(); },
    async align(args, onProgress) {
      onProgress && onProgress('Синхронизация (dev-сервер)…');
      const r = await fetch('/__align', { method: 'POST', body: JSON.stringify(args) }); if (!r.ok) throw new Error(await r.text()); return await r.json();
    },
    async transcribe(args, onProgress) { window.__trArgs = args; onProgress && onProgress('Распознаю слова…'); if (!window.__fakeTranscribe) throw new Error('нет распознавания в dev-режиме'); return { words: JSON.parse(JSON.stringify(window.__fakeTranscribe)) }; },
    async netBeats(a) { if (window.__fakeNet) return window.__fakeNet; throw new Error('нет нейросети в dev-режиме'); },
    async removeBg(a, onProgress) { onProgress && onProgress('Нейросеть ищет, где фон…'); window.__bgArg = a; return { dataUrl: a.dataUrl, model: 'isnet' }; },
    async saveProject(json, name, existing) { ls('ls-project', json); return existing || name; },
    async openProject() { const j = ls('ls-project'); return j ? { json: j, path: 'local.lsp' } : null; },
    async recent() { return []; },
    async autosave(json) { ls('ls-autosave', json); return true; },
    async loadAutosave() { const j = ls('ls-autosave'); return j ? { json: j, time: Date.now() } : null; },
    async clearAutosave() { localStorage.removeItem('ls-autosave'); },
    async loadUserPresets() { try { return JSON.parse(ls('ls-presets') || '{}'); } catch (e) { return {}; } },
    async saveUserPresets(p) { ls('ls-presets', JSON.stringify(p)); },
    async loadProfile() { try { return JSON.parse(ls('ls-profile') || '{}'); } catch (e) { return {}; } },
    async saveProfile(p) { ls('ls-profile', JSON.stringify(p)); },
    async saveBundle(json, name) { window.__bundle = json; return name; },
    async gpuInfo() { return null; },
    async loadUserTemplates() { try { return JSON.parse(ls('ls-utpl') || '{}'); } catch (e) { return {}; } },
    async saveUserTemplates(p) { ls('ls-utpl', JSON.stringify(p)); },
    async exportPreset(json, name) { window.__lastPreset = json; return name + '.lspreset'; },
    async importPreset() { return window.__importPreset ? [window.__importPreset] : null; },
    async exportVideo(job, onProgress) { window.__lastJob = job; (window.__jobs = window.__jobs || []).push(job); return window.__fakeExportOk ? { ok: true, path: job.outPath || 'x.mp4', seconds: 1 } : { ok: false }; },
    cancelExport() {},
    async exportFrame(job) { window.__lastFrame = job; return { ok: false }; },
    async pickFolder() { return '/tmp/out'; },
    async showFile() {},
    async captureRect() { return null; },
    async log(level, msg) { (window.__log = window.__log || []).push(level + ' ' + msg); },
    async copyReport(extra) { window.__report = extra; return 1; },
    async openLogFolder() {},
    async version() { return { version: '0.0.0-dev', portable: false }; },
    async checkUpdate() { return window.__fakeUpdate || null; },
    async installUpdate(info, onProgress) { onProgress && onProgress('Скачиваю обновление: 50%'); return { installer: true }; },
    async openExternal() {},
    async selfTest() { return [{ group: 'Компьютер', name: 'Система', level: 'ok', text: 'браузер (dev)' }, { group: 'Видео', name: 'Кодирование видеокартой', level: 'warn', text: 'не найдено — видео кодирует процессор' }, { group: 'Синхронизация', name: 'Модель для английского', level: 'info', text: 'скачается при первой синхронизации' }]; },
    async selfTestExport(job, onProgress) { window.__stJob = job; onProgress && onProgress({ frac: .5, text: 'Кадр 45 из 90 · осталось ~2 с' }); return { ok: true, seconds: 2.1, size: 123456, duration: 3, audio: true, viaCpu: false, gpu: null }; },
    async lastCrash() { return window.__fakeCrash || null; },
    async setLang(l) { window.__lang = l; return true; }
  };
}
