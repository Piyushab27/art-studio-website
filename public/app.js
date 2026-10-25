'use strict';
/* Art Studio front end: plain JS, no build step. Sections: helpers, generated art, UI kit, maps, payments, views. */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
const PAGE = 50;
let me = null, config = null, tab = 'paintings', reload = () => {}, onRefusal = () => {}, cleanup = () => {};

const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const parseDbTime = (s) => new Date(String(s).replace(' ', 'T') + 'Z');

/* ============================ generated art ============================ */
// Every painting without a photo, every wall and every pottery piece gets artwork made from its name.
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PALETTES = [
  ['#efe3d0', '#c4552d', '#23364a', '#d7a24a', '#6b8f71'], ['#f2e8cf', '#bc4749', '#386641', '#6a994e', '#e9c46a'],
  ['#f4ede4', '#264653', '#2a9d8f', '#e9c46a', '#e76f51'], ['#efe6dd', '#7b4b94', '#2d3142', '#ef8354', '#9db4c0'],
  ['#f7ede2', '#e5707e', '#5f8f8b', '#f6bd60', '#2f3e46'], ['#ece4d6', '#1d3557', '#457b9d', '#e63946', '#f1c453'],
  ['#f3e9dc', '#5e3023', '#c08552', '#895737', '#dab49d'], ['#e9ecdf', '#344e41', '#588157', '#a3b18a', '#d4a373'],
];
const RATIOS = [[4, 5], [3, 4], [1, 1], [5, 4], [2, 3], [4, 5]];
const artRatio = (key) => RATIOS[hash('r' + key) % RATIOS.length];
function artSvg(key, { grain = false } = {}) {
  const hs = hash(key), r = rng(hs), pal = PALETTES[hs % PALETTES.length];
  const [rw, rh] = artRatio(key), W = rw * 100, H = rh * 100, id = 'a' + hs;
  const pick = () => pal[1 + Math.floor(r() * (pal.length - 1))];
  const style = (hs >>> 3) % 5;
  let body = '';
  if (style === 0) { // colour fields
    body += `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
    const a = H * (0.08 + r() * 0.1), b = H * (0.42 + r() * 0.1), c = H * (0.74 + r() * 0.08);
    body += `<rect x="${W * .1}" y="${a}" width="${W * .8}" height="${b - a - H * .04}" fill="${pal[1]}" filter="url(#${id}b)"/>`;
    body += `<rect x="${W * .1}" y="${b}" width="${W * .8}" height="${c - b - H * .04}" fill="${pal[2]}" filter="url(#${id}b)"/>`;
    body += `<rect x="${W * .1}" y="${c}" width="${W * .8}" height="${H * .12}" fill="${pal[3]}" filter="url(#${id}b)"/>`;
  } else if (style === 1) { // sun and horizon
    body += `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[3]}"/><stop offset="1" stop-color="${pal[0]}"/></linearGradient></defs>`;
    body += `<rect width="${W}" height="${H}" fill="url(#${id}g)"/>`;
    const cx = W * (0.35 + r() * 0.3), cy = H * (0.38 + r() * 0.12);
    for (let i = 4; i > 0; i--) body += `<circle cx="${cx}" cy="${cy}" r="${i * W * .09}" fill="${i % 2 ? pal[1] : pal[0]}" opacity="${.35 + i * .15}"/>`;
    body += `<rect y="${H * .68}" width="${W}" height="${H * .32}" fill="${pal[2]}"/><rect y="${H * .68}" width="${W}" height="${H * .02}" fill="${pal[4]}"/>`;
  } else if (style === 2) { // cut-out shapes
    body += `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
    for (let i = 0; i < 9; i++) {
      const x = r() * W, y = r() * H, s = W * (0.12 + r() * 0.2), col = pick();
      body += i % 3 === 0 ? `<ellipse cx="${x}" cy="${y}" rx="${s}" ry="${s * (.5 + r() * .6)}" fill="${col}" transform="rotate(${r() * 180} ${x} ${y})"/>`
        : i % 3 === 1 ? `<circle cx="${x}" cy="${y}" r="${s * .6}" fill="${col}"/>` : `<rect x="${x}" y="${y}" width="${s}" height="${s * .35}" rx="${s * .17}" fill="${col}" transform="rotate(${r() * 90} ${x} ${y})"/>`;
    }
  } else if (style === 3) { // arches and grid
    body += `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
    const cols = 3, rows = Math.round(H / (W / 3)), cw = W / cols;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = i * cw, y = j * cw, col = pick(), k = Math.floor(r() * 4);
      body += k === 0 ? `<path d="M${x} ${y + cw} A${cw / 2} ${cw / 2} 0 0 1 ${x + cw} ${y + cw}Z" fill="${col}"/>`
        : k === 1 ? `<circle cx="${x + cw / 2}" cy="${y + cw / 2}" r="${cw / 3}" fill="${col}"/>`
        : k === 2 ? `<path d="M${x} ${y} H${x + cw} V${y + cw} A${cw} ${cw} 0 0 1 ${x} ${y}Z" fill="${col}"/>` : `<rect x="${x + cw * .15}" y="${y + cw * .15}" width="${cw * .7}" height="${cw * .7}" fill="${col}"/>`;
    }
  } else { // waves
    body += `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const y = H * (0.12 + i * (0.8 / bands)), amp = 14 + r() * 26, f = 0.012 + r() * 0.014, ph = r() * 6;
      let d = `M0 ${H}`;
      for (let x = 0; x <= W; x += 10) d += ` L${x} ${y + Math.sin(x * f + ph) * amp}`;
      body += `<path d="${d} L${W} ${H}Z" fill="${pal[1 + (i % 4)]}" opacity="${.9 - i * .04}"/>`;
    }
  }
  const defs = `<defs><filter id="${id}b"><feGaussianBlur stdDeviation="${W * .008}"/></filter>${grain ? `<filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="${hs % 99}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .1 0"/></filter>` : ''}</defs>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Abstract artwork">${defs}${body}${grain ? `<rect width="${W}" height="${H}" filter="url(#${id}n)"/>` : ''}</svg>`;
}

// Glaze colour from its name (works for any glaze in the seed data); unknown names get a stable colour.
const GLAZE_COLORS = [[/celadon/, '#9cc5a1'], [/white|ivory|cream/, '#efe9dc'], [/ocean|blue|cobalt|sky|navy/, '#3f78a8'], [/terra|rust|clay/, '#c1633b'], [/ash|grey|gray|smoke/, '#8c9092'],
  [/green|moss|olive|jade/, '#5f8a6b'], [/red|crimson|ruby/, '#a8362f'], [/black|ebony|charcoal/, '#2d2926'], [/yellow|honey|gold|amber|mustard/, '#d9a441'], [/pink|rose|blush/, '#d98ca0'], [/brown|walnut|tenmoku|coffee/, '#7a4b2a'], [/purple|plum|lilac/, '#7b5a94'], [/teal|turquoise/, '#2f8f94']];
function hslHex(h, s, l) { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
const glazeColor = (name) => (GLAZE_COLORS.find(([re]) => re.test(String(name).toLowerCase())) || [0, hslHex(hash(name) % 360, 38, 55)])[1];
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join(''); }
function potSvg(name, color = '#c4552d') {
  const n = String(name).toLowerCase(), id = 'p' + hash(name + color), c1 = shade(color, .28), c2 = color, c3 = shade(color, -.3);
  const kind = /mug|cup/.test(n) ? 'mug' : /bowl/.test(n) ? 'bowl' : /vase|bottle|jug|pitcher/.test(n) ? 'vase' : /plate|dish|saucer|platter/.test(n) ? 'plate' : /plant|pot/.test(n) ? 'planter' : 'jar';
  const fill = `fill="url(#${id})"`;
  const shapes = {
    mug: `<path d="M86 50 Q112 50 112 70 Q112 90 86 88" fill="none" stroke="${c3}" stroke-width="8" stroke-linecap="round"/><path d="M32 36 H88 V88 Q88 102 74 102 H46 Q32 102 32 88Z" ${fill}/><ellipse cx="60" cy="36" rx="28" ry="7" fill="${c3}"/><ellipse cx="60" cy="36" rx="23" ry="5" fill="${shade(color, -.45)}"/>`,
    bowl: `<path d="M12 48 H108 Q104 98 60 102 Q16 98 12 48Z" ${fill}/><ellipse cx="60" cy="48" rx="48" ry="10" fill="${c3}"/><ellipse cx="60" cy="48" rx="42" ry="7.5" fill="${shade(color, -.45)}"/>`,
    vase: `<path d="M48 14 H72 L70 34 Q100 50 96 80 Q93 106 60 106 Q27 106 24 80 Q20 50 50 34Z" ${fill}/><ellipse cx="60" cy="14" rx="12" ry="3.5" fill="${c3}"/>`,
    plate: `<ellipse cx="60" cy="76" rx="54" ry="18" fill="${c3}"/><ellipse cx="60" cy="70" rx="54" ry="18" ${fill}/><ellipse cx="60" cy="70" rx="34" ry="9" fill="${shade(color, -.18)}"/>`,
    planter: `<path d="M44 40 Q40 18 56 22 Q50 34 56 40Z M76 40 Q80 16 64 22 Q70 34 64 40Z M60 40 Q54 12 66 8 Q72 24 60 40Z" fill="#5f8a6b"/><path d="M26 44 H94 L86 102 H34Z" ${fill}/><rect x="22" y="40" width="76" height="10" rx="3" fill="${c3}"/>`,
    jar: `<path d="M40 24 H80 V32 Q100 44 98 74 Q96 104 60 104 Q24 104 22 74 Q20 44 40 32Z" ${fill}/><rect x="38" y="18" width="44" height="9" rx="3" fill="${c3}"/>`,
  };
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(name)}"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".45" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient></defs><ellipse cx="60" cy="108" rx="40" ry="5" fill="#000" opacity=".12"/>${shapes[kind]}</svg>`;
}
const EMPTY_ART = `<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="22" y="18" width="76" height="84" fill="none" stroke="#151311" stroke-width="1.5"/><rect x="30" y="26" width="60" height="68" fill="#e8e2d6"/><circle cx="60" cy="54" r="12" fill="#b5391c" opacity=".85"/><path d="M30 94 L52 70 L68 84 L78 74 L90 94Z" fill="#5c7a66"/></svg>`;

