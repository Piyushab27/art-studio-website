# Art Studio

Buy one-of-a-kind paintings, book a wall-painting date, and request custom pottery. Two roles: customer and studio (admin).

**Stack:** Node.js 22.5+ (tested on 24), Express, SQLite via Node's built-in `node:sqlite`, vanilla JS frontend. No build step, no database server to install.

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
- `app.js`: API routes, auth and role checks, business rules
- `public/index.html`: the whole UI
- `test/smoke.js`: end-to-end checks

## Extras beyond the brief

- Status history for orders, bookings and pottery requests, plus an optional studio note when confirming, accepting or declining
- Delete a painting (only while available and with no order history)
- Painting search and filters; paging on every list
- Sessions expire after 7 days on the server; login is rate limited; cross-site writes are refused
- Dates use the studio time zone (`APP_TIMEZONE`, default `Asia/Kolkata`)
