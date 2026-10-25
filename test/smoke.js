// End-to-end tests: start the app on a temp DB with a frozen clock and check
// RBAC, the "only once" rules, date boundaries, sessions, rate limiting and history.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';

process.env.ADMIN_EMAIL = 'studio@example.com';
process.env.ADMIN_PASSWORD = 'test-admin-pw';
const { openDb, seed } = await import('../db.js');
const { createApp } = await import('../app.js');
const { razorpayAdapter } = await import('../payments.js');

const TODAY = '2026-10-25'; // frozen "today"
const iso = (n) => new Date(Date.UTC(2026, 9, 25 + n)).toISOString().slice(0, 10);
const db = openDb(join(tmpdir(), `studio-test-${Date.now()}.db`));
const uploadDir = mkdtempSync(join(tmpdir(), 'studio-uploads-'));
const sentMail = [];
const mailer = { mode: 'test', send: async (m) => { sentMail.push(m); } };
const server = createApp(db, { today: () => TODAY, mailer, uploadDir, simulationStepMs: 15, simulationSteps: 3 }).listen(0);
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

const PIN = { address: '12 Main Street, Hyderabad', lat: 17.41, lng: 78.45 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function upload(who, id, body, type = 'image/png') {
  const r = await fetch(`${base}/api/paintings/${id}/image`, { method: 'POST', headers: { 'content-type': type, cookie: who.cookie }, body });
  return { status: r.status, body: await r.json() };
}
async function pay(who, kind, id) {
  const c = await call(who, 'POST', '/api/payments/create', { kind, id });
  if (c.status !== 201) return { create: c };
  const v = await call(who, 'POST', '/api/payments/verify', { razorpayOrderId: c.body.razorpayOrderId, razorpayPaymentId: 'pay_mock_' + Math.random().toString(36).slice(2), razorpaySignature: '' });
  return { create: c, verify: v };
}
const newPainting = async (price = 500) => (await call(admin, 'POST', '/api/paintings', { title: 'P' + Math.random(), price })).body.id;

test('single-record routes: owner or studio gets 200, other customers get 404', async () => {
  const pid = await newPainting();
  const o = await call(a, 'POST', '/api/orders', { paintingId: pid, ...PIN });
  assert.equal(o.status, 201); assert.equal(o.body.delivery_address, PIN.address); assert.equal(o.body.lat, PIN.lat);
  assert.equal((await call(a, 'GET', `/api/orders/${o.body.id}`)).status, 200);
  assert.equal((await call(admin, 'GET', `/api/orders/${o.body.id}`)).status, 200);
  assert.equal((await call(b, 'GET', `/api/orders/${o.body.id}`)).status, 404);
  assert.equal((await call(a, 'GET', '/api/orders/99999')).status, 404);
  assert.equal((await call(a, 'GET', `/api/paintings/${pid}`)).status, 200);
  assert.equal((await call(a, 'GET', '/api/paintings/99999')).status, 404);
  const bk = await call(a, 'POST', '/api/bookings', { date: iso(40), wallSqFt: 30, address: '12 Main Street', lat: 17.4, lng: 78.4 });
  assert.equal((await call(a, 'GET', `/api/bookings/${bk.body.id}`)).status, 200);
  assert.equal((await call(b, 'GET', `/api/bookings/${bk.body.id}`)).status, 404);
  const po = await call(a, 'POST', '/api/pottery', { item: item.name, glaze, quantity: 1, neededBy: iso(20) });
  assert.equal((await call(a, 'GET', `/api/pottery/${po.body.id}`)).status, 200);
  assert.equal((await call(b, 'GET', `/api/pottery/${po.body.id}`)).status, 404);
  assert.equal((await call(a, 'POST', '/api/orders', { paintingId: await newPainting(), lat: 999, lng: 0 })).status, 400);
});

test('image upload: studio only, real images only, replaced file is removed', async () => {
  const pid = await newPainting();
  assert.equal((await upload(a, pid, PNG)).status, 403);
  assert.equal((await upload(admin, pid, Buffer.from('not an image at all'))).status, 415);
  const ok = await upload(admin, pid, PNG);
  assert.equal(ok.status, 200); assert.match(ok.body.image_url, /^\/uploads\/[a-f0-9]+\.png$/);
  const served = await fetch(base + ok.body.image_url);
  assert.equal(served.status, 200); assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  const second = await upload(admin, pid, PNG);
  assert.notEqual(second.body.image_url, ok.body.image_url);
  assert.equal(existsSync(join(uploadDir, ok.body.image_url.split('/').pop())), false);
  assert.equal((await call(a, 'POST', '/api/orders', { paintingId: pid })).status, 201);
  assert.equal((await upload(admin, pid, PNG)).status, 409); // sold -> locked
});

test('payments: pay an order, no double pay, refund on cancel, ownership', async () => {
  const pid = await newPainting(1200);
  const o = (await call(a, 'POST', '/api/orders', { paintingId: pid })).body;
  assert.equal(o.payment_status, 'unpaid');
  assert.equal((await call(admin, 'POST', '/api/payments/create', { kind: 'orders', id: o.id })).status, 403);
  assert.equal((await call(b, 'POST', '/api/payments/create', { kind: 'orders', id: o.id })).status, 404);
  assert.equal((await call(a, 'POST', '/api/payments/create', { kind: 'nope', id: 1 })).status, 400);
  const c = await call(a, 'POST', '/api/payments/create', { kind: 'orders', id: o.id });
  assert.equal(c.status, 201); assert.equal(c.body.amount, 120000); assert.equal(c.body.mode, 'mock');
  // forged / unverifiable payment is rejected and does not mark anything paid
  assert.equal((await call(a, 'POST', '/api/payments/verify', { razorpayOrderId: c.body.razorpayOrderId, razorpayPaymentId: 'pay_fake', razorpaySignature: 'x' })).status, 400);
  assert.equal((await call(a, 'GET', `/api/orders/${o.id}`)).body.payment_status, 'unpaid');
  const done = await pay(a, 'orders', o.id);
  assert.equal(done.verify.status, 200);
  assert.equal((await call(a, 'GET', `/api/orders/${o.id}`)).body.payment_status, 'paid');
  assert.equal((await call(a, 'POST', '/api/payments/create', { kind: 'orders', id: o.id })).status, 409); // already paid
  assert.equal((await call(b, 'POST', '/api/payments/verify', { razorpayOrderId: c.body.razorpayOrderId, razorpayPaymentId: 'pay_mock_z', razorpaySignature: '' })).status, 404);
  const rev = (await call(admin, 'GET', '/api/admin/summary')).body.revenue;
  assert.ok(rev >= 1200);
  const cancelled = await call(a, 'POST', `/api/orders/${o.id}/cancel`);
  assert.equal(cancelled.body.status, 'cancelled'); assert.equal(cancelled.body.payment_status, 'refunded');
  assert.equal((await call(admin, 'GET', '/api/admin/summary')).body.revenue, rev - 1200);
  assert.equal((await call(a, 'POST', '/api/payments/create', { kind: 'orders', id: o.id })).status, 409); // cancelled
});

test('payments: bookings payable only once confirmed; pottery only once accepted', async () => {
  const bk = (await call(a, 'POST', '/api/bookings', { date: iso(45), wallSqFt: 40, address: '12 Main Street', ...PIN })).body;
  assert.equal((await pay(a, 'bookings', bk.id)).create.status, 409);
  await call(admin, 'POST', `/api/bookings/${bk.id}/confirm`);
  assert.equal((await pay(a, 'bookings', bk.id)).verify.status, 200);
  assert.equal((await call(a, 'POST', `/api/bookings/${bk.id}/cancel`)).body.payment_status, 'refunded');
  const po = (await call(a, 'POST', '/api/pottery', { item: item.name, glaze, quantity: 2, neededBy: iso(30) })).body;
  assert.equal((await pay(a, 'pottery', po.id)).create.status, 409);
  await call(admin, 'POST', `/api/pottery/${po.id}/accept`);
  assert.equal((await pay(a, 'pottery', po.id)).verify.status, 200);
  assert.equal((await call(a, 'GET', `/api/pottery/${po.id}`)).body.payment_status, 'paid');
});

test('razorpay signature check accepts only the correct HMAC', () => {
  const rz = razorpayAdapter({ keyId: 'rzp_test_x', keySecret: 'topsecret' });
  const sig = createHmac('sha256', 'topsecret').update('order_1|pay_1').digest('hex');
  assert.equal(rz.verify({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }), true);
  assert.equal(rz.verify({ orderId: 'order_1', paymentId: 'pay_2', signature: sig }), false);
  assert.equal(rz.verify({ orderId: 'order_1', paymentId: 'pay_1', signature: 'abc' }), false);
  assert.equal(rz.verify({ orderId: 'order_1', paymentId: 'pay_1', signature: undefined }), false);
});

test('live tracking: stages, location, ownership and simulated route', async () => {
  const bk = (await call(a, 'POST', '/api/bookings', { date: iso(50), wallSqFt: 25, address: '12 Main Street', ...PIN })).body;
  assert.equal((await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/stage`, { stage: 'on_the_way' })).status, 409); // not confirmed yet
  await call(admin, 'POST', `/api/bookings/${bk.id}/confirm`);
  const t0 = (await call(a, 'GET', `/api/tracking/bookings/${bk.id}`)).body;
  assert.equal(t0.stage, 'scheduled'); assert.equal(t0.position, null); assert.equal(t0.destination.lat, PIN.lat);
  assert.equal((await call(b, 'GET', `/api/tracking/bookings/${bk.id}`)).status, 404);
  assert.equal((await call(a, 'POST', `/api/tracking/bookings/${bk.id}/stage`, { stage: 'on_the_way' })).status, 403);
  assert.equal((await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/stage`, { stage: 'flying' })).status, 400);
  assert.equal((await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/location`, { lat: 200, lng: 0 })).status, 400);
  const moving = (await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/stage`, { stage: 'on_the_way' })).body;
  assert.equal(moving.stage, 'on_the_way'); assert.ok(moving.position);
  const gps = (await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/location`, { lat: 17.39, lng: 78.48 })).body;
  assert.equal(gps.position.lat, 17.39);
  assert.equal((await call(admin, 'POST', `/api/tracking/bookings/${bk.id}/simulate`)).status, 202);
  await new Promise((r) => setTimeout(r, 200));
  const end = (await call(a, 'GET', `/api/tracking/bookings/${bk.id}`)).body;
  assert.equal(end.stage, 'arrived'); assert.equal(end.simulating, false); assert.equal(end.position.lat, PIN.lat);
  const all = (await call(admin, 'GET', '/api/tracking')).body;
  assert.ok(all.items.some((i) => i.kind === 'bookings' && i.id === bk.id));
  assert.equal((await call(a, 'GET', '/api/tracking')).status, 403);
  assert.deepEqual((await call(a, 'GET', `/api/history/bookings/${bk.id}`)).body.map((h) => h.status).slice(-2), ['on_the_way', 'arrived']);
  // an order without a pin cannot be simulated
  const o = (await call(a, 'POST', '/api/orders', { paintingId: await newPainting() })).body;
  assert.equal((await call(admin, 'POST', `/api/tracking/orders/${o.id}/simulate`)).status, 409);
  assert.equal((await call(admin, 'POST', `/api/tracking/orders/${o.id}/stage`, { stage: 'out_for_delivery' })).body.stage, 'out_for_delivery');
  assert.equal((await call(admin, 'POST', `/api/tracking/nothing/1/stage`, { stage: 'x' })).status, 404);
});

test('forgot / reset password: single-use link, no account leak, sessions revoked', async () => {
  const who = await signup('resetme');
  const before = sentMail.length;
  const unknown = await call(null, 'POST', '/api/auth/forgot', { email: 'nobody@t.com' });
  assert.equal(unknown.status, 200); assert.equal(sentMail.length, before); // same answer, no mail
  const known = await call(null, 'POST', '/api/auth/forgot', { email: 'RESETME@t.com' });
  assert.deepEqual(known.body, unknown.body);
  assert.equal(sentMail.length, before + 1);
  const token = sentMail.at(-1).link.split('#reset=')[1];
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await call(null, 'POST', '/api/auth/reset', { token, password: '123' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/reset', { token: 'f'.repeat(64), password: 'newsecret1' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/auth/reset', { token, password: 'newsecret1' })).status, 200);
  assert.equal((await call(who, 'GET', '/api/me')).status, 401); // old session ended
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'resetme@t.com', password: 'secret1' })).status, 401);
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'resetme@t.com', password: 'newsecret1' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/auth/reset', { token, password: 'another1' })).status, 400); // used once
  // expired link
  await call(null, 'POST', '/api/auth/forgot', { email: 'resetme@t.com' });
  const t2 = sentMail.at(-1).link.split('#reset=')[1];
  db.prepare("UPDATE password_resets SET expires_at = datetime('now','-1 minute')").run();
  assert.equal((await call(null, 'POST', '/api/auth/reset', { token: t2, password: 'another1' })).status, 400);
  // the database never stores the raw token
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE token_hash = ?').get(t2).n, 0);
  // rate limit: 5 requests per 15 minutes per IP + email
  for (let i = 0; i < 5; i++) assert.equal((await call(null, 'POST', '/api/auth/forgot', { email: 'spam@t.com' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/auth/forgot', { email: 'spam@t.com' })).status, 429);
});

let failed = 0;
for (const [name, fn] of run) {
  try { await fn(); console.log('ok   -', name); }
  catch (e) { failed++; console.log('FAIL -', name, '\n', e.message); }
}
server.close();
if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
console.log('All tests passed');