/* ============================ UI kit ============================ */
function toast(text, type = '') {
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = text;
  $('#toasts').append(t); setTimeout(() => t.remove(), type === 'err' ? 6500 : 4200);
}
function modal({ title, html = '', wide = false, onClose = () => {} }) {
  const overlay = document.createElement('div'); overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></header><div class="content">${html}</div></div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener('keydown', onKey); overlay.remove(); document.body.style.overflow = ''; onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  $('.x', overlay).onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden'; document.body.append(overlay);
  return { el: overlay, body: $('.content', overlay), close };
}
// Small prompt/confirm dialogs in the site's own style. Resolves to the text (or true), or null if dismissed.
function ask({ title, text = '', input = null, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({ title, html: `${text ? `<p class="muted">${esc(text)}</p>` : ''}${input ? `<label>${esc(input)}<textarea maxlength="300" data-v></textarea></label>` : ''}
      <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
      onClose: () => { if (!answered) resolve(null); } });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { answered = true; resolve(input ? $('[data-v]', m.el).value.trim() : true); m.close(); };
    $('[data-v]', m.el)?.focus();
  });
}
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;

async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && me && !path.startsWith('/auth/')) { me = null; render(); toast('Your session ended. Please log in again.', 'err'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// Every data screen goes through here: skeleton while loading -> error | empty | content, plus "Load more" paging.
function loadInto(wrap, fetchPage, renderItem, { cls = 'list', emptyTitle = 'Nothing here yet', emptyText = '', after = () => {} } = {}) {
  wrap.innerHTML = `<div class="${cls}" data-items></div><div data-foot></div>`;
  const box = $('[data-items]', wrap), foot = $('[data-foot]', wrap);
  let items = [];
  const draw = (more) => {
    box.innerHTML = items.map(renderItem).join('');
    foot.innerHTML = items.length ? (more ? '<div class="state" style="padding:20px"><button class="btn" data-more>Load more</button></div>' : '')
      : `<div class="state">${EMPTY_ART}<h3>${esc(emptyTitle)}</h3><div>${esc(emptyText)}</div></div>`;
    $('[data-more]', foot)?.addEventListener('click', step);
    after(box, items);
  };
  const skeleton = () => { box.innerHTML = cls === 'masonry' ? [300, 380, 340, 420, 320, 360].map((h) => `<div class="skeleton card-sk" style="height:${h}px"></div>`).join('') : '<div class="skeleton row-sk"></div>'.repeat(3); foot.innerHTML = ''; };
  async function step() {
    try { const page = await fetchPage(items.length); items = items.concat(page); draw(page.length === PAGE); }
    catch (e) {
      if (!items.length) box.innerHTML = '';
      foot.innerHTML = `<div class="state error"><h3>Something went wrong</h3><div>${esc(e.message)}</div><p><button class="btn" data-retry>Try again</button></p></div>`;
      $('[data-retry]', foot).onclick = () => (items.length ? step() : start());
    }
  }
  const start = () => { items = []; skeleton(); return step(); };
  reload = start;
  return start();
}
// Run an action. Success: confirm and redraw. Refusal: say why and refresh the data only, so typed values survive.
async function act(fn, okText) {
  try { const r = await fn(); if (okText) toast(okText, 'ok'); show(); return r; }
  catch (e) { toast(e.message, 'err'); reload(); onRefusal(); return null; }
}
const on = (root, sel, fn) => root.querySelectorAll(sel).forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); fn(n, e); }));

/* ============================ maps ============================ */
const mapsOn = () => typeof L !== 'undefined';
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'; // free, no API key; fair-use policy applies
function newMap(el, center, zoom = 13) {
  if (!mapsOn()) { el.innerHTML = '<div class="map-off">The map could not load. Check your internet connection and reload.</div>'; return null; }
  const m = L.map(el, { scrollWheelZoom: false }).setView(center, zoom);
  L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
  setTimeout(() => m.invalidateSize(), 60); setTimeout(() => m.invalidateSize(), 400);
  return m;
}
const pinIcon = (emoji, cls = '') => L.divIcon({ className: `pin ${cls}`, html: `<span><i>${emoji}</i></span>`, iconSize: [0, 0] });
const km = (a, b) => { const R = 6371, rad = (x) => (x * Math.PI) / 180, dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng); const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
async function geocode(path) {
  const r = await fetch('https://nominatim.openstreetmap.org/' + path, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Address search is unavailable right now');
  return r.json();
}

// Click-to-drop pin with address search and "use my location". onAddress fills the address box.
function mapPicker(root, onAddress) {
  root.innerHTML = `<div class="row"><input class="grow" data-q placeholder="Search an address or landmark" aria-label="Search address"><button type="button" class="btn sm" data-find>Find</button><button type="button" class="btn sm" data-me>Use my location</button></div>
    <div class="map" style="margin-top:12px"></div><div class="small muted" style="margin-top:6px" data-hint>Click the map, or drag the pin, to mark the exact spot.</div>`;
  let marker = null, point = null;
  const m = newMap($('.map', root), [config.studio.lat, config.studio.lng], 12);
  const hint = (t) => { $('[data-hint]', root).textContent = t; };
  const reverse = async (lat, lng) => { try { const d = await geocode(`reverse?format=jsonv2&lat=${lat}&lon=${lng}`); if (d.display_name) onAddress(d.display_name); } catch { /* address text can be typed by hand */ } };
  const set = (lat, lng, fly) => {
    point = { lat, lng }; hint(`Pin set at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    if (!m) return;
    if (!marker) { marker = L.marker([lat, lng], { icon: pinIcon('📍'), draggable: true }).addTo(m); marker.on('dragend', () => { const p = marker.getLatLng(); set(p.lat, p.lng); reverse(p.lat, p.lng); }); }
    else marker.setLatLng([lat, lng]);
    if (fly) m.setView([lat, lng], 16);
  };
  m?.on('click', (e) => { set(e.latlng.lat, e.latlng.lng); reverse(e.latlng.lat, e.latlng.lng); });
  $('[data-find]', root).onclick = async () => {
    const q = $('[data-q]', root).value.trim(); if (!q) return;
    try { const d = await geocode(`search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`); if (!d.length) return toast('No match found. Try a nearby landmark, or click the map.', 'err'); set(+d[0].lat, +d[0].lon, true); onAddress(d[0].display_name); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('[data-q]', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-find]', root).click(); } });
  $('[data-me]', root).onclick = () => {
    if (!navigator.geolocation) return toast('Your browser cannot share location.', 'err');
    navigator.geolocation.getCurrentPosition((p) => { set(p.coords.latitude, p.coords.longitude, true); reverse(p.coords.latitude, p.coords.longitude); }, () => toast('Could not get your location. Click the map instead.', 'err'), { timeout: 8000 });
  };
  return { get point() { return point; }, destroy: () => m?.remove() };
}

const STAGE = {
  processing: ['🖼️', 'Preparing'], out_for_delivery: ['🚚', 'On the way'], delivered: ['🏠', 'Delivered'],
  scheduled: ['📅', 'Scheduled'], on_the_way: ['🚗', 'Artist on the way'], arrived: ['📍', 'Artist arrived'], completed: ['✅', 'Completed'],
};
const MOVING = new Set(['out_for_delivery', 'on_the_way']);

// Live tracking window: polls the server every 3 s and glides the marker. The studio also gets controls here.
function openTracking(kind, id) {
  let map, studioM, destM, moverM, trail, bounds = false, timer, watch = null, lastSent = 0, sharing = false, data = null, built = false;
  const m = modal({ title: kind === 'orders' ? 'Track your painting' : 'Track your artist', wide: true, html: '<div class="state" style="padding:40px">Loading the map…</div>',
    onClose: () => { clearInterval(timer); if (watch !== null) navigator.geolocation.clearWatch(watch); map?.remove(); } });
  const isAdmin = me.role === 'admin';

  function build() {
    m.body.innerHTML = `<div class="split" style="grid-template-columns:1.5fr 1fr">
      <div><div class="map tall" data-map></div></div>
      <div><div data-live></div><div class="stepper" data-steps></div><div data-info class="small"></div>
      ${isAdmin ? '<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><div class="eyebrow">Studio controls</div><div class="row" style="margin-top:10px" data-ctl></div><div class="small muted" style="margin-top:8px" data-ctlmsg></div>' : ''}</div></div>`;
    map = newMap($('[data-map]', m.body), [data.studio.lat, data.studio.lng], 12);
    if (map) {
      studioM = L.marker([data.studio.lat, data.studio.lng], { icon: pinIcon('🎨', 'studio') }).addTo(map).bindTooltip('Art Studio');
      if (data.destination) destM = L.marker([data.destination.lat, data.destination.lng], { icon: pinIcon('📍') }).addTo(map).bindTooltip(data.destination.address || 'Destination');
      trail = L.polyline([], { color: '#36648b', weight: 4, opacity: .8 }).addTo(map);
    }
    built = true;
  }
  function paint() {
    if (!built) build();
    const i = data.stages.indexOf(data.stage), moving = MOVING.has(data.stage);
    $('[data-steps]', m.body).innerHTML = data.stages.map((s, k) => `<div class="step ${k < i ? 'done' : k === i ? 'now' : ''}"><b>${STAGE[s][0]}</b>${STAGE[s][1]}</div>`).join('');
    const pos = data.position, dest = data.destination;
    let info = '';
    if (pos) { const ago = Math.max(0, Math.round((Date.now() - parseDbTime(pos.updated_at)) / 1000)); info += `<div><span class="live ${moving ? '' : 'off'}">${moving ? 'Live' : 'Last seen'}</span> <span class="muted">· updated ${ago < 60 ? ago + 's' : Math.round(ago / 60) + ' min'} ago</span></div>`; }
    else info += `<div class="muted">${data.active ? 'Not on the move yet. The live position appears here as soon as the studio sets off.' : 'Tracking is only available for active items.'}</div>`;
    if (pos && dest) { const d = km(pos, dest), mins = Math.round((d / 28) * 60); info += `<p style="margin:10px 0 0"><span class="serif" style="font-size:30px">${d < 0.05 ? 'Arrived' : d.toFixed(1) + ' km'}</span><br><span class="muted">${d < 0.05 ? 'At your door.' : `about ${Math.max(1, mins)} min away`}</span></p>`; }
    if (dest?.address) info += `<p class="muted" style="margin:10px 0 0">To: ${esc(dest.address)}</p>`;
    if (!dest) info += '<p class="muted">No map pin was saved for this item.</p>';
    $('[data-info]', m.body).innerHTML = info;
    if (map) {
      const ll = pos ? [pos.lat, pos.lng] : null;
      if (ll) { if (!moverM) moverM = L.marker(ll, { icon: pinIcon(kind === 'orders' ? '🚚' : '🧑‍🎨', 'mover'), zIndexOffset: 500 }).addTo(map); else moverM.setLatLng(ll);
        trail.setLatLngs([[data.studio.lat, data.studio.lng], ll]); }
      if (!bounds) { const pts = [[data.studio.lat, data.studio.lng], ...(dest ? [[dest.lat, dest.lng]] : []), ...(ll ? [ll] : [])]; map.fitBounds(pts.length > 1 ? pts : [pts[0], pts[0]], { padding: [50, 50], maxZoom: 15 }); bounds = true; }
    }
    if (isAdmin) controls();
  }
  function controls() {
    const ctl = $('[data-ctl]', m.body), msg = $('[data-ctlmsg]', m.body);
    ctl.innerHTML = data.stages.map((s) => `<button class="btn sm ${s === data.stage ? 'primary' : ''}" data-stage="${s}" ${data.active ? '' : 'disabled'}>${STAGE[s][0]} ${STAGE[s][1]}</button>`).join('')
      + `<button class="btn sm dark" data-sim ${data.active && data.destination ? '' : 'disabled'}>▶ ${data.simulating ? 'Simulating…' : 'Simulate route'}</button>`
      + `<button class="btn sm" data-share ${data.active ? '' : 'disabled'}>${sharing ? '■ Stop sharing' : '📡 Share my live location'}</button>`;
    msg.textContent = data.destination ? '' : 'This item has no map pin, so the route cannot be simulated.';
    on(ctl, '[data-stage]', (b) => post(`/tracking/${kind}/${id}/stage`, { stage: b.dataset.stage }));
    on(ctl, '[data-sim]', () => post(`/tracking/${kind}/${id}/simulate`).then(() => toast('The marker is now travelling to the pin.', 'ok')));
    on(ctl, '[data-share]', () => {
      if (sharing) { navigator.geolocation.clearWatch(watch); watch = null; sharing = false; return controls(); }
      if (!navigator.geolocation) return toast('This browser cannot share location.', 'err');
      watch = navigator.geolocation.watchPosition((p) => {
        if (Date.now() - lastSent < 3000) return; lastSent = Date.now();
        api('POST', `/tracking/${kind}/${id}/location`, { lat: p.coords.latitude, lng: p.coords.longitude }).then(tick).catch((e) => toast(e.message, 'err'));
      }, () => toast('Could not read your GPS position.', 'err'), { enableHighAccuracy: true });
      sharing = true; controls();
    });
  }
  async function post(path, body) { try { await api('POST', path, body); await tick(); } catch (e) { toast(e.message, 'err'); } }
  async function tick() {
    try { data = await api('GET', `/tracking/${kind}/${id}`); paint(); }
    catch (e) { if (!built) m.body.innerHTML = `<div class="state error"><h3>Could not load tracking</h3><div>${esc(e.message)}</div></div>`; }
  }
  tick(); timer = setInterval(tick, 3000);
}

/* ============================ payments ============================ */
async function startPayment(kind, id) {
  let p;
  try { p = await api('POST', '/payments/create', { kind, id }); } catch (e) { toast(e.message, 'err'); return false; }
  const verify = (o, pay, sig) => api('POST', '/payments/verify', { razorpayOrderId: o, razorpayPaymentId: pay, razorpaySignature: sig });
  if (p.mode === 'razorpay') {
    try { await loadScript('https://checkout.razorpay.com/v1/checkout.js'); } catch { toast('Could not load Razorpay. Check your connection.', 'err'); return false; }
    return new Promise((resolve) => {
      const rz = new Razorpay({ key: p.keyId, amount: p.amount, currency: 'INR', name: 'Art Studio', description: p.description, order_id: p.razorpayOrderId, prefill: p.prefill, theme: { color: '#151311' },
        handler: async (r) => { try { await verify(r.razorpay_order_id, r.razorpay_payment_id, r.razorpay_signature); toast('Payment received. Thank you.', 'ok'); resolve(true); } catch (e) { toast(e.message, 'err'); resolve(false); } },
        modal: { ondismiss: () => resolve(false) } });
      rz.on('payment.failed', (r) => toast(r.error?.description || 'The payment failed.', 'err'));
      rz.open();
    });
  }
  // No Razorpay keys on the server: a clearly labelled demo checkout so the flow can still be shown.
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'Checkout', html: `<div class="demo-note"><b>Demo mode.</b> No money moves. Add Razorpay test keys to the server to use the real checkout.</div>
      <div class="fakecard"><div class="small" style="opacity:.7">${esc(p.description)}</div><div class="num">4111 1111 1111 1111</div><div class="row" style="justify-content:space-between"><span>${esc(p.prefill.name)}</span><span>12 / 30</span></div></div>
      <button class="btn primary block" data-pay>Pay ${money(p.amountRupees)}</button>`, onClose: () => { if (!done) resolve(false); } });
    $('[data-pay]', m.el).onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Processing…';
      try { await verify(p.razorpayOrderId, 'pay_mock_' + Math.random().toString(36).slice(2, 12), ''); done = true; toast('Payment received. Thank you.', 'ok'); resolve(true); m.close(); }
      catch (err) { toast(err.message, 'err'); e.target.disabled = false; e.target.textContent = `Pay ${money(p.amountRupees)}`; }
    };
  });
}

