# Проверка кнопки «Проверить ролик» (app/check.js) в обычном Chromium.
# Запуск: python3 dev/server.py 8772 & python3 dev/test_check.py 8772
import json, asyncio, sys, time
from playwright.async_api import async_playwright
PORT = sys.argv[1] if len(sys.argv) > 1 else '8772'
WORDS = '/root/work/t8/words.json'; TRACK = '/mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3'
W = json.load(open(WORDS)); W = W['words'] if isinstance(W, dict) else W
for w in W: w.pop('say', None); w.pop('conf', None)
# ~12 сцен: 8 строк + первые 4 ещё раз через 16 с (как припев)
W12 = W + [dict(w, t=round(w['t'] + 16, 3), e=round(w['e'] + 16, 3), line=w['line'] + 8) for w in W if w['line'] < 4]
PRESETS = ['melhor', 'purple-haze', 'poster', 'lockscreen', 'cloud9']
GEOM = {'overlap', 'edge', 'safe', 'sticker'}

LOAD = """async ([W, per, preset]) => {
  if (preset) document.querySelector(`#presetGrid .pr[data-k="${preset}"]`).click();
  const P = __ls.proj; P.words = JSON.parse(JSON.stringify(W)); P.perScene = per; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); __ls.rebuildPreview();
  return [P.style.preset, P.scenes.length, P.scenes.map(s => s.tpl).join(',')];
}"""
RUN = """async (opts) => { const r = await Check.run(null, opts || {}); return { ms: r.ms, aborted: r.aborted, items: r.map(f => ({ kind: f.kind, scene: f.scene, t: +f.t.toFixed(2), text: f.text, fix: !!f.fix, safe: f.safe })) }; }"""

