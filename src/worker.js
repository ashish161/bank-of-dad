/*
  Bank of Dad — minimal backend (Cloudflare Worker + D1 + Resend).

  What it does, and nothing more:
    POST /api/login    { email }        → emails a one-time magic link
    GET  /api/auth?token=…              → verifies link, sets a session cookie, → /app
    GET  /api/state                     → returns this family's saved blob (or {})
    PUT  /api/state    <json blob>       → saves this family's blob (size-capped)
    POST /api/logout                    → clears the session
  Everything else is served as a static file (the landing + the app).

  Design choices (kept deliberately simple):
    • The server is a dumb per-email JSON store. All app logic stays in the client.
    • Magic-link token: 32 random bytes, stored only as a SHA-256 hash, 15-min TTL,
      single-use (deleted on redeem). The email address is the identity.
    • Session: opaque random id in an HttpOnly, Secure, SameSite=Lax cookie, 30 days.
    • Isolation: every state query is scoped `WHERE email = <session email>`.
*/

const TOKEN_TTL = 15 * 60;              // 15 minutes
const SESSION_TTL = 30 * 24 * 60 * 60;  // 30 days
const MAX_BLOB = 1_000_000;             // 1 MB per family
const COOKIE = 'bod_session';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/api/login'  && request.method === 'POST') return login(request, env, url);
      if (pathname === '/api/auth'   && request.method === 'GET')  return authCallback(request, env, url);
      if (pathname === '/api/state'  && request.method === 'GET')  return getState(request, env);
      if (pathname === '/api/state'  && request.method === 'PUT')  return putState(request, env);
      if (pathname === '/api/logout' && request.method === 'POST') return logout(request, env);
      if (pathname === '/api/me'     && request.method === 'GET')  return whoami(request, env);
    } catch (err) {
      return json({ error: 'server_error' }, 500);
    }

    // /app → real app if signed in; demo playground if they chose demo; else sign in.
    // One file, no duplication — the session (or a demo cookie) decides the mode.
    const p = url.pathname;
    if (p === '/app' || p.startsWith('/app/')) {
      const asset = () => env.ASSETS.fetch(new Request(new URL('/app/index.html', url), request));
      const s = await sessionOf(request, env);
      if (s) {
        // real mode: readable bod_mode=real for the client; clear any demo flag
        return withCookies(await asset(), ['bod_mode=real; Path=/; SameSite=Lax', 'bod_demo=; Path=/; Max-Age=0']);
      }
      const wantsDemo = url.searchParams.get('demo') === '1' || readCookie(request, 'bod_demo') === '1';
      if (wantsDemo) {
        return withCookies(await asset(), ['bod_demo=1; HttpOnly; Secure; Path=/; SameSite=Lax', 'bod_mode=demo; Path=/; SameSite=Lax']);
      }
      return Response.redirect(`${env.APP_URL}/login`, 302);
    }

    // everything else → static assets (landing at /, login at /login)
    return env.ASSETS.fetch(request);
  }
};

/* ─────────────────────────── auth ─────────────────────────── */