/* ============================ shell ============================ */
function render() {
  const nav = $('#nav'), who = $('#who');
  cleanup(); cleanup = () => {};
  if (!me) { nav.innerHTML = ''; who.innerHTML = ''; return authView(); }
  const tabs = me.role === 'admin'
    ? [['overview', 'Overview'], ['paintings', 'Collection'], ['orders', 'Orders'], ['bookings', 'Wall bookings'], ['pottery', 'Pottery']]
    : [['paintings', 'Collection'], ['orders', 'My orders'], ['bookings', 'Wall painting'], ['pottery', 'Pottery']];
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  nav.innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  on(nav, 'button', (b) => { tab = b.dataset.t; render(); window.scrollTo(0, 0); });
  who.innerHTML = `<div><div>${esc(me.name)}</div><div class="role">${me.role === 'admin' ? 'Studio' : 'Customer'}</div></div><button class="link" id="out">Log out</button>`;
  $('#out').onclick = async () => { await api('POST', '/auth/logout').catch(() => {}); me = null; tab = 'paintings'; render(); };
  show();
}
function show() {
  cleanup(); cleanup = () => {}; onRefusal = () => {};
  ({ overview: overviewView, paintings: paintingsView, orders: ordersView, bookings: bookingsView, pottery: potteryView })[tab]();
}