async def main():
    ok = True
    def check(name, cond, extra=''):
        nonlocal ok; ok &= bool(cond); print(('OK  ' if cond else 'FAIL'), name, extra)
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1500, 'height': 940}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(f'http://127.0.0.1:{PORT}/index.html'); await pg.wait_for_function('window.__ls && window.Check')
        await pg.evaluate("async (a) => { await __ls.loadAudio({path: a, name: 'serega.mp3'}); __ls.proj.duration = 73.37; }", TRACK); await pg.wait_for_timeout(1500)

        # ---------- чистые проекты по пресетам ----------
        print('== чистые проекты (autoScenes) ==')
        summary = {}
        for pr in PRESETS:
            for per, words, tag in [(2, W, '4 сцены'), (1, W12, '12 сцен')]:
                info = await pg.evaluate(LOAD, [words, per, pr]); await pg.wait_for_timeout(300)
                r = await pg.evaluate(RUN)
                g = [f for f in r['items'] if f['kind'] in GEOM]; other = [f for f in r['items'] if f['kind'] not in GEOM]
                summary[(pr, tag)] = (len(g), len(other), r['ms'])
                print(f"{pr:12s} {tag:8s} сцен={info[1]:2d} геометрия={len(g)} прочее={len(other)} время={r['ms']} мс")
                for f in r['items']: print('     ', f['kind'], 'сц', f['scene'], f['t'], f['text'])
                check(f'{pr} {tag}: геометрия ≤ 2', len(g) <= 2)

        # ---------- проект с дефектами ----------
        print('== проект с дефектами ==')
        await pg.evaluate(LOAD, [W12, 1, 'melhor'])
        setup = await pg.evaluate("""() => { const P = __ls.proj, S = P.scenes;
          // 1) два одинаковых шаблона подряд (разный текст)
          S[2].tpl = S[1].tpl; S[2].f = {};
          // 2) карточка сдвинута за край
          S[4].dx = 400;
          // 3) строка 0.2 с: слова строки 6 сжимаются к началу строки 7, перед ней появляется пауза
          const L6 = P.words.map((w, i) => i).filter(i => P.words[i].line === 6), n7 = P.words.findIndex(w => w.line === 7), t7 = P.words[n7].t;
          L6.forEach((i, k) => { P.words[i].t = +(t7 - .2 + k * .02).toFixed(3); P.words[i].e = +(P.words[i].t + .02).toFixed(3); });
          // 4) неуверенное слово
          P.words[S[8].a + 1].unsure = true;
          __ls.renderAll(); __ls.rebuildPreview();
          return { tplPair: [S[1].tpl, S[2].tpl], short: S.findIndex(s => L6[0] >= s.a && L6[0] < s.b), unsure: 8 };
        }""")
        r = await pg.evaluate(RUN)
        for f in r['items']: print('     ', f['kind'], 'сц', f['scene'], f['t'], f['text'], '[fix]' if f['fix'] else '')
        has = lambda kind, sc: any(f['kind'] == kind and f['scene'] == sc for f in r['items'])
        check('одинаковые шаблоны подряд', has('repeat', 1) or has('repeat', 2), setup['tplPair'])
        check('сдвиг dx=400 за край', has('edge', 4))
        check('строка 0.2 с', has('short', setup['short']))
        check('слово unsure', has('unsure', 8))
        check('у dx=400 есть исправление', any(f['kind'] == 'edge' and f['scene'] == 4 and f['fix'] for f in r['items']))

        # ---------- интерфейс: кнопка, окно, «исправить», отмена ----------
        print('== интерфейс ==')
        await pg.click('#bCheck'); await pg.wait_for_function("!document.querySelector('#ckModal').hidden && !Check.busy && document.querySelectorAll('#ckList .ckItem').length > 0", timeout=60000)
        n0 = await pg.evaluate("document.querySelectorAll('#ckList .ckItem:not(.done)').length")
        await pg.screenshot(path='/tmp/check_modal.png')
        row = await pg.evaluate_handle("""() => [...document.querySelectorAll('#ckList .ckItem')].find(d => /Сцена 5 ·/.test(d.textContent) && /край кадра/.test(d.textContent))""")
        check('в окне есть строка «Сцена 5 · … за край кадра»', await row.evaluate('d => !!d'))
        # «показать»: окно прячется, сцена выделена, курсор в момент замера; «К списку проверки» возвращает окно
        await row.evaluate("d => [...d.querySelectorAll('button')].find(b => b.textContent === 'показать').click()"); await pg.wait_for_timeout(300)
        sh = await pg.evaluate("""() => ({ hidden: document.querySelector('#ckModal').hidden, back: !document.querySelector('#ckBack').hidden, idx: document.querySelector('#seIdx').textContent, t: document.querySelector('#tCur').textContent, want: Check.list.find(f => f.kind === 'edge' && f.scene === 4).t })""")
        check('«показать» выделяет сцену и перематывает', sh['hidden'] and sh['back'] and sh['idx'].startswith('Сцена 5 ') and sh['t'].startswith(f"{int(sh['want'] // 60)}:{int(sh['want'] % 60):02d}"), sh)
        await pg.click('#ckBack'); await pg.wait_for_timeout(200)
        row = await pg.evaluate_handle("""() => [...document.querySelectorAll('#ckList .ckItem')].find(d => /Сцена 5 ·/.test(d.textContent) && /край кадра/.test(d.textContent))""")
        dx0 = await pg.evaluate("__ls.proj.scenes[4].dx")
        await row.evaluate("d => [...d.querySelectorAll('button')].find(b => b.textContent === 'исправить').click()")
        await pg.wait_for_function("!Check.busy", timeout=30000); await pg.wait_for_timeout(300)
        after = await pg.evaluate("""() => ({ dx: __ls.proj.scenes[4].dx, scale: __ls.proj.scenes[4].scale, open: Check.list.filter(f => !f.done && f.kind === 'edge' && f.scene === 4).length, done: Check.list.filter(f => f.done).length, status: document.querySelector('#ckStatus').textContent })""")
        check('«исправить» убирает находку', after['open'] == 0 and after['done'] >= 1, after)
        await pg.screenshot(path='/tmp/check_fixed.png')
        # отмена Ctrl+Z возвращает сдвиг
        await pg.evaluate("document.querySelector('#ckModal').hidden = true"); await pg.wait_for_timeout(700)
        await pg.evaluate("__ls.histGo(-1)"); await pg.wait_for_timeout(300)
        check('Ctrl+Z возвращает dx', await pg.evaluate("__ls.proj.scenes[4].dx") == dx0, await pg.evaluate("__ls.proj.scenes[4].dx"))
        # повтор шаблона: исправление меняет шаблон
        r = await pg.evaluate(RUN)
        rep = [f for f in r['items'] if f['kind'] == 'repeat' and f['scene'] in (1, 2)]
        if rep:
            res = await pg.evaluate("""async (sc) => { const f = (await Check.run(null, {geometry: false})).find(f => f.kind === 'repeat' && f.scene === sc); const before = __ls.proj.scenes[sc].tpl; await f.fix(); const r2 = await Check.run(null, {geometry: false}); return [before, __ls.proj.scenes[sc].tpl, r2.some(x => x.kind === 'repeat' && (x.scene === 1 || x.scene === 2))]; }""", rep[0]['scene'])
            check('исправление повтора меняет шаблон', res[0] != res[1] and not res[2], res)
        # растянуть строку
        res = await pg.evaluate("""async (sc) => { const f = (await Check.run(null, {geometry: false})).find(f => f.kind === 'short' && f.scene === sc); if (!f || !f.fix) return 'нет исправления'; await f.fix(); const r2 = await Check.run(null, {geometry: false}); return r2.some(x => x.kind === 'short' && x.scene === sc); }""", setup['short'])
        check('«растянуть строку» убирает находку', res is False, res)
        # «исправить всё безопасное»
        await pg.evaluate("(() => { __ls.proj.scenes[4].dx = 400; __ls.proj.scenes[6].dy = -700; __ls.renderAll(); })()")
        await pg.evaluate("Check.open()"); await pg.click('#ckRun'); await pg.wait_for_function("!Check.busy", timeout=60000)
        g0 = await pg.evaluate("Check.list.filter(f => !f.done && ['edge','overlap'].includes(f.kind)).map(f => f.scene + ':' + f.kind)")
        await pg.click('#ckFixAll'); await pg.wait_for_timeout(500); await pg.wait_for_function("!Check.busy", timeout=60000); await pg.wait_for_timeout(500)
        g1 = await pg.evaluate("Check.list.filter(f => !f.done && ['edge','overlap'].includes(f.kind)).map(f => f.scene + ':' + f.kind)")
        check('«исправить всё безопасное» убирает выход за край', any(x.startswith('4:') or x.startswith('6:') for x in g0) and not any(x.startswith('4:') or x.startswith('6:') for x in g1), [g0, g1])
        # прервать проверку
        ab = await pg.evaluate("async () => { const p = Check.run(); setTimeout(() => Check.abort(), 30); const r = await p; return [r.aborted, r.ms]; }")
        check('проверку можно прервать', ab[0] is True, ab)
        # пункт в меню «?» и пустой список
        await pg.evaluate("document.querySelector('#ckModal').hidden = true")
        await pg.evaluate(LOAD, [W, 2, 'melhor']); await pg.evaluate("__ls.proj.words = []; __ls.proj.scenes = []; __ls.renderAll()")
        await pg.click('#bHelp'); await pg.click('#helpMenu button[data-act=check]'); await pg.wait_for_timeout(400)
        check('пункт меню «?» открывает окно', await pg.evaluate("!document.querySelector('#ckModal').hidden"))
        # основное превью не трогается: скрытых окон после проверки не остаётся
        check('скрытое окно проверки убрано', await pg.evaluate("document.querySelectorAll('iframe').length") == 1, await pg.evaluate("document.querySelectorAll('iframe').length"))
        # английский интерфейс: строки окна переведены
        await pg.evaluate("localStorage.setItem('ls-lang','en')"); await pg.reload(); await pg.wait_for_function('window.__ls && window.Check')
        await pg.evaluate("async (a) => { await __ls.loadAudio({path: a, name: 'serega.mp3'}); __ls.proj.duration = 73.37; }", TRACK)
        await pg.evaluate(LOAD, [W12, 1, 'melhor']); await pg.evaluate("(() => { __ls.proj.scenes[4].dx = 400; __ls.renderAll(); })()")
        await pg.click('#bCheck'); await pg.wait_for_function("!Check.busy && document.querySelectorAll('#ckList .ckItem').length > 0", timeout=60000)
        cyr = await pg.evaluate("""(() => { const out = []; const m = document.querySelector('#ckModal'); const tw = document.createTreeWalker(m, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) if (/[а-яё]/i.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 70)); return out.concat([document.querySelector('#bCheck').textContent]).filter(s => /[а-яё]/i.test(s)) })()""")
        lyr = await pg.evaluate("Check.list.filter(f => f.kind !== 'unsure' && f.kind !== 'short' && f.kind !== 'order').map(f => f.text).filter(s => /[а-яё]/i.test(s.replace(/«[^»]*»/g, '')))")
        await pg.screenshot(path='/tmp/check_en.png')
        check('английский: нет непереведённых строк', not lyr and all('«' in s or not s for s in cyr), [cyr[:6], lyr[:6]])
        await pg.evaluate("localStorage.removeItem('ls-lang')")
        check('нет pageerror', not errs, errs[:5])
        await b.close()
    print('ИТОГ:', 'OK' if ok else 'ЕСТЬ ОШИБКИ')
    return ok
sys.exit(0 if asyncio.run(main()) else 1)
