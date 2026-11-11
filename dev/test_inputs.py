# Проверка полей ввода: каждое видимое поле принимает набор с клавиатуры, фокус не теряется,
# поле не пересоздаётся; горячие клавиши не срабатывают из полей; после окон, превью,
# перетаскивания и экспорта клавиатура работает.
# Запуск: python3 dev/test_inputs.py 8771   (нужен dev/server.py на этом порту)
import json, asyncio, sys
from playwright.async_api import async_playwright

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
URL = f'http://127.0.0.1:{PORT}/index.html'
AUDIO = '/mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3'
W = json.load(open('/root/work/t8/words.json')); W = W['words'] if isinstance(W, dict) else W
for w in W: w.pop('say', None); w.pop('conf', None)

TEXT = 'sm g?Ms Gx'      # 10 символов: пробелы и буквы горячих клавиш (S, M, G, ?)
NUM = '1234567.25'       # 10 символов для числовых полей
FIELDS = 'input:not([type]),input[type=text],input[type=number],input[type=search],textarea,select'

# состояние, которое меняют горячие клавиши: если буква «просочилась» из поля, оно изменится
STATE = """() => ({ scenes: __ls.proj.scenes.length, play: document.querySelector('#bPlay').textContent,
  gallery: document.querySelector('#gallery').hidden, keys: document.querySelector('#keysModal').hidden })"""
# путь до элемента от ближайшего предка с id: так видно, что фокус на «том же» поле после перерисовки
JS_HELPERS = """
window.__pathOf = el => { const p = []; let n = el; while (n && n.parentElement && !n.id) { p.unshift([...n.parentElement.children].indexOf(n)); n = n.parentElement; } return (n && n.id ? '#' + n.id : '?') + '/' + p.join('.'); };
window.__desc = el => el ? (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' ' + __pathOf(el)) : 'null';
"""