function authView() {
  $('#main').innerHTML = `<div class="auth">
    <div class="hero">${artSvg('studio-hero-two', { grain: true })}<div class="copy"><div class="eyebrow" style="color:#fff;opacity:.8">Art Studio</div><h1>Paintings, walls and clay, made one at a time.</h1><p>Acquire an original, book a mural for your wall, or commission handmade pottery.</p></div></div>
    <div><div class="tabs" role="tablist"><button role="tab" data-tab="login" aria-selected="true">Log in</button><button role="tab" data-tab="signup" aria-selected="false">Create account</button></div>
      <form class="form" id="login"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary block">Enter the studio</button></form>
      <form class="form" id="signup" hidden><label>Name<input name="name" maxlength="80" required></label><label>Email<input name="email" type="email" maxlength="120" required></label><label>Password (6 or more characters)<input name="password" type="password" minlength="6" maxlength="200" required></label><button class="btn primary block">Create my account</button></form>
    </div></div>`;
  on($('#main'), '[data-tab]', (b) => {
    for (const t of ['login', 'signup']) { $('#' + t).hidden = t !== b.dataset.tab; }
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
  });
  for (const [id, path] of [['login', '/auth/login'], ['signup', '/auth/signup']]) {
    $('#' + id).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button.primary', e.target); btn.disabled = true;
      try { me = await api('POST', path, Object.fromEntries(new FormData(e.target))); config = await api('GET', '/seed'); tab = me.role === 'admin' ? 'overview' : 'paintings'; render(); }
      catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    };
  }
}

const head = (eyebrow, title, sub, extra = '') => `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div>${extra}</div></div>`;

