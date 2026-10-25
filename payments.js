import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, bad, conflict, notFound } from './lib.js';

// ---------- provider adapters ----------
// Both expose: mode, keyId, createOrder(), verify(), refund(). The app only talks to this interface.

export function razorpayAdapter({ keyId, keySecret }) {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const post = async (path, body) => {
    const r = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.description || `Razorpay error ${r.status}`);
    return data;
  };
  return {
    mode: 'razorpay', keyId,
    createOrder: ({ amountPaise, receipt, notes }) => post('/orders', { amount: amountPaise, currency: 'INR', receipt, notes }),
    // Razorpay signs "order_id|payment_id" with the key secret; the secret never reaches the browser.
    verify({ orderId, paymentId, signature }) {
      const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest();
      const given = Buffer.from(String(signature || ''), 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
    refund: (paymentId, amountPaise) => post(`/payments/${paymentId}/refund`, { amount: amountPaise }),
  };
}

// Used when no Razorpay keys are configured, so the whole flow can still be demoed.
export function mockAdapter() {
  return {
    mode: 'mock', keyId: null,
    createOrder: async () => ({ id: 'order_mock_' + randomBytes(8).toString('hex') }),
    verify: ({ paymentId }) => typeof paymentId === 'string' && paymentId.startsWith('pay_mock_'),
    refund: async () => ({ id: 'rfnd_mock_' + randomBytes(6).toString('hex') }),
  };
}

export function adapterFromEnv(env = process.env) {
  return env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
    ? razorpayAdapter({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET })
    : mockAdapter();
}

// What each kind of record needs to be in before it can be paid for.
const KINDS = {
  orders: { table: 'orders', payableStatus: 'placed', label: 'Painting order' },
  bookings: { table: 'bookings', payableStatus: 'confirmed', label: 'Wall painting booking' },
  pottery: { table: 'pottery_requests', payableStatus: 'accepted', label: 'Pottery request' },
};

export function createPayments({ db, tx, adapter, logEvent }) {
  // Money has been captured; send it back and mark the record refunded. Returns true on success.
  async function refundPayment(pay) {
    try {
      await adapter.refund(pay.provider_payment_id, pay.amount * 100);
    } catch (e) {
      console.error('Refund failed:', e.message);
      return false;
    }
    tx(() => {
      db.prepare("UPDATE payments SET status='refunded' WHERE id=?").run(pay.id);
      db.prepare(`UPDATE ${KINDS[pay.kind].table} SET payment_status='refunded' WHERE id=? AND payment_status IN ('paid','refund_pending')`).run(pay.record_id);
      logEvent(pay.kind, pay.record_id, 'refunded', null);
    });
    return true;
  }

  // Call inside the cancel transaction: a paid record becomes refund_pending.
  const markRefundPending = (kind, id) =>
    db.prepare(`UPDATE ${KINDS[kind].table} SET payment_status='refund_pending' WHERE id=? AND payment_status='paid'`).run(id);

  // Call after the cancel transaction commits.
  async function processRefund(kind, id) {
    const rec = db.prepare(`SELECT payment_status FROM ${KINDS[kind].table} WHERE id=?`).get(id);
    if (!rec || rec.payment_status !== 'refund_pending') return null;
    const pay = db.prepare("SELECT * FROM payments WHERE kind=? AND record_id=? AND status='paid' ORDER BY id DESC").get(kind, id);
    return pay ? refundPayment(pay) : false;
  }

  function register(app, { customer, admin, ah }) {
    // Step 1: create a payment for something the signed-in customer owns.
    app.post('/api/payments/create', customer, ah(async (req, res) => {
      const { kind, id } = req.body || {};
      const k = KINDS[kind];
      if (!k) throw bad('Unknown kind of payment');
      const rec = db.prepare(`SELECT * FROM ${k.table} WHERE id = ? AND user_id = ?`).get(Number(id), req.user.id);
      if (!rec) throw notFound();
      if (rec.status !== k.payableStatus) throw conflict(`This ${k.label.toLowerCase()} is not ready for payment`);
      if (rec.payment_status !== 'unpaid') throw conflict('This has already been paid for');
      let order;
      try {
        order = await adapter.createOrder({ amountPaise: rec.price * 100, receipt: `${kind}-${rec.id}-${Date.now()}`.slice(0, 40), notes: { kind, id: String(rec.id) } });
      } catch (e) {
        console.error('Could not create payment order:', e.message);
        throw new HttpError(502, 'The payment provider is unavailable. Please try again.');
      }
      db.prepare('INSERT INTO payments (kind, record_id, user_id, amount, provider_order_id) VALUES (?,?,?,?,?)')
        .run(kind, rec.id, req.user.id, rec.price, order.id);
      res.status(201).json({
        mode: adapter.mode, keyId: adapter.keyId, razorpayOrderId: order.id, amount: rec.price * 100, amountRupees: rec.price,
        description: `${k.label} #${rec.id}`, prefill: { name: req.user.name, email: req.user.email },
      });
    }));

    // Step 2: the browser reports the result; we trust only the signature check, never the browser's say-so.
    app.post('/api/payments/verify', customer, ah(async (req, res) => {
      const { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature } = req.body || {};
      if (typeof orderId !== 'string' || typeof paymentId !== 'string') throw bad('Payment details are missing');
      const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id = ? AND user_id = ?').get(orderId, req.user.id);
      if (!pay) throw notFound();
      if (pay.status === 'paid' || pay.status === 'refunded') return res.json({ ok: true, alreadyPaid: true });
      if (!adapter.verify({ orderId, paymentId, signature })) {
        db.prepare("UPDATE payments SET status='failed' WHERE id=?").run(pay.id);
        throw bad('Payment could not be verified');
      }
      const k = KINDS[pay.kind];
      let payable = false;
      tx(() => {
        const rec = db.prepare(`SELECT status, payment_status FROM ${k.table} WHERE id=?`).get(pay.record_id);
        db.prepare("UPDATE payments SET status='paid', provider_payment_id=? WHERE id=?").run(paymentId, pay.id);
        if (rec && rec.status === k.payableStatus && rec.payment_status === 'unpaid') {
          db.prepare(`UPDATE ${k.table} SET payment_status='paid' WHERE id=?`).run(pay.record_id);
          logEvent(pay.kind, pay.record_id, 'paid', req.user.id);
          payable = true;
        }
      });
      if (!payable) {
        // It was cancelled while the customer was paying: give the money straight back.
        await refundPayment({ ...pay, provider_payment_id: paymentId });
        throw conflict('This was cancelled while you were paying, so the payment was refunded');
      }
      res.json({ ok: true });
    }));

    // Studio can retry a refund that failed at the provider.
    app.post('/api/payments/:kind/:id/refund', admin, ah(async (req, res) => {
      if (!KINDS[req.params.kind]) throw notFound();
      const rec = db.prepare(`SELECT payment_status FROM ${KINDS[req.params.kind].table} WHERE id=?`).get(req.params.id);
      if (!rec) throw notFound();
      if (rec.payment_status !== 'refund_pending') throw conflict('There is no refund waiting for this record');
      const ok = await processRefund(req.params.kind, Number(req.params.id));
      if (!ok) throw new HttpError(502, 'The refund could not be completed. Try again shortly.');
      res.json({ ok: true });
    }));
  }

  return { register, markRefundPending, processRefund };
}
