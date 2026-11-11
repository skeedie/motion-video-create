"""Сценарии редактора (перенесены из ручных проверок t37/t61/t62). Каждый тест получает фабрику окон
`open_app(lang=..., viewport=...)` и падает через check()/исключение. Окно закрывается раннером."""
from common import check

# Строка-«ловушка» и полезные нагрузки для проверки экранирования
XSS_SCRIPT = '<script>window.__xss=(window.__xss||0)+1</script>'
XSS_IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">'
LT = 'a<b'

VISIBLE = "(s)=>{ const e=document.querySelector(s); if(!e) return false; const r=e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width>0 && r.height>0; }"


def t_load(open_app):
    a = open_app()
    check(a.js("!!(window.TEMPLATES && TEMPLATES.length)"), 'нет списка шаблонов')
    a.load_track()
    r = a.js("""(()=>({ name: document.querySelector('#audioName').textContent, dur: __ls.proj.duration,
        bpm: +document.querySelector('#bpmIn').value, bpmW: Math.round(document.querySelector('#bpmIn').getBoundingClientRect().width),
        beats: __ls.beatInfo ? __ls.beatInfo.beats.length : 0 }))()""")
    check('test-track' in r['name'], 'имя трека не показано', r)
    check(abs(r['dur'] - 48) < 1, 'длительность трека', r)
    check(any(abs(r['bpm'] - x) <= 3 for x in (60, 120, 240)), 'темп синтетического трека (120 BPM) не распознан', r)
    check(r['beats'] > 40, 'мало долей в анализе ритма', r)
    check(r['bpmW'] >= 50, 'поле темпа слишком узкое', r)
    a.no_errors('загрузка')


def t_autoscenes(open_app):
    a = open_app().ready()
    r = a.js("""(()=>{ const P=__ls.proj, S=P.scenes, ids=new Set(TEMPLATES.map(t=>t.id)); let gaps=[];
        for(let i=1;i<S.length;i++) if(S[i].a!==S[i-1].b) gaps.push(i);
        const spec=__ls.buildSpec(true);
        return { n:S.length, first:S[0]&&S[0].a, last:S[S.length-1]&&S[S.length-1].b, words:P.words.length, gaps,
          badTpl:S.filter(s=>!ids.has(s.tpl)).map(s=>s.tpl), specScenes:spec.scenes.length, specWords:spec.words.length,
          strip:document.querySelectorAll('#sceneStrip .sc').length, start:+P.style.start, end:+P.style.end } })()""")
    check(r['n'] >= 3, 'автосцен слишком мало', r)
    check(r['first'] == 0 and r['last'] == r['words'] and not r['gaps'], 'сцены не покрывают слова подряд', r)
    check(not r['badTpl'], 'сцена с неизвестным шаблоном', r)
    check(r['specScenes'] == r['n'] and r['specWords'] == r['words'], 'buildSpec потерял сцены/слова', r)
    check(r['strip'] == r['n'], 'лента сцен не совпадает с числом сцен', r)
    check(r['start'] <= 26.44 and r['end'] >= 40, 'отрезок ролика не охватывает слова', r)
    a.fresh_preview()
    a.no_errors('автосцены')


