import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

export const SESSION_DAYS = 7;

export const seed = JSON.parse(readFileSync(new URL('./data/seed.json', import.meta.url), 'utf8'));

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function openDb(file = process.env.DB_FILE || 'studio.db') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('customer','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS paintings (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL CHECK (price > 0),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      painting_id INTEGER NOT NULL REFERENCES paintings(id), price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    -- Backstop: at most one live order per painting, enforced by the database itself.
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_order_per_painting
      ON orders(painting_id) WHERE status = 'placed';
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      booking_date TEXT NOT NULL, wall_sqft INTEGER NOT NULL, address TEXT NOT NULL,
      price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','declined','cancelled')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    -- Backstop: a date can be held by only one requested/confirmed booking.
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_booking_per_date
      ON bookings(booking_date) WHERE status IN ('requested','confirmed');
    CREATE TABLE IF NOT EXISTS pottery_requests (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      item TEXT NOT NULL, glaze TEXT NOT NULL, quantity INTEGER NOT NULL,
      needed_by TEXT NOT NULL, price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','declined','cancelled')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    -- Audit trail: every status change, who made it, and any note.
    CREATE TABLE IF NOT EXISTS status_events (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('orders','bookings','pottery')),
      record_id INTEGER NOT NULL, status TEXT NOT NULL, actor_id INTEGER REFERENCES users(id),
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS events_by_record ON status_events(kind, record_id);
  `);
  // Columns added after the first version. CREATE TABLE above already has the originals.
  const ensureColumn = (table, col, ddl) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  };
  ensureColumn('bookings', 'note', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('pottery_requests', 'note', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('paintings', 'image', 'TEXT');
  for (const t of ['orders', 'bookings', 'pottery_requests']) ensureColumn(t, 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'");
  ensureColumn('orders', 'delivery_address', "TEXT NOT NULL DEFAULT ''");
  for (const t of ['orders', 'bookings']) { ensureColumn(t, 'lat', 'REAL'); ensureColumn(t, 'lng', 'REAL'); }
  db.exec(`
    -- One row per payment attempt (Razorpay order). kind + record_id point at the thing being paid for.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('orders','bookings','pottery')),
      record_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL, provider_order_id TEXT NOT NULL UNIQUE, provider_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','refunded')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS payments_by_record ON payments(kind, record_id);
    -- Live tracking: current stage and last known position of a delivery or a wall job.
    CREATE TABLE IF NOT EXISTS tracking (
      kind TEXT NOT NULL CHECK (kind IN ('orders','bookings')), record_id INTEGER NOT NULL,
      stage TEXT NOT NULL, lat REAL, lng REAL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (kind, record_id));
  `);
  db.exec(`DELETE FROM sessions WHERE created_at <= datetime('now', '-${SESSION_DAYS} days')`);

  // Studio account is seeded (studio sign-up is out of scope).
  const adminEmail = (process.env.ADMIN_EMAIL || 'studio@example.com').toLowerCase();
  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(adminEmail)) {
    // No default password: use ADMIN_PASSWORD, or generate one and show it once.
    let adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      adminPassword = randomBytes(6).toString('hex');
      console.log(`Studio account created. Log in with ${adminEmail} / ${adminPassword} (shown once; set ADMIN_PASSWORD to choose your own).`);
    }
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run('Studio', adminEmail, hashPassword(adminPassword), 'admin');
  }
  if (!db.prepare('SELECT 1 FROM paintings LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO paintings (title, artist, description, price) VALUES (?,?,?,?)');
    for (const p of seed.paintings) ins.run(p.title, p.artist || '', p.description || '', p.price);
  }
  return db;
}
