# Проверка логики редактора в Chromium (без Electron): отмена/повтор, проекты, таймлайн, сцены, тайминги, пресеты, перевод.
# Запуск: python3 dev/server.py 8775 &  python3 dev/test_editor.py 8775 [сценарий ...]
# Сценарии: templates batch undo project timeline scenes timings words english presets (без имени — все, ~8 мин).
# Данные: слова /root/work/t8/words.json, трек /mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3 (пути — переменные ниже).
import json, asyncio, sys, time
from playwright.async_api import async_playwright
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8775
ONLY = [a for a in sys.argv[1:] if not a.isdigit()]
WORDS = '/root/work/t8/words.json'
TRACK = '/mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3'
W = json.load(open(WORDS)); W = W['words'] if isinstance(W, dict) else W
for w in W: w.pop('say', None); w.pop('conf', None)
FAIL = []
def check(name, cond, info=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '  ← ' + str(info)[:400]))
    if not cond: FAIL.append(name)

async def page(b, lang='ru', track=True, words=W):
    ctx = await b.new_context(viewport={'width': 1500, 'height': 940}); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '404' not in m.text and 'ERR_FILE_NOT_FOUND' not in m.text else None)
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await pg.add_init_script(f"try{{localStorage.setItem('ls-lang','{lang}')}}catch(e){{}}")
    await pg.goto(f'http://127.0.0.1:{PORT}/index.html'); await pg.wait_for_function('window.__ls')
    if track:
        await pg.evaluate("async(p)=>{ await __ls.loadAudio({path:p,name:'serega.mp3'}); __ls.proj.duration=73.37; }", TRACK); await pg.wait_for_timeout(800)
    if words is not None:
        await pg.evaluate("(W)=>{ const P=__ls.proj; P.words=JSON.parse(JSON.stringify(W)); P.lyrics=''; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); __ls.rebuildPreview(); __ls.histReset(); }", words)
        await pg.wait_for_timeout(500)
    pg.errs = errs
    return pg

STATE = "JSON.stringify((({assets,...r})=>r)(__ls.proj))"
async def settle(pg, ms=600): await pg.wait_for_timeout(ms)
# панель сцены совпадает с проектом
PANEL = """(()=>{ const P=__ls.proj, s=__ls.sel, sc=P.scenes[s]; if(!sc) return 'нет сцены';
  const bad=[]; const strip=document.querySelectorAll('#sceneStrip .sc').length; if(strip!==P.scenes.filter(x=>P.words[x.a]).length) bad.push('лента '+strip+'≠'+P.scenes.length);
  const t=document.querySelector('#seText').textContent, want=P.words.slice(sc.a,sc.b).map(w=>w.w).join(' '); if(t!==want) bad.push('текст сцены');
  const bv=document.querySelector('#seBump').value; if(String(bv)!==String(sc.bump??'') ) bad.push('bump '+bv+'≠'+sc.bump);
  if(document.querySelector('#seStamp').value!==(sc.stamp||'')) bad.push('stamp');
  if(document.querySelector('#seFx').value!==(sc.fx||'')) bad.push('fx');
  if(document.querySelector('#seTrans').value!==(sc.trans||'')) bad.push('trans');
  if(document.querySelector('#lyrics').value!==(P.lyrics||'')) bad.push('lyrics');
  return bad.join('; ') })()"""

async def t_undo(b):
    print('— отмена/повтор')
    pg = await page(b); ev = pg.evaluate
    await ev("window.__ls.sel0=1")
    s0 = await ev(STATE)
    # 1) шаблон из галереи
    await pg.click('#sceneStrip .sc:nth-child(2)'); await pg.click('#seTpl'); await pg.click('#gGrid .tp[data-id="weather"]'); await settle(pg)
    s1 = await ev(STATE)
    check('галерея меняет проект', s1 != s0)
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('Ctrl+Z после галереи возвращает проект целиком', await ev(STATE) == s0)
    check('панель после отмены совпадает', (await ev(PANEL)) == '', await ev(PANEL))
    await pg.keyboard.press('Control+Shift+z'); await settle(pg, 300)
    check('Ctrl+Shift+Z восстанавливает', await ev(STATE) == s1)
    # 2) разделить сцену и отменить
    n0 = await ev("__ls.proj.scenes.length"); sA = await ev(STATE)
    await pg.click('#seSplit'); await settle(pg)
    check('разделение добавило сцену', await ev("__ls.proj.scenes.length") == n0 + 1)
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('отмена разделения одним шагом', await ev(STATE) == sA)
    check('панель после отмены разделения', (await ev(PANEL)) == '', await ev(PANEL))
    # 3) перетаскивание слова на таймлайне медленно (пауза > 0,4 с посреди) — один шаг отмены
    sB = await ev(STATE)
    box = await (await pg.query_selector('#timeline')).bounding_box()
    pos = await ev("""(()=>{ const P=__ls.proj, i=5, w=P.words[i]; const tl=document.querySelector('#timeline'); const r=tl.getBoundingClientRect();
       // найти x слова: перебором по пикселям через hit невозможно — считаем по видимому окну
       return null })()""")
    # прокрутим таймлайн так, чтобы слово 5 было видно: Timeline.fit по отрезку ролика
    await ev("Timeline.fit()")
    xw = await ev("""(()=>{ const P=__ls.proj, [a,b]=(()=>{const st=P.style; return [ +st.start, +st.end ]})(); const tl=document.querySelector('#timeline'); const w=tl.getBoundingClientRect().width; const t=P.words[5].t+0.02; return (t-a)/(Math.max(a+1,b)-a)*w })()""")
    y = box['y'] + 18 + 46 + 4 + 26 + 4 + 14
    await pg.mouse.move(box['x'] + xw, y); await pg.mouse.down(); await pg.mouse.move(box['x'] + xw + 15, y, steps=3); await settle(pg, 700)
    await pg.mouse.move(box['x'] + xw + 30, y, steps=3); await settle(pg, 700); await pg.mouse.up(); await settle(pg, 700)
    sC = await ev(STATE)
    check('перетаскивание слова изменило время', sC != sB)
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('перетаскивание слова отменяется одним шагом', await ev(STATE) == sB, (await ev("__ls.proj.words[5].t")))
    # 4) история не растёт бесконечно
    await ev("""(()=>{ for(let i=0;i<300;i++){ __ls.proj.style.wmOp=i/1000; __ls.histCommit(); } })()""")
    n = await ev("__ls.histLen()")
    check('история ограничена', n <= 121, n)
    # 5) отмена во время воспроизведения
    await ev("document.querySelector('#bPlay').click()"); await settle(pg, 400)
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.click('#seTpl'); await pg.click('#gGrid .tp[data-id="map"]'); await settle(pg)
    await pg.keyboard.press('Control+z'); await settle(pg, 500)
    check('отмена во время воспроизведения — без ошибок', not pg.errs, pg.errs)
    for k in ['s', 'm', 'Control+z', 'ArrowDown', 's', 'Control+c', 'Control+v', 'Control+z', 'Control+Shift+z']:
        await pg.keyboard.press(k); await settle(pg, 250)
    check('действия клавишами во время воспроизведения — без ошибок', not pg.errs, pg.errs[:3])
    await ev("document.querySelector('#bPlay').click()")
    # ползунок тянут медленно — один шаг
    await ev("document.querySelector('#bPlay').textContent==='❚❚' && document.querySelector('#bPlay').click()")
    await settle(pg, 600); sD = await ev(STATE)
    await pg.click('#sceneStrip .sc:nth-child(2)'); await settle(pg, 600); sD = await ev(STATE)
    await pg.locator('#seScale').scroll_into_view_if_needed(); sl = await (await pg.query_selector('#seScale')).bounding_box()
    await pg.mouse.move(sl['x'] + 5, sl['y'] + sl['height'] / 2); await pg.mouse.down()
    for k in range(4): await pg.mouse.move(sl['x'] + 20 + k * 25, sl['y'] + sl['height'] / 2); await settle(pg, 500)
    await pg.mouse.up(); await settle(pg, 700)
    check('ползунок изменил масштаб', await ev(STATE) != sD)
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('медленное перетаскивание ползунка отменяется одним шагом', await ev(STATE) == sD)
    # число строк в сцене: кнопка показывает значение проекта (после открытия/отмены)
    await pg.click('#perScene button[data-v="3"]'); await settle(pg, 600)
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('отмена «строк в сцене»: кнопка совпадает с проектом', await ev("[__ls.proj.perScene||2, +document.querySelector('#perScene button.on').dataset.v]") == [2, 2])
    # смена темпа отменяется вместе с сеткой битов
    await pg.wait_for_function("!!__ls.beatInfo", timeout=20000); b0 = await ev("[__ls.beatInfo.bpm, __ls.beatInfo.beats.length]")
    await ev("(()=>{ const i=document.querySelector('#bpmIn'); i.value=String(Math.round(__ls.beatInfo.bpm*2>200?__ls.beatInfo.bpm/2:__ls.beatInfo.bpm*2)); i.dispatchEvent(new Event('change')); })()"); await settle(pg, 700)
    b1 = await ev("[__ls.beatInfo.bpm, __ls.beatInfo.beats.length]")
    await pg.keyboard.press('Control+z'); await settle(pg, 500)
    b2 = await ev("[__ls.beatInfo.bpm, __ls.beatInfo.beats.length, document.querySelector('#bpmIn').value, document.querySelector('#bpmMode').textContent]")
    check('отмена смены темпа возвращает сетку битов', b1 != b0 and b2[:2] == b0 and str(b2[2]) == str(b0[0]), (b0, b1, b2))
    # выбор другого трека отменяется вместе с треком в плеере
    import shutil; shutil.copy(TRACK, '/tmp/второй трек.mp3')
    await ev("async()=>{ await __ls.loadAudio({path:'/tmp/второй трек.mp3', name:'второй трек.mp3'}); __ls.touch(); }"); await settle(pg, 900)
    src1 = await ev("__ls.audioSrc()")
    await pg.keyboard.press('Control+z'); await settle(pg, 1500)
    check('отмена выбора трека: в плеере снова прежний трек', await ev("__ls.proj.audioPath") == TRACK and await ev("__ls.audioSrc()") != src1 and await ev("document.querySelector('#audioName').textContent") == 'serega.mp3', await ev("[__ls.proj.audioPath, document.querySelector('#audioName').textContent]"))
    check('нет ошибок страницы', not pg.errs, pg.errs[:5])
    await pg.context.close()

PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
async def t_project(b):
    print('— проекты: сохранение, открытие, картинки, старые проекты, трек без пути')
    pg = await page(b); ev = pg.evaluate
    # картинки во всех местах, где пишется asset:
    await ev("""(png)=>{ const P=__ls.proj, A=P.assets; ['font1','stk1','logo1','bg1','fld1','blk1','orph','tpl2img','acc1'].forEach(k=>A[k]=png);
      P.fonts=[{family:'MyFont',asset:'font1'}]; P.style.custom.font='MyFont';
      P.stickers=[{id:'s1',type:'image',value:'asset:stk1',x:.5,y:.3,size:120,t0:30,t1:32}];
      P.style.wmImg='asset:logo1'; P.style.bgMedia={type:'image',asset:'bg1',blur:0,dim:.2,zoom:true};
      P.scenes[0].tpl='post'; P.scenes[0].f={img:'asset:fld1'};
      P.scenes[1].tpl='blocks'; P.scenes[1].f={blocks:[{type:'image',img:'asset:blk1',h:200}]};
      P.scenes[2].tpl2='story'; P.scenes[2].f2={img:'asset:tpl2img'};
      __ls.renderAll(); __ls.touch(); }""", PNG)
    j = json.loads(await ev("__ls.projJSON()"))
    check('projJSON хранит все используемые картинки', sorted(j['assets']) == sorted(['font1','stk1','logo1','bg1','fld1','blk1','tpl2img']), sorted(j['assets']))
    # сохранить → открыть
    await ev("__ls.saveProject(false)"); await settle(pg, 300)
    s0 = await ev(STATE)
    await ev("__ls.proj.scenes[0].tpl='map'; __ls.touch()")
    await ev("__ls.openProject()"); await settle(pg, 1500)
    s1 = await ev(STATE)
    check('сохранить → открыть: проект тот же', s0 == s1)
    check('после открытия картинки на месте', await ev("Object.keys(__ls.proj.assets).length") >= 7)
    # вставили текст (ещё без синхронизации) — открытие другого проекта спрашивает подтверждение
    nd = []; pg.on('dialog', lambda d: nd.append(d.message))
    await ev("__ls.newFrom(false)"); await settle(pg, 300); nd.clear()
    await pg.fill('#lyrics', 'длинный текст песни\nвторая строка'); await settle(pg, 500)
    await ev("__ls.openProject()"); await settle(pg, 1500)
    check('несинхронизированный текст: перед открытием другого проекта спрашивает', len(nd) == 1, nd)
    check('после открытия история с нуля', await ev("[__ls.histLen(), document.querySelector('#bUndo').disabled]") == [1, True])
    # старый проект без новых полей
    old = {'version': 1, 'audioPath': '', 'audioName': '', 'lyrics': 'раз два\nтри четыре', 'words': [{'w': 'раз', 't': 1, 'e': 1.4, 'line': 0}, {'w': 'два', 't': 1.5, 'e': 1.9, 'line': 0}, {'w': 'три', 't': 2.5, 'e': 2.9, 'line': 1}, {'w': 'четыре', 't': 3, 'e': 3.6, 'line': 1}],
           'duration': 6, 'scenes': [{'a': 0, 'b': 2, 'tpl': 'chat'}, {'a': 2, 'b': 4, 'tpl': 'nonexistent-tpl'}], 'style': {'preset': 'melhor', 'format': '9:16', 'start': 0.5, 'end': 4.5}}
    pg.errs.clear()
    await ev("async(p)=>{ __ls.applyProject(p,'старый.lsp'); await __ls.afterLoad(); }", old); await settle(pg, 1200)
    check('старый проект открывается без ошибок', not pg.errs, pg.errs[:4])
    await pg.click('#sceneStrip .sc:nth-child(2)'); await settle(pg, 300)
    await ev("__ls.buildSpec(true)")
    check('старый проект: сцены и экспорт без ошибок', not pg.errs, pg.errs[:4])
    check('старый проект без трека: прежний трек не остаётся играть', await ev("!__ls.audioSrc() && !__ls.hasAudioData()"), await ev("__ls.audioSrc()"))
    # проект версии 1 (первый формат файла: без assets, fonts, custom, fx, sfx, trim, cuts, intro/outro, stickers, accents)
    v1 = {'version': 1, 'audioPath': '', 'audioName': '', 'lyrics': '', 'alFrom': '', 'alTo': '', 'words': W, 'duration': 73.37, 'perScene': 2,
          'scenes': [{'a': 0, 'b': 12, 'tpl': 'chat', 'f': {}, 'bump': '3', 'stamp': 'ОК', 'stampAt': '', 'fx': '', 'fxAt': '', 'scale': ''}, {'a': 12, 'b': len(W), 'tpl': 'notifs', 'f': {}, 'bump': '', 'stamp': '', 'stampAt': '', 'fx': '🔥', 'fxAt': '', 'scale': ''}],
          'style': {'preset': 'melhor-lenta', 'format': '9:16', 'start': 26, 'end': 41, 'artist': 'melhor', 'title': '', 'wm': 'melhor', 'wmOp': 0.2, 'part': '', 'partColor': '#ffffff', 'beat': None, 'smokeOn': False, 'smokeA': '#78aa78', 'smokeB': '#9678c8', 'lead': None, 'fade': 0.4}}
    pg.errs.clear()
    await ev("async(p)=>{ __ls.applyProject(p,'v1.lsp'); await __ls.afterLoad(); }", v1); await settle(pg, 1500)
    for i in range(2): await pg.click(f'#sceneStrip .sc:nth-child({i+1})'); await settle(pg, 200)
    for tab in ['style', 'fx', 'scene']: await ev(f"document.querySelector('.tabs button[data-tab={tab}]').click()"); await settle(pg, 150)
    await ev("__ls.buildSpec(true); __ls.exportTimings('srt'); __ls.saveProject(false)"); await settle(pg, 300)
    check('проект версии 1 открывается, редактируется и сохраняется без ошибок', not pg.errs and (await ev(PANEL)) == '', pg.errs[:3] or await ev(PANEL))
    # путь с кириллицей и пробелами
    import shutil, os
    os.makedirs('/tmp/мои треки', exist_ok=True); cyr = '/tmp/мои треки/Мой трек (финал) 2.mp3'; shutil.copy(TRACK, cyr)
    pg.errs.clear()
    await ev("async(p)=>{ __ls.applyProject({words:[], scenes:[], audioPath:p, audioName:p.split('/').pop(), style:{}}, '/tmp/мои треки/проект 1.lsp'); await __ls.afterLoad(); }", cyr); await settle(pg, 1500)
    check('трек с кириллицей и пробелами в пути открывается', await ev("document.querySelector('#audioName').textContent") == 'Мой трек (финал) 2.mp3', await ev("document.querySelector('#audioName').textContent"))
    check('имя проекта в заголовке', (await ev("document.querySelector('#projName').textContent")).startswith('проект 1.lsp'))
    check('ошибок нет', not pg.errs, pg.errs[:4])
    await pg.context.close()
    # автосохранение и восстановление
    pg = await page(b); ev = pg.evaluate
    await ev("localStorage.removeItem('ls-autosave')")
    await ev("""(png)=>{ const P=__ls.proj; P.assets.x1=png; P.style.wmImg='asset:x1'; P.scenes[0].tpl='map'; __ls.touch(); }""", PNG); await settle(pg, 500)
    s0 = await ev(STATE)
    await ev("window.__beforeClose()")
    check('автосохранение записано', await ev("!!localStorage.getItem('ls-autosave')"))
    await pg.reload(); await pg.wait_for_function('window.__ls'); await settle(pg, 800)
    check('баннер восстановления', await ev("!document.querySelector('#banner').hidden"))
    await pg.click('#bannerBtns button.primary'); await settle(pg, 1500)
    s1 = await ev(STATE)
    check('восстановление после сбоя: проект тот же', json.loads(s1)['scenes'] == json.loads(s0)['scenes'] and json.loads(s1)['style']['wmImg'] == 'asset:x1')
    check('восстановление: логотип на месте', await ev("!!__ls.proj.assets.x1"))
    check('ошибок нет', not pg.errs, pg.errs[:4])
    await pg.context.close()

