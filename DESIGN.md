# Design notes

## 1. How do login and the two roles work?
Customers sign up with name, email and password. Passwords are hashed with scrypt and a per-user salt. Login creates a random session token stored in a `sessions` table and sent as an HttpOnly cookie. Sessions expire after 7 days on the server, not just in the cookie. Login is rate limited (10 failures per 15 minutes per IP and email). Writes with a foreign `Origin` header are refused. The studio (admin) account is seeded at startup with a password from `ADMIN_PASSWORD` or a random one printed once, and sign-up can only ever create customers. Every `/api` route runs through middleware that loads the user from the cookie, then a role check. No session gives 401, the wrong role gives 403, and a customer asking for another customer's order, booking or request gets 404 because lookups are always scoped to the owner. The UI hides buttons by role, but the server is what enforces it.

## 2. Which database did you choose, and why?
SQLite through Node's built-in `node:sqlite`. It needs no account, server or native build, so a reviewer can run the app with `npm install && npm start`. It also supports partial unique indexes and transactions, which the "only once" rules need. The trade-off is that it is a single-file database, not cloud-hosted; moving to Postgres would mostly mean changing `db.js` and the SQL placeholders.

## 3. How do you stop two people from taking the same painting or date?
Two layers, both in the database. Buying runs in a transaction that does `UPDATE paintings SET status='sold' WHERE id=? AND status='available'`. Only one caller can change a row from available to sold, and the other sees zero rows changed and gets a 409 "just sold". As a backstop, a partial unique index allows only one `placed` order per painting. Bookings use a partial unique index on `booking_date` for statuses `requested` and `confirmed`. A second insert for the same date fails and returns 409. Cancelled and declined bookings drop out of the index, so those dates open up again. `test/smoke.js` fires concurrent requests at both cases.

## 4. What did you finish, what did you leave out, and what would you do next?
**Finished:** sign-up, login and logout; both roles with server-side checks; browsing, adding and editing paintings (only while available), buying and cancelling orders; wall bookings with the 7-90 day window, 10-500 sq ft, one booking per date, price from the rate, admin confirm or decline, and customer cancel until 3 days before; pottery requests with item and glaze validation, quantity 1-12, needed-by at least 14 days away, admin accept or decline, and customer edit or cancel only while requested; loading, empty and error states on every data screen, with clear refusal messages.

**Extras:** Razorpay payments with signature verification and refunds, a live map with delivery and job tracking, painting image uploads, generated artwork for everything else, a gallery-style interface,  status history with studio notes, painting delete (only when it has no orders), search and filters, paging, and a frozen-clock test suite.

**Left out:** password reset, email verification, social login, studio sign-up, email or SMS notifications, Razorpay webhooks (the browser reports the result and the server verifies the signature), deployment and Docker.

**Caveats:** the official `seedData.zip` was not available when I built this, so `data/seed.json` holds placeholder values (wall rate ₹45/sq ft, five pottery items, five glazes, four paintings). Swapping in the real file should only need the same field names. Day counts use the studio time zone (`APP_TIMEZONE`, default IST), so they do not depend on the server's clock settings.

**Next:** use the real seed data, add a full CSRF token (the Origin check covers modern browsers), move to a hosted database, and add browser-level tests for the UI.

## Extras: payments, maps and images

**Payments.** A `payments` table records each Razorpay order. `POST /api/payments/create` makes the order for something the customer owns and that is ready to pay for (an order that is placed, a booking that is confirmed, a pottery request that is accepted). `POST /api/payments/verify` recomputes the HMAC signature on the server and only then marks the record paid. If the item was cancelled while the customer was paying, the money is refunded straight away. Cancelling a paid order or booking sets it to `refund_pending`, calls the refund API, then sets it to `refunded`, and the studio can retry a failed refund. With no keys the same flow runs on a demo provider behind the same interface.

**Live tracking.** The `tracking` table holds each delivery's or job's current stage and last position. The studio updates it by changing stage, posting real GPS coordinates, or starting a server-side simulation that walks a marker from the studio to the customer's pin. Customers poll every 3 seconds and only see their own records (404 otherwise).

**Images.** Uploads are read as raw bytes, limited to 5 MB, identified by magic bytes, stored under a random name, and served with `nosniff`. The old file is deleted when it is replaced or the painting is deleted.