def t_tabs_and_dialogs(open_app):
    a = open_app().ready()
    for tab in ('track', 'words', 'scene', 'style', 'fx'):
        a.tab(tab)
        r = a.js("(n)=>{ const p=[...document.querySelectorAll(`[data-pane=\"${n}\"]`)]; return p.map(x=>[!x.hidden, x.getBoundingClientRect().height, x.textContent.trim().length]) }", tab)
        check(r and all(v[0] and v[1] > 20 and v[2] > 0 for v in r), f'вкладка {tab} пустая или не открылась', r)
    a.tab('words')
    check(a.js("document.querySelectorAll('#wordList .w').length") == len(a.env.words), 'список слов не совпадает с проектом')
    a.tab('style')
    check(a.js("document.querySelectorAll('#presetGrid .pr').length") >= 5, 'нет пресетов')
    # меню
    for btn, menu in (('#bNew', '#newMenu'), ('#bOpen', '#openMenu'), ('#bSave', '#saveMenu'), ('#bHelp', '#helpMenu')):
        a.page.click(btn); a.wait(150)
        check(a.js(VISIBLE, menu), f'меню {menu} не открылось')
        a.page.keyboard.press('Escape'); a.page.mouse.click(700, 500); a.wait(100)
    # окна
    def modal(open_js, sel):
        a.js(open_js); a.wait(400)
        check(a.js(VISIBLE, sel), f'окно {sel} не открылось')
        a.js("(s)=>{ document.querySelector(s).hidden=true }", sel)
    modal("document.querySelector('#seTpl').click()", '#gallery')
    check(a.js("document.querySelectorAll('#gGrid > *').length") >= 10, 'галерея шаблонов пустая')
    modal("document.querySelector('#bExport').click()", '#exportModal')
    modal("document.querySelector('#bProfile').click()", '#profileModal')
    for act, sel in (('keys', '#keysModal'), ('licenses', '#licModal'), ('models', '#mdModal'), ('selftest', '#stModal')):
        modal(f"(()=>{{ document.querySelector('#bHelp').click(); document.querySelector('#helpMenu button[data-act={act}]').click(); }})()", sel)
    check(len(a.js("document.querySelector('#licText').textContent")) > 100, 'текст лицензий не загрузился')
    modal("(()=>{ document.querySelector('#bNew').click(); document.querySelector('#newMenu button[data-act=batch]').click(); })()", '#batchModal')
    a.no_errors('вкладки и окна')


def t_scene_fields(open_app):
    a = open_app().ready()
    a.js("(()=>{ const P=__ls.proj; P.scenes[0].tpl='imsg-dialog'; P.scenes[0].f={}; __ls.renderAll(); })()"); a.wait(300)
    labels = a.js("[...document.querySelectorAll('#seFields label, #seFields .lbl')].map(x=>x.textContent).filter(x=>/аватар|avatar/i.test(x))")
    check(labels, 'у шаблона imsg-dialog нет поля цвета аватара')
    col = a.js("(()=>{ __ls.proj.scenes[0].f.color='#00AAFF'; return __ls.buildSpec(false).scenes[0].widget.avatar.color })()")
    check('#00AAFF' in str(col), 'цвет аватара не попал в задание', col)
    a.no_errors()


def t_accents(open_app):
    a = open_app().ready()
    a.js("(()=>{ const P=__ls.proj; P.scenes[0].tpl='toggles'; P.scenes[0].f={}; __ls.renderAll(); })()"); a.wait(200)
    a.tab('scene')
    for _ in range(3):
        a.page.click('#seAccAdd')
    a.wait(200)
    check(a.js("document.querySelectorAll('#seAccList .accRow').length") == 3, 'строки акцентов не добавились')
    a.js("(()=>{ const rows=document.querySelectorAll('#seAccList .accRow'); const el=rows[1].querySelector('[data-f=k]'); el.value='stamp'; el.dispatchEvent(new Event('change',{bubbles:true})); })()"); a.wait(150)
    a.js("(()=>{ const rows=document.querySelectorAll('#seAccList .accRow'); const v=rows[1].querySelector('[data-f=v]'); v.value='ОК'; v.dispatchEvent(new Event('input',{bubbles:true})); const k=rows[2].querySelector('[data-f=k]'); k.value='fx'; k.dispatchEvent(new Event('change',{bubbles:true})); })()"); a.wait(150)
    a.js("(()=>{ const rows=document.querySelectorAll('#seAccList .accRow'); const el=rows[2].querySelector('[data-f=v]'); el.value='🔥'; el.dispatchEvent(new Event('input',{bubbles:true})); const at=rows[0].querySelector('[data-f=at]'); at.value=at.options[2].value; at.dispatchEvent(new Event('change',{bubbles:true})); })()"); a.wait(500)
    r = a.js("(()=>{ const s=__ls.buildSpec(false).scenes[0]; return { acc: __ls.proj.scenes[0].accents, punch:(s.punch||[]).map(p=>p.style+':'+p.at), fx:s.fx } })()")
    kinds = [x.get('k') for x in r['acc']]
    check(kinds == ['bump', 'stamp', 'fx'], 'акценты сцены не сохранились', r)
    check(r['acc'][1].get('v') == 'ОК' and r['acc'][2].get('v') == '🔥', 'значения акцентов не сохранились', r)
    check(any(p.startswith('bump:') for p in r['punch']) and any(p.startswith('stamp:') for p in r['punch']), 'акценты не попали в задание (punch)', r)
    check(r['fx'] and r['fx'].get('emoji') == '🔥', 'эффект-эмодзи не попал в задание', r)
    a.no_errors()