// Inline status history under a record.
function wireHistory(root, kind) {
  on(root, '[data-hist]', async (b) => {
    const slot = $(`[data-slot="${b.dataset.hist}"]`, root);
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div class="muted small">Loading history…</div>';
    try {
      const h = await api('GET', `/history/${kind}/${b.dataset.hist}`);
      slot.innerHTML = `<ul class="hist">${h.map((e) => `<li>${esc((STAGE[e.status] || [0, e.status])[1] || e.status)} · ${esc(e.actor || 'System')} · ${esc(e.created_at)}${e.note ? ' · “' + esc(e.note) + '”' : ''}</li>`).join('')}</ul>`;
    } catch (e) { slot.innerHTML = `<div class="muted small">${esc(e.message)}</div>`; }
  });
}
const histBtn = (id) => `<button class="btn sm" data-hist="${id}">History</button>`;
const histSlot = (id) => `<div data-slot="${id}"></div>`;
const noteHtml = (n) => (n ? `<div class="small" style="margin-top:6px"><span class="muted">Note from the studio:</span> “${esc(n)}”</div>` : '');
// Payment badge for any record that has reached a payable state.
function payChip(r, payableStatus) {
  if (r.payment_status === 'paid') return chip('Paid', 'green');
  if (r.payment_status === 'refund_pending') return chip('Refund pending', 'gold');
  if (r.payment_status === 'refunded') return chip('Refunded', 'blue');
  return r.status === payableStatus ? chip('Awaiting payment', 'gold') : '';
}
const statusChip = (s) => chip(s, { placed: 'green', confirmed: 'green', accepted: 'green', requested: 'gold', cancelled: 'red', declined: 'red' }[s] || '');

/* ============================ overview (studio) ============================ */
async function overviewView() {
  $('#main').innerHTML = head('Studio', 'Overview', 'What needs you today, and where everything is right now.') + '<div class="statrow" id="stats"><div class="skeleton" style="height:90px;grid-column:1/-1"></div></div>'
    + '<div class="eyebrow" style="margin-bottom:12px">Live map · deliveries and wall jobs</div><div class="map tall" id="live"></div><div id="livelist" class="small muted" style="margin-top:12px"></div>';
  let alive = true; cleanup = () => { alive = false; clearInterval(timer); map?.remove(); };
  api('GET', '/admin/summary').then((s) => {
    if (!alive) return;
    $('#stats').innerHTML = [['Works available', s.paintingsAvailable], ['Works sold', s.paintingsSold], ['Orders open', s.ordersPlaced], ['Bookings to review', s.bookingsPending], ['Pottery to review', s.potteryPending], ['Collected', money(s.revenue)]]
      .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }).catch((e) => { $('#stats').innerHTML = `<div class="state error" style="grid-column:1/-1;padding:20px">${esc(e.message)}</div>`; });
  const map = newMap($('#live'), [config.studio.lat, config.studio.lng], 11);
  const markers = new Map();
  if (map) L.marker([config.studio.lat, config.studio.lng], { icon: pinIcon('🎨', 'studio') }).addTo(map).bindTooltip('Art Studio');
  let fitted = false;
  async function poll() {
    try {
      const { items } = await api('GET', '/tracking');
      if (!alive) return;
      $('#livelist').textContent = items.length ? `${items.length} active · click a marker to open its tracker.` : 'Nothing to track yet. Confirm a wall booking or place an order with a map pin, and it shows up here.';
      for (const it of items) {
        const key = `${it.kind}:${it.id}`, ll = it.position ? [it.position.lat, it.position.lng] : [it.destination.lat, it.destination.lng];
        const label = `${it.title} · ${it.customer_name} · ${STAGE[it.stage][1]}`;
        if (!map) continue;
        if (markers.has(key)) { markers.get(key).setLatLng(ll).setTooltipContent(label); }
        else { const mk = L.marker(ll, { icon: pinIcon(it.position ? (it.kind === 'orders' ? '🚚' : '🧑‍🎨') : '📍', it.position ? 'mover' : '') }).addTo(map).bindTooltip(label); mk.on('click', () => openTracking(it.kind, it.id)); markers.set(key, mk); }
      }
      if (map && !fitted && items.length) { map.fitBounds([[config.studio.lat, config.studio.lng], ...items.map((i) => [i.destination.lat, i.destination.lng])], { padding: [60, 60], maxZoom: 14 }); fitted = true; }
    } catch { /* keep the last picture on screen */ }
  }
  poll(); const timer = setInterval(poll, 5000);
}

