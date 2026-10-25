// End-to-end smoke test: starts the app on a temp DB and checks RBAC + the "only once" rules.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

const db = openDb(join(tmpdir(), `studio-test-${Date.now()}.db`));
const server = createApp(db).listen(0);
const base = `http://localhost:${server.address().port}`;

const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function call(who, method, path, body) {
  const r = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(who?.cookie ? { cookie: who.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(email, password) { const r = await call(null, 'POST', '/api/auth/login', { email, password }); assert.equal(r.status, 200); return { cookie: r.cookie }; }
async function signup(name) { const r = await call(null, 'POST', '/api/auth/signup', { name, email: `${name}@t.com`, password: 'secret1' }); assert.equal(r.status, 201); return { cookie: r.cookie }; }

try {
  const admin = await login('studio@example.com', 'studio123');
  const a = await signup('alice'), b = await signup('bob');

  // 401 / 403
  assert.equal((await call(null, 'GET', '/api/paintings')).status, 401);
  assert.equal((await call(a, 'POST', '/api/paintings', { title: 'x', price: 5 })).status, 403);
  assert.equal((await call(admin, 'POST', '/api/orders', { paintingId: 1 })).status, 403);
  assert.equal((await call(admin, 'POST', '/api/bookings', {})).status, 403);

  // painting: buy once, cancel frees it
  const pid = (await call(admin, 'POST', '/api/paintings', { title: 'Test', price: 100 })).body.id;
  const results = await Promise.all([call(a, 'POST', '/api/orders', { paintingId: pid }), call(b, 'POST', '/api/orders', { paintingId: pid })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results.find((r) => r.status === 201), winnerWho = results[0].status === 201 ? a : b, loser = winnerWho === a ? b : a;
  assert.equal((await call(admin, 'PUT', `/api/paintings/${pid}`, { title: 'Y', price: 5 })).status, 409); // sold -> not editable
  assert.equal((await call(loser, 'POST', `/api/orders/${winner.body.id}/cancel`)).status, 404); // someone else's record
  assert.equal((await call(admin, 'POST', `/api/orders/${winner.body.id}/cancel`)).status, 403);
  assert.equal((await call(winnerWho, 'POST', `/api/orders/${winner.body.id}/cancel`)).status, 200);
  assert.equal((await call(loser, 'POST', '/api/orders', { paintingId: pid })).status, 201); // available again
  assert.equal((await call(a, 'GET', '/api/orders')).body.every((o) => o.customer_email === 'alice@t.com'), true);

  // booking: range, size, one per date, price, ownership, cancel window, decline frees date
  const bk = (date, sq = 100) => ({ date, wallSqFt: sq, address: '12 Main Street' });
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(6)))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(91)))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(10), 9))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk(iso(10), 501))).status, 400);
  assert.equal((await call(a, 'POST', '/api/bookings', bk('2026-02-31'))).status, 400);
  const first = await call(a, 'POST', '/api/bookings', bk(iso(7), 100));
  assert.equal(first.status, 201); assert.equal(first.body.price, 100 * 45);
  const race = await Promise.all([call(a, 'POST', '/api/bookings', bk(iso(30))), call(b, 'POST', '/api/bookings', bk(iso(30)))]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await call(b, 'POST', `/api/bookings/${first.body.id}/cancel`)).status, 404);
  assert.equal((await call(a, 'POST', `/api/bookings/${first.body.id}/confirm`)).status, 403);
  assert.equal((await call(admin, 'POST', `/api/bookings/${first.body.id}/decline`)).body.status, 'declined');
  assert.equal((await call(b, 'POST', '/api/bookings', bk(iso(7)))).status, 201); // declined date is free again
  // cancel window: force a booking to 2 days away directly in the DB
  db.prepare("UPDATE bookings SET booking_date = ? WHERE id = ?").run(iso(2), race.find((r) => r.status === 201).body.id);
  const near = race.find((r) => r.status === 201), nearWho = race[0].status === 201 ? a : b;
  assert.equal((await call(nearWho, 'POST', `/api/bookings/${near.body.id}/cancel`)).status, 409);

  // pottery
  const pot = (o = {}) => ({ item: 'Mug', glaze: 'Celadon', quantity: 2, neededBy: iso(14), ...o });
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ neededBy: iso(13) }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ quantity: 13 }))).status, 400);
  assert.equal((await call(a, 'POST', '/api/pottery', pot({ glaze: 'Nope' }))).status, 400);
  const p1 = await call(a, 'POST', '/api/pottery', pot());
  assert.equal(p1.status, 201);
  assert.equal((await call(a, 'PUT', `/api/pottery/${p1.body.id}`, pot({ quantity: 3 }))).body.quantity, 3);
  assert.equal((await call(b, 'PUT', `/api/pottery/${p1.body.id}`, pot())).status, 404);
  assert.equal((await call(admin, 'POST', `/api/pottery/${p1.body.id}/accept`)).body.status, 'accepted');
  assert.equal((await call(a, 'PUT', `/api/pottery/${p1.body.id}`, pot())).status, 409);
  assert.equal((await call(a, 'POST', `/api/pottery/${p1.body.id}/cancel`)).status, 409);
  assert.equal((await call(admin, 'GET', '/api/pottery')).body.length, 1);

  console.log('All smoke tests passed');
} finally {
  server.close();
}
