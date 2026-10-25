import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { hashPassword, seed } from './db.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const conflict = (m) => new HttpError(409, m);
const notFound = () => new HttpError(404, 'Not found');

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Whole days from today (server local date) to a YYYY-MM-DD string; null if not a real date.
function daysFromToday(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const now = new Date();
  return Math.round((t - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
}

function intIn(v, lo, hi, name) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${name} must be a whole number from ${lo} to ${hi}`);
  return n;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(req) {
  const m = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

export function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(new URL('./public', import.meta.url).pathname));

  // Run fn inside a write transaction so multi-statement changes are all-or-nothing.
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const isUnique = (e) => /UNIQUE constraint failed/.test(e.message || '');

  // ---------- auth middleware ----------
  app.use('/api', (req, _res, next) => {
    const token = cookieToken(req);
    req.user = token
      ? db.prepare(`SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) || null
      : null;
    next();
  });
  const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in')));
  const requireRole = (role) => (req, _res, next) =>
    !req.user ? next(new HttpError(401, 'Please log in'))
      : req.user.role !== role ? next(new HttpError(403, 'You do not have permission to do that'))
      : next();
  const customer = requireRole('customer');
  const admin = requireRole('admin');

  const startSession = (res, userId) => {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
  };

  // ---------- auth routes ----------
  app.post('/api/auth/signup', (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) throw bad('Name is required');
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) throw bad('A valid email is required');
    if (typeof password !== 'string' || password.length < 6) throw bad('Password must be at least 6 characters');
    try {
      const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
        .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), 'customer'); // sign-up always makes a customer
      startSession(res, Number(r.lastInsertRowid));
      res.status(201).json({ id: Number(r.lastInsertRowid), name: name.trim(), email: email.trim().toLowerCase(), role: 'customer' });
    } catch (e) {
      if (isUnique(e)) throw conflict('That email is already registered');
      throw e;
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const u = typeof email === 'string' && typeof password === 'string'
      ? db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) : null;
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Wrong email or password');
    startSession(res, u.id);
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  });

  app.post('/api/auth/logout', (req, res) => {
    const t = cookieToken(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
  app.get('/api/seed', requireAuth, (_req, res) =>
    res.json({ wallRatePerSqFt: seed.wallRatePerSqFt, potteryItems: seed.potteryItems, glazes: seed.glazes }));

  // ---------- paintings ----------
  app.get('/api/paintings', requireAuth, (_req, res) =>
    res.json(db.prepare('SELECT * FROM paintings ORDER BY id DESC').all()));

  function paintingBody(b) {
    b = b || {};
    if (typeof b.title !== 'string' || !b.title.trim()) throw bad('Title is required');
    const price = intIn(b.price, 1, 10_000_000, 'Price');
    return [b.title.trim(), String(b.artist || '').trim(), String(b.description || '').trim(), price];
  }
  app.post('/api/paintings', admin, (req, res) => {
    const r = db.prepare('INSERT INTO paintings (title, artist, description, price) VALUES (?,?,?,?)').run(...paintingBody(req.body));
    res.status(201).json(db.prepare('SELECT * FROM paintings WHERE id = ?').get(r.lastInsertRowid));
  });
  app.put('/api/paintings/:id', admin, (req, res) => {
    const vals = paintingBody(req.body);
    const r = tx(() => {
      const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(req.params.id);
      if (!p) throw notFound();
      if (p.status !== 'available') throw conflict('A sold painting cannot be edited');
      db.prepare('UPDATE paintings SET title=?, artist=?, description=?, price=? WHERE id=?').run(...vals, p.id);
      return db.prepare('SELECT * FROM paintings WHERE id = ?').get(p.id);
    });
    res.json(r);
  });

  // ---------- orders ----------
  const orderSelect = `SELECT o.*, p.title AS painting_title, u.name AS customer_name, u.email AS customer_email
    FROM orders o JOIN paintings p ON p.id = o.painting_id JOIN users u ON u.id = o.user_id`;
  const own = (req) => (req.user.role === 'admin' ? ['', []] : ['WHERE o.user_id = ?', [req.user.id]]);

  app.post('/api/orders', customer, (req, res) => {
    const pid = Number(req.body?.paintingId);
    if (!Number.isInteger(pid)) throw bad('paintingId is required');
    const id = tx(() => {
      const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(pid);
      if (!p) throw notFound();
      // Atomic claim: only one caller can flip available -> sold.
      const claim = db.prepare("UPDATE paintings SET status='sold' WHERE id=? AND status='available'").run(pid);
      if (claim.changes === 0) throw conflict('Sorry, this painting was just sold');
      return Number(db.prepare('INSERT INTO orders (user_id, painting_id, price) VALUES (?,?,?)').run(req.user.id, pid, p.price).lastInsertRowid);
    });
    res.status(201).json(db.prepare(`${orderSelect} WHERE o.id = ?`).get(id));
  });
  app.get('/api/orders', requireAuth, (req, res) => {
    const [w, a] = own(req);
    res.json(db.prepare(`${orderSelect} ${w} ORDER BY o.id DESC`).all(...a));
  });
  app.post('/api/orders/:id/cancel', customer, (req, res) => {
    tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!o) throw notFound();
      if (o.status !== 'placed') throw conflict('This order is already cancelled');
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
      db.prepare("UPDATE paintings SET status='available' WHERE id=?").run(o.painting_id);
    });
    res.json(db.prepare(`${orderSelect} WHERE o.id = ?`).get(req.params.id));
  });

  // ---------- wall bookings ----------
  const bookingSelect = `SELECT b.*, u.name AS customer_name, u.email AS customer_email
    FROM bookings b JOIN users u ON u.id = b.user_id`;
  const ownB = (req) => (req.user.role === 'admin' ? ['', []] : ['WHERE b.user_id = ?', [req.user.id]]);

  app.get('/api/bookings/taken-dates', requireAuth, (_req, res) =>
    res.json(db.prepare("SELECT booking_date FROM bookings WHERE status IN ('requested','confirmed') ORDER BY booking_date").all().map((r) => r.booking_date)));

  app.post('/api/bookings', customer, (req, res) => {
    const { date, wallSqFt, address } = req.body || {};
    const d = daysFromToday(date);
    if (d === null) throw bad('Date must be in YYYY-MM-DD format');
    if (d < 7 || d > 90) throw bad('Date must be between 7 and 90 days from today');
    const sqft = intIn(wallSqFt, 10, 500, 'Wall size (sq ft)');
    if (typeof address !== 'string' || address.trim().length < 5) throw bad('Please enter the full address');
    let id;
    try {
      id = Number(db.prepare('INSERT INTO bookings (user_id, booking_date, wall_sqft, address, price) VALUES (?,?,?,?,?)')
        .run(req.user.id, date, sqft, address.trim(), sqft * seed.wallRatePerSqFt).lastInsertRowid);
    } catch (e) {
      if (isUnique(e)) throw conflict('Sorry, that date was just taken. Please pick another.');
      throw e;
    }
    res.status(201).json(db.prepare(`${bookingSelect} WHERE b.id = ?`).get(id));
  });
  app.get('/api/bookings', requireAuth, (req, res) => {
    const [w, a] = ownB(req);
    res.json(db.prepare(`${bookingSelect} ${w} ORDER BY b.booking_date`).all(...a));
  });
  app.post('/api/bookings/:id/cancel', customer, (req, res) => {
    tx(() => {
      const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!b) throw notFound();
      if (!['requested', 'confirmed'].includes(b.status)) throw conflict(`This booking is already ${b.status}`);
      if (daysFromToday(b.booking_date) < 3) throw conflict('Bookings can only be cancelled until 3 days before the date');
      db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
    });
    res.json(db.prepare(`${bookingSelect} WHERE b.id = ?`).get(req.params.id));
  });
  const decide = (table, select, from, to) => (req, res) => {
    tx(() => {
      const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!r) throw notFound();
      if (r.status !== from) throw conflict(`Only ${from} items can be changed (this one is ${r.status})`);
      db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(to, r.id);
    });
    res.json(db.prepare(`${select} WHERE ${table[0]}.id = ?`).get(req.params.id));
  };
  app.post('/api/bookings/:id/confirm', admin, decide('bookings', bookingSelect, 'requested', 'confirmed'));
  app.post('/api/bookings/:id/decline', admin, decide('bookings', bookingSelect, 'requested', 'declined'));

  // ---------- pottery ----------
  const potterySelect = `SELECT p.*, u.name AS customer_name, u.email AS customer_email
    FROM pottery_requests p JOIN users u ON u.id = p.user_id`;
  function potteryBody(b) {
    b = b || {};
    const item = seed.potteryItems.find((i) => i.name === b.item);
    if (!item) throw bad('Choose an item from the list');
    if (!seed.glazes.includes(b.glaze)) throw bad('Choose a glaze from the list');
    const qty = intIn(b.quantity, 1, 12, 'Quantity');
    const d = daysFromToday(b.neededBy);
    if (d === null) throw bad('Needed-by date must be in YYYY-MM-DD format');
    if (d < 14) throw bad('Needed-by date must be at least 14 days from today');
    return [item.name, b.glaze, qty, b.neededBy, item.price * qty];
  }
  app.post('/api/pottery', customer, (req, res) => {
    const id = Number(db.prepare('INSERT INTO pottery_requests (user_id, item, glaze, quantity, needed_by, price) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, ...potteryBody(req.body)).lastInsertRowid);
    res.status(201).json(db.prepare(`${potterySelect} WHERE p.id = ?`).get(id));
  });
  app.get('/api/pottery', requireAuth, (req, res) => {
    const [w, a] = req.user.role === 'admin' ? ['', []] : ['WHERE p.user_id = ?', [req.user.id]];
    res.json(db.prepare(`${potterySelect} ${w} ORDER BY p.id DESC`).all(...a));
  });
  app.put('/api/pottery/:id', customer, (req, res) => {
    const vals = potteryBody(req.body);
    tx(() => {
      const r = db.prepare('SELECT * FROM pottery_requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!r) throw notFound();
      if (r.status !== 'requested') throw conflict('Only requests that are still "requested" can be edited');
      db.prepare('UPDATE pottery_requests SET item=?, glaze=?, quantity=?, needed_by=?, price=? WHERE id=?').run(...vals, r.id);
    });
    res.json(db.prepare(`${potterySelect} WHERE p.id = ?`).get(req.params.id));
  });
  app.post('/api/pottery/:id/cancel', customer, (req, res) => {
    tx(() => {
      const r = db.prepare('SELECT * FROM pottery_requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!r) throw notFound();
      if (r.status !== 'requested') throw conflict('Only requests that are still "requested" can be cancelled');
      db.prepare("UPDATE pottery_requests SET status='cancelled' WHERE id=?").run(r.id);
    });
    res.json(db.prepare(`${potterySelect} WHERE p.id = ?`).get(req.params.id));
  });
  app.post('/api/pottery/:id/accept', admin, decide('pottery_requests', potterySelect, 'requested', 'accepted'));
  app.post('/api/pottery/:id/decline', admin, decide('pottery_requests', potterySelect, 'requested', 'declined'));

  // ---------- errors ----------
  app.use('/api', (_req, _res, next) => next(notFound()));
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  return app;
}
