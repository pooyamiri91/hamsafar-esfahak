import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, desc, sql } from 'drizzle-orm';
import { members, sessions, settings, audit, attempts } from '../../db/schema.js';
import { names } from '../../db/names.js';

export type Database = Pick<typeof import('../../db/index.js').db, 'select' | 'insert' | 'update' | 'delete' | 'transaction'>;
type Member = typeof members.$inferSelect;
class Rejection extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
function publicMember(row: Member, admin: boolean) {
  const profile = { ...row.profile };
  if (!admin && !profile.share_phone) delete profile.phone;
  return { ...row, profile };
}
function cookie(value: string, secure: boolean, maxAge = 604800) {
  return `hamsafar=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function json(body: unknown, status = 200, sessionCookie?: string) {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  };
  if (sessionCookie) headers['Set-Cookie'] = sessionCookie;
  return Response.json(body, { status, headers });
}
function cleanProfile(input: unknown, previous: Member['profile'], admin: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Rejection(400, 'اطلاعات پروفایل نامعتبر است.');
  const p = input as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [field, limit] of Object.entries({ display_name: 80, city: 60, car: 60, about: 300, phone: 20 })) {
    const value = p[field] ?? '';
    if (typeof value !== 'string' || value.length > limit) throw new Rejection(400, 'یکی از فیلدها طولانی یا نامعتبر است.');
    clean[field] = value.trim();
  }
  clean.share_phone = admin ? p.share_phone === true : previous.share_phone === true;
  if (!admin) clean.phone = previous.phone ?? '';
  clean.ready = p.ready === true;
  const seats = p.seats ?? 0;
  if (!Number.isInteger(seats) || Number(seats) < 0 || Number(seats) > 20) throw new Rejection(400, 'ظرفیت آزاد باید بین صفر و ۲۰ باشد.');
  clean.seats = seats;
  if (clean.phone && !/^\+?[0-9]+$/.test(String(clean.phone))) throw new Rejection(400, 'شماره تماس را با اعداد انگلیسی وارد کنید.');
  if (seats && !clean.car) throw new Rejection(400, 'برای ثبت صندلی آزاد، دسته خودرو را انتخاب کنید.');
  return clean;
}

export function createApi(db: Database, adminCode: () => string = () => process.env.HAMSAFAR_ADMIN_CODE ?? '') {
  // This promise only coalesces initialization. All application data lives in Postgres.
  let initialized: Promise<void> | undefined;
  function initialize() {
    initialized ??= (async () => {
      await db.insert(members).values(names.map((name, index) => ({
        id: index + 1, name, role: index === 2 ? 'admin' : [3, 4, 5].includes(index) ? 'assistant' : 'member',
      }))).onConflictDoNothing();
      await db.insert(settings).values({ key: 'announcement', value: '' }).onConflictDoNothing();
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  return async function handle(request: Request, context?: { ip?: string }) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const secure = url.protocol === 'https:';
      const routes = ['/api/state', '/api/roster', '/api/join', '/api/login', '/api/logout', '/api/profile', '/api/announcement'];
      if (!routes.includes(path)) throw new Rejection(404, 'مسیر پیدا نشد.');
      const expectedMethod = ['/api/state', '/api/roster'].includes(path) ? 'GET' : 'POST';
      if (request.method !== expectedMethod) throw new Rejection(405, 'روش درخواست مجاز نیست.');
      let data: Record<string, unknown> = {};
      if (request.method === 'POST') {
        if (request.headers.get('X-HamSafar') !== '1' || (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin)) {
          throw new Rejection(403, 'درخواست نامعتبر است.');
        }
        if (Number(request.headers.get('Content-Length')) > 16384) throw new Rejection(400, 'حجم درخواست نامعتبر است.');
        // Limit streamed bodies too; Content-Length is not always present.
        const reader = request.body?.getReader();
        if (!reader) throw new Rejection(400, 'اطلاعات ارسالی نامعتبر است.');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) { await reader.cancel(); throw new Rejection(400, 'حجم درخواست نامعتبر است.'); }
          chunks.push(part.value);
        }
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new Rejection(400, 'اطلاعات ارسالی نامعتبر است.'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Rejection(400, 'اطلاعات ارسالی نامعتبر است.');
      }
      await initialize();
      if (path === '/api/roster') {
        return json({ members: await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(members.id) });
      }
      if (path === '/api/join' || path === '/api/login') {
        const verified = path === '/api/login';
        // Atomic shared rate limits survive cold starts and multiple instances.
        const key = digest(`${context?.ip ?? 'unknown'}:${path}`);
        const stamp = now();
        await db.delete(attempts).where(lt(attempts.expires, stamp));
        const [attempt] = await db.insert(attempts).values({ key, count: 1, expires: stamp + 300 })
          .onConflictDoUpdate({ target: attempts.key, set: { count: sql`${attempts.count} + 1` } }).returning();
        if (attempt.count > (verified ? 20 : 300)) throw new Rejection(429, 'تلاش‌های زیادی انجام شده؛ ۵ دقیقه دیگر امتحان کنید.');
        let proof = '';
        if (verified) {
          const configured = adminCode();
          if (configured.length < 16) throw new Rejection(503, 'ورود مدیر هنوز پیکربندی نشده است. ورود با نام برای همسفرها فعال است.');
          const supplied = typeof data.code === 'string' ? data.code.trim() : '';
          if (!timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(digest(configured)))) throw new Rejection(401, 'رمز مدیر معتبر نیست.');
          proof = digest(configured);
        } else if (!Number.isInteger(data.id)) throw new Rejection(400, 'نام خودتان را از فهرست انتخاب کنید.');
        const [row] = await db.select().from(members).where(and(eq(members.id, verified ? 3 : data.id as number), eq(members.active, true)));
        if (!row) throw new Rejection(401, 'این نام در فهرست اعضای فعال نیست.');
        const token = randomBytes(32).toString('base64url');
        await db.delete(sessions).where(lt(sessions.expires, stamp));
        await db.insert(sessions).values({ token: digest(token), member: row.id, expires: stamp + 604800, adminProof: proof });
        return json({ ok: true }, 200, cookie(token, secure));
      }
      const rawToken = request.headers.get('Cookie')?.match(/(?:^|;\s*)hamsafar=([^;]*)/)?.[1] ?? '';
      const [session] = await db.select({ member: members, proof: sessions.adminProof }).from(sessions)
        .innerJoin(members, eq(members.id, sessions.member))
        .where(and(eq(sessions.token, digest(rawToken)), gt(sessions.expires, now()), eq(members.active, true)));
      const configured = adminCode();
      const admin = session?.member.role === 'admin' && !!session.proof && configured.length >= 16 && session.proof === digest(configured);
      const me = session ? { ...session.member, role: session.member.role === 'admin' && !admin ? 'member' : session.member.role } : null;
      if (path === '/api/state') {
        const roster = await db.select().from(members).where(admin ? undefined : eq(members.active, true)).orderBy(members.id);
        const [announcement] = await db.select().from(settings).where(eq(settings.key, 'announcement'));
        const history = admin ? await db.select().from(audit).orderBy(desc(audit.id)).limit(15) : [];
        return json({ me: me ? publicMember(me, admin) : null, members: roster.map(row => publicMember(row, admin)), announcement: announcement?.value ?? '', audit: history });
      }
      if (path === '/api/logout') {
        await db.delete(sessions).where(eq(sessions.token, digest(rawToken)));
        return json({ ok: true }, 200, cookie('', secure, 0));
      }
      if (path === '/api/announcement') {
        if (!admin) throw new Rejection(403, 'این بخش مخصوص مدیر است.');
        if (typeof data.text !== 'string' || data.text.length > 1200) throw new Rejection(400, 'اطلاعیه باید کمتر از ۱۲۰۰ نویسه باشد.');
        const text = data.text;
        await db.transaction(async tx => {
          await tx.update(settings).set({ value: text }).where(eq(settings.key, 'announcement'));
          await tx.insert(audit).values({ actor: admin ? me!.id : 0, target: 0, action: 'announcement', stamp: now() });
        });
        return json({ ok: true });
      }
      const target = data.id ?? me?.id;
      if (!Number.isInteger(target) || !Number.isInteger(data.version)) throw new Rejection(400, 'اطلاعات ارسالی نامعتبر است.');
      await db.transaction(async tx => {
        const [row] = await tx.select().from(members).where(eq(members.id, target as number));
        if (!row || (!admin && !row.active)) throw new Rejection(404, 'عضو پیدا نشد.');
        const profile = cleanProfile(data.profile, row.profile, admin);
        const room = admin ? data.room ?? row.room : row.room;
        const active = admin ? data.active ?? row.active : row.active;
        if (typeof room !== 'string' || room.length > 120 || typeof active !== 'boolean') throw new Rejection(400, 'اطلاعات اتاق نامعتبر است.');
        if (target === me?.id && !active) throw new Rejection(400, 'مدیر نمی‌تواند حساب خودش را غیرفعال کند.');
        const updated = await tx.update(members).set({ profile, room, active, version: sql`${members.version} + 1`, updated: now() })
          .where(and(eq(members.id, target as number), eq(members.version, data.version as number))).returning({ id: members.id });
        if (!updated.length) throw new Rejection(409, 'اطلاعات تازه‌تر موجود است. تازه‌سازی کنید و دوباره ویرایش کنید.');
        await tx.insert(audit).values({ actor: admin ? me!.id : 0, target: row.id, action: 'profile', stamp: now() });
      });
      return json({ ok: true });
    } catch (error) {
      if (error instanceof Rejection) return json({ error: error.message }, error.status);
      // Do not expose connection strings, request bodies or database errors.
      return json({ error: 'اتصال به اطلاعات مشترک برقرار نشد؛ کمی بعد دوباره تلاش کنید.' }, 503);
    }
  };
}
