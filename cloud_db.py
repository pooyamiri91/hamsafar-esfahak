"""Persistent Postgres storage for the Vercel entrypoint; never falls back to /tmp."""
from contextlib import contextmanager
import os

def configuration():
    url=os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
    password=os.environ.get('HAMSAFAR_ADMIN_CODE','')
    if not url or len(password)<16:
        raise RuntimeError('Cloud database and administrator password must be configured.')
    return url,password

class Row(dict):
    def __getitem__(self,key):
        return list(self.values())[key] if isinstance(key,int) else super().__getitem__(key)

class Cursor:
    def __init__(self,cursor):self.cursor=cursor
    @property
    def rowcount(self):return self.cursor.rowcount
    def fetchone(self):
        row=self.cursor.fetchone()
        return Row(row) if row is not None else None
    def fetchall(self):return [Row(row) for row in self.cursor.fetchall()]
    def __iter__(self):return iter(self.fetchall())

class Database:
    def __init__(self,connection):self.connection=connection
    def execute(self,sql,parameters=()):
        # Application statements use placeholders only for bound values, never in literals.
        return Cursor(self.connection.execute(sql.replace('?','%s'),parameters))

@contextmanager
def connect():
    url,_=configuration()
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(url,row_factory=dict_row,connect_timeout=8,prepare_threshold=None) as connection:
        yield Database(connection)

def initialize(names,digest):
    _,password=configuration()
    with connect() as db:
        # Serialize first initialization across cold starts and deployments.
        db.execute('SELECT pg_advisory_xact_lock(174523001)')
        statements=[
          "CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,code TEXT NOT NULL,profile TEXT NOT NULL DEFAULT '{}',room TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 0,updated BIGINT NOT NULL DEFAULT 0)",
          'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,member INTEGER,expires BIGINT,admin_verified INTEGER NOT NULL DEFAULT 0)',
          'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS admin_verified INTEGER NOT NULL DEFAULT 0',
          'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)',
          'CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,actor INTEGER,target INTEGER,action TEXT,stamp BIGINT)',
        ]
        for sql in statements:db.execute(sql)
        for i,name in enumerate(names,1):
            role='admin' if i==3 else ('assistant' if i in (4,5,6) else 'member')
            code=digest(password) if role=='admin' else digest('name-entry-only:'+str(i))
            db.execute('INSERT INTO members(id,name,role,code) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',(i,name,role,code))
        # Set the administrator password from private environment configuration.
        # Rotation invalidates existing administrator sessions, without touching profiles.
        row=db.execute('SELECT code FROM members WHERE id=3 FOR UPDATE').fetchone()
        if row['code']!=digest(password):
            db.execute('DELETE FROM sessions WHERE member=3 AND admin_verified=1')
            db.execute('UPDATE members SET code=? WHERE id=3',(digest(password),))
        db.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING',('announcement',''))
