import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.js';
import { createApi, type Database } from '../netlify/server/api.js';

// The test database executes the actual generated PostgreSQL migration in isolation.
async function setup() {
  const pg = new PGlite();
  const directory = 'netlify/database/migrations';
  for (const item of (await readdir(directory)).sort()) {
    const path = item.endsWith('.sql') ? join(directory, item) : join(directory, item, 'migration.sql');
    await pg.exec(await readFile(path, 'utf8'));
  }
  const db = drizzle({ client: pg, schema }) as unknown as Database;
  const api = createApi(db, () => 'test-only-administrator-fixture');
  async function call(path: string, data?: unknown, cookie?: string, handler = api) {
    const headers = new Headers();
    if (data !== undefined) { headers.set('X-HamSafar', '1'); headers.set('Content-Type', 'application/json'); }
    if (cookie) headers.set('Cookie', cookie);
    return handler(new Request(`https://example.test/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST', headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }), { ip: 'test-client' });
  }
  const session = (response: Response) => response.headers.get('Set-Cookie')!.split(';')[0];
  return { pg, db, api, call, session };
}

test('name entry persists profiles across handlers; logout revokes the session', async () => {
  const { pg, db, call, session } = await setup();
  try {
    assert.equal((await call('state')).status, 200);
    const roster = await (await call('roster')).json();
    assert.equal(roster.members.length, 27);
    assert.deepEqual(Object.keys(roster.members[0]).sort(), ['id', 'name']);
    assert.equal((await call('join', { id: '1' })).status, 400);
    assert.equal((await call('join', { id: 999 })).status, 401);
    const entered = await call('join', { id: 1 });
    assert.equal(entered.status, 200);
    assert.match(entered.headers.get('Set-Cookie')!, /HttpOnly; SameSite=Strict.*Secure/);
    const token = session(entered);
    const state = await (await call('state', undefined, token)).json();
    assert.equal(state.me.id, 1);
    assert.equal((await call('profile', { id: 1, version: 0, profile: { display_name: 'نام آزمایشی', city: 'تهران', seats: 2, car: 'خودرو' } }, token)).status, 200);
    const restarted = createApi(db);
    const saved = await (await call('state', undefined, token, restarted)).json();
    assert.equal(saved.me.profile.display_name, 'نام آزمایشی');
    assert.equal(saved.me.version, 1);
    assert.equal((await call('profile', { id: 1, version: 0, profile: {} }, token)).status, 409);
    assert.equal((await call('profile', { id: 2, version: 0, profile: {} }, token)).status, 200);
    assert.equal((await call('announcement', { text: 'test' }, token)).status, 403);
    assert.equal((await call('logout', {}, token)).status, 200);
    assert.equal((await (await call('state', undefined, token)).json()).me, null);
  } finally { await pg.close(); }
});

test('leader name grants no administration; password protects private fields and changes', async () => {
  const { pg, db, call, session } = await setup();
  try {
    const leaderToken = session(await call('join', { id: 3 }));
    const leader = await (await call('state', undefined, leaderToken)).json();
    assert.equal(leader.me.role, 'member');
    assert.equal((await call('announcement', { text: 'test' }, leaderToken)).status, 403);
    assert.equal((await call('login', { code: 'incorrect' })).status, 401);
    const adminResponse = await call('login', { code: 'test-only-administrator-fixture' });
    assert.equal(adminResponse.status, 200);
    const adminToken = session(adminResponse);
    assert.equal((await call('profile', { id: 1, version: 0, profile: { phone: '09120000000', share_phone: false } }, adminToken)).status, 200);
    const memberToken = session(await call('join', { id: 1 }));
    let member = await (await call('state', undefined, memberToken)).json();
    assert.equal(member.me.profile.phone, undefined);
    assert.equal((await call('profile', { id: 1, version: 1, profile: { phone: '09121111111', share_phone: true, display_name: 'عضو' } }, memberToken)).status, 200);
    const admin = await (await call('state', undefined, adminToken)).json();
    assert.equal(admin.members[0].profile.phone, '09120000000');
    assert.equal(admin.members[0].profile.share_phone, false);
    assert.equal(admin.audit.length, 2);
    assert.equal((await call('announcement', { text: 'اطلاعیه' }, adminToken)).status, 200);
    member = await (await call('state', undefined, memberToken)).json();
    assert.equal(member.announcement, 'اطلاعیه');
    assert.equal(member.audit.length, 0);
    const rotated = createApi(db, () => 'rotated-test-only-admin-fixture');
    assert.equal((await (await call('state', undefined, adminToken, rotated)).json()).me.role, 'member');
    assert.equal((await call('announcement', { text: 'test' }, adminToken, rotated)).status, 403);
    assert.equal((await call('state', undefined, memberToken, rotated)).status, 200);
  } finally { await pg.close(); }
});

test('JSON errors, CSRF, validation, and shared attempt limits', async () => {
  const { pg, db, api, call, session } = await setup();
  try {
    assert.equal((await call('missing')).status, 404);
    assert.equal((await call('join')).status, 405);
    const csrf = await api(new Request('https://example.test/api/join', { method: 'POST', body: '{"id":1}' }));
    assert.equal(csrf.status, 403);
    const crossOrigin = await api(new Request('https://example.test/api/join', { method: 'POST', headers: { 'X-HamSafar': '1', Origin: 'https://other.test' }, body: '{"id":1}' }));
    assert.equal(crossOrigin.status, 403);
    assert.equal((await call('join', { id: 1, padding: 'x'.repeat(17000) })).status, 400);
    const cookie = session(await call('join', { id: 1 }));
    assert.equal((await call('profile', { version: 0, profile: { seats: 21 } }, cookie)).status, 400);
    const missingAdmin = createApi(db, () => '');
    assert.equal((await call('login', { code: 'test' }, undefined, missingAdmin)).status, 503);
    assert.equal((await call('join', { id: 2 }, undefined, missingAdmin)).status, 200);
    for (let i = 0; i < 19; i++) await call('login', { code: 'incorrect' });
    const limited = await call('login', { code: 'incorrect' });
    assert.equal(limited.status, 429);
    assert.match(limited.headers.get('Content-Type')!, /application\/json/);
    assert.equal(limited.headers.get('Cache-Control'), 'no-store');
  } finally { await pg.close(); }
});


test('visitors see all names and edit public fields without a session', async () => {
  const { pg, db, call } = await setup();
  try {
    const first = await (await call('state')).json();
    assert.equal(first.me, null);
    assert.equal(first.members.length, 27);
    assert.equal((await call('profile', { id: 7, version: 0, profile: { display_name: 'همسفر', city: 'تهران', ready: true }, room: 'untrusted', active: false })).status, 200);
    const restarted = createApi(db);
    const saved = await (await call('state', undefined, undefined, restarted)).json();
    assert.equal(saved.members[6].profile.display_name, 'همسفر');
    assert.equal(saved.members[6].profile.ready, true);
    assert.equal(saved.members[6].room, '');
    assert.equal(saved.members[6].active, true);
    assert.equal(saved.audit.length, 0);
    assert.equal((await call('profile', { id: 7, version: 0, profile: {} })).status, 409);
    assert.equal((await call('announcement', { text: 'untrusted' })).status, 403);
  } finally { await pg.close(); }
});
