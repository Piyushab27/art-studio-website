// End-to-end tests: start the app on a temp DB with a frozen clock and check
// RBAC, the "only once" rules, date boundaries, sessions, rate limiting and history.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ADMIN_EMAIL = 'studio@example.com';
process.env.ADMIN_PASSWORD = 'test-admin-pw';
const { openDb, seed } = await import('../db.js');
const { createApp } = await import('../app.js');

const TODAY = '2026-10-25'; // frozen "today"
const iso = (n) => new Date(Date.UTC(2026, 9, 25 + n)).toISOString().slice(0, 10);
const db = openDb(join(tmpdir(), `studio-test-${Date.now()}.db`));
const server = createApp(db, { today: () => TODAY }).listen(0);
const base = `http://localhost:${server.address().port}`;
const rate = seed.wallRatePerSqFt;
const item = seed.potteryItems[0], glaze = seed.glazes[0];

async function call(who, method, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(who?.cookie ? { cookie: who.cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(email, password) { const r = await call(null, 'POST', '/api/auth/login', { email, password }); assert.equal(r.status, 200); return { cookie: r.cookie }; }
async function signup(name) { const r = await call(null, 'POST', '/api/auth/signup', { name, email: `${name}@t.com`, password: 'secret1' }); assert.equal(r.status, 201); return { cookie: r.cookie }; }
const run = [];
const test = (name, fn) => run.push([name, fn]);

const admin = await login('studio@example.com', 'test-admin-pw');
const a = await signup('alice'), b = await signup('bob');

test('401 / 403 role checks', async () => {
  assert.equal((await call(null, 'GET', '/api/paintings')).status, 401);
  assert.equal((await call(a, 'POST', '/api/paintings', { title: 'x', price: 5 })).status, 403);
  assert.equal((await call(a, 'DELETE', '/api/paintings/1')).status, 403);
  assert.equal((await call(admin, 'POST', '/api/orders', { paintingId: 1 })).status, 403);
  assert.equal((await call(admin, 'POST', '/api/bookings', {})).status, 403);
  assert.equal((await call(admin, 'POST', '/api/pottery', {})).status, 403);
});

test('painting can be bought once; cancel frees it; ownership is 404', async () => {
  const pid = (await call(admin, 'POST', '/api/paintings', { title: 'Test', price: 100 })).body.id;
  const results = await Promise.all([call(a, 'POST', '/api/orders', { paintingId: pid }), call(b, 'POST', '/api/orders', { paintingId: pid })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const win = results.find((r) => r.status === 201), who = results[0].status === 201 ? a : b, other = who === a ? b : a;
  assert.equal((await call(admin, 'PUT', `/api/paintings/${pid}`, { title: 'Y', price: 5 })).status, 409);
  assert.equal((await call(admin, 'DELETE', `/api/paintings/${pid}`)).status, 409);
  assert.equal((await call(other, 'POST', `/api/orders/${win.body.id}/cancel`)).status, 404);
  assert.equal((await call(other, 'GET', `/api/history/orders/${win.body.id}`)).status, 404);
  assert.equal((await call(admin, 'POST', `/api/orders/${win.body.id}/cancel`)).status, 403);
  assert.equal((await call(who, 'POST', `/api/orders/${win.body.id}/cancel`)).status, 200);
  assert.equal((await call(other, 'POST', '/api/orders', { paintingId: pid })).status, 201);
  assert.equal((await call(a, 'GET', '/api/orders')).body.every((o) => o.customer_email === 'alice@t.com'), true);
  const hist = (await call(who, 'GET', `/api/history/orders/${win.body.id}`)).body;
  assert.deepEqual(hist.map((h) => h.status), ['placed', 'cancelled']);
});

test('painting delete (only without history), search and paging', async () => {
  const p = (await call(admin, 'POST', '/api/paintings', { title: 'Zebra Study', artist: 'Q', price: 777 })).body;
  const found = (await call(a, 'GET', '/api/paintings?q=zebra&status=available&min=700&max=800')).body;
  assert.equal(found.length, 1); assert.equal(found[0].id, p.id);
  assert.equal((await call(a, 'GET', '/api/paintings?q=zebra&max=100')).body.length, 0);
  assert.equal((await call(a, 'GET', '/api/paintings?limit=1')).body.length, 1);
  assert.equal((await call(admin, 'DELETE', `/api/paintings/${p.id}`)).status, 200);
  assert.equal((await call(admin, 'DELETE', `/api/paintings/${p.id}`)).status, 404);
});

test('booking date boundaries, size limits and price', async () => {
  const bk = (date, sq = 100) => ({ date, wallSqFt: sq, address: '12 Main Street' });
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(6)))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(91)))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(10), 9))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(10), 501))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk('2026-02-31'))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', { ...bk(iso(10)), address: 'x'.repeat(301) })).status, 400);
  const lo = await call(a, 'POST', '/api/bookings', bk(iso(7), 10));
  assert.equal(lo.status, 201); assert.equal(lo.body.price, 10 * rate);
  const hi = await call(a, 'POST', '/api/bookings', bk(iso(90), 500));
  assert.equal(hi.status, 201); assert.equal(hi.body.price, 500 * rate);
});

