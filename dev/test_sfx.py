# Проверка звуков интерфейса сцен (app/sfx.js + sfxEvents в app/app.js).
# Запуск: python3 dev/server.py PORT &  затем  python3 dev/test_sfx.py PORT
#   --ref  — записать эталон буфера «старого проекта» (без поля sfx.ui) в dev/sfx_ref.json
import json, asyncio, sys, os
from playwright.async_api import async_playwright

PORT = next((a for a in sys.argv[1:] if a.isdigit()), '8774')
REF_MODE = '--ref' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, 'sfx_ref.json')
WORDS = '/root/work/t8/words.json'
TRACK = '/mnt/user-data/uploads/8445f95e-demo_dem_serega.mp3'
TPLS = ['chat', 'call', 'notifs', 'recorder', 'player', 'counter', 'achievement', 'kin-stack']

W = json.load(open(WORDS)); W = W['words'] if isinstance(W, dict) else W
for w in W: w.pop('say', None); w.pop('conf', None)

# проект: одна строка — одна сцена, шаблоны по списку, звуки как в старом проекте (без ui)
SETUP = """([W, T]) => { const P = __ls.proj; P.words = W; P.perScene = 1; __ls.autoRange(); __ls.autoScenes();
  P.scenes.forEach((sc, i) => { sc.tpl = T[i % T.length]; sc.f = {}; delete sc.snd; delete sc.stamp; sc.accents = []; });
  P.scenes[2].stamp = 'ОК'; P.words[20].acc = { zoom: 1 };
  P.style.sfx = { on: true, vol: 0.7, trans: true, events: true, acc: true };
  __ls.renderAll(); return P.scenes.map(s => [s.tpl, s.a, s.b]); }"""

# буфер экспорта: тот же путь, что у кнопки «Экспорт» (job.sfx.data). Список событий снимаем с входа SFX.render.
# Отпечаток буфера — пик каждого блока по 2048 кадров (int16, по каналам) и сумма модулей: WebAudio в Chromium
# складывает одновременно звучащие узлы в произвольном порядке, поэтому соседние рендеры одного и того же
# расходятся в младшем бите (это было и до звуков интерфейса) — сравнение побайтно, но с допуском ±2 единицы.
EXPORT_FP = """async () => { window.__fakeExportOk = true; window.__lastJob = null; let cap = null;
  const R0 = SFX.render; SFX.render = (ev, a, b) => { cap = { ev: JSON.parse(JSON.stringify(ev)), t0: a, t1: b }; return R0(ev, a, b); };
  try { document.querySelector('#bExport').click(); await new Promise(r => setTimeout(r, 400));
    document.querySelector('#xGo').click();
    for (let i = 0; i < 100 && !window.__lastJob; i++) await new Promise(r => setTimeout(r, 100)); } finally { SFX.render = R0; }
  document.querySelector('#exportModal').hidden = true;
  const j = window.__lastJob; if (!j || !j.sfx) return null;
  const d = new Int16Array(j.sfx.data.slice(44)), B = 2048, C = 2, pk = [], sa = [];
  for (let o = 0; o < d.length; o += B * C) { let p0 = 0, p1 = 0, s = 0; for (let i = o; i < Math.min(d.length, o + B * C); i += C) { p0 = Math.max(p0, Math.abs(d[i])); p1 = Math.max(p1, Math.abs(d[i + 1])); s += Math.abs(d[i]) + Math.abs(d[i + 1]); } pk.push(p0, p1); sa.push(s); }
  return { bytes: j.sfx.data.byteLength, vol: j.sfx.vol, pk, sa, events: cap }; }"""

def same_fp(a, b):
    if not a or not b or a['bytes'] != b['bytes'] or len(a['pk']) != len(b['pk']): return False, 'длина'
    dp = max(abs(x - y) for x, y in zip(a['pk'], b['pk'])); ds = max(abs(x - y) for x, y in zip(a['sa'], b['sa']))
    return dp <= 2 and ds <= 2 * 2048 * 2, f'пик ±{dp}, сумма ±{ds}'

