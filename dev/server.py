# Dev-сервер для проверки интерфейса в обычном Chromium: отдаёт app/ и эмулирует синхронизацию через align.py.
import http.server, json, os, sys, subprocess, tempfile, urllib.parse
APP = os.path.join(os.path.dirname(__file__), '..', 'app')
ALIGN = os.path.expanduser('~/lyricvid/align.py')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=APP, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        u = urllib.parse.urlparse(s.path)
        if u.path == '/__file':
            p = urllib.parse.parse_qs(u.query)['path'][0]; b = open(p, 'rb').read()
            s.send_response(200); s.send_header('content-length', len(b)); s.end_headers(); s.wfile.write(b); return
        return super().do_GET()
    def do_POST(s):
        a = json.loads(s.rfile.read(int(s.headers['content-length'])))
        if s.path == '/__align':
            d = tempfile.mkdtemp(); src = a['audioPath']; off = a.get('from') or 0
            if a.get('from') is not None or a.get('to') is not None:
                cmd = ['ffmpeg', '-v', 'error', '-y'] + (['-ss', str(a['from'])] if a.get('from') is not None else []) + (['-to', str(a['to'])] if a.get('to') is not None else []) + ['-i', src, d + '/f.wav']
                subprocess.run(cmd, check=True); src = d + '/f.wav'
            open(d + '/l.txt', 'w').write(a['lyrics'])
            subprocess.run([sys.executable, ALIGN, src, d + '/l.txt', d + '/w.json'], check=True, stdout=subprocess.DEVNULL)
            W = json.load(open(d + '/w.json'))
            for w in W['words']: w['t'] = round(w['t'] + off, 3); w['e'] = round(w['e'] + off, 3); w.pop('say', None)
            vs = sorted(w['conf'] for w in W['words']); W['median'] = vs[len(vs) // 2]; W['duration'] = None
            b = json.dumps(W, ensure_ascii=False).encode()
            s.send_response(200); s.send_header('content-type', 'application/json'); s.end_headers(); s.wfile.write(b); return
        s.send_response(404); s.end_headers()
if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
