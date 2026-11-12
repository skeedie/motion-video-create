"""Общее для тестов: проверка с понятным сообщением и окно редактора (App)."""
import json, os

from track import DURATION


class Fail(AssertionError):
    pass


def check(cond, msg, *details):
    if not cond:
        raise Fail(msg + ((' :: ' + ' | '.join(json.dumps(d, ensure_ascii=False, default=str)[:600] for d in details)) if details else ''))


# Сообщения консоли, которые не считаются ошибкой (отсутствующие миниатюры и т. п. в dev-режиме)
CONSOLE_NOISE = ('404', 'Failed to load resource', 'net::ERR_')


class Env:
    """Общие для всех тестов параметры: адрес сервера, трек, слова, папка для скриншотов."""
    def __init__(self, port, track, words, shots):
        self.port, self.track, self.words, self.shots = port, track, words, shots
        self.base = f'http://127.0.0.1:{port}/'


class App:
    """Открытое окно редактора: страница + накопленные ошибки страницы."""
    def __init__(self, env, browser, lang='ru', viewport=(1500, 940)):
        self.env = env
        self.ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]})
        self.page = self.ctx.new_page()
        self.errors = []  # pageerror и console.error
        self.page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        self.page.on('console', lambda m: self.errors.append('console: ' + m.text)
                     if m.type == 'error' and not any(n in m.text for n in CONSOLE_NOISE) else None)
        self.page.on('dialog', lambda d: d.accept())
        self.page.add_init_script(f"try{{localStorage.setItem('ls-lang','{lang}')}}catch(e){{}}")
        self.page.goto(self.env.base + 'index.html')
        self.page.wait_for_function('window.__ls', timeout=30000)
        # подтверждения в приложении — свои окна (Dialogs): в тестах отвечаем «да» и запоминаем вопрос
        self.page.evaluate("(()=>{ window.__dlg=[]; if(window.Dialogs){ Dialogs.confirm=async(t)=>{ __dlg.push(String(t)); return true; }; Dialogs.alert=async(t)=>{ __dlg.push(String(t)); }; } })()")

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def load_track(self):
        self.js("async(p)=>{ await __ls.loadAudio({path:p,name:'test-track.mp3'}); __ls.proj.duration=%s; }" % DURATION, self.env.track)
        self.wait(800)

    def set_words(self, preview=True):
        self.js("(W)=>{ const P=__ls.proj; P.words=JSON.parse(JSON.stringify(W)); __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); %s }"
                % ('__ls.rebuildPreview();' if preview else ''), self.env.words)
        self.wait(600 if preview else 200)

    def ready(self, preview=True):
        """Трек загружен, слова расставлены, сцены собраны."""
        self.load_track(); self.set_words(preview)
        return self

    def fresh_preview(self, timeout=20000):
        """Пересобрать превью и дождаться нового (не старого) окна движка."""
        self.js("async()=>{ const w=document.querySelector('#preview').contentWindow; if(w) w.__stale=1; await __ls.rebuildPreview(); }")
        self.page.wait_for_function("(()=>{ const w=document.querySelector('#preview').contentWindow; return w && !w.__stale && w.READY===true && !!(w.seek||w.seekAsync) })()", timeout=timeout)

    def preview_seek(self, t):
        self.js("(t)=>{ const w=document.querySelector('#preview').contentWindow; return w.seekAsync ? w.seekAsync(t) : w.seek(t) }", t)

    def tab(self, name):
        self.js("(n)=>{ const b=document.querySelector(`.tabs button[data-tab=\"${n}\"]`); if(!b) throw new Error('нет вкладки '+n); b.click(); }", name)
        self.wait(150)

    def menu(self, btn, act):
        self.page.click(btn); self.page.click(f'{MENUS[btn]} button[data-act={act}]')
        self.wait(250)

    def no_errors(self, what=''):
        check(not self.errors, 'ошибки страницы' + (f' ({what})' if what else ''), self.errors[:8])

    def shot(self, name):
        try:
            self.page.screenshot(path=os.path.join(self.env.shots, name + '.png'))
        except Exception:
            pass

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass


MENUS = {'#bNew': '#newMenu', '#bSave': '#saveMenu', '#bHelp': '#helpMenu', '#bOpen': '#openMenu'}