def t_scene_copy_paste(open_app):
    a = open_app().ready(preview=False)
    r = a.js("""()=>{ const P=__ls.proj, s0=P.scenes[0], s2=P.scenes[2]; s0.tpl='list'; s0.accents=[{k:'bump',at:String(s0.a+1)},{k:'fx',v:'🔥',at:''}]; __ls.renderAll(); return [s0.a,s2.a]; }""")
    a.page.click('#sceneStrip .sc:nth-child(1)'); a.page.keyboard.press('Control+c')
    a.page.click('#sceneStrip .sc:nth-child(3)'); a.page.keyboard.press('Control+v'); a.wait(300)
    s2 = a.js("JSON.parse(JSON.stringify(__ls.proj.scenes[2]))")
    check(s2['tpl'] == 'list', 'вид сцены не вставился', s2)
    acc = s2.get('accents') or []
    check([x['k'] for x in acc] == ['bump', 'fx'], 'акценты не скопировались', acc)
    check(acc[0]['at'] == str(r[1] + 1), 'акцент на слове не сдвинулся на соответствующее слово новой сцены', r, acc)
    a.no_errors()


def t_two_cards(open_app):
    a = open_app().ready()
    sc = a.js("""async()=>{ const P=__ls.proj; P.scenes[0].tpl2='player'; P.scenes[0].f2={}; const old=document.querySelector('#preview').contentWindow; if(old) old.__stale=1; await __ls.rebuildPreview();
        const t0=Date.now(); let cw; while(Date.now()-t0<20000){ cw=document.querySelector('#preview').contentWindow; if(cw&&!cw.__stale&&cw.READY===true&&(cw.seek||cw.seekAsync)) break; await new Promise(r=>setTimeout(r,100)); }
        await new Promise(r=>setTimeout(r,300)); if(cw.seekAsync) await cw.seekAsync(P.words[P.scenes[0].b-1].t); else cw.seek(P.words[P.scenes[0].b-1].t);
        return [...cw.document.querySelectorAll('.wslot')].filter(e=>e.offsetParent).map(e=>e.style.scale); }""")
    check(len(sc) >= 2, 'вторая карточка сцены не видна', sc)
    nums = [float(x) for x in sc if x not in ('', None)]
    check(all(0.3 <= x <= 1.5 for x in nums), 'подгонка сломала масштаб карточек', sc)
    a.no_errors()


