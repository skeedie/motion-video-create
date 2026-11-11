"""Геометрия кадра: все шаблоны × все пресеты в форматах 9:16 и 16:9 (перенос ручного sweep.py).

Для первых двух сцен каждого сочетания кадр рендерится движком (engineHTML) в iframe нужного размера, и ищутся
находки: карточка за краем кадра/экрана телефона, текст за краем, текст поверх карточки, надпись шире карточки,
а также ошибки сборки задания/движка. Находки есть и сейчас, поэтому тест сравнивает их число с
data/geometry_baseline.json по каждому (формат, шаблон, вид находки) и падает, только если стало больше.
"""
import json, os, time
from collections import Counter, defaultdict

from common import App

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.path.join(HERE, 'data', 'geometry_baseline.json')

SIZES = {'9:16': (720, 1280), '16:9': (1280, 720), '1:1': (1080, 1080), '4:5': (864, 1080)}

JS = r"""
async ({fmt, pk, base})=>{
  const P=__ls.proj, out=[];
  const [FW,FH]=(%SIZES%)[fmt];
  const fr=document.createElement('iframe'); fr.style.cssText=`position:fixed;left:0;top:0;width:${FW}px;height:${FH}px;border:0;z-index:99999;background:#000`; document.body.append(fr);
  // как при экспорте: ждём READY, загрузку шрифтов (после неё движок заново подгоняет карточки) и две перерисовки
  const raf2=w=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
  const load=html=>new Promise(res=>{ fr.onload=()=>{ const w=fr.contentWindow; let n=0; const iv=setInterval(async()=>{ if(w.READY===true||w.__err||++n>200){ clearInterval(iv); try{ if(w.document.fonts) await w.document.fonts.ready; await raf2(w); }catch(e){} res(w); } },25); }; fr.srcdoc=html; });
  const vis=el=>{ let o=1; for(let e=el;e&&e.nodeType===1;e=e.parentElement){ const cs=e.ownerDocument.defaultView.getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden') return 0; o*=+cs.opacity; } return o; };
  const btn=document.querySelector(`#presetGrid .pr[data-k="${pk}"]`); if(!btn) return [[pk,'*',-1,'preset','пресет не найден']];
  btn.click(); P.style.format=fmt;
  for(const t of TEMPLATES){
    P.scenes.slice(0,2).forEach(s=>{ s.tpl=t.id; s.f={}; delete s.dx; delete s.dy; delete s.scale; delete s.capY; });
    let spec; try{ spec=__ls.buildSpec(false); }catch(e){ out.push([pk,t.id,-1,'buildSpec',e.message]); continue; }
    const w=await load(__ls.engineHTML(spec,base));
    if(w.__err||w.READY!==true){ out.push([pk,t.id,-1,'engine',String(w.__err||'не готов')]); continue; }
    for(const si of [0,1]){ const sc=P.scenes[si], nx=P.words[sc.b]?P.words[sc.b].t:1e9, tt=Math.max(P.words[sc.a].t+.1, Math.min(P.words[sc.b-1].t+.2, nx-.5));
      try{ if(w.seekAsync) await w.seekAsync(tt); else w.seek(tt); await raf2(w); }catch(e){ out.push([pk,t.id,si,'seek',e.message]); continue; }
      const d=fr.contentDocument, vw=w.innerWidth, vh=w.innerHeight, probs=[];
      const cards=[...d.querySelectorAll('.wslot .wscale')].filter(e=>vis(e)>.5).map(e=>e.getBoundingClientRect()).filter(r=>r.width>4);
      const caps=[...d.querySelectorAll('.cap, .kin > *')].filter(e=>vis(e)>.5&&e.textContent.trim()).map(e=>e.getBoundingClientRect()).filter(r=>r.width>4&&r.height>4);
      const ph=d.querySelector('.phone .screen'), pr=ph&&vis(ph)>.5?ph.getBoundingClientRect():null;
      for(const r of cards){ const B=pr||{left:0,top:0,right:vw,bottom:vh}; const o=Math.max(B.left-r.left, r.right-B.right, B.top-r.top, r.bottom-B.bottom); if(o>6) probs.push(['карточка за краем',`на ${Math.round(o)}px (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`]); }
      for(const r of caps){ const o=Math.max(-r.left, r.right-vw, -r.top, r.bottom-vh); if(o>6) probs.push(['текст за краем',`на ${Math.round(o)}px`]);
        for(const c of cards){ const ix=Math.min(r.right,c.right)-Math.max(r.left,c.left), iy=Math.min(r.bottom,c.bottom)-Math.max(r.top,c.top); if(ix>12&&iy>12) probs.push(['текст поверх карточки',`${Math.round(ix)}×${Math.round(iy)}`]); } }
      for(const cardEl of [...d.querySelectorAll('.wslot .wscale')].filter(e=>vis(e)>.5)){ const inner=cardEl.firstElementChild; if(!inner) continue; const ic=inner.getBoundingClientRect();
        for(const el of inner.querySelectorAll('*')){ if(el.children.length||!el.textContent.trim()||vis(el)<.5) continue; const r=el.getBoundingClientRect(); if(r.width<3) continue; const o=Math.max(ic.left-r.left, r.right-ic.right); if(o>8){ probs.push(['надпись шире карточки',`«${el.textContent.trim().slice(0,18)}» на ${Math.round(o)}px`]); break; } } }
      // одна находка каждого вида на сцену (как в ручном sweep.py — без дублей)
      const kinds=new Map(); probs.forEach(([k,d])=>{ if(!kinds.has(k)) kinds.set(k,d); });
      kinds.forEach((d,k)=>out.push([pk,t.id,si,k,d]));
    }
  }
  fr.remove(); return out;
}
""".replace('%SIZES%', json.dumps({k: list(v) for k, v in SIZES.items()}))


