"""Регрессионные тесты интерфейса Lyric Studio в обычном Chromium (playwright), без pytest.

Запуск:
    python dev/tests/run.py PORT                 # сценарии редактора
    python dev/tests/run.py PORT --geometry      # перебор шаблонов × пресетов (долго), сверка с baseline
    python dev/tests/run.py PORT --only xss,small_window
    python dev/tests/run.py PORT --geometry --update-baseline   # переписать data/geometry_baseline.json

Если на PORT никто не отвечает, раннер сам поднимает dev/server.py. Тестовый трек синтезируется (track.py),
слова берутся из data/words.json. Скриншоты падений — в --shots (по умолчанию dev/tests/out/shots).
Код выхода: 0 — всё прошло (известные провалы из KNOWN_FAIL не считаются), 1 — есть падения.
"""
import argparse, json, os, subprocess, sys, tempfile, time, traceback, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

from track import make_track  # noqa: E402
from common import App, Env, Fail  # noqa: E402

# Известные провалы: тест выполняется, но его падение не валит набор (и наоборот, неожиданный успех только отмечается).
# Ключ — имя теста, значение — пояснение (что за баг приложения и где).
KNOWN_FAIL = {}

def server_alive(port):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{port}/index.html', timeout=2).read(10)
        return True
    except Exception:
        return False


def ensure_server(port):
    if server_alive(port):
        return None
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'dev', 'server.py'), str(port)])
    for _ in range(50):
        time.sleep(.2)
        if server_alive(port):
            return p
    p.kill(); raise SystemExit(f'dev/server.py не поднялся на порту {port}')


def run_tests(env, tests, browser, only=None):
    results = []
    for name, fn in tests:
        if only and name not in only:
            continue
        t0 = time.time(); app_box = []
        def factory(**kw):
            a = App(env, browser, **kw); app_box.append(a); return a
        status, info = 'ok', ''
        try:
            fn(factory)
        except Exception as e:  # noqa: BLE001 — любое исключение теста = падение
            status = 'FAIL'
            info = str(e) if isinstance(e, Fail) else ''.join(traceback.format_exception_only(type(e), e)).strip()
            for i, a in enumerate(app_box):
                a.shot(f'{name}{"_" + str(i) if i else ""}')
                if a.errors and 'ошибки страницы' not in info:
                    info += ' | ошибки страницы: ' + json.dumps(a.errors[:5], ensure_ascii=False)
        finally:
            for a in app_box:
                a.close()
        if name in KNOWN_FAIL:
            status = 'xfail' if status == 'FAIL' else 'XPASS'
            info = (info + ' | ' if info else '') + 'известный провал: ' + KNOWN_FAIL[name]
        results.append({'test': name, 'status': status, 'sec': round(time.time() - t0, 1), 'info': info})
        print(f'[{status:5}] {name} ({results[-1]["sec"]} с){(" — " + info) if info else ""}', flush=True)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port', type=int)
    ap.add_argument('--geometry', action='store_true', help='перебор шаблонов × пресетов вместо сценариев')
    ap.add_argument('--formats', default='9:16,16:9')
    ap.add_argument('--update-baseline', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    a = ap.parse_args()
    shots = os.path.join(a.out, 'shots'); os.makedirs(shots, exist_ok=True)
    srv = ensure_server(a.port)
    try:
        track = make_track(tempfile.mkdtemp(prefix='ls-track-'))
        words = json.load(open(os.path.join(HERE, 'data', 'words.json'), encoding='utf-8'))
        env = Env(a.port, track, words, shots)
        print('трек:', track, '· слов:', len(words), flush=True)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            if a.geometry:
                import geometry
                ok = geometry.run(env, browser, [f for f in a.formats.split(',') if f], a.update_baseline, a.out)
                browser.close()
                return 0 if ok else 1
            import editor
            res = run_tests(env, editor.TESTS, browser, set(x for x in a.only.split(',') if x) or None)
            browser.close()
        json.dump(res, open(os.path.join(a.out, 'report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        bad = [r for r in res if r['status'] == 'FAIL']
        print(f'\nитого: {len(res)} тестов, упало {len(bad)}, известных провалов {sum(r["status"] == "xfail" for r in res)}, '
              f'неожиданно прошли {sum(r["status"] == "XPASS" for r in res)}')
        return 1 if bad or not res else 0
    finally:
        if srv:
            srv.terminate()


if __name__ == '__main__':
    sys.exit(main())