def t_timings(open_app):
    a = open_app().ready(preview=False)
    a.menu('#bSave', 'lrc')
    lrc = a.js("window.__savedText")
    check(lrc and lrc['ext'] == 'lrc', 'LRC не сохранён', lrc)
    lines = lrc['text'].strip().split('\n')
    check(len(lines) == 8 and lines[0] == '[00:26.44]я только проснулся уже сипнул дымчика', 'неверный LRC', lines[:3])
    check(all(l.startswith('[00:') for l in lines), 'строки LRC без времени', lines)
    a.menu('#bSave', 'srt')
    srt = a.js("window.__savedText")
    check(srt and srt['ext'] == 'srt', 'SRT не сохранён', srt)
    blocks = srt['text'].strip().split('\n\n')
    check(len(blocks) == 8, 'в SRT не 8 блоков', blocks[:3])
    b0 = blocks[0].split('\n')
    import re
    check(b0[0] == '1' and re.match(r'^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$', b0[1]) and b0[2].startswith('я только'), 'неверный блок SRT', b0)
    # время SRT — по ролику (от начала отрезка): первая строка в начале ролика
    st = a.js("+__ls.proj.style.start")
    t0 = sum(float(x) * k for x, k in zip(b0[1].split(' --> ')[0].replace(',', '.').split(':'), (3600, 60, 1)))
    check(abs(t0 - (26.44 - st)) < 0.05, 'время SRT не совпадает со временем ролика', b0[1], st)
    # импорт LRC
    a.js("window.__openText={name:'a.lrc',text:'[00:10.00]первая строка тут\\n[00:12.50]вторая строка\\n[00:15.00]и третья'}")
    a.page.click('#bOpen'); a.wait(200); a.page.click('#openMenu button[data-timing]'); a.wait(800)
    r = a.js("({n:__ls.proj.words.length, w:__ls.proj.words.map(w=>[w.w,w.t,w.line]), sc:__ls.proj.scenes.length, st:document.querySelector('#alignStatus').textContent})")
    check(r['n'] == 7, 'импорт LRC: не то число слов', r)
    check(r['w'][0][:2] == ['первая', 10] and r['w'][3][:2] == ['вторая', 12.5] and r['w'][5][:2] == ['и', 15], 'импорт LRC: неверные времена строк', r)
    check(all(r['w'][i][1] < r['w'][i + 1][1] for i in range(r['n'] - 1)), 'импорт LRC: слова не по порядку', r)
    check(r['sc'] >= 1 and 'a.lrc' in r['st'], 'импорт LRC: нет сцен или статуса', r)
    a.no_errors()


def t_drop_file(open_app):
    a = open_app().ready(preview=False)
    a.js("""(()=>{ window.__fileKind=p=>({kind:'timing',path:p,name:'b.srt',ext:'srt',text:'1\\n00:00:05,000 --> 00:00:07,000\\nсубтитр один\\n\\n2\\n00:00:07,500 --> 00:00:09,000\\nсубтитр <i>два</i>\\n'});
        const e=new Event('dragenter'); e.dataTransfer={types:['Files']}; window.dispatchEvent(e); })()""")
    check(a.js("!document.querySelector('#dropOv').hidden"), 'подсказка перетаскивания не показана')
    a.js("(()=>{ const e=new Event('drop'); e.dataTransfer={types:['Files'],files:[{__path:'/x/b.srt'}]}; window.dispatchEvent(e); })()"); a.wait(800)
    r = a.js("[document.querySelector('#dropOv').hidden, __ls.proj.words.map(w=>w.w).join(' '), __ls.proj.words[0].t, __ls.proj.words[2].t]")
    check(r[0], 'подсказка перетаскивания не скрылась', r)
    check(r[1] == 'субтитр один субтитр два', 'брошенный SRT не применён (или не убраны теги)', r)
    check(r[2] == 5 and r[3] == 7.5, 'времена из SRT', r)
    a.no_errors()


def t_recognition(open_app):
    a = open_app().ready(preview=False)
    check(a.js("document.querySelector('#alVocalsQ').hidden"), 'выбор качества отделения вокала виден без галочки')
    a.page.click('#alVocals')
    check(not a.js("document.querySelector('#alVocalsQ').hidden"), 'выбор качества не появился')
    a.page.select_option('#alVocalsQ', 'best')
    a.js("window.__fakeTranscribe=[{w:'Я',t:26.4,e:26.6,e0:26.5,conf:.9},{w:'только',t:26.6,e:26.9,e0:26.85,conf:.3},{w:'проснулся.',t:26.9,e:27.4,e0:27.3,conf:.95},{w:'Глаза',t:28.4,e:28.7,e0:28.6,conf:.4}]")
    a.js("document.querySelector('#lyrics').value=''"); a.page.click('#bRecog'); a.wait(900)
    r = a.js("[window.__trArgs && window.__trArgs.vocalsQ, window.__trArgs && window.__trArgs.vocals, document.querySelector('#lyrics').value]")
    check(r[0] == 'best' and r[1], 'настройки отделения вокала не переданы в распознавание', r)
    check('только' in r[2] and 'Глаза' in r[2], 'распознанный текст не попал в поле', r)
    a.tab('words')
    u = a.js("[document.querySelectorAll('#wordList .w.unsure').length, !!document.querySelector('.unsureHint'), document.querySelector('#alCancel').hidden]")
    check(u[0] == 2 and u[1], 'неуверенные слова не подсвечены', u)
    check(u[2], 'кнопка остановки не скрылась после распознавания', u)
    a.page.click('#wordList .uq'); a.wait(200)
    check(a.js("document.querySelectorAll('#wordList .w.unsure').length") == 1, 'щелчок по «?» не снял пометку')
    a.no_errors()