async def main():
    fails = []
    def check(name, ok, info=''):
        print(('OK   ' if ok else 'FAIL ') + name + (('  ' + str(info)) if info != '' else ''))
        if not ok: fails.append(name)
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.add_init_script("try{localStorage.clear()}catch(e){}")
        await pg.goto(f'http://127.0.0.1:{PORT}/index.html'); await pg.wait_for_function('window.__ls')
        await pg.evaluate("async(a)=>{ await __ls.loadAudio({path:a,name:'serega.mp3'}); __ls.proj.duration=73.37; }", TRACK); await pg.wait_for_timeout(1500)
        scenes = await pg.evaluate(SETUP, [W, TPLS]); await pg.wait_for_timeout(300)
        print('сцены:', scenes)
        old = await pg.evaluate(EXPORT_FP)
        if REF_MODE:
            json.dump({'note': 'звуки старого проекта (без sfx.ui), сняты на исходном коммите', 'scenes': scenes, **(old or {})}, open(REF, 'w'), ensure_ascii=False, separators=(',', ':'))
            print('эталон записан:', old['bytes'], len(old['events']['ev']), 'событий'); await b.close(); return
        ref = json.load(open(REF))
        check('старый проект: те же события, что до правок', old is not None and old['events'] == ref['events'], len((old or {}).get('events', {}).get('ev', [])))
        ok, info = same_fp(old, ref)
        check('старый проект: тот же буфер, что до правок', ok, info)

        # события: ui выключен — ни одного звука интерфейса
        UI = ['vibrate', 'key', 'send', 'receive', 'notify', 'rec', 'play', 'shutter', 'error', 'success']
        r = await pg.evaluate("(UI)=>{ const ev=SFX.appEvents(__ls.buildSpec(false)); return ev.filter(e=>e.ui||UI.includes(e.type)).length }", UI)
        check('ui=false: событий интерфейса нет', r == 0, r)

        # ui включён: сверка с временами из спецификации
        R = await pg.evaluate("""() => { const P=__ls.proj; P.style.sfx.ui=true; P.style.sfx.uiVol=0.7;
          const spec=__ls.buildSpec(false), ev=SFX.appEvents(spec), T=SFX.sceneTimes(spec), Wd=spec.words;
          const ui=ev.filter(e=>e.ui), by=k=>ui.filter(e=>e.k===k);
          const at=(k,x)=>SFX.resolveAt(spec,k)(x);
          const S=spec.scenes;
          return { T:T.map(t=>[t.t0,t.t1]), ev:ui.map(e=>[e.k,e.type,+e.t.toFixed(3)]),
            chat:{ msgs:S[0].widget.msgs.map(m=>[!!m.me, at(0,m.at)]), kb:!!S[0].widget.keyboard, ws:T[0].ws.map(w=>[w.t,w.e,w.w]) },
            call:{ end:S[1].widget.end?at(1,S[1].widget.end.at):null },
            notifs:S[2].widget.items.map(it=>at(2,it.at)),
            rec:at(3,S[3].widget.at), player:at(4,S[4].widget.at), counter:[at(5,S[5].widget.at), S[5].widget.dur||1.2],
            ach:at(6,S[6].widget.at), total:ev.length }; }""")
        T = R['T']; ev = R['ev']; by = lambda k, ty=None: [e for e in ev if e[0] == k and (ty is None or e[1] == ty)]
        near = lambda a, b, tol=.03: abs(a - b) <= tol
        # 0: chat — send в момент появления пузыря (at − 0.1), receive у ответа, клавиши не чаще 12/с и только во время слов
        c = R['chat']; sends = [e[2] for e in by(0, 'send')]; recv = [e[2] for e in by(0, 'receive')]; keys = [e[2] for e in by(0, 'key')]
        exp_send = [t - .1 for me, t in c['msgs'] if me]; exp_recv = [t - .1 for me, t in c['msgs'] if not me]
        check('chat: send на каждом своём пузыре', len(sends) == len(exp_send) and all(near(a, b) for a, b in zip(sends, exp_send)), [sends, exp_send])
        check('chat: receive на ответе', len(recv) == len(exp_recv) and all(near(a, b) for a, b in zip(recv, exp_recv)), [recv, exp_recv])
        gaps = [b2 - a2 for a2, b2 in zip(keys, keys[1:])]
        check('chat: клавиши есть, не чаще 12 в секунду', len(keys) >= 3 and (not gaps or min(gaps) >= 1 / 12 - .002), [len(keys), round(min(gaps), 3) if gaps else None])
        ws = c['ws']; check('chat: клавиши только во время слов сцены', all(ws[0][0] - .01 <= k <= ws[-1][1] + .01 for k in keys), [keys[:3], ws[0][0], ws[-1][1]])
        # 1: call — вибрация от начала сцены каждые ~0.7 с до ответа
        vib = [e[2] for e in by(1, 'vibrate')]; end = R['call']['end'] or T[1][1]
        check('call: вибрация от начала сцены', bool(vib) and near(vib[0], T[1][0], .12), [vib[:3], T[1][0]])
        check('call: шаг ~0.7 с, до ответа', len(vib) >= 2 and all(near(b2 - a2, .7, .02) for a2, b2 in zip(vib, vib[1:])) and vib[-1] < end, [vib, end])
        check('call: щелчок ответа в момент accept', any(near(e[2], end) for e in by(1, 'play')), [by(1, 'play'), end])
        # 2: notifs — дзынь на каждом уведомлении
        nt = [e[2] for e in by(2, 'notify')]; exp = [t - .08 for t in R['notifs']]
        check('notifs: notify на каждое уведомление', len(nt) == len(exp) and all(near(a, b) for a, b in zip(nt, exp)), [nt, exp])
        # 3: recorder — гудки перед началом записи
        rc = [e[2] for e in by(3, 'rec')]; check('recorder: rec перед началом записи', len(rc) == 1 and R['rec'] - .3 <= rc[0] <= R['rec'] and rc[0] >= T[3][0] - .01, [rc, R['rec'], T[3][0]])
        # 4: player — клик play
        pl = [e[2] for e in by(4, 'play')]; check('player: один клик play в начале', len(pl) == 1 and T[4][0] <= pl[0] <= R['player'] + .01, [pl, R['player'], T[4][0]])
        # 5: counter — тики во время прокрутки чисел
        tk = [e[2] for e in by(5, 'tick')]; t0, d = R['counter']
        check('counter: тики в пределах прокрутки', len(tk) >= 4 and all(t0 - .01 <= x <= t0 + d + .01 for x in tk), [len(tk), tk[:2], t0, d])
        # 6: achievement — success
        sc6 = [e[2] for e in by(6, 'success')]; check('achievement: success в момент появления', len(sc6) == 1 and near(sc6[0], R['ach']), [sc6, R['ach']])
        # 7: типографика — тишина
        check('kin-stack: событий интерфейса нет', not by(7), by(7))
        check('все события внутри своих сцен', all(T[e[0]][0] - .06 <= e[2] <= T[e[0]][1] + .01 for e in ev))

        # звук сцены выключен
        r = await pg.evaluate("()=>{ const P=__ls.proj; P.scenes[1].snd='off'; const ev=SFX.appEvents(__ls.buildSpec(false)); P.scenes[1].snd=''; return [ev.filter(e=>e.ui&&e.k===1).length, ev.filter(e=>e.ui&&e.k===0).length] }")
        check("sc.snd='off': у этой сцены звуков интерфейса нет, у других есть", r[0] == 0 and r[1] > 0, r)
        # обычные события виджетов (ding/ring) в сценах со звуками интерфейса не дублируются
        r = await pg.evaluate("()=>{ const ev=SFX.appEvents(__ls.buildSpec(false)); return ev.filter(e=>!e.ui&&['ding','ring','chime','tick'].includes(e.type)).map(e=>e.type) }")
        check('общие ding/ring/chime заменены звуками интерфейса', len(r) == 0, r)

        # буфер: не пустой и не клипует (рендер тем же SFX.render, что превью и экспорт)
        r = await pg.evaluate("""async()=>{ const spec=__ls.buildSpec(false), buf=await SFX.render(SFX.appEvents(spec), +spec.start, +spec.end);
          let pk=0, e=0; for(let c=0;c<buf.numberOfChannels;c++){ const d=buf.getChannelData(c); for(let i=0;i<d.length;i++){ const a=Math.abs(d[i]); if(a>pk) pk=a; e+=a*a; } }
          return [pk, Math.sqrt(e/(buf.length*buf.numberOfChannels)), buf.duration] }""")
        check('буфер со звуками интерфейса: не пустой, пик < 1.0', r[0] > .02 and r[0] < 1.0, [round(r[0], 3), round(r[1], 5), round(r[2], 2)])
        # каждый новый звук синтезируется и не клипует даже на полной громкости
        r = await pg.evaluate("""async(UI)=>{ const out={}; for(const ty of UI.concat(['tick'])){ const b=await SFX.render([{t:.1,type:ty,v:1}],0,1.2); let pk=0; const d=b.getChannelData(0); for(let i=0;i<d.length;i++) pk=Math.max(pk,Math.abs(d[i])); out[ty]=+pk.toFixed(3); } return out }""", UI)
        check('каждый звук интерфейса синтезируется (пик > 0.01, < 1.0)', all(.01 < v < 1.0 for v in r.values()), r)
        r2 = await pg.evaluate("async()=>{ const b=await SFX.render([{t:.1,type:'thump',v:1}],0,1); let pk=0; const d=b.getChannelData(0); for(let i=0;i<d.length;i++) pk=Math.max(pk,Math.abs(d[i])); return pk }")
        check('звуки интерфейса тише удара-акцента', max(r.values()) < r2, [max(r.values()), round(r2, 3)])
        # детерминированность: события — точно, буфер — до младшего бита (см. EXPORT_FP)
        r = await pg.evaluate("""async()=>{ const spec=__ls.buildSpec(false), e1=JSON.stringify(SFX.appEvents(spec)), e2=JSON.stringify(SFX.appEvents(spec));
          const h=async()=>new Int16Array(SFX.wav(await SFX.render(JSON.parse(e1), +spec.start, +spec.end)).slice(44)); const a=await h(), b=await h(); let mx=0; for(let i=0;i<a.length;i++) mx=Math.max(mx,Math.abs(a[i]-b[i])); return [e1===e2, mx] }""")
        check('события и рендер детерминированы', r[0] and r[1] <= 2, r)
        # экспорт с ui: буфер другой и тоже в job.sfx
        new = await pg.evaluate(EXPORT_FP)
        check('экспорт с ui: звуки интерфейса в общем буфере job.sfx', new is not None and not same_fp(new, ref)[0] and any(e.get('ui') for e in new['events']['ev']), (new or {}).get('bytes'))

        # интерфейс: флажок, громкость, звук сцены
        r = await pg.evaluate("""async()=>{ const P=__ls.proj; P.style.sfx.ui=false; __ls.renderAll(); await new Promise(r=>setTimeout(r,100));
          const cb=document.querySelector('#sfxUi'), vol=document.querySelector('#sfxUiVol'), sel=document.querySelector('#seSnd');
          if(!cb||!vol||!sel) return ['нет элементов', !!cb, !!vol, !!sel];
          const st0=cb.checked; cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
          vol.value='0.4'; vol.dispatchEvent(new Event('input',{bubbles:true})); vol.dispatchEvent(new Event('change',{bubbles:true}));
          sel.value='off'; sel.dispatchEvent(new Event('change',{bubbles:true}));
          return [st0, P.style.sfx.ui, P.style.sfx.uiVol, P.scenes.filter(s=>s.snd==='off').length, [...sel.options].map(o=>o.value)] }""")
        check('флажок «звуки интерфейса сцен», громкость и «звук сцены» работают', r[0] is False and r[1] is True and abs(r[2] - .4) < 1e-9 and r[3] >= 1 and r[4] == ['', 'off'], r)
        await pg.wait_for_timeout(800)
        check('без ошибок страницы', not errs, errs[:5])
        await b.close()
    print('\nИТОГ:', 'всё прошло' if not fails else f'провалено {len(fails)}: ' + '; '.join(fails))
    sys.exit(1 if fails else 0)

asyncio.run(main())