R = []  # (имя, ок, подробности)
def check(name, ok, info=''):
    R.append((name, bool(ok), info)); print(('OK   ' if ok else 'FAIL ') + name + ('' if ok else '  →  ' + str(info)), flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1500, 'height': 940}); pg = await ctx.new_page(); pg.set_default_timeout(8000)
        errs, native = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        def on_dialog(d): native.append(d.message); asyncio.ensure_future(d.dismiss())
        pg.on('dialog', on_dialog)
        await pg.add_init_script("try{localStorage.setItem('ls-lang','ru'); localStorage.removeItem('ls-autosave')}catch(e){}")
        await pg.goto(URL); await pg.wait_for_function('window.__ls')
        await pg.evaluate(JS_HELPERS)
        await pg.evaluate("async a => { await __ls.loadAudio({path:a,name:'serega.mp3'}); __ls.proj.duration=73.37; }", AUDIO); await pg.wait_for_timeout(1500)
        await pg.evaluate("W => { const P=__ls.proj; P.words=W; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); __ls.rebuildPreview(); }", W)
        await pg.wait_for_timeout(1500)

        async def state(): return await pg.evaluate(STATE)
        async def reset():
            # после проваленной проверки буквы могли открыть окна — закрываем, чтобы следующие проверки шли честно
            await pg.evaluate("() => { ['#gallery', '#keysModal', '#exportModal', '#profileModal', '#batchModal', '#wordMenu'].forEach(s => document.querySelector(s).hidden = true); document.querySelectorAll('.dlg').forEach(d => d.remove()); }")
            await stop_play()
        async def stop_play():
            if await pg.evaluate("document.querySelector('#bPlay').textContent") != '▶': await pg.click('#bPlay')

        async def type_into(el, name, restore=True):
            """клик, набор 10 символов, проверка значения, фокуса и того, что поле не пересоздано"""
            info = await el.evaluate("e => ({tag: e.tagName, type: e.type, val: e.value, ro: e.readOnly || e.disabled, n: e.options ? e.options.length : 0})")
            if info['ro']: return
            await el.scroll_into_view_if_needed()
            s0 = await state()
            if info['tag'] == 'SELECT':
                # выпадающий список: стрелкой с клавиатуры (клик открыл бы системный список)
                await el.focus()
                key = 'ArrowDown' if await el.evaluate("e => e.selectedIndex < e.options.length - 1 && e.options[e.selectedIndex + 1].value !== '__load'") else 'ArrowUp'
                await el.evaluate("e => { window.__pid = e.__pid = 'P' + Math.random(); window.__ppath = __pathOf(e); }")
                await pg.keyboard.press(key); await pg.wait_for_timeout(400)
                r = await pg.evaluate("() => { const a = document.activeElement; return { same: !!a && a.__pid === window.__pid, equiv: !!a && a.tagName === 'SELECT' && __pathOf(a) === window.__ppath, bk: !!a && a.classList.contains('bkAdd'), val: a && a.value, now: __desc(a) } }")
                ok = (r['bk'] and r['val'] == '') if 'bkAdd' in name else r['equiv'] and (info['n'] < 2 or r['val'] != info['val'])
                check(f'список {name}: стрелка меняет значение, фокус остаётся', ok, r)
                return
            await el.click(); await pg.wait_for_timeout(50)
            if not await el.evaluate("e => e === document.activeElement"):
                check(f'поле {name}: клик даёт фокус', False, await pg.evaluate("__desc(document.activeElement)")); return
            await el.evaluate("e => { window.__pid = e.__pid = 'P' + Math.random(); }")
            await pg.keyboard.press('Control+A')
            txt = NUM if info['type'] == 'number' else TEXT
            for i, ch in enumerate(txt):
                await pg.keyboard.type(ch)
                await pg.wait_for_timeout(35)
            await pg.wait_for_timeout(700)  # отложенная перестройка превью и перерисовки
            r = await pg.evaluate("() => { const a = document.activeElement; return { same: !!a && a.__pid === window.__pid, val: a && a.value, now: __desc(a), caret: a && (() => { try { return a.selectionStart } catch (e) { return null } })() } }")
            s1 = await state()
            ok = r['same'] and r['val'] == txt and s0 == s1
            check(f'поле {name}: набор «{txt}»', ok, {'r': r, 'hotkeys': None if s0 == s1 else [s0, s1]})
            if restore:
                await el.evaluate("(e, v) => { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); e.blur(); }", info['val'])
                await pg.wait_for_timeout(120)

        async def all_fields(root, prefix):
            # поля ищутся заново перед каждым: панель могла перерисоваться (например, «+ добавить блок»)
            seen, i, done = 0, 0, set()
            while True:
                hs = await pg.query_selector_all(f'{root} :is({FIELDS})')
                if i >= len(hs): return seen
                h = hs[i]; i += 1
                if not await h.evaluate("e => e.isConnected && !!(e.offsetWidth || e.offsetHeight) && getComputedStyle(e).visibility !== 'hidden'"): continue
                name = await h.evaluate("e => __desc(e)")
                if 'bkAdd' in name:  # «+ добавить блок» добавляет блок и перерисовывает список — проверяется один раз
                    if 'bkAdd' in done: continue
                    done.add('bkAdd')
                try: await type_into(h, prefix + ' ' + name)
                except Exception as x: check(f'поле {prefix} {name}', False, str(x).split(chr(10))[0])
                seen += 1

        async def tab(side, t):
            await pg.click(f'#{side} .tabs button[data-tab={t}]'); await pg.wait_for_timeout(150)
            await pg.evaluate(f"document.querySelectorAll('#{side} details').forEach(d => d.open = true)")

        # ---------- 1. все поля левой панели ----------
        await tab('left', 'track'); n = await all_fields('#left', 'слева/трек')
        await tab('left', 'words'); n += await all_fields('#left', 'слева/слова')
        await pg.evaluate("openWordMenu(3, 400, 500)"); await pg.wait_for_timeout(100)
        n += await all_fields('#wordMenu', 'меню слова'); await pg.evaluate("document.querySelector('#wordMenu').hidden = true")
        await tab('left', 'track')

        # ---------- 2. правая панель: сцена (обычный шаблон, акценты, стикеры, имя шаблона) ----------
        await tab('right', 'scene')
        await pg.evaluate("() => { const P = __ls.proj; P.scenes[0].tpl = 'imsg-dialog'; P.scenes[0].f = {}; P.scenes[0].accents = [{k:'bump',at:''},{k:'stamp',v:'ОК',at:''},{k:'fx',v:'🔥',at:''}]; __ls.seekTo(P.words[P.scenes[0].a].t + .2); __ls.renderAll(); }")
        await pg.click('#stText'); await pg.click('#stEmoji'); await pg.click('#seSaveTpl'); await pg.wait_for_timeout(300)
        n += await all_fields('#right', 'справа/сцена')
        # шаблон-конструктор: поля блоков
        await pg.evaluate("() => { const P = __ls.proj; P.scenes[0].tpl = 'blocks'; P.scenes[0].f = {}; __ls.renderAll(); }"); await pg.wait_for_timeout(300)
        n += await all_fields('#seFields', 'справа/блоки')
        await tab('right', 'style'); n += await all_fields('#right', 'справа/стиль')
        await tab('right', 'fx'); n += await all_fields('#right', 'справа/эффекты')
        await tab('right', 'scene')
        # профиль и пакет треков — поля в модальных окнах
        await pg.click('#bProfile'); await pg.wait_for_timeout(150); n += await all_fields('#profileModal', 'профиль'); await pg.evaluate("document.querySelector('#profileModal').hidden = true")
        check(f'проверено полей: {n}', n >= 40, n)

        # ---------- 3. перерисовки во время набора ----------
        await pg.evaluate("() => { const P = __ls.proj; P.scenes[0].tpl = 'imsg-dialog'; P.scenes[0].f = {}; __ls.renderAll(); }"); await pg.wait_for_timeout(200)
        fld = await pg.query_selector('#seFields input:not([type=color]):not([type=number])')
        await fld.click(); await pg.keyboard.press('Control+A'); await pg.evaluate("window.__ppath = __pathOf(document.activeElement)")
        await pg.keyboard.type('abcde', delay=30)
        await pg.evaluate("__ls.renderAll()")   # так перерисовывает панель конец синхронизации / распознавания
        await pg.keyboard.type('fghij', delay=30); await pg.wait_for_timeout(500)
        r = await pg.evaluate("() => { const a = document.activeElement; return { path: __pathOf(a), want: window.__ppath, val: a.value, caret: a.selectionStart } }")
        check('перерисовка панели сцены во время набора: фокус и курсор на месте', r['path'] == r['want'] and r['val'] == 'abcdefghij' and r['caret'] == 10, r)

        await reset()
        # смена вида акцента с клавиатуры (строка акцента перерисовывается)
        await pg.evaluate("() => { const P = __ls.proj; P.scenes[0].accents = [{k:'bump',at:''}]; __ls.renderAll(); }"); await pg.wait_for_timeout(150)
        await type_into(await pg.query_selector('#seAccList [data-f=k]'), 'вид акцента')

        await reset()
        # воспроизведение переходит в следующую сцену, а человек печатает в поле сцены
        await pg.evaluate("() => { const P = __ls.proj; __ls.seekTo(P.words[P.scenes[0].a].t + .1); __ls.renderAll(); }"); await pg.wait_for_timeout(200)
        await pg.click('#bPlay'); await pg.wait_for_timeout(200)
        fld = await pg.query_selector('#seStamp') if await pg.is_visible('#seStamp') else await pg.query_selector('#seFields input:not([type=color])')
        await fld.click(); await pg.keyboard.press('Control+A'); await pg.evaluate("window.__pid = document.activeElement.__pid = 'P' + Math.random()")
        await pg.keyboard.type('abcde', delay=30)
        await pg.evaluate("() => { const P = __ls.proj; __ls.seekTo(P.words[P.scenes[2].a].t + .2); }"); await pg.wait_for_timeout(300)
        await pg.keyboard.type('fghij', delay=30); await pg.wait_for_timeout(300)
        r = await pg.evaluate("() => { const a = document.activeElement; return { same: a.__pid === window.__pid, val: a.value, now: __desc(a) } }")
        await stop_play()
        check('воспроизведение: поле сцены не пересоздаётся под пальцами', r['same'] and r['val'] == 'abcdefghij', r)
        await pg.evaluate("document.activeElement.blur()")

        await reset()
        # пакет треков: строка прогресса перерисовывает список, а в соседнем треке печатают текст
        await pg.evaluate("window.__batchFiles = [{path:'/a/1.mp3',name:'1.mp3'},{path:'/a/2.mp3',name:'2.mp3'}]")
        await pg.click('#bNew'); await pg.click('#newMenu button[data-act=batch]'); await pg.click('#bmAdd'); await pg.wait_for_timeout(200)
        ta = (await pg.query_selector_all('#bmList textarea'))[1]
        await ta.click(); await pg.evaluate("window.__ppath = __pathOf(document.activeElement)")
        await pg.keyboard.type('abcde', delay=30); await pg.evaluate("renderBatch()"); await pg.keyboard.type('fghij', delay=30)
        r = await pg.evaluate("() => { const a = document.activeElement; return { path: __pathOf(a), want: window.__ppath, val: a.value } }")
        check('пакет треков: перерисовка списка не сбивает набор', r['path'] == r['want'] and r['val'] == 'abcdefghij', r)
        await pg.click('#bmClose')

        await reset()
        # ---------- 4. горячие клавиши и элементы без набора текста ----------
        await pg.focus('#snapBeats'); c0 = await pg.is_checked('#snapBeats'); s0 = await state()
        await pg.keyboard.press('Space'); await pg.wait_for_timeout(150)
        check('пробел на флажке переключает флажок, а не воспроизведение', await pg.is_checked('#snapBeats') != c0 and (await state())['play'] == s0['play'], [c0, s0, await state()])
        await stop_play()
        await tab('right', 'style'); await pg.focus('#beat'); v0 = await pg.input_value('#beat'); t0 = await pg.evaluate("document.querySelector('#tCur').textContent")
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(150)
        check('стрелка на ползунке двигает ползунок, а не перемотку', await pg.input_value('#beat') != v0 and await pg.evaluate("document.querySelector('#tCur').textContent") == t0, [v0, await pg.input_value('#beat')])
        await tab('right', 'scene')
        await pg.evaluate("() => { const d = document.createElement('div'); d.id = 'ceProbe'; d.contentEditable = 'true'; d.style.cssText = 'position:fixed;left:10px;top:10px;width:200px;height:30px;background:#333;z-index:40'; document.body.append(d); }")
        await pg.click('#ceProbe'); s0 = await state(); await pg.keyboard.type('s m g', delay=20); await pg.wait_for_timeout(150)
        r = await pg.evaluate("document.querySelector('#ceProbe').textContent")
        check('contenteditable: буквы горячих клавиш набираются', r == 's m g' and await state() == s0, [r, s0, await state()])
        await pg.evaluate("document.querySelector('#ceProbe').remove()"); await reset()
        await pg.click('#bProfile'); await pg.focus('#pfApply'); s0 = await state(); await pg.keyboard.press('KeyS'); await pg.keyboard.press('KeyG'); await pg.wait_for_timeout(150)
        check('открыто модальное окно: горячие клавиши редактора не срабатывают', await state() == s0, [s0, await state()])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        check('Esc закрывает окно профиля', await pg.evaluate("document.querySelector('#profileModal').hidden"))
        await pg.evaluate("document.querySelector('#profileModal').hidden = true")

        await reset()
        # ---------- 5. своё окно подтверждения вместо confirm() ----------
        native.clear()
        await pg.click('#bAutoScenes'); await pg.wait_for_timeout(200)
        dlg = await pg.evaluate("() => { const d = document.querySelector('.dlg:not([hidden])'); return d ? { text: d.textContent.slice(0, 60), focus: __desc(document.activeElement), inDlg: d.contains(document.activeElement) } : null }")
        check('«Разбить на сцены заново» спрашивает своим окном внутри страницы', dlg and dlg['inDlg'] and not native, [dlg, native])
        if dlg:
            await pg.evaluate("__ls.proj.scenes[0].tpl = 'toggles'")
            await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
            r = await pg.evaluate("() => ({ dlg: !!document.querySelector('.dlg'), focus: __desc(document.activeElement), tpl: __ls.proj.scenes[0].tpl })")
            check('Enter подтверждает, фокус возвращается на кнопку', not r['dlg'] and r['focus'] == '#bAutoScenes' and r['tpl'] != 'toggles', r)
            await pg.click('#bAutoScenes'); await pg.wait_for_timeout(200); n0 = await pg.evaluate("JSON.stringify(__ls.proj.scenes.map(s => s.tpl))")
            await pg.evaluate("__ls.proj.scenes[0].tpl = 'toggles'")
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            r = await pg.evaluate("() => ({ dlg: !!document.querySelector('.dlg'), focus: __desc(document.activeElement), tpl: __ls.proj.scenes[0].tpl, gallery: document.querySelector('#gallery').hidden })")
            check('Esc отменяет, фокус возвращается', not r['dlg'] and r['focus'] == '#bAutoScenes' and r['tpl'] == 'toggles', r)
            # пробел и буквы, пока окно открыто, не уходят в редактор
            await pg.click('#bAutoScenes'); await pg.wait_for_timeout(150); s0 = await state()
            await pg.keyboard.press('KeyG'); await pg.keyboard.press('KeyS'); await pg.keyboard.press('Tab'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(200)
            check('при открытом окне горячие клавиши молчат; Tab → «Отмена», Enter на ней отменяет', await state() == s0 and await pg.evaluate("__ls.proj.scenes[0].tpl") == 'toggles', [s0, await state()])
        await pg.evaluate("__ls.renderAll()")
        await type_into(await pg.query_selector('#lyrics'), 'текст песни после окна подтверждения', restore=True)
        await type_into(await pg.query_selector('#artist'), 'артист после окна подтверждения') if await pg.is_visible('#artist') else None
        if not await pg.evaluate("typeof Dialogs !== 'undefined'"): check('есть Dialogs (app/dialogs.js)', False)
        else:
            r = await pg.evaluate("async () => { Dialogs.prompt('Название?', 'abc').then(v => window.__prv = v); await new Promise(r => setTimeout(r, 50)); return [document.activeElement.value, __desc(document.activeElement)] }")
            await pg.keyboard.press('Control+A'); await pg.keyboard.type('новое имя'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
            r2 = await pg.evaluate("window.__prv")
            check('Dialogs.prompt: набор и Enter', r[0] == 'abc' and r2 == 'новое имя', [r, r2])
            await pg.evaluate("void Dialogs.alert('Проверка')"); await pg.wait_for_timeout(100); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
            check('Dialogs.alert закрывается по Enter', not await pg.evaluate("!!document.querySelector('.dlg')"))
        check('встроенные confirm/alert/prompt не вызывались', not native, native)

        await reset()
        # ---------- 6. клик по превью ----------
        await pg.wait_for_timeout(600)
        bx = await (await pg.query_selector('#stage')).bounding_box()
        await pg.mouse.click(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] * .8); await pg.wait_for_timeout(200)
        p0 = await pg.evaluate("document.querySelector('#bPlay').textContent")
        await pg.keyboard.press('Space'); await pg.wait_for_timeout(200)
        p1 = await pg.evaluate("document.querySelector('#bPlay').textContent")
        check('после клика по превью пробел запускает воспроизведение', p0 != p1, [p0, p1, await pg.evaluate("__desc(document.activeElement)")])
        await stop_play()
        await pg.mouse.click(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] * .5); await pg.wait_for_timeout(150)
        check('после клика по превью фокус не остаётся в превью', await pg.evaluate("document.activeElement !== document.querySelector('#preview')"), await pg.evaluate("__desc(document.activeElement)"))
        await type_into(await pg.query_selector('#lyrics'), 'текст после клика по превью')
        await tab('right', 'style'); await type_into(await pg.query_selector('#artist'), 'артист после клика по превью'); await tab('right', 'scene')

        await reset()
        # ---------- 7. перетаскивание файла ----------
        drag = """(t) => { const e = new Event(t, {cancelable: true}); e.dataTransfer = {types: ['Files'], files: [], dropEffect: ''}; window.dispatchEvent(e); }"""
        await pg.evaluate(drag, 'dragenter'); v = await pg.evaluate("!document.querySelector('#dropOv').hidden")
        await pg.evaluate(drag, 'dragleave'); h = await pg.evaluate("document.querySelector('#dropOv').hidden")
        check('перетаскивание: оверлей появляется и прячется после dragleave', v and h, [v, h])
        # перетаскивание кончилось без dragleave/drop (например, над превью): первое движение мыши убирает оверлей
        await pg.evaluate(drag, 'dragenter'); await pg.mouse.move(150, 300); await pg.mouse.move(170, 320); await pg.wait_for_timeout(100)
        h = await pg.evaluate("document.querySelector('#dropOv').hidden"); await pg.evaluate(drag, 'dragenter'); await pg.evaluate(drag, 'dragleave')
        check('перетаскивание: «застрявший» оверлей прячется при движении мыши и счётчик сброшен', h and await pg.evaluate("document.querySelector('#dropOv').hidden"), h)
        await type_into(await pg.query_selector('#lyrics'), 'текст после перетаскивания')
        # файл бросили на превью: его должно принять приложение, а оверлей — спрятаться
        await pg.evaluate("window.__dropped = null; window.__fileKind = p => { window.__dropped = p; return null; }")
        await pg.evaluate("""() => { const d = document.querySelector('#preview').contentDocument, w = d.defaultView;
          const ev = (t, files) => { const e = new w.Event(t, {bubbles: true, cancelable: true}); e.dataTransfer = {types: ['Files'], files: files || [], dropEffect: ''}; d.body.dispatchEvent(e); return e.defaultPrevented; };
          window.__dz = [ev('dragenter'), ev('dragover'), ev('drop', [{__path: '/x/track.mp3'}])]; }""")
        await pg.wait_for_timeout(300)
        r = await pg.evaluate("() => ({ dropped: window.__dropped, ov: document.querySelector('#dropOv').hidden, prevented: window.__dz })")
        check('файл, брошенный на превью, принимается; оверлей спрятан', r['dropped'] == '/x/track.mp3' and r['ov'] and r['prevented'][2], r)
        await type_into(await pg.query_selector('#lyrics'), 'текст после броска на превью')

        await reset()
        # ---------- 8. экспорт: открыть и закрыть ----------
        await pg.click('#bExport'); await pg.wait_for_timeout(200); s0 = await state()
        await pg.keyboard.press('Space'); await pg.keyboard.press('KeyS'); await pg.wait_for_timeout(100)
        check('открыт экспорт: пробел и S не трогают редактор', await state() == s0, [s0, await state()])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check('Esc закрывает экспорт', await pg.evaluate("document.querySelector('#exportModal').hidden"))
        await type_into(await pg.query_selector('#lyrics'), 'текст после экспорта (Esc)')
        await pg.click('#bExport'); await pg.wait_for_timeout(150); await pg.click('#xClose'); await pg.wait_for_timeout(150)
        await tab('right', 'style'); await type_into(await pg.query_selector('#songTitle'), 'название после экспорта (✕)'); await tab('right', 'scene')

        await reset()
        # ---------- 9. невидимые слои не перехватывают клики ----------
        await pg.evaluate("() => { toastErr('проверка'); toast('обычное сообщение', 150); }"); await pg.wait_for_timeout(700)
        r = await pg.evaluate("() => { const t = document.querySelector('#toast'), b = t.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2; const top = document.elementFromPoint(x, y); return { on: t.classList.contains('on'), hit: top === t || t.contains(top), top: __desc(top) } }")
        check('скрытый тост не перехватывает клики', not r['on'] and not r['hit'], r)
        r = await pg.evaluate("() => [...document.querySelectorAll('.modal,#dropOv,#toast,.dlg')].filter(m => { const s = getComputedStyle(m); return s.display !== 'none' && s.pointerEvents !== 'none' && (s.opacity === '0' || s.visibility === 'hidden') }).map(__desc)")
        check('нет невидимых, но кликабельных слоёв', not r, r)

        check('нет ошибок страницы', not errs, errs[:5])
        await b.close()

def run():
    try: asyncio.run(main())
    except Exception as x:  # страница упала или зависла — это тоже провал
        check('тест дошёл до конца', False, str(x).split(chr(10))[0])
    bad = [r for r in R if not r[1]]
    print(f'\nИтого: {len(R) - len(bad)} из {len(R)} проверок прошли')
    sys.exit(1 if bad else 0)

run()