def t_bpm_controls(open_app):
    a = open_app()
    a.load_track()
    b0 = float(a.js("document.querySelector('#bpmIn').value"))
    a.page.click('#bpmDbl'); a.wait(300)
    b1 = float(a.js("document.querySelector('#bpmIn').value"))
    check(abs(b1 - 2 * b0) < 1, 'кнопка ×2 не удвоила темп', b0, b1)
    a.page.click('#bpmHalf'); a.wait(300)
    b2 = float(a.js("document.querySelector('#bpmIn').value"))
    check(abs(b2 - b0) < 1, 'кнопка ÷2 не вернула темп', b0, b2)
    a.page.click('#bpmDbl'); a.wait(200); a.page.click('#bpmAutoBtn'); a.wait(300)
    b3 = float(a.js("document.querySelector('#bpmIn').value"))
    check(abs(b3 - b0) < 1, 'кнопка «авто» не вернула распознанный темп', b0, b3)
    a.no_errors()


def t_models(open_app):
    a = open_app()
    a.menu('#bHelp', 'models'); a.wait(300)
    r = a.js("[document.querySelectorAll('#mdList .md').length, document.querySelector('#mdTotal').textContent, [...document.querySelectorAll('#mdList button')].map(b=>b.dataset.a)]")
    check(r[0] == 2, 'список моделей (заглушка) не показан', r)
    check('225' in r[1], 'итог по диску', r)
    check('get' in r[2] and 'del' in ' '.join(r[2]), 'нет кнопок скачать/удалить', r)
    a.page.click('#mdList button[data-a=get]'); a.wait(300)
    g = a.js("[window.__mdGet, document.querySelector('#mdStatus').textContent]")
    check(g[0] == 'beat' and g[1].strip(), 'скачивание модели не вызвано', g)
    a.page.click('#mdClose')
    check(a.js("document.querySelector('#mdModal').hidden"), 'окно моделей не закрылось')
    a.no_errors()


def t_save_prune(open_app):
    a = open_app().ready(preview=False)
    a.js("(()=>{ const P=__ls.proj; P.assets.used1='data:image/png;base64,AAAA'; P.assets.orphan1='data:image/png;base64,BBBB'; P.stickers=[{id:'s1',type:'image',value:'asset:used1',x:.5,y:.3,size:120,t0:1,t1:3}]; })()")
    a.menu('#bSave', 'bundle')
    r = a.js("(()=>{ const j=JSON.parse(window.__bundle); return [Object.keys(j.assets||{}), Object.keys(__ls.proj.assets), j.words.length] })()")
    check(r[0] == ['used1'], 'в сохранение попали неиспользуемые картинки', r)
    check('orphan1' in r[1], 'отбор картинок испортил сам проект', r)
    check(r[2] == len(a.env.words), 'в сохранении не все слова', r)
    a.menu('#bSave', 'save')
    saved = a.js("JSON.parse(localStorage.getItem('ls-project'))")
    check(saved and list((saved.get('assets') or {}).keys()) == ['used1'], 'обычное сохранение: отбор картинок', list((saved or {}).get('assets', {}).keys()))
    a.no_errors()


