// Клавиатура и фокус в редакторе: чтобы поля ввода всегда отвечали на набор.
//  • Focus.eatsKey(el, e) — нажатие нужно самому элементу (поле, список, флажок, ползунок): горячие клавиши молчат.
//  • Focus.typingIn(sel) — человек сейчас печатает в поле внутри sel.
//  • Focus.keep(fn) — перерисовка панели не сбивает набор: если активное поле пересоздано,
//    фокус и курсор переходят на такое же поле на том же месте. Перерисовки панелей (renderScene,
//    renderAll, fillStyle…) оборачиваются этим после загрузки страницы — см. PATCH ниже.
//  • Превью (iframe) не держит фокус клавиатуры: после клика по нему фокус возвращается редактору,
//    а клавиши, нажатые в превью, доходят до горячих клавиш; файл, брошенный на превью, открывается.
(function () {
  const TEXT_TYPES = /^(text|search|url|tel|email|password|number|date|time|datetime-local|month|week)$/;
  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && TEXT_TYPES.test(el.type || 'text');
  }
  function eatsKey(el, e) {
    if (!el || el === document.body || el.nodeType !== 1) return false;
    if (isTextField(el)) return true;
    if (el.tagName !== 'INPUT') return false;
    const t = el.type, k = e ? e.key : '';
    if (e && (e.ctrlKey || e.metaKey || e.altKey)) return t === 'color';
    if (t === 'range') return /^(Arrow|Page|Home|End)/.test(k);              // пробел на ползунке — воспроизведение
    if (t === 'checkbox') return k === ' ';                                   // стрелки на флажке — перемотка
    if (t === 'radio') return k === ' ' || /^Arrow/.test(k);
    return t === 'color';
  }
  const typingIn = sel => { const a = document.activeElement; return isTextField(a) && !!a.closest(sel); };

  // ---- сохранить фокус и курсор при перерисовке ----
  const sig = el => el.tagName + '|' + (el.type || '') + '|' + (el.className || '') + '|' + (el.dataset ? (el.dataset.f || el.dataset.k || '') : '');
  function where(el) {
    const path = []; let n = el;
    while (n && n.parentElement && !n.id) { path.unshift([...n.parentElement.children].indexOf(n)); n = n.parentElement; }
    if (!n || !n.id) return null;
    const same = [...n.querySelectorAll('input,textarea,select,[contenteditable]')].filter(x => sig(x) === sig(el));
    return { host: n.id, path, sig: sig(el), nth: same.indexOf(el) };
  }
  function findAgain(w) {
    const host = document.getElementById(w.host); if (!host) return null;
    let n = host; for (const i of w.path) { n = n && n.children[i]; }
    if (n && sig(n) === w.sig) return n;
    const same = [...host.querySelectorAll('input,textarea,select,[contenteditable]')].filter(x => sig(x) === w.sig);
    return same[w.nth] || (same.length === 1 ? same[0] : null);
  }
  let depth = 0;
  function keep(fn, self, args) {
    if (depth) return fn.apply(self, args);
    const a = document.activeElement;
    if (!isTextField(a)) return fn.apply(self, args);
    let w = null, s0 = null, s1 = null, dir;
    try { w = where(a); s0 = a.selectionStart; s1 = a.selectionEnd; dir = a.selectionDirection; } catch (e) {}
    depth++;
    try { return fn.apply(self, args); }
    finally {
      depth--;
      if (document.activeElement !== a) {
        const el = a.isConnected ? a : (w && findAgain(w));
        if (el && el.getClientRects().length) {
          try { el.focus({ preventScroll: true }); } catch (e) {}
          if (s0 != null && document.activeElement === el) try { el.setSelectionRange(Math.min(s0, el.value.length), Math.min(s1, el.value.length), dir); } catch (e) {}
        }
      }
    }
  }
  // перерисовки, которые пересоздают поля ввода (функции объявлены в app.js глобально)
  const PATCH = ['renderAll', 'renderScene', 'renderFields', 'renderBlocks', 'renderAccents', 'renderStickers', 'fillStyle', 'renderWords', 'renderCuts', 'renderBatch', 'renderQueue', 'renderProfile'];
  function patch() {
    for (const n of PATCH) {
      const f = window[n]; if (typeof f !== 'function' || f.__kept) continue;
      const g = function (...args) { return keep(f, this, args); }; g.__kept = true;
      try { window[n] = g; } catch (e) {}
    }
  }

  // ---- превью: фокус, клавиши, брошенные файлы ----
  function release() {
    const fr = document.getElementById('preview');
    if (fr && document.activeElement === fr) try { fr.blur(); } catch (e) {}
  }
  function hookFrame(fr) {
    let d; try { d = fr.contentDocument; } catch (e) { return; }
    if (!d || d.__kbd) return; d.__kbd = true;
    d.addEventListener('keydown', e => {
      const ev = new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev); if (ev.defaultPrevented) e.preventDefault();
      release();
    });
    d.addEventListener('pointerup', () => setTimeout(release, 0));
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(t => d.addEventListener(t, e => {
      if (!hasFiles(e)) return; e.preventDefault(); // иначе превью само откроет файл
      const ev = new Event(t, { cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: e.dataTransfer }); window.dispatchEvent(ev);
    }));
  }
  function init() {
    patch();
    const fr = document.getElementById('preview');
    if (fr) { fr.addEventListener('load', () => hookFrame(fr)); hookFrame(fr); }
    // невидимый тост не должен ловить клики (класс err остаётся после обычного сообщения)
    const css = document.createElement('style'); css.textContent = '#toast:not(.on){pointer-events:none}'; document.head.append(css);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.Focus = { eatsKey, typingIn, isTextField, keep: fn => keep(fn, null, []) };
})();