def gen_words(n, dur, t0=1.0):
    out = []; step = (dur - t0 - 1) / max(1, n)
    for i in range(n): out.append({'w': ('слово%d' % i) if i % 7 else '(эй)', 't': round(t0 + i * step, 3), 'e': round(t0 + i * step + step * .8, 3), 'line': i // 4})
    return out

async def t_timeline(b):
    print('— таймлайн: размеры проекта, перетаскивание, масштаб, клики')
    for name, n, dur, track in [('пустой', 0, 0, False), ('1 слово', 1, 10, False), ('10 с', 20, 10, False), ('5 мин, 1000 слов', 1000, 300, False), ('трек + 1000 слов', 1000, 73.37, True)]:
        words = gen_words(n, dur) if n else []
        pg = await page(b, track=track, words=None); ev = pg.evaluate
        if not track: await ev("(d)=>{ __ls.proj.duration=d }", dur)
        t = await ev("""(W)=>{ const P=__ls.proj; P.words=W; const T=[]; let t=performance.now(); __ls.autoRange(); __ls.autoScenes(); T.push(performance.now()-t); t=performance.now(); __ls.renderAll(); T.push(performance.now()-t); t=performance.now(); __ls.buildSpec(true); T.push(performance.now()-t); Timeline.fit(); __ls.rebuildPreview(); __ls.histReset(); return T.map(x=>Math.round(x)) }""", words)
        await settle(pg, 1200)
        # кадры, когда ничего не играет и превью загружено (раньше таймлайн перерисовывался каждый кадр: ~50 мс на кадр при 1000 словах)
        await settle(pg, 2500)
        fr = await ev("""new Promise(r=>{ const d=[]; let n=0, t=performance.now(); const f=()=>{ const now=performance.now(); d.push(now-t); t=now; if(++n<60) requestAnimationFrame(f); else { d.sort((a,b)=>a-b); r(Math.round(d[30])) } }; requestAnimationFrame(f) })""")  # медиана — машина бывает занята другими процессами
        box = await (await pg.query_selector('#timeline')).bounding_box()
        # клики по всем рядам и за пределами, масштаб, прокрутка
        for yy in [5, 40, 80, 105, 140]:
            await pg.mouse.click(box['x'] + box['width'] * .5, box['y'] + yy)
        await pg.mouse.click(box['x'] + 2, box['y'] + 105); await pg.mouse.click(box['x'] + box['width'] - 2, box['y'] + 80)
        await pg.mouse.move(box['x'] + 300, box['y'] + 80)
        for _ in range(6): await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -400); await pg.keyboard.up('Control')
        for _ in range(6): await pg.keyboard.down('Control'); await pg.mouse.wheel(0, 2000); await pg.keyboard.up('Control')
        await pg.mouse.wheel(0, 50000); await pg.mouse.wheel(0, -100000)
        # тянуть границу сцены далеко за пределы и слово за край
        await ev("Timeline.fit()"); await settle(pg, 100)
        await pg.mouse.move(box['x'] + box['width'] * .3, box['y'] + 80); await pg.mouse.down(); await pg.mouse.move(box['x'] - 400, box['y'] + 80, steps=4); await pg.mouse.move(box['x'] + box['width'] + 400, box['y'] + 80, steps=4); await pg.mouse.up()
        await pg.mouse.move(box['x'] + box['width'] * .4, box['y'] + 110); await pg.mouse.down(); await pg.mouse.move(box['x'] - 600, box['y'] + 110, steps=5); await pg.mouse.move(box['x'] + box['width'] + 600, box['y'] + 300, steps=5); await pg.mouse.up()
        await settle(pg, 500)
        ok = await ev("""(()=>{ const P=__ls.proj, W=P.words; for(let i=1;i<W.length;i++) if(W[i].t<W[i-1].t) return 'слова не по порядку '+i; for(let i=0;i<P.scenes.length;i++){ const s=P.scenes[i]; if(!(s.a<s.b)) return 'пустая сцена '+i; if(i&&P.scenes[i-1].b!==s.a) return 'дыра между сценами '+i; } if(P.scenes.length && P.scenes[P.scenes.length-1].b!==W.length) return 'хвост слов без сцены'; return '' })()""")
        check(f'{name}: autoScenes {t[0]} мс, renderAll {t[1]} мс, buildSpec {t[2]} мс, кадр таймлайна {fr} мс', t[0] < 300 and t[1] < 400 and t[2] < 400 and fr < 40, t + [fr])
        check(f'{name}: после кликов/масштаба/перетаскиваний структура цела', ok == '', ok)
        await ev("document.querySelector('#bPlay').click()"); await settle(pg, 300); await ev("document.querySelector('#bPlay').click()")
        check(f'{name}: нет ошибок', not pg.errs, pg.errs[:3])
        await pg.context.close()

SPEC_REFS = """(()=>{ const sp=__ls.buildSpec(false), bad=[]; sp.scenes.forEach((s,k)=>{ const [a,b]=s.words; (s.punch||[]).forEach(p=>{ if(typeof p.at==='number' && (p.at<a||p.at>=b)) bad.push('сцена '+(k+1)+': '+p.style+' на слове '+p.at+' вне ['+a+','+b+')'); }); [].concat(s.fx||[]).forEach(f=>{ if(typeof f.at==='number' && (f.at<a||f.at>=b)) bad.push('сцена '+(k+1)+': эмодзи вне сцены'); }); }); return bad.join('; ') })()"""
async def t_scenes(b):
    print('— сцены: разделить/объединить/копировать/вставить/повторы/мои шаблоны')
    pg = await page(b); ev = pg.evaluate
    # акценты на последних словах сцены 1, затем разделить пополам
    await ev("""(()=>{ const P=__ls.proj, sc=P.scenes[0]; sc.tpl='chat'; sc.bump=String(sc.b-1); sc.stamp='ОК'; sc.stampAt=String(sc.b-1); sc.fx='🔥'; sc.fxAt=String(sc.b-1); __ls.renderAll(); })()""")
    await pg.click('#sceneStrip .sc:nth-child(1)'); await ev("__ls.seekTo(0)"); await pg.click('#seSplit'); await settle(pg)
    check('после разделения акценты не уходят в чужую сцену', (await ev(SPEC_REFS)) == '', await ev(SPEC_REFS))
    check('после разделения панель совпадает с проектом', (await ev(PANEL)) == '', await ev(PANEL))
    # граница сцены на таймлайне: акцент остаётся в своей сцене
    await ev("""(()=>{ const P=__ls.proj, s1=P.scenes[1], s2=P.scenes[2]; s1.bump=String(s1.b-1); s1.fx='💸'; s1.fxAt=String(s1.b-1); s1.accents=[{k:'stamp',v:'да',at:String(s1.b-1)}]; s2.a=s1.b-1; s1.b=s1.b-1; __ls.renderAll(); })()""")
    check('после сдвига границы акценты не уходят в чужую сцену', (await ev(SPEC_REFS)) == '', await ev(SPEC_REFS))
    # настоящее перетаскивание границы мышью: слово с акцентом уходит в соседнюю сцену
    await ev("""(()=>{ const P=__ls.proj; P.style.intro.on=false; P.style.outro.on=false; const s=P.scenes[2]; s.bump=String(s.a+1); s.fx='💸'; s.fxAt=String(s.a+1); __ls.renderAll(); Timeline.fit(); })()""")
    await pg.click('#sceneStrip .sc:nth-child(3)'); await settle(pg, 300)
    box = await (await pg.query_selector('#timeline')).bounding_box()
    xs = await ev("""(()=>{ const P=__ls.proj, a=+P.style.start, b=Math.max(a+1,+P.style.end), W=document.querySelector('#timeline').getBoundingClientRect().width, X=t=>(t-a)/(b-a)*W, s=P.scenes[2]; return [X(P.words[s.a].t-.05), X(P.words[s.a+2].t-.05)] })()""")
    a2 = await ev("__ls.proj.scenes[2].a")
    await pg.mouse.move(box['x'] + xs[0], box['y'] + 81); await pg.mouse.down(); await pg.mouse.move(box['x'] + xs[1] + 1, box['y'] + 81, steps=6); await pg.mouse.up(); await settle(pg, 500)
    check('граница сцены сдвинута мышью', await ev("__ls.proj.scenes[2].a") == a2 + 2 and (await ev(SPEC_REFS)) == '', await ev(SPEC_REFS))
    check('после сдвига границы мышью панель совпадает', (await ev(PANEL)) == '', await ev(PANEL))
    # объединить: с первой/последней — без ошибок
    n = await ev("__ls.proj.scenes.length")
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.click('#seMergePrev'); await settle(pg, 200)
    check('объединить с предыдущей у первой сцены — ничего не меняет', await ev("__ls.proj.scenes.length") == n)
    await ev(f"document.querySelectorAll('#sceneStrip .sc')[{n-1}].click()"); await pg.click('#seMergeNext'); await settle(pg, 200)
    check('объединить со следующей у последней — ничего не меняет', await ev("__ls.proj.scenes.length") == n)
    await pg.click('#sceneStrip .sc:nth-child(2)'); await pg.click('#seMergePrev'); await settle(pg, 300)
    check('объединение: сцен стало меньше, панель совпадает', await ev("__ls.proj.scenes.length") == n - 1 and (await ev(PANEL)) == '', await ev(PANEL))
    # мультивыделение + объединение — выделение не указывает на несуществующие сцены
    await pg.click('#sceneStrip .sc:nth-child(2)'); await pg.click('#sceneStrip .sc:nth-child(4)', modifiers=['Shift']); await pg.click('#seMergeNext'); await settle(pg, 300)
    check('после объединения выделение в пределах сцен', await ev("__ls.msel.every(i=>i<__ls.proj.scenes.length) && __ls.sel<__ls.proj.scenes.length"))
    # копировать вид / вставить во все
    await ev("""(()=>{ const P=__ls.proj; P.scenes[0].tpl='weather'; P.scenes[0].f={}; P.scenes[0].trans='zoom'; P.scenes[0].accents=[{k:'fx',v:'✨',at:String(P.scenes[0].a)}]; __ls.renderAll(); })()""")
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.keyboard.press('Control+c'); await pg.keyboard.press('Control+a'); await pg.keyboard.press('Control+v'); await settle(pg)
    r = await ev("__ls.proj.scenes.map(s=>s.tpl+'/'+s.trans)")
    check('вставить вид во все сцены', all(x == 'weather/zoom' for x in r), r)
    check('вставка: акценты на словах своих сцен', (await ev(SPEC_REFS)) == '', await ev(SPEC_REFS))
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('вставка отменяется одним шагом', len(set(await ev("__ls.proj.scenes.map(s=>s.tpl)"))) > 1)
    # вид с картинкой копируется и вставляется в другой проект
    await ev("""(png)=>{ const P=__ls.proj; P.assets.lookimg=png; P.scenes[0].tpl='post'; P.scenes[0].f={img:'asset:lookimg'}; __ls.renderAll(); }""", PNG)
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.keyboard.press('Control+c')
    await ev("__ls.newFrom(false)"); await settle(pg, 300)
    await ev("(W)=>{ const P=__ls.proj; P.words=JSON.parse(JSON.stringify(W)); P.duration=73.37; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); }", W)
    await pg.click('#sceneStrip .sc:nth-child(2)'); await pg.keyboard.press('Control+v'); await settle(pg, 300)
    img = await ev("(()=>{ const w=__ls.buildSpec(false).scenes[1].widget; return w && w.avatar && w.avatar.img })()")
    check('вид с картинкой вставляется в другой проект вместе с картинкой', bool(img) and img.startswith('data:image'), img)
    # мои шаблоны: картинка в блоке конструктора переносится в другой проект
    await ev("""(png)=>{ const P=__ls.proj; P.assets.blkimg=png; P.scenes[0].tpl='blocks'; P.scenes[0].f={blocks:[{type:'image',img:'asset:blkimg',h:200}], dark:false}; __ls.renderAll(); }""", PNG)
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.click('#seSaveTpl'); await pg.fill('#seTplNameIn', 'мой блок'); await pg.click('#seSaveTplGo'); await settle(pg, 400)
    await ev("__ls.newFrom(false)"); await settle(pg, 300)
    await ev("(W)=>{ const P=__ls.proj; P.words=JSON.parse(JSON.stringify(W)); P.duration=73.37; __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); }", W)
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.click('#seTpl'); await pg.click('#gGrid .tp[data-u="мой блок"]'); await settle(pg)
    img = await ev("(()=>{ const w=__ls.buildSpec(false).scenes[0].widget; return w && w.blocks && w.blocks[0].img })()")
    check('мой шаблон с картинкой в блоке работает в новом проекте', bool(img) and img.startswith('data:image'), img)
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

async def t_timings(b):
    print('— тайминги LRC/SRT: разбор, импорт, экспорт')
    pg = await page(b); ev = pg.evaluate
    P = lambda txt: ev("(t)=>__ls.parseTimings(t).map(l=>[+l.t.toFixed(3), l.e==null?null:+l.e.toFixed(3), l.text])", txt)
    check('пустой файл → нет строк', await P('') == [])
    check('текст без времени → нет строк', await P('просто текст\nвторая строка') == [])
    r = await P('﻿[ar:Артист]\r\n[ti:Песня]\r\n[00:10.50]первая\r\n[00:12.00]вторая\r\n')
    check('LRC с BOM, метками и \\r\\n', r == [[10.5, None, 'первая'], [12.0, None, 'вторая']], r)
    r = await P('[01:02:03.50]через час\n[61:00.00]минуты > 59')
    check('LRC: время больше часа', [x[0] for x in r] == [3660.0, 3723.5], r)
    r = await P('﻿1\r\n01:02:03,500 --> 01:02:05,000\r\nчас и две минуты\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\n<i>курсив</i>\r\n')
    check('SRT: BOM, \\r\\n, часы, теги, порядок по времени', r == [[5.0, 7.0, 'курсив'], [3723.5, 3725.0, 'час и две минуты']], r)
    r = await P('WEBVTT\n\n00:01.000 --> 00:02.500\nвтт строка\n\n00:00:03 --> 00:00:04\nбез миллисекунд\n')
    check('VTT и время без миллисекунд', r == [[1.0, 2.5, 'втт строка'], [3.0, 4.0, 'без миллисекунд']], r)
    # импорт: слова по порядку, проект цел
    await ev("(t)=>__ls.importTimings(t,'x.srt')", '1\n00:00:30,000 --> 00:00:32,000\nвторая строка тут\n\n2\n00:00:28,000 --> 00:00:30,500\nпервая строка (эй)\n')
    await settle(pg, 400)
    ws = await ev("__ls.proj.words.map(w=>[w.w,w.t,w.line,!!w.adlib])")
    check('импорт SRT: слова по возрастанию времени', all(ws[i][1] <= ws[i + 1][1] for i in range(len(ws) - 1)), ws)
    check('импорт: адлиб в скобках отмечен', any(w[0] == '(эй)' and w[3] for w in ws), ws)
    check('импорт: сцены покрывают все слова', await ev("__ls.proj.scenes.length>0 && __ls.proj.scenes[__ls.proj.scenes.length-1].b===__ls.proj.words.length"))
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('импорт отменяется одним шагом', await ev("__ls.proj.words.length") == len(W))
    # экспорт LRC: округление до 60 секунд
    await ev("""(()=>{ const P=__ls.proj; P.words[0].t=59.996; P.words[0].line=-1; })()""")
    await ev("__ls.exportTimings('lrc')"); await settle(pg, 200)
    first = await ev("window.__savedText.text.split('\\n')[0]")
    check('LRC: 59,996 с пишется как [01:00.00], а не [00:60.00]', first.startswith('[01:00.00]'), first)
    # экспорт SRT с вырезанным проигрышем
    await ev("""(W)=>{ const P=__ls.proj; P.words=JSON.parse(JSON.stringify(W)); P.words.forEach(w=>{ if(w.line>=4){ w.t+=10; w.e+=10; } }); P.style.start=20; P.style.end=73; P.style.intro.on=false; P.style.outro.on=false; P.style.cuts=[{a:35,b:43,on:true}]; }""", W)
    await ev("__ls.exportTimings('srt')"); await settle(pg, 200)
    srt = await ev("window.__savedText.text")
    cues = await ev("(t)=>__ls.parseTimings(t).map(l=>[l.t,l.e,l.text])", srt)
    lines = await ev("""(()=>{ const L=[]; __ls.proj.words.forEach(w=>{ const l=L[L.length-1]; if(!l||l.line!==w.line) L.push({line:w.line,t:w.t,e:w.e}); else l.e=w.e; }); return L })()""")
    after = [l for l in lines if l['t'] >= 43]
    exp0 = round(after[0]['t'] - 20 - 8, 2) if after else None
    got = [c for c in cues if abs(c[0] - exp0) < .02] if after else []
    check('SRT: время после выреза сдвинуто на длину выреза', bool(got), (exp0, cues[:8]))
    check('SRT: подписи не перекрываются', all(cues[i][1] <= cues[i + 1][0] + 1e-6 for i in range(len(cues) - 1)), cues)
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

async def t_words(b):
    print('— слова и текст: повторная синхронизация, ±, скобки')
    pg = await page(b); ev = pg.evaluate
    lyr = await ev("""(()=>{ const L=[]; __ls.proj.words.forEach(w=>{ (L[w.line]=L[w.line]||[]).push(w.w) }); return L.map(x=>x.join(' ')).join('\\n') })()""")
    await ev("(t)=>{ document.querySelector('#lyrics').value=t; __ls.proj.lyrics=t; }", lyr)
    # настроили сцены, исправили слово в тексте, синхронизировали заново
    await ev("""(()=>{ const P=__ls.proj; P.scenes[1].tpl='weather'; P.scenes[1].f={city:'Москва'}; P.scenes[1].bump=String(P.scenes[1].a+1); P.scenes[2].tpl='map'; P.words[3].acc={color:'#ff0000'}; __ls.renderAll(); __ls.histReset(); })()""")
    await ev("""(()=>{ window.api.align=async(a)=>{ const W=JSON.parse(JSON.stringify(__ls.proj.words)).map(w=>{ delete w.acc; return w }); W[2].w='проснулся!'; W.forEach(w=>{ w.t+=.01; w.e+=.01 }); return {words:W, median:.5}; }; })()""")
    before = await ev("__ls.proj.scenes.map(s=>[s.a,s.b,s.tpl])")
    await pg.click('#bAlign'); await settle(pg, 800)
    after = await ev("__ls.proj.scenes.map(s=>[s.a,s.b,s.tpl])")
    check('повторная синхронизация с тем же числом строк сохраняет сцены', after == before, (before[:4], after[:4]))
    check('… и поля, акценты сцены и слова', await ev("[__ls.proj.scenes[1].f.city, __ls.proj.scenes[1].bump===String(__ls.proj.scenes[1].a+1), !!__ls.proj.words[3].acc]") == ['Москва', True, True])
    check('панель совпадает', (await ev(PANEL)) == '', await ev(PANEL))
    await pg.keyboard.press('Control+z'); await settle(pg, 300)
    check('синхронизация отменяется', await ev("__ls.proj.words[2].w") != 'проснулся!')
    # другое число строк — сцены пересобираются без ошибок
    await ev("""(()=>{ window.api.align=async(a)=>{ const W=JSON.parse(JSON.stringify(__ls.proj.words)); W.forEach(w=>{ w.line=Math.floor(w.line/2) }); return {words:W, median:.5}; }; })()""")
    await pg.click('#bAlign'); await settle(pg, 800)
    check('другое число строк: сцены покрывают все слова', await ev("__ls.proj.scenes[__ls.proj.scenes.length-1].b===__ls.proj.words.length && __ls.proj.scenes[0].a===0"))
    # кнопки ± на вкладке «Слова» не переставляют слова местами
    await ev("document.querySelectorAll('#left .tabs button').forEach(b=>{ if(b.dataset.tab==='words') b.click(); })"); await settle(pg, 200)
    for _ in range(30): await ev("document.querySelectorAll('#wordList .w')[0].querySelectorAll('button')[1].click()")
    for _ in range(30): await ev("document.querySelectorAll('#wordList .w')[2].querySelectorAll('button')[0].click()")
    await settle(pg, 500)
    ok = await ev("__ls.proj.words.every((w,i,a)=>!i||w.t>a[i-1].t)")
    check('± у слова не обгоняет соседние слова', ok, await ev("__ls.proj.words.slice(0,4).map(w=>w.t)"))
    # незакрытая скобка не прячет всю песню
    await ev("""(()=>{ const P=__ls.proj; P.words=[{w:'раз',t:1,e:1.2,line:0},{w:'(эй',t:1.3,e:1.5,line:0},{w:'два',t:1.6,e:1.8,line:0},{w:'три',t:2,e:2.2,line:1},{w:'четыре',t:2.3,e:2.5,line:1},{w:'(да)',t:2.6,e:2.8,line:1}]; })()""")
    await ev("(t)=>{ window.api.align=async()=>({words:JSON.parse(JSON.stringify(__ls.proj.words)).map(w=>{delete w.adlib; return w}), median:.5}); }", '')
    await ev("document.querySelector('#bAlign').click()"); await settle(pg, 500)
    ad = await ev("__ls.proj.words.map(w=>!!w.adlib)")
    check('незакрытая «(» действует только до конца строки', ad == [False, True, True, False, False, True], ad)
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

CYR = """(()=>{ const out=[]; const vis=el=>{ for(let e=el;e;e=e.parentElement){ if(e.hidden) return false; const cs=getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden') return false; } return true };
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; while(n=w.nextNode()){ const el=n.parentElement; if(!el||el.closest('[data-notr],textarea,script,style,#langBtn,#sceneStrip .t,#seText,#wordList,#gGrid .tp span.n')) continue; if(/[а-яё]/i.test(n.nodeValue) && vis(el)) out.push(n.nodeValue.trim().slice(0,90)); }
  document.querySelectorAll('[title],[placeholder]').forEach(el=>{ if(el.closest('[data-notr]')||!vis(el)) return; ['title','placeholder'].forEach(a=>{ const v=el.getAttribute(a); if(v && /[а-яё]/i.test(v)) out.push(a+': '+v.slice(0,90)); }); });
  document.querySelectorAll('select option').forEach(o=>{ if(o.closest('[data-notr]')||o.hasAttribute('data-notr')||!vis(o.parentElement)) return; if(/[а-яё]/i.test(o.textContent)) out.push('option: '+o.textContent.slice(0,60)); });
  return [...new Set(out)] })()"""
async def t_english(b):
    print('— английский интерфейс: видимый русский текст')
    pg = await page(b, lang='en'); ev = pg.evaluate
    # имена файлов и текст песни — данные пользователя, их не переводим
    allowed = lambda s: any(x in s for x in ['serega', 'слово', 'я только', 'Москва', 'melhor', '{лав}', '{одинноль}'])  # пример подсказки произношения — намеренно по-русски
    found = {}
    async def scan(where):
        for s in await ev(CYR):
            if not allowed(s): found.setdefault(s, where)
    await scan('главное окно')
    for tab in ['words', 'track']:
        await ev(f"document.querySelector('#left .tabs button[data-tab={tab}]').click()"); await settle(pg, 200); await scan('вкладка ' + tab)
    for tab in ['style', 'fx', 'scene']:
        await ev(f"document.querySelector('#right .tabs button[data-tab={tab}], .tabs button[data-tab={tab}]').click()"); await settle(pg, 200); await scan('вкладка ' + tab)
    for tpl in ['blocks', 'chat', 'imsg-dialog', 'weather', 'kin-pop']:
        await ev(f"(()=>{{ const sc=__ls.proj.scenes[0]; sc.tpl='{tpl}'; sc.f={{}}; sc.tpl2='post'; sc.accents=[{{k:'bump',at:''}},{{k:'stamp',v:'',at:''}},{{k:'fx',v:'',at:''}}]; __ls.renderAll(); }})()"); await settle(pg, 200); await scan('сцена ' + tpl)
    await pg.click('#sceneStrip .sc:nth-child(1)'); await pg.click('#sceneStrip .sc:nth-child(3)', modifiers=['Shift']); await scan('мультивыделение')
    await ev("(()=>{ const P=__ls.proj; P.scenes[2].tpl=P.scenes[0].tpl; __ls.renderAll(); })()")
    for m in ['#bOpen', '#bSave', '#bNew', '#bHelp']:
        await pg.click(m); await settle(pg, 300); await scan('меню ' + m); await pg.mouse.click(5, 5)
    await pg.click('#seTpl'); await settle(pg, 300); await scan('галерея'); await ev("document.querySelector('#gClose').click()")
    await ev("__ls.proj.style.cuts=[{a:30,b:35,on:true}]; __ls.renderAll()")
    await ev("document.querySelector('#bExport').click()"); await settle(pg, 300); await scan('экспорт')
    for c in ['gif', 'sticker', 'mov']:
        await ev(f"document.querySelector('#xCont button[data-v={c}]').click()"); await scan('экспорт ' + c)
    await ev("document.querySelector('#xCont button[data-v=mp4]').click(); document.querySelector('#xQAdd').click(); document.querySelector('#xPlat button[data-v=tiktok]') && document.querySelector('#xPlat button[data-v=tiktok]').click()"); await scan('экспорт: очередь')
    await ev("document.querySelector('#exportModal').hidden=true")
    for btn, modal in [('#bProfile', '#profileModal')]:
        await pg.click(btn); await settle(pg, 300); await scan('профиль'); await ev(f"document.querySelector('{modal}').hidden=true")
    await ev("document.querySelector('#keysModal').hidden=false"); await scan('клавиши'); await ev("document.querySelector('#keysModal').hidden=true")
    for el in ['#wordMenu', '#dropOv', '#seSaveTplBox', '#licModal']:
        await ev(f"document.querySelector('{el}').hidden=false"); await settle(pg, 150); await scan(el); await ev(f"document.querySelector('{el}').hidden=true")
    await ev("window.__batchFiles=[{path:'/x/a.mp3',name:'a.mp3'}]; document.querySelector('#newMenu button[data-act=batch]').click()"); await settle(pg, 200); await ev("document.querySelector('#bmAdd').click()"); await settle(pg, 200); await scan('пакет'); await ev("document.querySelector('#batchModal').hidden=true")
    await ev("document.querySelector('#helpMenu button[data-act=models]').click()"); await settle(pg, 400); await scan('модели'); await ev("document.querySelector('#mdModal').hidden=true")
    await ev("document.querySelector('#helpMenu button[data-act=selftest]').click()"); await settle(pg, 1500); await scan('проверка системы'); await ev("document.querySelector('#stModal').hidden=true")
    await ev("document.querySelector('#xCover').click()"); await settle(pg, 800); await scan('обложки'); await ev("document.querySelector('#coverModal').hidden=true")
    # статусы и баннеры
    await ev("window.api.align=async()=>({words:JSON.parse(JSON.stringify(__ls.proj.words)), median:.1}); document.querySelector('#lyrics').value='а б'; document.querySelector('#bAlign').click()"); await settle(pg, 800); await scan('статус синхронизации')
    await ev("(()=>{ const P=__ls.proj; const ad=P.audioName; P.audioName=''; document.querySelector('#audioName').textContent=(P.audioName||'трек')+' — не найден'; })()"); await scan('трек не найден')
    await ev("""(()=>{ __ls.banner && 0; })()""")
    # пустой проект: превью «Нет текста»
    await ev("__ls.newFrom(false)"); await settle(pg, 800)
    pv = await ev("document.querySelector('#preview').srcdoc")
    if 'Нет текста' in pv: found['превью: Нет текста'] = 'пустой проект'
    await scan('пустой проект')
    # баннер после аварийного завершения
    await ev("(W)=>{ localStorage.setItem('ls-autosave', JSON.stringify({words:W, lyrics:'x', audioName:'a.mp3', scenes:[], style:{}})) }", W)
    await pg.add_init_script("window.__fakeCrash={reason:'oom'}"); await pg.reload(); await pg.wait_for_function('window.__ls'); await settle(pg, 800)
    await scan('баннер после сбоя')
    bt = await ev("document.querySelector('#banner').hidden ? '' : document.querySelector('#bannerText').textContent")
    check('баннер после сбоя по-английски', bt.startswith('The last session ended unexpectedly (oom). An autosave'), bt)
    await pg.click('#bannerBtns button.primary'); await settle(pg, 1200)
    check('после «Восстановить проект» баннер скрывается (повторный клик не затрёт новую работу)', await ev("document.querySelector('#banner').hidden") and await ev("__ls.proj.words.length") == len(W))
    for s, w in found.items(): print('     ', w, '→', s)
    check('в английском интерфейсе не осталось русского текста', not found, len(found))
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

async def t_presets(b):
    print('— пресеты и форматы')
    pg = await page(b); ev = pg.evaluate
    await ev("localStorage.removeItem('ls-presets')")
    await pg.click('#right .tabs button[data-tab=style]') if await ev("!!document.querySelector('#right .tabs')") else await ev("document.querySelector('.tabs button[data-tab=style]').click()")
    await settle(pg, 200)
    await pg.click('#fmt button[data-v="1:1"]'); await settle(pg, 200)
    keys = await ev("[...document.querySelectorAll('#presetGrid .pr')].map(d=>d.dataset.k)")
    words0 = await ev("JSON.stringify(__ls.proj.words)+JSON.stringify(__ls.proj.scenes)")
    for k in keys:
        await pg.click(f'#presetGrid .pr[data-k="{k}"]'); await settle(pg, 250)
        await ev("__ls.buildSpec(true)")
    await settle(pg, 1500)
    check('все пресеты подряд: формат, выбранный пользователем, не сбрасывается', await ev("__ls.proj.style.format") == '1:1', await ev("__ls.proj.style.format"))
    check('все пресеты подряд: слова и сцены не меняются', await ev("JSON.stringify(__ls.proj.words)+JSON.stringify(__ls.proj.scenes)") == words0)
    check('превью собралось без ошибки движка', await ev("!document.querySelector('#preview').contentWindow.__err"), await ev("document.querySelector('#preview').contentWindow.__err"))
    # форматы туда-обратно
    s0 = json.loads(await ev(STATE))
    for f in ['16:9', '4:5', '1:1', '9:16', '16:9', '1:1']:
        await pg.click(f'#fmt button[data-v="{f}"]'); await settle(pg, 300)
        sz = await ev("[document.querySelector('#preview').width, document.querySelector('#preview').height]")
    await settle(pg, 800)
    s1 = json.loads(await ev(STATE)); s0['style'].pop('format'); s1['style'].pop('format')
    check('формат туда-обратно не меняет остальной проект', s0 == s1)
    check('размер превью соответствует 1:1', await ev("[+document.querySelector('#preview').width, +document.querySelector('#preview').height]") == [720, 720])
    # свой пресет: сохранить, экспорт, импорт, удалить
    await pg.fill('#presetName', 'мой стиль'); await pg.click('#bSavePreset'); await settle(pg, 500)
    check('свой пресет сохранён и выбран', await ev("__ls.proj.style.preset") == 'мой стиль')
    await pg.click('#bPresetExport'); await settle(pg, 300)
    exp = await ev("window.__lastPreset")
    await ev("(j)=>{ window.__importPreset={name:'x.lspreset', json:j}; }", exp)
    await pg.click('#bPresetImport'); await settle(pg, 500)
    names = await ev("Object.keys(JSON.parse(localStorage.getItem('ls-presets')))")
    check('импорт того же пресета не плодит копию', names == ['мой стиль'], names)
    await ev("(j)=>{ window.__importPreset={name:'bad.lspreset', json:'null'}; }", exp); await pg.click('#bPresetImport'); await settle(pg, 300)
    await ev("(j)=>{ window.__importPreset={name:'bad2.lspreset', json:'{\"preset\":null}'}; }", exp); await pg.click('#bPresetImport'); await settle(pg, 300)
    names = await ev("Object.keys(JSON.parse(localStorage.getItem('ls-presets')))")
    check('битый файл пресета не добавляется', names == ['мой стиль'], names)
    await ev("document.querySelector('#presetGrid .pr.user .del').click()"); await settle(pg, 500)
    check('удаление своего пресета', await ev("__ls.proj.style.preset") == 'melhor-lenta' and await ev("!document.querySelector('#presetGrid .pr.user')"))
    check('нет ошибок', not [e for e in pg.errs if 'не похож на пресет' not in e], pg.errs[:4])
    await pg.context.close()

async def t_batch(b):
    print('— пакетная обработка не теряет несохранённый проект')
    pg = await page(b); ev = pg.evaluate
    await ev("(()=>{ __ls.proj.scenes[0].tpl='map'; __ls.touch(); })()"); await settle(pg, 600)
    s0 = await ev(STATE)
    await ev("(W)=>{ window.api.align=async()=>({words:JSON.parse(JSON.stringify(W)), median:.5}); window.__fakeExportOk=true; window.__batchFiles=[{path:'%s', name:'b.mp3'}]; }" % TRACK, W)
    await ev("document.querySelector('#newMenu button[data-act=batch]').click()"); await ev("document.querySelector('#bmAdd').click()"); await settle(pg, 200)
    await ev("document.querySelector('#bmList textarea').value='раз два'; document.querySelector('#bmList textarea').dispatchEvent(new Event('input'))")
    await ev("document.querySelector('#bmGo').click()")
    await pg.wait_for_function("!document.querySelector('#bmStop') || document.querySelector('#bmStop').hidden", timeout=60000); await settle(pg, 1500)
    check('после пакета открыт прежний проект', json.loads(await ev(STATE))['scenes'] == json.loads(s0)['scenes'])
    check('после пакета несохранённые изменения остаются несохранёнными (•)', await ev("document.querySelector('#projName').textContent.endsWith('•')"), await ev("document.querySelector('#projName').textContent"))
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

async def t_templates(b):
    print('— все шаблоны: сцена из одного слова, только из адлибов, обычная')
    words = [{'w': 'одно', 't': 1, 'e': 1.4, 'line': 0}, {'w': '(эй)', 't': 2, 'e': 2.3, 'line': 1}, {'w': '(да', 't': 2.4, 'e': 2.6, 'line': 1}, {'w': 'да)', 't': 2.7, 'e': 2.9, 'line': 1}] + gen_words(12, 12, 3.5)
    for w in words[4:]: w['line'] += 2
    pg = await page(b, track=False, words=words); ev = pg.evaluate
    r = await ev("""(()=>{ const P=__ls.proj, bad=[]; P.scenes=[{a:0,b:1},{a:1,b:4},{a:4,b:P.words.length}].map(x=>Object.assign({tpl:'chat',f:{},bump:'',stamp:'',stampAt:'',fx:'',fxAt:'',scale:''},x));
      const ids=TEMPLATES.map(t=>t.id); const errs=[]; const ce=console.error; console.error=(...a)=>errs.push(String(a[0]&&a[0].stack||a[0]));
      for(const id of ids){ P.scenes.forEach(sc=>{ sc.tpl=id; sc.f={}; }); for(const ad of ['chip','inline','none']){ P.style.adlibs=ad; try{ __ls.buildSpec(true); __ls.renderAll(); }catch(e){ bad.push(id+'/'+ad+': '+e.message) } } if(errs.length){ bad.push(id+': '+errs[0].split(String.fromCharCode(10))[0]); errs.length=0; } }
      console.error=ce; return bad })()""")
    check('все шаблоны собираются для коротких и адлиб-сцен', not r, r[:6])
    check('нет ошибок', not pg.errs, pg.errs[:4])
    await pg.context.close()

TESTS = {'templates': t_templates, 'batch': t_batch, 'undo': t_undo, 'project': t_project, 'timeline': t_timeline, 'scenes': t_scenes, 'timings': t_timings, 'words': t_words, 'english': t_english, 'presets': t_presets}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for k, f in TESTS.items():
            if ONLY and k not in ONLY: continue
            try: await f(b)
            except Exception as e: check(k + ': сценарий упал', False, repr(e))
        await b.close()
    print('\nИТОГ:', 'всё ok' if not FAIL else 'FAIL: ' + ', '.join(FAIL))
    sys.exit(1 if FAIL else 0)
asyncio.run(main())
