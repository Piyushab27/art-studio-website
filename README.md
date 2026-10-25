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
| Studio (admin) | `studio@example.com` / `studio123` (override with `ADMIN_EMAIL` / `ADMIN_PASSWORD`) |
| Customer | Sign up on the home page |

## Tests

```bash
npm test
```

Starts the app on a temporary database and checks 401/403/404 rules, one-buyer-per-painting and one-booking-per-date (with concurrent requests), the date and quantity limits, and the cancel and edit rules.

## Seed data

`data/seed.json` holds the wall rate per sq ft, pottery items, glazes and sample paintings. The values in this repo are placeholders in the shape the brief describes. Replace the file with the official seed data to use the real numbers.

## Layout

- `db.js`: schema, seeded admin and paintings
- `app.js`: API routes, auth and role checks, business rules
- `public/index.html`: the whole UI
- `test/smoke.js`: end-to-end checks
