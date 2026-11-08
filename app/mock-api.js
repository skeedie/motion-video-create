// Заглушка API для запуска интерфейса в обычном браузере (разработка/проверка). В приложении window.api даёт preload.js.
if (!window.api) {
  const files = {};
  window.api = {
    async pickAudio() {
      return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*'; i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); const data = await f.arrayBuffer(); files[f.name] = data; res({ path: f.name, name: f.name, data }); }; i.click(); });
    },
    async readFile(p) { if (files[p]) return files[p]; const r = await fetch('/__file?path=' + encodeURIComponent(p)); if (!r.ok) throw new Error('нет файла'); return await r.arrayBuffer(); },
    async align(args, onProgress) {
      onProgress && onProgress('Синхронизация (dev-сервер)…');
      const r = await fetch('/__align', { method: 'POST', body: JSON.stringify(args) }); if (!r.ok) throw new Error(await r.text()); return await r.json();
    },
    async saveProject(json, name) { localStorage.setItem('ls-project', json); return name; },
    async openProject() { const j = localStorage.getItem('ls-project'); return j ? { json: j, path: 'local' } : null; },
    async loadUserPresets() { try { return JSON.parse(localStorage.getItem('ls-presets') || '{}'); } catch (e) { return {}; } },
    async saveUserPresets(p) { localStorage.setItem('ls-presets', JSON.stringify(p)); },
    async exportVideo(job, onProgress) { const r = await fetch('/__export', { method: 'POST', body: JSON.stringify(job) }); if (!r.ok) throw new Error(await r.text()); return await r.json(); },
    cancelExport() {}
  };
}
