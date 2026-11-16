"""HamSafar local shared server. Python 3.10+, standard library only.

For public hosting, put behind HTTPS and set HAMSAFAR_SECURE=1.
Private runtime files are never served by this server.
"""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
PRIVATE = Path(os.environ.get('HAMSAFAR_DATA', str(ROOT / 'private')))
PRIVATE.mkdir(parents=True, exist_ok=True)
DB = PRIVATE / 'trip.sqlite3'
NAMES = ['Pooya Miri','Bahareh Mohebzadeh','Farhad Leader','Tina (leader assistant)','Mohamadreza Kalate (leader assistant)','Farhad Ashrafi (leader assistant)','Ali Nategh Fasihi','Haki P.e','Sarina Sadeghi','Christina','Soroush Berenty','Mohammad Khalili','Maryam Shenasa','Ashkan Sajjadi','MObina','Koohyar H.j','Mahshid Ospid','Negar','Kaveh Javan','Rezvaneh Jafari','Fateme','Mina Gholami','Hanieh Chitsaz','Mahi','Sepehr','Neda Seddigh','Soroush H']

@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def digest(code):
    return hashlib.sha256(code.encode()).hexdigest()

def initialize():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
          role TEXT NOT NULL, code TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '{}',
          room TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, member INTEGER, expires INTEGER);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor INTEGER, target INTEGER,
          action TEXT, stamp INTEGER);
        ''')
        if db.execute('SELECT count(*) FROM members').fetchone()[0]:
            return
        codes = ['همسفر اصفهک — کدهای ورود خصوصی', 'این فایل فقط برای مدیر است. برای هر نفر فقط کد خودش را ارسال کنید.', 'کد مدیر متعلق به Farhad Leader است. دستیارها اجازه ویرایش اطلاعات دیگران ندارند.', '']
        for i, name in enumerate(NAMES, 1):
            code = secrets.token_urlsafe(12)
            role = 'admin' if i == 3 else ('assistant' if i in (4,5,6) else 'member')
            db.execute('INSERT INTO members(id,name,role,code) VALUES(?,?,?,?)', (i,name,role,digest(code)))
            codes.append(f'{name}\t{code}')
        db.execute('INSERT INTO settings VALUES(?,?)', ('announcement',''))
        (PRIVATE / 'access-codes.txt').write_text('\n'.join(codes), encoding='utf-8-sig')

class Rejection(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

attempts = {}
attempt_lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Never log codes, cookies or profile bodies.
        pass

    def respond(self, status, obj, cookie=None):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def session(self, db):
        c = SimpleCookie()
        try:
            c.load(self.headers.get('Cookie',''))
            token = c['hamsafar'].value if 'hamsafar' in c else ''
        except Exception:
            token = ''
        row = db.execute('SELECT m.* FROM members m JOIN sessions s ON s.member=m.id WHERE s.token=? AND s.expires>? AND m.active=1', (digest(token),int(time.time()))).fetchone()
        if not row:
            raise Rejection(401,'برای دیدن اطلاعات همسفرها وارد شوید.')
        return row, token

    def public(self, row, viewer):
        p = json.loads(row['profile'])
        if viewer['id'] != row['id'] and viewer['role'] != 'admin' and not p.get('share_phone'):
            p.pop('phone',None)
        return dict(id=row['id'],name=row['name'],role=row['role'],profile=p,room=row['room'],active=bool(row['active']),version=row['version'],updated=row['updated'])

    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/api/'):
            try:
                with connect() as db:
                    me, _ = self.session(db)
                    if path != '/api/state':
                        raise Rejection(404,'مسیر پیدا نشد.')
                    rows = db.execute('SELECT * FROM members' + ('' if me['role']=='admin' else ' WHERE active=1')+' ORDER BY id').fetchall()
                    announcement = db.execute('SELECT value FROM settings WHERE key=?',('announcement',)).fetchone()[0]
                    audit = [dict(x) for x in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 15')] if me['role']=='admin' else []
                    self.respond(200,dict(me=self.public(me,me),members=[self.public(r,me) for r in rows],announcement=announcement,audit=audit))
            except Rejection as e:
                self.respond(e.status,dict(error=e.message))
            return
        files = {'/':('index.html','text/html'),'/index.html':('index.html','text/html'),'/mobile.js':('mobile.js','application/javascript'),'/mobile.css':('mobile.css','text/css')}
        if path not in files:
            self.respond(404,dict(error='مسیر پیدا نشد.'))
            return
        name, mime = files[path]
        raw = (ROOT/name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',mime+'; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            # Custom header prevents cross-site forms/CSRF; no CORS is granted.
            if self.headers.get('X-HamSafar') != '1':
                raise Rejection(403,'درخواست نامعتبر است.')
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= 16384:
                raise Rejection(400,'حجم درخواست نامعتبر است.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise ValueError()
            with connect() as db:
                if self.path == '/api/login':
                    now = time.time()
                    ip = self.client_address[0]
                    with attempt_lock:
                        recent = [t for t in attempts.get(ip,[]) if now-t<300]
                        attempts[ip] = recent
                        if len(recent)>=20:
                            raise Rejection(429,'تلاش‌های زیادی انجام شده؛ ۵ دقیقه دیگر امتحان کنید.')
                        recent.append(now)
                    code = data.get('code','')
                    row = db.execute('SELECT * FROM members WHERE code=? AND active=1',(digest(str(code).strip()),)).fetchone()
                    if not row:
                        raise Rejection(401,'کد ورود معتبر نیست. کد اختصاصی خود را از لیدر بگیرید.')
                    token = secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<?',(int(now),))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),row['id'],int(now)+7*86400))
                    secure = '; Secure' if os.environ.get('HAMSAFAR_SECURE')=='1' else ''
                    self.respond(200,dict(ok=True),f'hamsafar={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}')
                    return
                me, token = self.session(db)
                if self.path == '/api/logout':
                    db.execute('DELETE FROM sessions WHERE token=?',(digest(token),))
                    self.respond(200,dict(ok=True),'hamsafar=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
                    return
                if self.path == '/api/announcement':
                    if me['role']!='admin':
                        raise Rejection(403,'این بخش مخصوص مدیر است.')
                    text = data.get('text','')
                    if not isinstance(text,str) or len(text)>1200:
                        raise Rejection(400,'اطلاعیه باید کمتر از ۱۲۰۰ نویسه باشد.')
                    db.execute('UPDATE settings SET value=? WHERE key=?',(text,'announcement'))
                    db.execute('INSERT INTO audit(actor,target,action,stamp) VALUES(?,?,?,?)',(me['id'],0,'announcement',int(time.time())))
                    self.respond(200,dict(ok=True))
                    return
                if self.path != '/api/profile':
                    raise Rejection(404,'مسیر پیدا نشد.')
                target = int(data.get('id',me['id']))
                if target!=me['id'] and me['role']!='admin':
                    raise Rejection(403,'هر نفر فقط می‌تواند پروفایل خودش را ویرایش کند.')
                row = db.execute('SELECT * FROM members WHERE id=?',(target,)).fetchone()
                if not row:
                    raise Rejection(404,'عضو پیدا نشد.')
                p = data.get('profile')
                if not isinstance(p,dict):
                    raise Rejection(400,'اطلاعات پروفایل نامعتبر است.')
                clean = {}
                for field,limit in [('display_name',80),('city',60),('car',60),('about',300),('phone',20)]:
                    value = p.get(field,'')
                    if not isinstance(value,str) or len(value)>limit:
                        raise Rejection(400,'یکی از فیلدها طولانی یا نامعتبر است.')
                    clean[field] = value.strip()
                clean['share_phone'] = p.get('share_phone') is True
                clean['ready'] = p.get('ready') is True
                seats = p.get('seats',0)
                if type(seats)!=int or not 0<=seats<=20:
                    raise Rejection(400,'ظرفیت آزاد باید بین صفر و ۲۰ باشد.')
                clean['seats'] = seats
                if clean['phone'] and not (clean['phone'].isascii() and clean['phone'].replace('+','',1).isdigit()):
                    raise Rejection(400,'شماره تماس را با اعداد انگلیسی وارد کنید.')
                if clean['seats'] and not clean['car']:
                    raise Rejection(400,'برای ثبت صندلی آزاد، دسته خودرو را انتخاب کنید.')
                room, active = row['room'],row['active']
                if me['role']=='admin':
                    room = data.get('room',room)
                    if not isinstance(room,str) or len(room)>120:
                        raise Rejection(400,'نام اتاق نامعتبر است.')
                    active = int(data.get('active',bool(active)) is True)
                    if target==me['id'] and not active:
                        raise Rejection(400,'مدیر نمی‌تواند حساب خودش را غیرفعال کند.')
                ver = data.get('version',-1)
                result = db.execute('UPDATE members SET profile=?,room=?,active=?,version=version+1,updated=? WHERE id=? AND version=?', (json.dumps(clean,ensure_ascii=False),room,active,int(time.time()),target,ver))
                if not result.rowcount:
                    raise Rejection(409,'اطلاعات تازه‌تر موجود است. تازه‌سازی کنید و دوباره ویرایش کنید.')
                db.execute('INSERT INTO audit(actor,target,action,stamp) VALUES(?,?,?,?)',(me['id'],target,'profile',int(time.time())))
                self.respond(200,dict(ok=True))
        except Rejection as e:
            self.respond(e.status,dict(error=e.message))
        except (ValueError,TypeError,KeyError):
            self.respond(400,dict(error='اطلاعات ارسالی نامعتبر است.'))

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--port',type=int,default=8766)
    args.add_argument('--bind',default='127.0.0.1')
    cfg = args.parse_args()
    initialize()
    print(f'HamSafar: http://{cfg.bind}:{cfg.port}',flush=True)
    print(f'Private login codes: {PRIVATE / "access-codes.txt"}',flush=True)
    ThreadingHTTPServer((cfg.bind,cfg.port),Handler).serve_forever()