def sweep(env, browser, fmt, log=print):
    first = App(env, browser, viewport=(1500, 1400))
    presets = first.js("[...document.querySelectorAll('#presetGrid .pr')].map(e=>e.dataset.k).filter(Boolean)")
    templates = first.js("TEMPLATES.map(t=>t.id)")
    first.close()
    found, errors = [], []
    for pk in presets:
        t0 = time.time()
        a = App(env, browser, viewport=(1500, 1400))  # новое окно на каждый пресет — иначе Chromium копит память
        try:
            a.ready(preview=False)
            r = a.js(JS, {'fmt': fmt, 'pk': pk, 'base': env.base})
            found += r
            errors += a.errors
            log(f'  {fmt} {pk}: {len(r)} находок ({time.time() - t0:.0f} с)', flush=True)
        except Exception as e:  # noqa: BLE001
            found.append([pk, '*', -1, 'crash', str(e)[:300]])
            a.shot(f'geometry_{fmt.replace(":", "x")}_{pk}')
            log(f'  {fmt} {pk}: СБОЙ {str(e)[:200]}', flush=True)
        finally:
            a.close()
    return {'presets': presets, 'templates': templates, 'found': found, 'pageerrors': errors}


def summarize(found):
    by = defaultdict(Counter)
    for pk, tpl, si, kind, det in found:
        by[tpl][kind] += 1
    return {t: dict(sorted(c.items())) for t, c in sorted(by.items())}


def run(env, browser, formats, update, out_dir):
    base = json.load(open(BASELINE, encoding='utf-8')) if os.path.exists(BASELINE) else {}
    ok, new_base, worse_all, better_all = True, {}, [], []
    raw = {}
    for fmt in formats:
        print(f'формат {fmt}:', flush=True)
        r = sweep(env, browser, fmt)
        raw[fmt] = r
        cur = summarize(r['found'])
        new_base[fmt] = {'total': len(r['found']), 'presets': len(r['presets']), 'templates': len(r['templates']), 'by_template': cur}
        old = (base.get(fmt) or {}).get('by_template', {})
        worse, better = [], []
        for tpl in sorted(set(cur) | set(old)):
            for kind in sorted(set(cur.get(tpl, {})) | set(old.get(tpl, {}))):
                n, b = cur.get(tpl, {}).get(kind, 0), old.get(tpl, {}).get(kind, 0)
                if n > b:
                    ex = [f'{x[0]}/сцена {x[2]}: {x[4]}' for x in r['found'] if x[1] == tpl and x[3] == kind][:4]
                    worse.append(f'{fmt} {tpl} «{kind}»: {b} → {n}; например: ' + '; '.join(ex))
                elif n < b:
                    better.append(f'{fmt} {tpl} «{kind}»: {b} → {n}')
        print(f'  итого {fmt}: {len(r["found"])} находок (baseline {(base.get(fmt) or {}).get("total", "—")}), '
              f'хуже: {len(worse)}, лучше: {len(better)}; ошибки страницы: {r["pageerrors"][:3]}', flush=True)
        worse_all += worse; better_all += better
        if r['pageerrors']:
            worse_all.append(f'{fmt}: ошибки страницы {r["pageerrors"][:3]}')
    json.dump(raw, open(os.path.join(out_dir, 'geometry_raw.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    json.dump(new_base, open(os.path.join(out_dir, 'geometry_current.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('GEOMETRY_CURRENT ' + json.dumps(new_base, ensure_ascii=False, separators=(',', ':')), flush=True)
    if better_all:
        print('\nСТАЛО ЛУЧШЕ (можно обновить baseline: --update-baseline):\n  ' + '\n  '.join(better_all))
    if update:
        merged = dict(base); merged.update(new_base)
        merged['_comment'] = ('Число находок геометрии кадра по формату → шаблону → виду (сумма по всем пресетам и двум сценам). '
                              'Тест падает, если по какому-то сочетанию находок стало больше. Обновить: python dev/tests/run.py PORT --geometry --update-baseline')
        json.dump(dict(sorted(merged.items())), open(BASELINE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('baseline обновлён:', BASELINE)
        return True
    if worse_all:
        ok = False
        print('\nСТАЛО ХУЖЕ, чем в baseline:\n  ' + '\n  '.join(worse_all))
    if not base:
        ok = False
        print('нет baseline — запустите с --update-baseline')
    return ok