/* ============================ collection ============================ */
function paintingsView() {
  const isAdmin = me.role === 'admin';
  $('#main').innerHTML = head('The collection', 'Original works', 'Every painting is one of a kind. Once it is acquired, it is gone.',
    isAdmin ? '<button class="btn primary" id="add">Add a work</button>' : '')
    + (isAdmin ? '' : `<div class="intro"><div data-go="paintings"><div class="eyebrow">I</div><h4>Paintings</h4><p>Acquire an original.</p></div><div data-go="bookings"><div class="eyebrow">II</div><h4>Wall painting</h4><p>Book a mural for your wall.</p></div><div data-go="pottery"><div class="eyebrow">III</div><h4>Custom pottery</h4><p>Choose the form and the glaze.</p></div></div>`)
    + `<form class="filters" id="filters"><label class="grow">Search<input name="q" type="search" placeholder="Title, artist, medium"></label>
      <div class="pills" id="status"><button type="button" aria-pressed="true" data-s="">All</button><button type="button" aria-pressed="false" data-s="available">Available</button><button type="button" aria-pressed="false" data-s="sold">Sold</button></div>
      <label>From ₹<input name="min" type="number" min="0"></label><label>To ₹<input name="max" type="number" min="0"></label><button class="btn sm">Apply</button></form><div id="wall"></div>`;
  let status = '';
  const filters = $('#filters');
  const query = (offset) => { const p = new URLSearchParams({ limit: PAGE, offset }); for (const [k, v] of new FormData(filters)) if (v !== '') p.set(k, v); if (status) p.set('status', status); return p.toString(); };
  const draw = () => loadInto($('#wall'), (offset) => api('GET', '/paintings?' + query(offset)), (p) => {
    const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy">` : artSvg(p.title + p.id, { grain: true });
    const [rw, rh] = artRatio(p.title + p.id);
    return `<figure class="piece"><div class="frame ${p.image_url ? '' : 'fixed'}" data-open="${p.id}" style="${p.image_url ? '' : `aspect-ratio:${rw}/${rh}`}" tabindex="0" role="button" aria-label="View ${esc(p.title)}">${img}<span class="view">View work</span>${p.status === 'sold' ? '<span class="sold" title="Sold"></span>' : ''}</div>
      <figcaption class="label"><span class="by">${esc(p.artist || 'Art Studio')}</span><h3>${esc(p.title)}</h3><span class="desc">${esc(p.description)}</span>
        <div class="foot"><span class="price">${money(p.price)}</span>${p.status === 'sold' ? chip('Sold', 'red') : !isAdmin ? `<button class="btn sm primary" data-buy="${p.id}">Acquire</button>` : chip('Available', 'green')}</div>
        ${isAdmin && p.status === 'available' ? `<div class="actions"><button class="btn sm" data-edit="${p.id}">Edit</button><button class="btn sm danger" data-del="${p.id}">Delete</button></div>` : ''}</figcaption></figure>`;
  }, {
    cls: 'masonry', emptyTitle: 'No works match', emptyText: 'Try a different search or price range.',
    after: (box, items) => {
      const find = (id) => items.find((x) => x.id == id);
      on(box, '[data-open]', (b) => openPainting(find(b.dataset.open)));
      box.querySelectorAll('[data-open]').forEach((f) => f.addEventListener('keydown', (e) => { if (e.key === 'Enter') f.click(); }));
      on(box, '[data-buy]', (b) => openCheckout(find(b.dataset.buy)));
      on(box, '[data-edit]', (b) => openPaintingForm(find(b.dataset.edit)));
      on(box, '[data-del]', async (b) => { if (await ask({ title: 'Delete this work?', text: 'This removes it from the collection for good.', ok: 'Delete', danger: true })) act(() => api('DELETE', '/paintings/' + b.dataset.del), 'Work deleted.'); });
    },
  });
  filters.onsubmit = (e) => { e.preventDefault(); draw(); };
  on($('#status'), 'button', (b) => { status = b.dataset.s; document.querySelectorAll('#status button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); draw(); });
  on($('#main'), '[data-go]', (b) => { if (b.dataset.go === 'paintings') return $('#wall').scrollIntoView(); tab = b.dataset.go; render(); window.scrollTo(0, 0); });
  if (isAdmin) $('#add').onclick = () => openPaintingForm(null);
  draw();
}

function openPainting(p) {
  const img = p.image_url ? `<img class="lightbox-img" src="${esc(p.image_url)}" alt="${esc(p.title)}">` : `<div style="aspect-ratio:${artRatio(p.title + p.id).join('/')}">${artSvg(p.title + p.id, { grain: true })}</div>`;
  const m = modal({ title: p.title, wide: true, html: `<div class="split">${img}<div><div class="eyebrow">${esc(p.artist || 'Art Studio')}</div><p style="font-size:17px">${esc(p.description) || 'An original, one-of-a-kind work.'}</p>
    <p class="serif" style="font-size:44px;margin:18px 0">${money(p.price)}</p>${p.status === 'sold' ? chip('Sold', 'red') : me.role === 'customer' ? '<button class="btn primary block" data-buy>Acquire this work</button>' : chip('Available', 'green')}
    <p class="small muted" style="margin-top:14px">One of a kind. Delivered to your door, with live tracking.</p></div></div>` });
  $('[data-buy]', m.el)?.addEventListener('click', () => { m.close(); openCheckout(p); });
}

function openCheckout(p) {
  let picker = null;
  const m = modal({ title: 'Acquire this work', wide: true, onClose: () => picker?.destroy(), html: `<div class="split"><div>
      <div style="aspect-ratio:${p.image_url ? '4/5' : artRatio(p.title + p.id).join('/')};overflow:hidden;background:#e8e2d6">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : artSvg(p.title + p.id, { grain: true })}</div>
      <h3 class="serif" style="font-size:32px;font-style:italic;margin-top:14px">${esc(p.title)}</h3><div class="eyebrow">${esc(p.artist || 'Art Studio')}</div><p class="serif" style="font-size:34px;margin:8px 0">${money(p.price)}</p></div>
      <form class="form" id="co"><div class="eyebrow">Where should it be delivered?</div><label>Delivery address<textarea name="address" maxlength="300" required minlength="5" placeholder="House no., street, area, city"></textarea></label>
      <div data-picker></div><button class="btn primary block">Place order and pay ${money(p.price)}</button><div class="small muted">You will pay securely next. The painting is held for you until you do.</div></form></div>` });
  const addr = $('[name=address]', m.el);
  picker = mapPicker($('[data-picker]', m.el), (t) => { addr.value = t; });
  $('#co', m.el).onsubmit = async (e) => {
    e.preventDefault();
    if (mapsOn() && !picker.point) return toast('Please drop a pin on the map so we can deliver and you can track it.', 'err');
    const btn = $('button.primary', e.target); btn.disabled = true;
    try {
      const order = await api('POST', '/orders', { paintingId: p.id, address: addr.value, ...(picker.point || {}) });
      m.close(); toast('Order placed. One step left: payment.', 'ok');
      const paid = await startPayment('orders', order.id);
      if (!paid) toast('Your order is saved. Pay any time from My orders.');
      tab = 'orders'; render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; if (/just sold/.test(err.message)) { m.close(); show(); } }
  };
}

function openPaintingForm(p) {
  let file = null, previewUrl = null;
  const m = modal({ title: p ? 'Edit work' : 'Add a work', onClose: () => previewUrl && URL.revokeObjectURL(previewUrl), html: `<form class="form" id="pf">
    <label>Title<input name="title" maxlength="120" required value="${esc(p?.title)}"></label><label>Artist<input name="artist" maxlength="80" value="${esc(p?.artist)}"></label>
    <label>Description<input name="description" maxlength="500" value="${esc(p?.description)}" placeholder="Medium, size, year"></label><label>Price (₹)<input name="price" type="number" min="1" step="1" required value="${esc(p?.price)}"></label>
    <div><div class="eyebrow" style="margin-bottom:8px">Photograph</div><label class="dropzone" data-drop><span data-prev>${p?.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}</span>
      <span class="small muted">Click to choose an image (PNG, JPEG, WebP or GIF, up to 5 MB). Without one, abstract artwork is generated.</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file hidden></label></div>
    <button class="btn primary block">${p ? 'Save changes' : 'Add to the collection'}</button></form>` });
  $('[data-file]', m.el).onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { e.target.value = ''; return toast('That image is over 5 MB.', 'err'); }
    file = f; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(f);
    $('[data-prev]', m.el).innerHTML = `<img src="${previewUrl}" alt="Preview">`;
  };
  $('#pf', m.el).onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button.primary', e.target); btn.disabled = true;
    const d = Object.fromEntries(new FormData(e.target)); delete d.undefined;
    try {
      const saved = p ? await api('PUT', '/paintings/' + p.id, d) : await api('POST', '/paintings', d);
      if (file) {
        const r = await fetch(`/api/paintings/${saved.id}/image`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The image could not be uploaded');
      }
      m.close(); toast(p ? 'Work updated.' : 'Work added to the collection.', 'ok'); show();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
}

/* ============================ orders ============================ */
function ordersView() {
  const isAdmin = me.role === 'admin';
  $('#main').innerHTML = head(isAdmin ? 'Studio' : 'Your acquisitions', isAdmin ? 'Orders' : 'My orders', isAdmin ? 'Every painting that has been acquired.' : 'Pay, track and manage your paintings.') + '<div id="list"></div>';
  loadInto($('#list'), (o) => api('GET', `/orders?limit=${PAGE}&offset=${o}`), (o) => {
    const [, stageLabel] = STAGE[o.stage] || [0, o.stage];
    const thumb = o.painting_image_url ? `<img src="${esc(o.painting_image_url)}" alt="">` : artSvg(o.painting_title + o.painting_id);
    return `<div class="item"><div class="thumb">${thumb}</div><div><h3>${esc(o.painting_title)}</h3>
      <div class="meta">${statusChip(o.status)}${payChip(o, 'placed')}${o.status === 'placed' ? chip(stageLabel, 'blue') : ''}</div>
      <div class="small muted">${isAdmin ? esc(o.customer_name) + ' · ' + esc(o.customer_email) + ' · ' : ''}${money(o.price)} · ${esc(o.created_at)}${o.delivery_address ? '<br>Deliver to: ' + esc(o.delivery_address) : ''}</div>
      <div class="actions">${!isAdmin && o.status === 'placed' && o.payment_status === 'unpaid' ? `<button class="btn sm primary" data-pay="${o.id}">Pay ${money(o.price)}</button>` : ''}
        ${o.status === 'placed' ? `<button class="btn sm dark" data-track="${o.id}">${isAdmin ? 'Manage delivery' : 'Track live'}</button>` : ''}
        ${isAdmin && o.payment_status === 'refund_pending' ? `<button class="btn sm" data-refund="${o.id}">Retry refund</button>` : ''}
        ${histBtn(o.id)}${!isAdmin && o.status === 'placed' ? `<button class="btn sm danger" data-cancel="${o.id}">Cancel</button>` : ''}</div>${histSlot(o.id)}</div></div>`;
  }, { emptyTitle: 'No orders yet', emptyText: isAdmin ? 'Orders appear here when a customer acquires a work.' : 'Acquire a painting from the collection and it will appear here.',
    after: (box) => {
      on(box, '[data-pay]', async (b) => { if (await startPayment('orders', Number(b.dataset.pay))) show(); });
      on(box, '[data-track]', (b) => openTracking('orders', b.dataset.track));
      on(box, '[data-refund]', (b) => act(() => api('POST', `/payments/orders/${b.dataset.refund}/refund`), 'Refund sent.'));
      on(box, '[data-cancel]', async (b) => { if (await ask({ title: 'Cancel this order?', text: 'The painting goes back on sale. If you already paid, you are refunded.', ok: 'Cancel order', danger: true })) act(() => api('POST', `/orders/${b.dataset.cancel}/cancel`), 'Order cancelled.'); });
      wireHistory(box, 'orders');
    } });
}

/* ============================ wall bookings ============================ */
function bookingsView() {
  const isAdmin = me.role === 'admin';
  const min = addDays(config.today, 7), max = addDays(config.today, 90);
  $('#main').innerHTML = head(isAdmin ? 'Studio' : 'Commissions', isAdmin ? 'Wall bookings' : 'Wall painting', isAdmin ? 'Confirm or decline requests, then track the artist.' : `We paint your wall on the day you choose. ${money(config.wallRatePerSqFt)} per sq ft.`)
    + (isAdmin ? '' : `<div class="split" style="margin-bottom:56px"><form class="form panel" id="bform">
      <label>Date (7 to 90 days from today)<input name="date" type="date" min="${min}" max="${max}" required></label>
      <label>Wall size: <span id="sqv">100</span> sq ft<input name="wallSqFt" type="range" min="10" max="500" step="5" value="100"></label>
      <label>Address<textarea name="address" required minlength="5" maxlength="300" placeholder="Where is the wall?"></textarea></label>
      <div data-picker></div><div class="row" style="justify-content:space-between"><div><div class="eyebrow">Estimate</div><div class="quote" id="quote"></div></div><button class="btn primary">Request this date</button></div></form>
      <div><div style="aspect-ratio:4/5;overflow:hidden;box-shadow:var(--shadow)">${artSvg('wall-mural-feature', { grain: true })}</div><div class="eyebrow" style="margin-top:16px">Dates already taken</div><div class="row" id="taken" style="gap:6px;margin-top:8px"></div></div></div>`)
    + '<div id="list"></div>';
  if (!isAdmin) {
    const f = $('#bform');
    let taken = [];
    const picker = mapPicker($('[data-picker]', f), (t) => { f.address.value = t; });
    cleanup = () => picker.destroy();
    const quote = () => { $('#sqv').textContent = f.wallSqFt.value; $('#quote').textContent = money(f.wallSqFt.value * config.wallRatePerSqFt); };
    const check = () => f.date.setCustomValidity(taken.includes(f.date.value) ? 'That date is already taken' : '');
    const loadTaken = () => api('GET', '/bookings/taken-dates').then((d) => { taken = d; check(); $('#taken').innerHTML = d.length ? d.map((x) => chip(fmtDate(x))).join('') : '<span class="muted small">None yet. Every date is open.</span>'; })
      .catch(() => { $('#taken').innerHTML = '<span class="muted small">Could not load taken dates (the server still checks).</span>'; });
    f.date.oninput = check; f.wallSqFt.oninput = quote; quote(); loadTaken();
    onRefusal = loadTaken;
    f.onsubmit = (e) => {
      e.preventDefault();
      if (mapsOn() && !picker.point) return toast('Please drop a pin on the map so the artist can find you.', 'err');
      const d = Object.fromEntries(new FormData(f)); Object.assign(d, picker.point || {});
      act(() => api('POST', '/bookings', d), 'Request sent. The studio will confirm shortly.');
    };
  }
  loadInto($('#list'), (o) => api('GET', `/bookings?limit=${PAGE}&offset=${o}`), (b) => `<div class="item"><div class="thumb">${artSvg('wall' + b.id)}</div><div><h3>${fmtDate(b.booking_date)}</h3>
      <div class="meta">${statusChip(b.status)}${payChip(b, 'confirmed')}${b.status === 'confirmed' ? chip((STAGE[b.stage] || [0, b.stage])[1], 'blue') : ''}</div>
      <div class="small muted">${isAdmin ? esc(b.customer_name) + ' · ' : ''}${b.wall_sqft} sq ft · ${money(b.price)}<br>${esc(b.address)}</div>${noteHtml(b.note)}
      <div class="actions">${!isAdmin && b.status === 'confirmed' && b.payment_status === 'unpaid' ? `<button class="btn sm primary" data-pay="${b.id}">Pay ${money(b.price)}</button>` : ''}
        ${b.status === 'confirmed' ? `<button class="btn sm dark" data-track="${b.id}">${isAdmin ? 'Manage job' : 'Track the artist'}</button>` : ''}
        ${isAdmin && b.status === 'requested' ? `<button class="btn sm primary" data-ok="${b.id}">Confirm</button><button class="btn sm danger" data-no="${b.id}">Decline</button>` : ''}
        ${isAdmin && b.payment_status === 'refund_pending' ? `<button class="btn sm" data-refund="${b.id}">Retry refund</button>` : ''}
        ${histBtn(b.id)}${!isAdmin && b.can_cancel ? `<button class="btn sm danger" data-cancel="${b.id}">Cancel</button>` : ''}
        ${!isAdmin && !b.can_cancel && ['requested', 'confirmed'].includes(b.status) ? '<span class="small muted">Too late to cancel (under 3 days)</span>' : ''}</div>${histSlot(b.id)}</div></div>`,
  { emptyTitle: 'No bookings yet', emptyText: isAdmin ? 'Requests appear here.' : 'Pick a date above and we will paint your wall.',
    after: (box) => {
      on(box, '[data-pay]', async (b) => { if (await startPayment('bookings', Number(b.dataset.pay))) show(); });
      on(box, '[data-track]', (b) => openTracking('bookings', b.dataset.track));
      on(box, '[data-refund]', (b) => act(() => api('POST', `/payments/bookings/${b.dataset.refund}/refund`), 'Refund sent.'));
      on(box, '[data-ok]', async (b) => { const n = await ask({ title: 'Confirm this booking', input: 'Note for the customer (optional)', ok: 'Confirm' }); if (n !== null) act(() => api('POST', `/bookings/${b.dataset.ok}/confirm`, { note: n }), 'Booking confirmed.'); });
      on(box, '[data-no]', async (b) => { const n = await ask({ title: 'Decline this booking', input: 'Reason (optional)', ok: 'Decline', danger: true }); if (n !== null) act(() => api('POST', `/bookings/${b.dataset.no}/decline`, { note: n }), 'Booking declined.'); });
      on(box, '[data-cancel]', async (b) => { if (await ask({ title: 'Cancel this booking?', text: 'If you already paid, you are refunded.', ok: 'Cancel booking', danger: true })) act(() => api('POST', `/bookings/${b.dataset.cancel}/cancel`), 'Booking cancelled.'); });
      wireHistory(box, 'bookings');
    } });
}

/* ============================ pottery ============================ */
function potteryView() {
  const isAdmin = me.role === 'admin';
  $('#main').innerHTML = head(isAdmin ? 'Studio' : 'Made by hand', isAdmin ? 'Pottery requests' : 'Custom pottery', isAdmin ? 'Accept or decline requests from customers.' : 'Choose a form and a glaze. We throw, glaze and fire it for you.')
    + (isAdmin ? '' : `<div class="split panel" style="margin-bottom:56px;grid-template-columns:1.2fr 1fr" id="builder"><form class="form" id="pform"><input type="hidden" name="rid">
      <div><div class="eyebrow" style="margin-bottom:8px" id="ptitle">1 · Form</div><div class="choices" role="radiogroup" id="items"></div></div>
      <div><div class="eyebrow" style="margin-bottom:8px">2 · Glaze</div><div class="swatches" role="radiogroup" id="glazes"></div></div>
      <div class="row"><div><div class="eyebrow" style="margin-bottom:8px">3 · Quantity</div><div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><b id="qty">1</b><button type="button" data-q="1" aria-label="More">+</button></div></div>
        <label class="grow">4 · Needed by (14+ days away)<input name="neededBy" type="date" min="${addDays(config.today, 14)}" required></label></div>
      <div class="row"><button class="btn primary">Send request</button><button type="button" class="btn" id="pclear">Clear</button></div></form>
      <div><div class="preview" id="preview"></div><div style="text-align:center;margin-top:14px"><div class="eyebrow" id="sum"></div><div class="quote" id="pquote"></div></div></div></div>`)
    + '<div id="list"></div>';
  if (!isAdmin) {
    const f = $('#pform'), sel = { item: config.potteryItems[0].name, glaze: config.glazes[0], qty: 1 };
    const priceOf = (name) => (config.potteryItems.find((i) => i.name === name) || { price: 0 }).price;
    const paint = () => {
      $('#items').innerHTML = config.potteryItems.map((i) => `<button type="button" class="choice" role="radio" aria-checked="${i.name === sel.item}" data-item="${esc(i.name)}">${potSvg(i.name, glazeColor(sel.glaze))}${esc(i.name)}<small>${money(i.price)}</small></button>`).join('');
      $('#glazes').innerHTML = config.glazes.map((g) => `<button type="button" class="swatch" role="radio" aria-checked="${g === sel.glaze}" data-glaze="${esc(g)}"><i style="background:${glazeColor(g)}"></i>${esc(g)}</button>`).join('');
      $('#qty').textContent = sel.qty;
      $('#preview').innerHTML = potSvg(sel.item, glazeColor(sel.glaze));
      $('#sum').textContent = `${sel.qty} × ${sel.item} · ${sel.glaze}`; $('#pquote').textContent = money(priceOf(sel.item) * sel.qty);
      on($('#items'), '[data-item]', (b) => { sel.item = b.dataset.item; paint(); });
      on($('#glazes'), '[data-glaze]', (b) => { sel.glaze = b.dataset.glaze; paint(); });
    };
    paint();
    on(f, '[data-q]', (b) => { sel.qty = Math.min(12, Math.max(1, sel.qty + Number(b.dataset.q))); paint(); });
    $('#pclear').onclick = () => { f.reset(); f.rid.value = ''; Object.assign(sel, { item: config.potteryItems[0].name, glaze: config.glazes[0], qty: 1 }); $('#ptitle').textContent = '1 · Form'; paint(); };
    window.__loadPottery = (r) => { Object.assign(sel, { item: r.item, glaze: r.glaze, qty: r.quantity }); f.rid.value = r.id; f.neededBy.value = r.needed_by; $('#ptitle').textContent = `Editing request #${r.id} · 1 · Form`; paint(); $('#builder').scrollIntoView({ behavior: 'smooth' }); };
    f.onsubmit = (e) => {
      e.preventDefault(); const id = f.rid.value;
      const d = { item: sel.item, glaze: sel.glaze, quantity: sel.qty, neededBy: f.neededBy.value };
      act(() => (id ? api('PUT', '/pottery/' + id, d) : api('POST', '/pottery', d)), id ? 'Request updated.' : 'Request sent. The studio will respond soon.');
    };
  }
  loadInto($('#list'), (o) => api('GET', `/pottery?limit=${PAGE}&offset=${o}`), (r) => `<div class="item"><div class="thumb" style="background:#efe7d8">${potSvg(r.item, glazeColor(r.glaze))}</div><div><h3>${r.quantity} × ${esc(r.item)}</h3>
      <div class="meta">${statusChip(r.status)}${payChip(r, 'accepted')}${chip(r.glaze)}</div>
      <div class="small muted">${isAdmin ? esc(r.customer_name) + ' · ' : ''}Needed by ${fmtDate(r.needed_by)} · ${money(r.price)}</div>${noteHtml(r.note)}
      <div class="actions">${!isAdmin && r.status === 'accepted' && r.payment_status === 'unpaid' ? `<button class="btn sm primary" data-pay="${r.id}">Pay ${money(r.price)}</button>` : ''}
        ${isAdmin && r.status === 'requested' ? `<button class="btn sm primary" data-ok="${r.id}">Accept</button><button class="btn sm danger" data-no="${r.id}">Decline</button>` : ''}
        ${histBtn(r.id)}${!isAdmin && r.status === 'requested' ? `<button class="btn sm" data-edit="${r.id}">Edit</button><button class="btn sm danger" data-cancel="${r.id}">Cancel</button>` : ''}</div>${histSlot(r.id)}</div></div>`,
  { emptyTitle: 'No requests yet', emptyText: isAdmin ? 'Requests appear here.' : 'Design a piece above and send it to the studio.',
    after: (box, items) => {
      on(box, '[data-pay]', async (b) => { if (await startPayment('pottery', Number(b.dataset.pay))) show(); });
      on(box, '[data-ok]', async (b) => { const n = await ask({ title: 'Accept this request', input: 'Note for the customer (optional)', ok: 'Accept' }); if (n !== null) act(() => api('POST', `/pottery/${b.dataset.ok}/accept`, { note: n }), 'Request accepted.'); });
      on(box, '[data-no]', async (b) => { const n = await ask({ title: 'Decline this request', input: 'Reason (optional)', ok: 'Decline', danger: true }); if (n !== null) act(() => api('POST', `/pottery/${b.dataset.no}/decline`, { note: n }), 'Request declined.'); });
      on(box, '[data-cancel]', async (b) => { if (await ask({ title: 'Cancel this request?', ok: 'Cancel request', danger: true })) act(() => api('POST', `/pottery/${b.dataset.cancel}/cancel`), 'Request cancelled.'); });
      on(box, '[data-edit]', (b) => window.__loadPottery(items.find((x) => x.id == b.dataset.edit)));
      wireHistory(box, 'pottery');
    } });
}

/* ============================ boot ============================ */
(async () => {
  $('#main').innerHTML = '<div class="state"><div class="skeleton" style="height:240px"></div></div>';
  try { me = await api('GET', '/me'); config = await api('GET', '/seed'); if (me.role === 'admin') tab = 'overview'; } catch { me = null; }
  render();
})();
