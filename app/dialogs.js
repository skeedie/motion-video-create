// Свои окна подтверждения внутри страницы вместо confirm()/alert()/prompt().
// Встроенные окна в Electron (Windows) после закрытия возвращают фокус окну, но не странице —
// поля ввода перестают отвечать на клавиатуру. Эти окна — обычная разметка (.modal/.mbox), фокус
// остаётся в странице и после закрытия возвращается на элемент, который был активен до окна.
//   await Dialogs.confirm(text, { ok, cancel, danger }) → true / false
//   await Dialogs.alert(text, { ok })
//   await Dialogs.prompt(text, value, { ok, cancel, placeholder }) → строка или null
// Enter — подтвердить (на кнопке «Отмена» — отменить), Esc и клик мимо окна — отмена.
(function () {
  const T = s => (window.T ? window.T(s) : s);
  const css = document.createElement('style');
  css.textContent = '.dlg{z-index:150}.dlg .mbox{width:min(440px,92vw)}.dlg .dlgText{white-space:pre-wrap;line-height:1.45;margin:2px 0 14px}.dlg .dlgIn{width:100%;margin:-4px 0 14px}'
    + '.dlg .dlgBtns{display:flex;gap:8px;justify-content:flex-end}.dlg .dlgBtns button{min-width:92px}.dlg button.danger{background:var(--red);border-color:var(--red);font-weight:700;color:#fff}'
    + '.dlg button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}';
  document.head.append(css);
  const queue = []; let busy = false;
  // окна не накладываются друг на друга: следующее откроется, когда закроется текущее
  function open(kind, text, o) {
    return new Promise(res => { queue.push({ kind, text, o: o || {}, res }); next(); });
  }
  function next() {
    if (busy || !queue.length) return; busy = true;
    const { kind, text, o, res } = queue.shift(), prev = document.activeElement;
    const ov = document.createElement('div'); ov.className = 'modal dlg'; ov.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="mbox"><div class="dlgText" data-notr></div>' + (kind === 'prompt' ? '<input class="dlgIn" data-notr>' : '')
      + '<div class="dlgBtns">' + (kind === 'alert' ? '' : '<button class="dlgNo"></button>') + '<button class="dlgOk"></button></div></div>';
    const box = ov.firstChild, okB = ov.querySelector('.dlgOk'), noB = ov.querySelector('.dlgNo'), inp = ov.querySelector('.dlgIn');
    ov.querySelector('.dlgText').textContent = T(String(text ?? ''));
    okB.textContent = T(o.ok || 'OK'); okB.className = 'dlgOk ' + (o.danger ? 'danger' : 'primary');
    if (noB) noB.textContent = T(o.cancel || 'Отмена');
    if (inp) { inp.value = o.value ?? ''; if (o.placeholder) inp.placeholder = T(o.placeholder); }
    const done = ok => {
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', stop, true); window.removeEventListener('keypress', stop, true);
      ov.remove(); busy = false;
      // фокус — туда, где он был до окна (если тот элемент ещё на экране)
      try { if (prev && prev !== document.body && prev.isConnected && prev.getClientRects().length && typeof prev.focus === 'function') prev.focus({ preventScroll: true }); } catch (e) {}
      res(kind === 'prompt' ? (ok ? inp.value : null) : kind === 'alert' ? undefined : !!ok);
      setTimeout(next, 0);
    };
    const focusables = () => [...box.querySelectorAll('input,button')];
    // клавиши, пока окно открыто, не доходят до горячих клавиш редактора
    const stop = e => e.stopPropagation();
    function onKey(e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(kind === 'alert'); return; }
      if (e.key === 'Enter' && !e.isComposing && !e.repeat) { e.preventDefault(); done(document.activeElement !== noB); return; }
      if (e.key === 'Tab') { // фокус не уходит из окна
        const f = focusables(), i = f.indexOf(document.activeElement); e.preventDefault();
        f[(i < 0 ? 0 : i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); return;
      }
      if (!ov.contains(document.activeElement)) { e.preventDefault(); (inp || okB).focus(); }
    }
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', stop, true); window.addEventListener('keypress', stop, true);
    okB.onclick = () => done(true); if (noB) noB.onclick = () => done(false);
    ov.addEventListener('mousedown', e => { if (e.target === ov) { e.preventDefault(); done(kind === 'alert'); } });
    document.body.append(ov);
    if (inp) { inp.focus(); inp.select(); } else okB.focus();
  }
  window.Dialogs = {
    confirm: (text, o) => open('confirm', text, o),
    alert: (text, o) => open('alert', text, o),
    prompt: (text, value, o) => open('prompt', text, Object.assign({}, o, { value })),
    get open() { return busy; }
  };
})();
