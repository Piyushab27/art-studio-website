import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword, seed, SESSION_DAYS } from './db.js';
import { HttpError, bad, conflict, notFound, intIn, text, coords, daysBetween, realToday } from './lib.js';
import { createPayments, adapterFromEnv } from './payments.js';
import { createTracking } from './tracking.js';

const PAGE_SIZE = 50;

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

// Identify an uploaded image by its first bytes, never by what the client claims.
function sniffImage(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())) return 'gif';
  return null;
}

// options.today: () => 'YYYY-MM-DD' lets tests freeze the clock.
// options.adapter: payment provider (defaults to Razorpay when keys are set, else the demo provider).
export function createApp(db, options = {}) {
  const today = options.today || realToday;
  const adapter = options.adapter || adapterFromEnv();
  // No email service is connected, so reset links go to the server console. Swap `send` for SMTP to email them.
  const mailer = options.mailer || {
    mode: 'console',
    send: async ({ to, link }) => console.log(`\nPassword reset requested for ${to}\nOpen this link within 30 minutes: ${link}\n`),
  };
  const uploadDir = options.uploadDir || process.env.UPLOAD_DIR || fileURLToPath(new URL('./uploads', import.meta.url));
  mkdirSync(uploadDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.json({ limit: '20kb' }));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', immutable: true }));
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

  // Run fn inside a write transaction so multi-statement changes are all-or-nothing.
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const isUnique = (e) => /UNIQUE constraint failed/.test(e.message || '');
  const daysAway = (s) => daysBetween(today(), s);
  const logEvent = (kind, id, status, actorId, note = '') =>
    db.prepare('INSERT INTO status_events (kind, record_id, status, actor_id, note) VALUES (?,?,?,?,?)').run(kind, id, status, actorId, note);
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async handlers -> error middleware

  // ---------- CSRF: refuse state-changing requests that come from another site ----------
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* malformed origin is refused below */ }
      if (host !== req.headers.host) return next(new HttpError(403, 'Cross-site request refused'));
    }
    next();
  });

  // ---------- auth middleware ----------
  app.use('/api', (req, _res, next) => {
    const token = cookieToken(req);
    req.user = token
      ? db.prepare(`SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.created_at > datetime('now', '-${SESSION_DAYS} days')`).get(token) || null
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
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  };

  // ---------- login rate limit: 10 failures per 15 minutes per IP + email ----------
  const failures = new Map();
  const WINDOW = 15 * 60 * 1000, MAX_FAILS = 10;
  const failKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;
  const tooMany = (key, max = MAX_FAILS) => {
    const f = failures.get(key);
    if (f && Date.now() - f.first > WINDOW) failures.delete(key);
    return (failures.get(key)?.count || 0) >= max;
  };
  const recordFail = (key) => {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
    else f.count++;
  };

  // ---------- paging: ?limit=&offset= (default 50, max 200) ----------
  const paging = (req) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_SIZE, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    return [limit, offset];
  };

  const payments = createPayments({ db, tx, adapter, logEvent });
  const tracking = createTracking({ db, logEvent, options });

  // ---------- auth routes ----------
  app.post('/api/auth/signup', (req, res) => {
    const b = req.body || {};
    const name = text(b.name, 'Name', { min: 1, max: 80 });
    const email = text(b.email, 'Email', { min: 1, max: 120 }).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('A valid email is required');
    if (typeof b.password !== 'string' || b.password.length < 6) throw bad('Password must be at least 6 characters');
    if (b.password.length > 200) throw bad('Password is too long');
    try {
      const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
        .run(name, email, hashPassword(b.password), 'customer'); // sign-up always makes a customer
      startSession(res, Number(r.lastInsertRowid));
      res.status(201).json({ id: Number(r.lastInsertRowid), name, email, role: 'customer' });
    } catch (e) {
      if (isUnique(e)) throw conflict('That email is already registered');
      throw e;
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 200) throw new HttpError(401, 'Wrong email or password');
    const key = failKey(req, email);
    if (tooMany(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!u || !verifyPassword(password, u.password_hash)) { recordFail(key); throw new HttpError(401, 'Wrong email or password'); }
    failures.delete(key);
    db.exec(`DELETE FROM sessions WHERE created_at <= datetime('now', '-${SESSION_DAYS} days')`);
    startSession(res, u.id);
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  });

  app.post('/api/auth/logout', (req, res) => {
    const t = cookieToken(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });


  // ---------- password reset: emailed single-use link, valid 30 minutes ----------
  const RESET_MINUTES = 30;
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  app.post('/api/auth/forgot', ah(async (req, res) => {
    const email = text(req.body?.email, 'Email', { min: 1, max: 120 }).toLowerCase();
    const key = `forgot|${failKey(req, email)}`;
    if (tooMany(key, 5)) throw new HttpError(429, 'Too many requests. Try again in 15 minutes.');
    recordFail(key);
    const u = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    if (u) {
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at <= datetime(\'now\')').run(u.id);
      db.prepare(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,datetime('now','+${RESET_MINUTES} minutes'))`).run(sha256(token), u.id);
      const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
      await mailer.send({ to: u.email, link: `${base}/#reset=${token}` });
    }
    // Same answer whether or not the account exists, so this cannot be used to find registered emails.
    res.json({ ok: true, delivery: mailer.mode });
  }));
  app.post('/api/auth/reset', (req, res) => {
    const { token, password } = req.body || {};
    const key = `reset|${req.ip}`;
    if (tooMany(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    if (typeof password !== 'string' || password.length < 6) throw bad('Password must be at least 6 characters');
    if (password.length > 200) throw bad('Password is too long');
    tx(() => {
      const row = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
        ? db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > datetime('now')").get(sha256(token)) : null;
      if (!row) { recordFail(key); throw bad('This reset link is invalid or has expired. Please request a new one.'); }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id); // single use
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);        // sign out everywhere
    });
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
  app.get('/api/seed', requireAuth, (_req, res) =>
    res.json({
      wallRatePerSqFt: seed.wallRatePerSqFt, potteryItems: seed.potteryItems, glazes: seed.glazes, today: today(),
      studio: tracking.studio, paymentMode: adapter.mode,
    }));

  // ---------- paintings (search: ?q=&status=&min=&max=) ----------
  const shapePainting = (p) => p && { ...p, image_url: p.image ? `/uploads/${p.image}` : null };
  const getPainting = (id) => shapePainting(db.prepare('SELECT * FROM paintings WHERE id = ?').get(id));

  app.get('/api/paintings', requireAuth, (req, res) => {
    const where = [], args = [];
    const q = String(req.query.q || '').trim();
    if (q) { where.push('(title LIKE ? OR artist LIKE ? OR description LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (['available', 'sold'].includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.min !== undefined && req.query.min !== '' && Number.isFinite(Number(req.query.min))) { where.push('price >= ?'); args.push(Number(req.query.min)); }
    if (req.query.max !== undefined && req.query.max !== '' && Number.isFinite(Number(req.query.max))) { where.push('price <= ?'); args.push(Number(req.query.max)); }
    const [limit, offset] = paging(req);
    res.json(db.prepare(`SELECT * FROM paintings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset).map(shapePainting));
  });
  app.get('/api/paintings/:id', requireAuth, (req, res) => {
    const p = getPainting(req.params.id);
    if (!p) throw notFound();
    res.json(p);
  });

  function paintingBody(b) {
    b = b || {};
    return [text(b.title, 'Title', { min: 1, max: 120 }), text(b.artist, 'Artist', { max: 80 }),
      text(b.description, 'Description', { max: 500 }), intIn(b.price, 1, 10_000_000, 'Price')];
  }
  const removeFile = (name) => { if (name) try { unlinkSync(join(uploadDir, name)); } catch { /* already gone */ } };

  app.post('/api/paintings', admin, (req, res) => {
    const r = db.prepare('INSERT INTO paintings (title, artist, description, price) VALUES (?,?,?,?)').run(...paintingBody(req.body));
    res.status(201).json(getPainting(r.lastInsertRowid));
  });
  app.put('/api/paintings/:id', admin, (req, res) => {
    const vals = paintingBody(req.body);
    tx(() => {
      const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(req.params.id);
      if (!p) throw notFound();
      if (p.status !== 'available') throw conflict('A sold painting cannot be edited');
      db.prepare('UPDATE paintings SET title=?, artist=?, description=?, price=? WHERE id=?').run(...vals, p.id);
    });
    res.json(getPainting(req.params.id));
  });
  // Image upload: raw bytes in the body (PNG, JPEG, WebP or GIF, up to 5 MB). Only while the painting is still available.
  app.post('/api/paintings/:id/image',
    admin, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], limit: '5mb' }),
    (req, res) => {
      const buf = req.body;
      const ext = Buffer.isBuffer(buf) && buf.length ? sniffImage(buf) : null;
      if (!ext) throw new HttpError(415, 'Please upload a PNG, JPEG, WebP or GIF image (max 5 MB)');
      let old = null, name = null;
      tx(() => {
        const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(req.params.id);
        if (!p) throw notFound();
        if (p.status !== 'available') throw conflict('A sold painting cannot be edited');
        name = `${randomBytes(12).toString('hex')}.${ext}`;
        writeFileSync(join(uploadDir, name), buf);
        old = p.image;
        db.prepare('UPDATE paintings SET image=? WHERE id=?').run(name, p.id);
      });
      removeFile(old);
      res.json(getPainting(req.params.id));
    });
  // Delete is only for a painting that never had an order; anything with history stays for the record.
  app.delete('/api/paintings/:id', admin, (req, res) => {
    let image = null;
    tx(() => {
      const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(req.params.id);
      if (!p) throw notFound();
      if (p.status !== 'available') throw conflict('A sold painting cannot be deleted');
      if (db.prepare('SELECT 1 FROM orders WHERE painting_id = ?').get(p.id)) throw conflict('This painting has order history, so it cannot be deleted');
      image = p.image;
      db.prepare('DELETE FROM paintings WHERE id = ?').run(p.id);
    });
    removeFile(image);
    res.json({ ok: true });
  });

  // ---------- orders ----------
  const orderSelect = `SELECT o.*, p.title AS painting_title, p.image AS painting_image, u.name AS customer_name, u.email AS customer_email,
      COALESCE(t.stage, 'processing') AS stage
    FROM orders o JOIN paintings p ON p.id = o.painting_id JOIN users u ON u.id = o.user_id
    LEFT JOIN tracking t ON t.kind = 'orders' AND t.record_id = o.id`;
  const shapeOrder = (o) => o && { ...o, painting_image_url: o.painting_image ? `/uploads/${o.painting_image}` : null };
  const getOrder = (id) => shapeOrder(db.prepare(`${orderSelect} WHERE o.id = ?`).get(id));
  const ownerOrAdmin = (req, row) => { if (!row || (req.user.role !== 'admin' && row.user_id !== req.user.id)) throw notFound(); return row; };

  app.post('/api/orders', customer, (req, res) => {
    const pid = Number(req.body?.paintingId);
    if (!Number.isInteger(pid)) throw bad('paintingId is required');
    const address = text(req.body?.address, 'Delivery address', { max: 300 });
    const [lat, lng] = coords(req.body?.lat, req.body?.lng);
    const id = tx(() => {
      const p = db.prepare('SELECT * FROM paintings WHERE id = ?').get(pid);
      if (!p) throw notFound();
      // Atomic claim: only one caller can flip available -> sold.
      const claim = db.prepare("UPDATE paintings SET status='sold' WHERE id=? AND status='available'").run(pid);
      if (claim.changes === 0) throw conflict('Sorry, this painting was just sold');
      const oid = Number(db.prepare('INSERT INTO orders (user_id, painting_id, price, delivery_address, lat, lng) VALUES (?,?,?,?,?,?)')
        .run(req.user.id, pid, p.price, address, lat, lng).lastInsertRowid);
      logEvent('orders', oid, 'placed', req.user.id);
      return oid;
    });
    res.status(201).json(getOrder(id));
  });
  app.get('/api/orders', requireAuth, (req, res) => {
    const [limit, offset] = paging(req);
    const [w, a] = req.user.role === 'admin' ? ['', []] : ['WHERE o.user_id = ?', [req.user.id]];
    res.json(db.prepare(`${orderSelect} ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...a, limit, offset).map(shapeOrder));
  });
  app.get('/api/orders/:id', requireAuth, (req, res) => res.json(ownerOrAdmin(req, getOrder(req.params.id))));
  app.post('/api/orders/:id/cancel', customer, ah(async (req, res) => {
    const id = Number(req.params.id);
    tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!o) throw notFound();
      if (o.status !== 'placed') throw conflict('This order is already cancelled');
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
      db.prepare("UPDATE paintings SET status='available' WHERE id=?").run(o.painting_id);
      payments.markRefundPending('orders', o.id);
      logEvent('orders', o.id, 'cancelled', req.user.id);
    });
    await payments.processRefund('orders', id); // no-op unless the order had been paid
    res.json(getOrder(id));
  }));

  // ---------- wall bookings ----------
  const bookingSelect = `SELECT b.*, u.name AS customer_name, u.email AS customer_email, COALESCE(t.stage, 'scheduled') AS stage
    FROM bookings b JOIN users u ON u.id = b.user_id
    LEFT JOIN tracking t ON t.kind = 'bookings' AND t.record_id = b.id`;
  const withFlags = (b) => b && ({ ...b, can_cancel: ['requested', 'confirmed'].includes(b.status) && daysAway(b.booking_date) >= 3 });
  const getBooking = (id) => withFlags(db.prepare(`${bookingSelect} WHERE b.id = ?`).get(id));

  app.get('/api/bookings/taken-dates', requireAuth, (_req, res) =>
    res.json(db.prepare("SELECT booking_date FROM bookings WHERE status IN ('requested','confirmed') ORDER BY booking_date").all().map((r) => r.booking_date)));

  app.post('/api/bookings', customer, (req, res) => {
    const { date, wallSqFt, address } = req.body || {};
    const d = daysAway(date);
    if (d === null) throw bad('Date must be in YYYY-MM-DD format');
    if (d < 7 || d > 90) throw bad('Date must be between 7 and 90 days from today');
    const sqft = intIn(wallSqFt, 10, 500, 'Wall size (sq ft)');
    const addr = text(address, 'Address', { min: 5, max: 300 });
    const [lat, lng] = coords(req.body?.lat, req.body?.lng);
    const id = tx(() => {
      try {
        const bid = Number(db.prepare('INSERT INTO bookings (user_id, booking_date, wall_sqft, address, price, lat, lng) VALUES (?,?,?,?,?,?,?)')
          .run(req.user.id, date, sqft, addr, sqft * seed.wallRatePerSqFt, lat, lng).lastInsertRowid);
        logEvent('bookings', bid, 'requested', req.user.id);
        return bid;
      } catch (e) {
        if (isUnique(e)) throw conflict('Sorry, that date was just taken. Please pick another.');
        throw e;
      }
    });
    res.status(201).json(getBooking(id));
  });
  app.get('/api/bookings', requireAuth, (req, res) => {
    const [limit, offset] = paging(req);
    const [w, a] = req.user.role === 'admin' ? ['', []] : ['WHERE b.user_id = ?', [req.user.id]];
    res.json(db.prepare(`${bookingSelect} ${w} ORDER BY b.booking_date LIMIT ? OFFSET ?`).all(...a, limit, offset).map(withFlags));
  });
  app.get('/api/bookings/:id', requireAuth, (req, res) => res.json(ownerOrAdmin(req, getBooking(req.params.id))));
  app.post('/api/bookings/:id/cancel', customer, ah(async (req, res) => {
    const id = Number(req.params.id);
    tx(() => {
      const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!b) throw notFound();
      if (!['requested', 'confirmed'].includes(b.status)) throw conflict(`This booking is already ${b.status}`);
      if (daysAway(b.booking_date) < 3) throw conflict('Bookings can only be cancelled until 3 days before the date');
      db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
      payments.markRefundPending('bookings', b.id);
      logEvent('bookings', b.id, 'cancelled', req.user.id);
    });
    await payments.processRefund('bookings', id);
    res.json(getBooking(id));
  }));

  // Studio decision on a request: only from "requested", with an optional note for the customer.
  const decide = (table, kind, from, to, fetch) => (req, res) => {
    const note = text(req.body?.note, 'Note', { max: 300 });
    tx(() => {
      const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!r) throw notFound();
      if (r.status !== from) throw conflict(`Only ${from} items can be changed (this one is ${r.status})`);
      db.prepare(`UPDATE ${table} SET status=?, note=? WHERE id=?`).run(to, note, r.id);
      logEvent(kind, r.id, to, req.user.id, note);
    });
    res.json(fetch(req.params.id));
  };
  app.post('/api/bookings/:id/confirm', admin, decide('bookings', 'bookings', 'requested', 'confirmed', getBooking));
  app.post('/api/bookings/:id/decline', admin, decide('bookings', 'bookings', 'requested', 'declined', getBooking));

  // ---------- pottery ----------
  const potterySelect = `SELECT p.*, u.name AS customer_name, u.email AS customer_email
    FROM pottery_requests p JOIN users u ON u.id = p.user_id`;
  const getPottery = (id) => db.prepare(`${potterySelect} WHERE p.id = ?`).get(id);
  function potteryBody(b) {
    b = b || {};
    const item = seed.potteryItems.find((i) => i.name === b.item);
    if (!item) throw bad('Choose an item from the list');
    if (!seed.glazes.includes(b.glaze)) throw bad('Choose a glaze from the list');
    const qty = intIn(b.quantity, 1, 12, 'Quantity');
    const d = daysAway(b.neededBy);
    if (d === null) throw bad('Needed-by date must be in YYYY-MM-DD format');
    if (d < 14) throw bad('Needed-by date must be at least 14 days from today');
    return [item.name, b.glaze, qty, b.neededBy, item.price * qty];
  }
  app.post('/api/pottery', customer, (req, res) => {
    const vals = potteryBody(req.body);
    const id = tx(() => {
      const pid = Number(db.prepare('INSERT INTO pottery_requests (user_id, item, glaze, quantity, needed_by, price) VALUES (?,?,?,?,?,?)')
        .run(req.user.id, ...vals).lastInsertRowid);
      logEvent('pottery', pid, 'requested', req.user.id);
      return pid;
    });
    res.status(201).json(getPottery(id));
  });
  app.get('/api/pottery', requireAuth, (req, res) => {
    const [limit, offset] = paging(req);
    const [w, a] = req.user.role === 'admin' ? ['', []] : ['WHERE p.user_id = ?', [req.user.id]];
    res.json(db.prepare(`${potterySelect} ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...a, limit, offset));
  });
  app.get('/api/pottery/:id', requireAuth, (req, res) => res.json(ownerOrAdmin(req, getPottery(req.params.id))));
  app.put('/api/pottery/:id', customer, (req, res) => {
    const vals = potteryBody(req.body);
    tx(() => {
      const r = db.prepare('SELECT * FROM pottery_requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!r) throw notFound();
      if (r.status !== 'requested') throw conflict('Only requests that are still "requested" can be edited');
      db.prepare('UPDATE pottery_requests SET item=?, glaze=?, quantity=?, needed_by=?, price=? WHERE id=?').run(...vals, r.id);
      logEvent('pottery', r.id, 'edited', req.user.id);
    });
    res.json(getPottery(req.params.id));
  });
  app.post('/api/pottery/:id/cancel', customer, (req, res) => {
    tx(() => {
      const r = db.prepare('SELECT * FROM pottery_requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!r) throw notFound();
      if (r.status !== 'requested') throw conflict('Only requests that are still "requested" can be cancelled');
      db.prepare("UPDATE pottery_requests SET status='cancelled' WHERE id=?").run(r.id);
      logEvent('pottery', r.id, 'cancelled', req.user.id);
    });
    res.json(getPottery(req.params.id));
  });
  app.post('/api/pottery/:id/accept', admin, decide('pottery_requests', 'pottery', 'requested', 'accepted', getPottery));
  app.post('/api/pottery/:id/decline', admin, decide('pottery_requests', 'pottery', 'requested', 'declined', getPottery));

  // ---------- payments and live tracking live in their own modules ----------
  payments.register(app, { customer, admin, ah });
  tracking.register(app, { requireAuth, admin });

  // ---------- studio dashboard numbers ----------
  app.get('/api/admin/summary', admin, (_req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    res.json({
      paintingsAvailable: n("SELECT COUNT(*) n FROM paintings WHERE status='available'"),
      paintingsSold: n("SELECT COUNT(*) n FROM paintings WHERE status='sold'"),
      ordersPlaced: n("SELECT COUNT(*) n FROM orders WHERE status='placed'"),
      bookingsPending: n("SELECT COUNT(*) n FROM bookings WHERE status='requested'"),
      bookingsConfirmed: n("SELECT COUNT(*) n FROM bookings WHERE status='confirmed'"),
      potteryPending: n("SELECT COUNT(*) n FROM pottery_requests WHERE status='requested'"),
      revenue: n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='paid'"),
    });
  });

  // ---------- history: customers see only their own records (404 otherwise) ----------
  const historyOwner = {
    orders: 'SELECT user_id FROM orders WHERE id = ?',
    bookings: 'SELECT user_id FROM bookings WHERE id = ?',
    pottery: 'SELECT user_id FROM pottery_requests WHERE id = ?',
  };
  app.get('/api/history/:kind/:id', requireAuth, (req, res) => {
    const sql = historyOwner[req.params.kind];
    if (!sql) throw notFound();
    ownerOrAdmin(req, db.prepare(sql).get(req.params.id));
    res.json(db.prepare(`SELECT e.status, e.note, e.created_at, u.name AS actor FROM status_events e
      LEFT JOIN users u ON u.id = e.actor_id WHERE e.kind = ? AND e.record_id = ? ORDER BY e.id`).all(req.params.kind, req.params.id));
  });

  // ---------- errors ----------
  app.use('/api', (_req, _res, next) => next(notFound()));
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  return app;
}