test('a date can be booked once; decline frees it; only studio decides', async () => {
  const bk = (date) => ({ date, wallSqFt: 50, address: '12 Main Street' });
  const race = await Promise.all([call(a, 'POST', '/api/bookings', bk(iso(30))), call(b, 'POST', '/api/bookings', bk(iso(30)))]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  const win = race.find((r) => r.status === 201), who = race[0].status === 201 ? a : b, other = who === a ? b : a;
  assert.equal((await call(other, 'POST', `/api/bookings/${win.body.id}/cancel`)).status, 404);
  assert.equal((await call(who, 'POST', `/api/bookings/${win.body.id}/confirm`)).status, 403);
  const declined = await call(admin, 'POST', `/api/bookings/${win.body.id}/decline`, { note: 'Fully booked that week' });
  assert.equal(declined.body.status, 'declined'); assert.equal(declined.body.note, 'Fully booked that week');
  assert.equal((await call(admin, 'POST', `/api/bookings/${win.body.id}/confirm`)).status, 409);
  assert.equal((await call(other, 'POST', '/api/bookings', bk(iso(30)))).status, 201);
  assert.deepEqual((await call(who, 'GET', `/api/history/bookings/${win.body.id}`)).body.map((h) => h.status), ['requested', 'declined']);
});

test('booking cancel window: allowed at 3 days, refused at 2', async () => {
  const mk = async (days) => {
    const who = await signup('cx' + days + Math.random().toString(36).slice(2, 6));
    const r = await call(who, 'POST', '/api/bookings', { date: iso(60), wallSqFt: 20, address: '12 Main Street' });
    db.prepare('UPDATE bookings SET booking_date = ? WHERE id = ?').run(iso(days), r.body.id); // move into the window
    return [who, r.body.id];
  };
  const [w3, id3] = await mk(3), [w2, id2] = await mk(2);
  const list = (await call(w3, 'GET', '/api/bookings')).body;
  assert.equal(list.find((x) => x.id === id3).can_cancel, true);
  assert.equal((await call(w2, 'GET', '/api/bookings')).body.find((x) => x.id === id2).can_cancel, false);
  assert.equal((await call(w3, 'POST', `/api/bookings/${id3}/cancel`)).status, 200);
  assert.equal((await call(w2, 'POST', `/api/bookings/${id2}/cancel`)).status, 409);
});

test('pottery validation boundaries and lifecycle', async () => {
  const pot = (o = {}) => ({ item: item.name, glaze, quantity: 2, neededBy: iso(14), ...o });
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ neededBy: iso(13) }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ quantity: 13 }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ quantity: 0 }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ glaze: 'Nope' }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ item: 'Nope' }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ quantity: 12 }))).status, 201);
  const p1 = await call(a, 'POST', '/api/pottery', pot());
  assert.equal(p1.status, 201); assert.equal(p1.body.price, item.price * 2);
  assert.equal((await call(a, 'PUT', `/api/pottery/${p1.body.id}`, pot({ quantity: 3 }))).body.quantity, 3);
  assert.equal((await call(b, 'PUT', `/api/pottery/${p1.body.id}`, pot())).status, 404);
  assert.equal((await call(admin, 'POST', `/api/pottery/${p1.body.id}/accept`, { note: 'See you soon' })).body.status, 'accepted');
  assert.equal((await call(a, 'PUT', `/api/pottery/${p1.body.id}`, pot())).status, 409);
  assert.equal((await call(a, 'POST', `/api/pottery/${p1.body.id}/cancel`)).status, 409);
  assert.deepEqual((await call(a, 'GET', `/api/history/pottery/${p1.body.id}`)).body.map((h) => h.status), ['requested', 'edited', 'accepted']);
});

test('sessions expire server-side', async () => {
  const who = await signup('sess');
  assert.equal((await call(who, 'GET', '/api/me')).status, 200);
  db.prepare("UPDATE sessions SET created_at = datetime('now','-8 days')").run();
  assert.equal((await call(who, 'GET', '/api/me')).status, 401);
  Object.assign(admin, await login('studio@example.com', 'test-admin-pw'));
  Object.assign(a, await login('alice@t.com', 'secret1'));
  Object.assign(b, await login('bob@t.com', 'secret1'));
});

test('login is rate limited after 10 failures', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'victim@t.com', password: 'wrong' + i })).status, 401);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'victim@t.com', password: 'wrong' })).status, 429);
});

test('cross-site requests are refused', async () => {
  const r = await call(a, 'POST', '/api/orders', { paintingId: 1 }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('input length caps', async () => {
  assert.equal((await call(admin, 'POST', '/api/paintings', { title: 'x'.repeat(121), price: 5 })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/signup', { name: 'n'.repeat(81), email: 'long@t.com', password: 'secret1' })).status, 400);
});

let failed = 0;
for (const [name, fn] of run) {
  try { await fn(); console.log('ok   -', name); }
  catch (e) { failed++; console.log('FAIL -', name, '\n', e.message); }
}
server.close();
if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
console.log('All tests passed');