async function login(request, env, url) {
  const body = await safeJson(request);
  const email = normEmail(body && body.email);
  // Always answer 200 — never reveal whether an address exists / is valid.
  if (!email) return json({ ok: true });

  // light anti-spam: one link per email per 60s
  const recent = await env.DB
    .prepare('SELECT expires_at FROM magic_tokens WHERE email = ? ORDER BY expires_at DESC LIMIT 1')
    .bind(email).first();
  const now = Math.floor(Date.now() / 1000);
  if (recent && (recent.expires_at - TOKEN_TTL) > (now - 60)) return json({ ok: true });

  const raw = randomToken();
  const hash = await sha256hex(raw);
  await env.DB
    .prepare('INSERT OR REPLACE INTO magic_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(hash, email, now + TOKEN_TTL).run();

  const link = `${env.APP_URL}/api/auth?token=${raw}`;
  await sendMagicLink(env, email, link);
  return json({ ok: true });
}

async function authCallback(request, env, url) {
  const raw = url.searchParams.get('token') || '';
  const hash = await sha256hex(raw);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB
    .prepare('SELECT email, expires_at FROM magic_tokens WHERE token_hash = ?')
    .bind(hash).first();

  // single-use: always delete whatever matched
  if (row) await env.DB.prepare('DELETE FROM magic_tokens WHERE token_hash = ?').bind(hash).run();

  if (!row || row.expires_at < now) {
    return htmlResponse(`<h1>Link expired</h1><p>Magic links last 15 minutes and work once. Please request a new one.</p><p><a href="/login">Back to sign in</a></p>`, 400);
  }

  const sid = randomToken();
  await env.DB
    .prepare('INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)')
    .bind(sid, row.email, now + SESSION_TTL).run();

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/app',
      'Set-Cookie': `${COOKIE}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`
    }
  });
}

async function logout(request, env) {
  const sid = readCookie(request, COOKIE);
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return new Response(null, {
    status: 200,
    headers: { 'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` }
  });
}

async function whoami(request, env) {
  const s = await sessionOf(request, env);
  return json({ email: s ? s.email : null });
}

/* ─────────────────────────── state ─────────────────────────── */

async function getState(request, env) {
  const s = await sessionOf(request, env);
  if (!s) return json({ error: 'unauthorized' }, 401);
  const row = await env.DB
    .prepare('SELECT data, updated_at FROM family_state WHERE email = ?')
    .bind(s.email).first();
  if (!row) return json({ data: null });
  return json({ data: JSON.parse(row.data), updated_at: row.updated_at });
}

async function putState(request, env) {
  const s = await sessionOf(request, env);
  if (!s) return json({ error: 'unauthorized' }, 401);

  const text = await request.text();
  if (text.length > MAX_BLOB) return json({ error: 'too_large' }, 413);

  // server-side trust boundary: it must be valid JSON with a children array.
  let parsed;
  try { parsed = JSON.parse(text); } catch { return json({ error: 'bad_json' }, 400); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.children)) {
    return json({ error: 'bad_shape' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('INSERT INTO family_state (email, data, updated_at) VALUES (?, ?, ?) ' +
             'ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(s.email, JSON.stringify(parsed), now).run();

  return json({ ok: true, updated_at: now });
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function sessionOf(request, env) {
  const sid = readCookie(request, COOKIE);
  if (!sid) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare('SELECT email, expires_at FROM sessions WHERE id = ?')
    .bind(sid).first();
  if (!row || row.expires_at < now) return null;
  return { email: row.email };
}

async function sendMagicLink(env, email, link) {
  const subject = 'Your Bank of Dad sign-in link';
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">
       <h2 style="color:#1C2733">Sign in to Bank of Dad</h2>
       <p style="color:#47566A">Tap the button below to sign in. This link works once and expires in 15 minutes.</p>
       <p><a href="${link}" style="display:inline-block;background:#1C2733;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Sign in</a></p>
       <p style="color:#8A94A3;font-size:13px">If you didn't request this, you can ignore this email.</p>
     </div>`;
  const text = `Sign in to Bank of Dad (link works once, expires in 15 min):\n${link}`;

  // Resend REST API — works on the free Workers plan, no binding needed.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [email], subject, html, text })
  });
  if (!res.ok) {
    // Don't leak details to the client; log for the operator.
    console.error('email_send_failed', res.status, await res.text());
  }
}

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

function normEmail(e) {
  if (typeof e !== 'string') return null;
  const t = e.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

async function safeJson(request) { try { return await request.json(); } catch { return null; } }

function withCookies(resp, cookies) {
  const h = new Headers(resp.headers);
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function htmlResponse(inner, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1C2733">${inner}</body>`,
    { status, headers: { 'Content-Type': 'text/html' } });
}
