# Проверка полей шаблонов: сдвиг/размер аватара и размер заголовка.
#   python3 dev/test_fields.py PORT ref    — снять эталонные кадры (значения по умолчанию) в /tmp/fields_ref
#   python3 dev/test_fields.py PORT [check] — сравнить кадры по умолчанию с эталоном (попиксельно),
#       проверить сдвиг аватара (dx=30 → ~30 px макета), размер (k=150 → ×1.5), что аватар не выходит
#       за карточку на краях диапазона полей, и что «Размер заголовка, %» меняет размер шрифта.
# Нужен запущенный dev/server.py на PORT. Временные _fields*.html пишутся в app/ и удаляются.
import json, asyncio, sys, os, re
from playwright.async_api import async_playwright
from PIL import Image, ImageChops

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8773
MODE = sys.argv[2] if len(sys.argv) > 2 else 'check'
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
REF, OUT = '/tmp/fields_ref', '/tmp/fields_out'
BASE = f'http://127.0.0.1:{PORT}/'
W = json.load(open('/root/work/t8/words.json')); W = W['words'] if isinstance(W, dict) else W
for w in W: w.pop('say', None); w.pop('conf', None)
TPLS = ['chat', 'imsg-dialog', 'tg-her', 'tg-group', 'tg-feed', 'server', 'vc-sheet', 'vc-list', 'post', 'story', 'call', 'callfull', 'record', 'notifs', 'player', 'recorder']
PRESETS = ['melhor-lenta', 'night-drive']
if len(sys.argv) > 3: TPLS = sys.argv[3].split(',')  # необязательно: только эти шаблоны

# новые поля выравнивания (задача 1): значение не по умолчанию должно менять кадр
NEWF = {'chat': {'status': 'Доставлено'}, 'imsg-dialog': {'keyboard': True}, 'tg-group': {'status': 'в сети: 2', 'time': '05:55'}, 'tg-feed': {'status': 'был(а) недавно'},
        'server': {'emoji': '😎', 'color': '#3BA5FF'}, 'vc-sheet': {'emoji': '😎', 'color': '#3BA5FF'}, 'vc-list': {'emoji': '😎', 'color': '#3BA5FF'},
        'post': {'emoji': '😎', 'color': '#FF9500', 'time': '5 мин'}, 'story': {'emoji': '😎', 'time': '5 мин'}, 'call': {'accept': False},
        'record': {'emoji': '😷', 'color': '#34C759', 'sub': 'приём завтра'}, 'notifs': {'title1': 'Подъём', 'cl1': '#34C759', 'cl2': '#FF2D55', 'ntime': '2 мин назад'},
        'player': {'color': '#34C759'}, 'recorder': {'app': 'Запись'}}
PREP = """([pk,tpl,f,n])=>{ const P=__ls.proj; document.querySelector(`#presetGrid .pr[data-k="${pk}"]`).click(); P.style.format='9:16';
 P.scenes.slice(0,2).forEach(s=>{ s.tpl=tpl; s.f=JSON.parse(JSON.stringify(f)); delete s.dx; delete s.dy; delete s.scale; delete s.capY; });
 const sc=P.scenes[0], nx=P.words[sc.b]?P.words[sc.b].t:1e9; return [__ls.engineHTML(__ls.buildSpec(false),'%s'), Math.max(P.words[sc.a].t+.1, Math.min(P.words[sc.b-1].t+.2, nx-.5))]; }""" % BASE

# измерения в кадре движка: аватары и заголовок первой сцены (в px макета карточки)
MEASURE = """()=>{ const slot=document.querySelector('.wslot[data-k="0"]:not([data-second])')||document.querySelector('.wslot'); const card=slot.querySelector('.card')||slot.querySelector('.wscale').firstElementChild.firstElementChild;
 const cr=card.getBoundingClientRect(), sc=cr.width/card.offsetWidth; const avs=[...card.querySelectorAll('.av')].map(a=>{ const r=a.getBoundingClientRect(); return {x:(r.left-cr.left)/sc, y:(r.top-cr.top)/sc, w:r.width/sc, ow:a.offsetWidth, in:r.left>=cr.left-1&&r.top>=cr.top-1&&r.right<=cr.right+1&&r.bottom<=cr.bottom+1}; });
 const tt=card.querySelector('[data-ttl]'); return {avs, title: tt?parseFloat(getComputedStyle(tt).fontSize):null}; }"""


