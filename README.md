# Art Studio

Buy one-of-a-kind paintings, book a wall-painting date, and request custom pottery. Two roles: customer and studio (admin).

**Stack:** Node.js 22.5+ (tested on 24), Express, SQLite via Node's built-in `node:sqlite`, vanilla JS frontend, Leaflet + OpenStreetMap for maps, Razorpay for payments. No build step and no database server. The map, fonts and Razorpay load from the internet, so you need to be online.

## Run it on a clean machine

```bash
git clone <this repo> && cd art-studio
npm install
cp .env.example .env   # optional; defaults work without it
npm start              # http://localhost:3000
```

`npm start` does not read `.env` by itself. To use custom values, export them (for example `ADMIN_PASSWORD=secret npm start`) or run `node --env-file=.env server.js`.

The first start creates `studio.db`, a studio account and a few sample paintings.

| Role | Login |
|------|-------|
| Studio (admin) | `ADMIN_EMAIL` (default `studio@example.com`) with `ADMIN_PASSWORD`. If you do not set a password, a random one is printed in the console on first start, once. |
| Customer | Sign up on the home page |

The app checks the Node version on start and tells you if it is older than 22.5.

## Tests

```bash
npm test
```

Starts the app on a temporary database with a frozen clock and checks 401/403/404 rules, one-buyer-per-painting and one-booking-per-date (with concurrent requests), the exact date boundaries (7, 90, 14 and the 3-day cancel cutoff), session expiry, login rate limiting, cross-site refusal, input limits, history and paging.

## Seed data

`data/seed.json` holds the wall rate per sq ft, pottery items, glazes and sample paintings. The values in this repo are placeholders in the shape the brief describes. Replace the file with the official seed data to use the real numbers.

## Layout

- `db.js`: schema, seeded admin and paintings
- `app.js`: API routes, auth and role checks, business rules, image upload
- `payments.js`: Razorpay and demo providers, payment verification, refunds
- `tracking.js`: delivery and job stages, live position, route simulation
- `lib.js`: shared validation and date helpers
- `public/`: `index.html`, `styles.css` and `app.js` (the whole UI)
- `test/smoke.js`: end-to-end checks

## Payments (Razorpay)

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (test keys) and the real Razorpay checkout opens. The server creates the Razorpay order, and the payment counts only after it verifies Razorpay's signature (HMAC-SHA256 of `order_id|payment_id`) with the secret. The secret never reaches the browser. Cancelling a paid order or booking refunds it through the Razorpay API.

With no keys set, the app shows a clearly labelled **demo checkout** so the whole flow still works. Test card for Razorpay test mode: `4111 1111 1111 1111`, any future expiry, any CVV.

What can be paid for: a painting order (right after placing it), a wall booking (once the studio confirms) and a pottery request (once the studio accepts).

## Live map and tracking

- Delivery addresses and wall-job addresses are chosen with a pin on an OpenStreetMap map (search, click, drag or "use my location").
- The studio opens **Manage delivery / Manage job** to move an item through its stages, **share its live GPS** from a phone or browser, or press **Simulate route** to make the marker travel from the studio to the pin (about 60 seconds). Customers see the marker move, plus distance and ETA, updating every 3 seconds.
- The studio **Overview** page shows every active delivery and job on one live map.

## Images

Studio users can upload a photograph (PNG, JPEG, WebP or GIF, up to 5 MB) for each painting. Files are checked by their first bytes, not the filename, and saved to `uploads/`. Paintings without a photo, wall bookings and pottery get generated artwork, and each pottery form is drawn in the colour of the chosen glaze.

## Extras beyond the brief

- Status history for orders, bookings and pottery requests, plus an optional studio note when confirming, accepting or declining
- Delete a painting (only while available and with no order history)
- Painting search and filters; paging on every list
- Sessions expire after 7 days on the server; login is rate limited; cross-site writes are refused
- Dates use the studio time zone (`APP_TIMEZONE`, default `Asia/Kolkata`)
- Single-record routes (`GET /api/orders/:id` and so on) return 404 for anyone but the owner or the studio