def t_export_job(open_app):
    a = open_app().ready()
    a.page.click('#bExport'); a.wait(400)
    ok = a.js("(()=>{ const m=document.querySelector('#exportModal .mbox').getBoundingClientRect(); return [...document.querySelectorAll('#xCont button')].every(b=>{ const r=b.getBoundingClientRect(); return r.right<=m.right-4 && r.left>=m.left }) })()")
    check(ok, 'кнопки контейнера выходят за окно экспорта')
    a.page.check('#xLoud'); a.js("window.__fakeExportOk=true"); a.page.click('#xGo'); a.wait(800)
    j = a.js("window.__lastJob && {loud:window.__lastJob.loud, csp:/Content-Security-Policy/.test(window.__lastJob.html), nonce:/nonce=/.test(window.__lastJob.html), W:window.__lastJob.W, H:window.__lastJob.H}")
    check(j and j['loud'] is True, 'громкость не попала в задание экспорта', j)
    check(j['csp'] and j['nonce'], 'в HTML ролика нет CSP с nonce', j)
    a.no_errors()


def t_cut_background(open_app):
    a = open_app().ready(preview=False)
    a.js("""(()=>{ const c=document.createElement('canvas'); c.width=c.height=40; c.getContext('2d').fillRect(5,5,20,20); __ls.proj.assets.tst=c.toDataURL(); __ls.proj.stickers=[{id:'s1',type:'image',value:'asset:tst',x:.5,y:.3,size:120,t0:1,t1:3}]; __ls.renderAll(); })()""")
    a.tab('scene')
    check(a.js("document.querySelectorAll('#stList [data-cut]').length") >= 1, 'у стикера-картинки нет кнопки «вырезать фон»')
    a.js("document.querySelector('#stList [data-cut]').click()"); a.wait(500)
    r = a.js("[!!window.__bgArg, __ls.proj.stickers[0].value]")
    check(r[0] and r[1].startswith('asset:'), 'вырезание фона не вызвано', r)
    a.no_errors()


def t_xss(open_app):
    a = open_app().ready(preview=False)
    # 1) через импорт LRC (теги в LRC не вырезаются)
    a.js("(t)=>{ window.__openText={name:'x.lrc',text:t} }", f'[00:27.00]{XSS_SCRIPT} раз\n[00:29.00]{XSS_IMG} два\n[00:31.00]{LT} три\n')
    a.page.click('#bOpen'); a.wait(200); a.page.click('#openMenu button[data-timing]'); a.wait(800)
    # 2) прямо в слово проекта (как после правки/распознавания)
    a.js("([s,i,l])=>{ const W=__ls.proj.words; W.push({w:s,t:33,e:33.4,line:9},{w:i,t:33.5,e:34,line:9},{w:l,t:34.1,e:34.6,line:9}); __ls.autoRange(); __ls.autoScenes(); __ls.renderAll(); }", [XSS_SCRIPT, XSS_IMG, LT])
    a.tab('words'); a.tab('scene')
    for i in range(a.js("__ls.proj.scenes.length")):
        a.js("(i)=>document.querySelectorAll('#sceneStrip .sc')[i].click()", i); a.wait(100)
    a.fresh_preview()
    seen = []
    for t in a.js("__ls.proj.words.filter(w=>/[<>]/.test(w.w)).map(w=>w.t+.1)"):
        a.preview_seek(t); a.wait(150)
        seen.append(a.js("document.querySelector('#preview').contentDocument.body.textContent"))
    a.tab('words')
    r = a.js("""(()=>{ const pw=document.querySelector('#preview').contentWindow;
        return { main: window.__xss||0, prev: pw.__xss||0, imgs: document.querySelectorAll('#wordList img, #sceneStrip .t img, #seText img').length,
          prevImgs: pw.document.querySelectorAll('img[src="x"]').length, scripts: [...pw.document.querySelectorAll('script')].filter(s=>s.textContent.trim().startsWith('window.__xss')).length,
          list: document.querySelector('#wordList').textContent, strip: document.querySelector('#sceneStrip').textContent } })()""")
    check(r['main'] == 0 and r['prev'] == 0, 'внедрённый в слово код исполнился', r['main'], r['prev'])
    check(r['imgs'] == 0 and r['prevImgs'] == 0 and r['scripts'] == 0, 'теги из текста слова попали в разметку', r)
    check(LT in r['list'], '«a<b» не отображается в списке слов', r['list'][-200:])
    check('<script>' in r['list'] and '<img' in r['list'], 'текст с тегами не показан как текст в списке слов', r['list'][-300:])
    check(any(LT in s for s in seen), '«a<b» не отображается в превью', [s[-120:] for s in seen])
    # экспорт: HTML ролика не исполняет слова (проверяем по заданию)
    a.page.click('#bExport'); a.wait(300); a.js("window.__fakeExportOk=true"); a.page.click('#xGo'); a.wait(600)
    html = a.js("window.__lastJob ? window.__lastJob.html : ''")
    check(XSS_SCRIPT not in html and XSS_IMG not in html, 'слово с тегами вставлено в HTML ролика как разметка')
    a.wait(300)
    check(a.js("window.__xss||0") == 0, 'внедрённый код исполнился при экспорте')
    a.no_errors()