async def main():
    os.makedirs(REF if MODE == 'ref' else OUT, exist_ok=True)
    fails, notes, errs = [], [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(); st = {}

        async def setup():  # страница редактора с проектом и страница движка; пересоздаются, если вкладка упала
            for k in ('pg', 'eng'):
                if k in st:
                    try: await st[k].close()
                    except Exception: pass
            pg = await b.new_page(viewport={'width': 1500, 'height': 940})
            pg.on('pageerror', lambda e: errs.append('ui: ' + str(e)))
            await pg.goto(BASE + 'index.html'); await pg.wait_for_function('window.__ls')
            await pg.evaluate("async()=>{ await __ls.loadAudio({path:'/mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3',name:'serega.mp3'}); __ls.proj.duration=73.37; }"); await pg.wait_for_timeout(1500)
            await pg.evaluate("(W)=>{ const P=__ls.proj; P.words=W; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); __ls.rebuildPreview(); }", W); await pg.wait_for_timeout(2000)
            eng = await b.new_page(viewport={'width': 720, 'height': 1280})
            eng.on('pageerror', lambda e: errs.append('engine: ' + str(e)))
            st['pg'], st['eng'] = pg, eng
        await setup()
        fields = await st['pg'].evaluate("()=>Object.fromEntries(TEMPLATES.map(t=>[t.id, Object.fromEntries(t.fields.map(f=>[f.k,{def:f.def,type:f.type,opts:f.opts}]))]))")
        n = [0]

        async def frame1(pk, tpl, f, shot=None):
            pg, eng = st['pg'], st['eng']
            html, t = await pg.evaluate(PREP, [pk, tpl, f, n[0]])
            fn = '_fields%d.html' % (n[0] % 4); n[0] += 1
            open(os.path.join(APP, fn), 'w').write(html)
            try:
                await eng.goto(BASE + fn); await eng.wait_for_function('window.READY===true'); await eng.evaluate('document.fonts.ready.then(()=>1)')
                await eng.evaluate(f'window.seekAsync ? seekAsync({t}) : seek({t})'); await eng.wait_for_timeout(250)
                if shot: await eng.screenshot(path=shot)
                return await eng.evaluate(MEASURE)
            finally:
                os.remove(os.path.join(APP, fn))

        async def frame(*a, **k):
            for attempt in range(3):
                try: return await frame1(*a, **k)
                except Exception as e:
                    if attempt == 2 or not re.search(r'crash|closed', str(e), re.I): raise
                    notes.append(f'вкладка упала ({str(e)[:60]}), пересоздаю'); await setup()

        for tpl in TPLS:
            for pk in PRESETS:
                name = f'{tpl}_{pk}.png'
                if MODE == 'ref':
                    await frame(pk, tpl, {}, os.path.join(REF, name)); continue
                out = os.path.join(OUT, name)
                if not os.path.exists(os.path.join(REF, name)): notes.append(f'{name}: нет эталона'); continue
                # карточки-призраки пресета melhor-lenta иногда дрожат на 1–2 px и между прогонами исходного кода;
                # настоящая разница повторяется, поэтому кадр с расхождением снимается ещё до двух раз
                for attempt in range(3):
                    await frame(pk, tpl, {}, out)
                    d = ImageChops.difference(Image.open(out).convert('RGB'), Image.open(os.path.join(REF, name)).convert('RGB')).getbbox()
                    if not d: break
                    if attempt < 2: notes.append(f'{name}: расхождение {d}, снимаю ещё раз')
                if d:  # разница в 1–3 уровня яркости — шум растеризации Chromium (бывает и между двумя прогонами исходного кода)
                    import numpy as np
                    dd = np.array(ImageChops.difference(Image.open(out).convert('RGB'), Image.open(os.path.join(REF, name)).convert('RGB'))); mx = int(dd.max())
                    (notes if mx <= 3 else fails).append(f'{name}: по умолчанию кадр отличается от эталона, область {d}, пикселей {(dd.sum(2) > 0).sum()}, макс. разница {mx}' + (' (шум)' if mx <= 3 else ''))
                else: notes.append(f'{name}: по умолчанию совпадает с эталоном попиксельно')
        if MODE == 'ref':  # кадр детерминирован?
            for pk in PRESETS:
                name = f'{TPLS[0]}_{pk}.png'; det = f'/tmp/fields_det_{pk}.png'; await frame(pk, TPLS[0], {}, det)
                d = ImageChops.difference(Image.open(det).convert('RGB'), Image.open(os.path.join(REF, name)).convert('RGB')).getbbox()
                if d: fails.append(f'{name}: кадр не детерминирован, область {d}')
        # варианты полей — после всех кадров по умолчанию: порядок кадров по умолчанию тот же, что при снятии эталона
        # (кадр зависит от истории страницы движка: карточки-призраки меряются при первом кадре)
        for tpl in (TPLS if MODE != 'ref' else []):
            F = fields.get(tpl, {}); pk = PRESETS[0]
            if 'avDx' in F:
                base = await frame(pk, tpl, {})
                a0 = base['avs'][0]; X, Y, K = F['avDx']['opts'], F['avDy']['opts'], F['avK']['opts']
                # 30 px, если диапазон позволяет; у аватара в строке с текстом диапазон уже (иначе он наезжает на текст)
                dxv = 30 if X['max'] >= 30 else -30 if X['min'] <= -30 else X['max']; dyv = min(10, Y['max'])
                m = await frame(pk, tpl, {'avDx': dxv}, os.path.join(OUT, f'{tpl}_dx{dxv}.png')); a = m['avs'][0]
                if abs((a['x'] - a0['x']) - dxv) > 1.5: fails.append(f'{tpl}: dx={dxv} сдвинул аватар на {a["x"]-a0["x"]:.1f}')
                m = await frame(pk, tpl, {'avDy': dyv}); a = m['avs'][0]
                if abs((a['y'] - a0['y']) - dyv) > 1.5: fails.append(f'{tpl}: dy={dyv} сдвинул аватар на {a["y"]-a0["y"]:.1f}')
                m = await frame(pk, tpl, {'avK': 150}, os.path.join(OUT, f'{tpl}_k150.png')); a = m['avs'][0]
                if abs(a['w'] / a0['w'] - 1.5) > .03: fails.append(f'{tpl}: k=150 дал ×{a["w"]/a0["w"]:.3f}')
                for i, (dx, dy) in enumerate([(X['min'], Y['min']), (X['max'], Y['min']), (X['min'], Y['max']), (X['max'], Y['max'])]):
                    for k in (K['min'], K['max']):
                        m = await frame(pk, tpl, {'avDx': dx, 'avDy': dy, 'avK': k}, os.path.join(OUT, f'{tpl}_edge{i}_{k}.png') if k == K['max'] else None)
                        bad = [j for j, a in enumerate(m['avs']) if not a['in']]
                        if bad: fails.append(f'{tpl}: dx={dx} dy={dy} k={k} — аватар(ы) {bad} выходят за карточку')
                # за пределами диапазона значения ограничиваются
                m = await frame(pk, tpl, {'avDx': 999, 'avDy': -999, 'avK': 999}); a = m['avs'][0]
                if a['w'] / a0['w'] > K['max'] / 100 + .03 or a['x'] - a0['x'] > X['max'] + a['w'] or a['y'] - a0['y'] < Y['min'] - a['w']: fails.append(f'{tpl}: значения вне диапазона не ограничены')
                notes.append(f'{tpl}: аватар {a0["ow"]}px, сдвиг X {X["min"]}…{X["max"]}, Y {Y["min"]}…{Y["max"]}, размер {K["min"]}–{K["max"]}%')
            if 'titleK' in F:
                base = await frame(pk, tpl, {})
                m = await frame(pk, tpl, {'titleK': 140}, os.path.join(OUT, f'{tpl}_title140.png'))
                if not base['title'] or not m['title'] or abs(m['title'] / base['title'] - 1.4) > .03: fails.append(f'{tpl}: titleK=140 — шрифт {base["title"]} → {m["title"]}')
                else: notes.append(f'{tpl}: заголовок {base["title"]}px → {m["title"]}px')
            for k, v in NEWF.get(tpl, {}).items():
                if k not in F: fails.append(f'{tpl}: нет поля {k}'); continue
                m = await frame(pk, tpl, {k: v}, os.path.join(OUT, f'{tpl}_f_{k}.png'))
                d = ImageChops.difference(Image.open(os.path.join(OUT, f'{tpl}_f_{k}.png')).convert('RGB'), Image.open(os.path.join(OUT, f'{tpl}_{pk}.png')).convert('RGB')).getbbox()
                (notes if d else fails).append(f'{tpl}: поле {k}={v!r} ' + ('меняет кадр' if d else 'НЕ меняет кадр'))
        await b.close()
    for x in notes: print('  ', x)
    for x in errs[:10]: print('ERR', x)
    for x in fails: print('FAIL', x)
    print('OK' if not fails and not errs else f'FAILED: {len(fails)} проверок, {len(errs)} ошибок страницы')
    sys.exit(1 if fails or errs else 0)

asyncio.run(main())
