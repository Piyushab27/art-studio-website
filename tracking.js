import { bad, conflict, notFound, coords } from './lib.js';

// Stages are stored as plain text; the order here is the order the customer sees.
const FLOWS = {
  orders: { table: 'orders', activeStatus: 'placed', stages: ['processing', 'out_for_delivery', 'delivered'], moving: 'out_for_delivery', done: 'delivered' },
  bookings: { table: 'bookings', activeStatus: 'confirmed', stages: ['scheduled', 'on_the_way', 'arrived', 'completed'], moving: 'on_the_way', done: 'arrived' },
};

export function createTracking({ db, logEvent, options }) {
  const studio = {
    lat: Number(process.env.STUDIO_LAT) || 17.385,
    lng: Number(process.env.STUDIO_LNG) || 78.4867,
  };
  const stepMs = options.simulationStepMs ?? 2000;
  const steps = options.simulationSteps ?? 30;
  const sims = new Map(); // "kind:id" -> interval handle

  const flowOf = (kind) => FLOWS[kind] || (() => { throw notFound(); })();
  const record = (kind, id, user) => {
    const f = flowOf(kind);
    const row = db.prepare(`SELECT * FROM ${f.table} WHERE id = ?`).get(id);
    // A customer asking for someone else's record gets the same 404 as a missing one.
    if (!row || (user.role !== 'admin' && row.user_id !== user.id)) throw notFound();
    return row;
  };
  const destinationOf = (kind, row) => (row.lat == null ? null : { lat: row.lat, lng: row.lng, address: kind === 'orders' ? row.delivery_address : row.address });
  const savePosition = (kind, id, stage, lat, lng) =>
    db.prepare(`INSERT INTO tracking (kind, record_id, stage, lat, lng, updated_at) VALUES (?,?,?,?,?,datetime('now'))
      ON CONFLICT(kind, record_id) DO UPDATE SET stage=excluded.stage, lat=excluded.lat, lng=excluded.lng, updated_at=excluded.updated_at`)
      .run(kind, id, stage, lat, lng);
  const current = (kind, id) => db.prepare('SELECT * FROM tracking WHERE kind=? AND record_id=?').get(kind, id);
  const stopSim = (key) => { clearInterval(sims.get(key)); sims.delete(key); };

  function view(kind, row) {
    const f = FLOWS[kind], t = current(kind, row.id);
    return {
      kind, id: row.id, active: row.status === f.activeStatus, stages: f.stages,
      stage: t?.stage || f.stages[0],
      studio, destination: destinationOf(kind, row),
      position: t && t.lat != null ? { lat: t.lat, lng: t.lng, updated_at: t.updated_at } : null,
      simulating: sims.has(`${kind}:${row.id}`),
    };
  }
  const requireActive = (kind, row) => {
    if (row.status !== FLOWS[kind].activeStatus) throw conflict(`Tracking is only available for ${FLOWS[kind].activeStatus} ${kind}`);
  };

  function register(app, { requireAuth, admin }) {
    // Admin overview: everything currently on its way or scheduled, with pins.
    app.get('/api/tracking', admin, (_req, res) => {
      const items = [];
      const orders = db.prepare(`SELECT o.*, p.title, u.name AS customer_name FROM orders o JOIN paintings p ON p.id=o.painting_id JOIN users u ON u.id=o.user_id
        WHERE o.status='placed' AND o.lat IS NOT NULL`).all();
      const bookings = db.prepare(`SELECT b.*, u.name AS customer_name FROM bookings b JOIN users u ON u.id=b.user_id
        WHERE b.status='confirmed' AND b.lat IS NOT NULL`).all();
      for (const o of orders) items.push({ ...view('orders', o), title: o.title, customer_name: o.customer_name });
      for (const b of bookings) items.push({ ...view('bookings', b), title: `Wall job ${b.booking_date}`, customer_name: b.customer_name });
      res.json({ studio, items });
    });

    app.get('/api/tracking/:kind/:id', requireAuth, (req, res) => {
      res.json(view(req.params.kind, record(req.params.kind, req.params.id, req.user)));
    });

    app.post('/api/tracking/:kind/:id/stage', admin, (req, res) => {
      const { kind, id } = req.params, f = flowOf(kind);
      const row = record(kind, id, req.user);
      requireActive(kind, row);
      const stage = req.body?.stage;
      if (!f.stages.includes(stage)) throw bad(`Stage must be one of: ${f.stages.join(', ')}`);
      stopSim(`${kind}:${row.id}`);
      const t = current(kind, row.id);
      let lat = t?.lat ?? null, lng = t?.lng ?? null;
      if (stage === f.stages[0]) { lat = null; lng = null; }
      else if (lat == null) { lat = studio.lat; lng = studio.lng; } // leaves from the studio
      if (stage === f.stages[f.stages.length - 1] && row.lat != null) { lat = row.lat; lng = row.lng; } // finished: at the destination
      savePosition(kind, row.id, stage, lat, lng);
      logEvent(kind, row.id, stage, req.user.id);
      res.json(view(kind, row));
    });

    // The studio phone (or a browser tab) reports its real GPS position.
    app.post('/api/tracking/:kind/:id/location', admin, (req, res) => {
      const { kind, id } = req.params;
      const row = record(kind, id, req.user);
      requireActive(kind, row);
      const [lat, lng] = coords(req.body?.lat, req.body?.lng);
      if (lat === null) throw bad('lat and lng are required');
      const t = current(kind, row.id);
      savePosition(kind, row.id, t?.stage || FLOWS[kind].stages[0], lat, lng);
      res.json(view(kind, row));
    });

    // Demo helper: the server walks the marker from the studio to the pin, so it works without a real vehicle.
    app.post('/api/tracking/:kind/:id/simulate', admin, (req, res) => {
      const { kind, id } = req.params, f = flowOf(kind);
      const row = record(kind, id, req.user);
      requireActive(kind, row);
      if (row.lat == null) throw conflict('This record has no map pin to travel to');
      const key = `${kind}:${row.id}`;
      stopSim(key);
      const dLat = row.lat - studio.lat, dLng = row.lng - studio.lng;
      let i = 0;
      savePosition(kind, row.id, f.moving, studio.lat, studio.lng);
      logEvent(kind, row.id, f.moving, req.user.id);
      const timer = setInterval(() => {
        i++;
        const live = db.prepare(`SELECT status FROM ${f.table} WHERE id=?`).get(row.id);
        if (!live || live.status !== f.activeStatus) return stopSim(key);
        const s = i / steps, wobble = Math.sin(Math.PI * s) * 0.06; // gentle curve so it looks like a road, not a ruler
        if (i >= steps) {
          savePosition(kind, row.id, f.done, row.lat, row.lng);
          logEvent(kind, row.id, f.done, null);
          return stopSim(key);
        }
        savePosition(kind, row.id, f.moving, studio.lat + dLat * s - dLng * wobble, studio.lng + dLng * s + dLat * wobble);
      }, stepMs);
      timer.unref();
      sims.set(key, timer);
      res.status(202).json(view(kind, row));
    });
  }

  return { register, studio, stopAll: () => [...sims.keys()].forEach(stopSim) };
}