def t_english(open_app):
    a = open_app(lang='en')
    check(a.js("document.querySelector('#bExport').textContent").strip() and a.js("/[а-яё]/i.test(document.querySelector('#bExport').textContent)") is False, 'кнопка экспорта не переведена')
    a.ready()
    for tab in ('track', 'words', 'scene', 'style', 'fx'):
        a.tab(tab)
    for act in ('keys', 'licenses', 'models', 'selftest'):
        a.menu('#bHelp', act); a.page.keyboard.press('Escape')
        a.js("document.querySelectorAll('.modal, #gallery').forEach(m=>m.hidden=true)")
    a.page.click('#bExport'); a.wait(300); a.js("document.querySelector('#exportModal').hidden=true")
    a.menu('#bSave', 'srt'); a.menu('#bSave', 'lrc')
    a.no_errors('английский интерфейс')


def t_english_untranslated(open_app):
    a = open_app(lang='en').ready()
    left = []
    for tab in ('track', 'words', 'scene', 'style', 'fx'):
        a.tab(tab)
        left += a.js("""(()=>{ const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
            while(n=w.nextNode()){ const el=n.parentElement; if(!el||el.closest('[data-notr],textarea,script,style,code,[hidden],#wordList,#sceneStrip,#seText')) continue;
              if(/[а-яё]/i.test(n.nodeValue) && el.offsetParent!==null) out.push(n.nodeValue.trim().slice(0,60)); } return out })()""")
    left = sorted(set(left))
    check(not left, 'в английском интерфейсе остался русский текст', left[:25])


def t_small_window(open_app):
    a = open_app(viewport=(1150, 720)).ready()
    a.wait(400)
    r = a.js("""(()=>{ const r=s=>{ const b=document.querySelector(s).getBoundingClientRect(); return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),h:Math.round(b.height)} };
        return {w:innerWidth, h:innerHeight, stage:r('#stage'), tl:r('#timeline'), strip:r('#sceneStrip'), transport:r('#transport'), sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight} })()""")
    for k in ('tl', 'strip', 'transport', 'stage'):
        b = r[k]
        check(b['t'] >= 0 and b['b'] <= r['h'] and b['l'] >= 0 and b['r'] <= r['w'], f'{k} выходит за окно 1150×720', r)
    check(r['tl']['h'] >= 60, 'таймлайн сжат', r)
    check(r['strip']['h'] >= 40, 'лента сцен сжата', r)
    check(r['stage']['h'] >= 200, 'превью сжато', r)
    check(r['sw'] <= r['w'] + 1 and r['sh'] <= r['h'] + 1, 'у окна появилась прокрутка', r)
    # то же после увеличения окна обратно
    a.page.set_viewport_size({'width': 1500, 'height': 940}); a.wait(400)
    a.no_errors()


TESTS = [(f.__name__[2:], f) for f in (
    t_load, t_autoscenes, t_tabs_and_dialogs, t_scene_fields, t_accents, t_scene_copy_paste, t_two_cards, t_timings,
    t_drop_file, t_recognition, t_bpm_controls, t_models, t_save_prune, t_export_job, t_cut_background, t_xss,
    t_english, t_english_untranslated, t_small_window)]
