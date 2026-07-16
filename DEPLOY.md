# Bank of Dad — backend deploy guide

Magic-link sign-in + cross-device save, on a **fully free** stack:
**Cloudflare Workers (free) + D1 (free) + Resend (free)**. No paid plan required.

> **You need a computer once** for setup — it uses the `wrangler` command (create a database,
> set a secret, deploy code). This can't be done from the iPhone drag-drop, which only handles
> static files. After the first deploy, every update is a single `npx wrangler deploy`.

---

## What you're deploying

- **One Worker** (`src/worker.js`) with these routes:
  - `POST /api/login` — email a one-time sign-in link
  - `GET  /api/auth` — verify the link, set a 30-day session cookie, → `/app`
  - `GET  /api/state` / `PUT /api/state` — load / save this family's JSON blob
  - `POST /api/logout`, `GET /api/me` — sign out, who-am-I
  - plus routing that gates `/app` and serves the demo
- **One D1 database** with 3 tables: `magic_tokens`, `sessions`, `family_state`.
- **Static files**: the landing (`/`), the sign-in page (`/login`), and the app (`/app`).
- **Email** via Resend (a few lines of `fetch` — no binding, no paid plan).

The sync glue is **inlined into the app** (not a separate file) so it runs under the app's
Content-Security-Policy without loosening it.

---

## The demo / sign-in model (one app file, no duplication)

The **session decides the mode** — there is no separate demo copy of the app:

- **Landing "Try it"** → `/app?demo=1` → **demo mode**: a "Demo — nothing is saved" bar, a
  throwaway local storage bucket, no server sync.
- **`/login`** → email sign-in **and** a "try the demo" link.
- **`/app`** →
  - has a session → **real app** (loads/saves the family on the server),
  - chose demo → **demo mode**,
  - neither → **redirected to `/login`**.
- The Worker sets a readable `bod_mode` cookie (`real` / `demo`) so the single app file knows
  which mode to run. Demo data lives in its own bucket and is throwaway (it does not carry into
  a real account).

---

## One-time setup (≈15 min on a computer)

You can run every command with `npx wrangler …` (no install needed), or install it once with
`npm install -g wrangler`. Unzip this bundle and run the commands from inside the `backend/` folder.

### 1. Sign in to Cloudflare
```
npx wrangler login
```

### 2. Create the database and load the tables
```
npx wrangler d1 create bank-of-dad
```
Copy the printed `database_id` into **wrangler.jsonc** (replace `PASTE_DATABASE_ID_HERE`). Then:
```
npx wrangler d1 execute bank-of-dad --remote --file=schema.sql
```

### 3. Set up Resend (free email)
1. Sign up at **resend.com** (free tier: 100 emails/day, 3,000/month — no paid plan).
2. Create an **API key**.
3. Store it as a Worker secret:
   ```
   npx wrangler secret put RESEND_API_KEY
   ```
   (paste the key when prompted)

**Sending address — important:**
- **Test to yourself right now:** leave `RESEND_FROM` as `onboarding@resend.dev` (already set).
  Resend's onboarding sender can email **your own Resend account address**.
- **Email other families:** verify a sending domain in Resend (add its DNS records — easy if the
  domain is on Cloudflare), then set `RESEND_FROM` to e.g. `Bank of Dad <noreply@yourdomain.com>`.
  This is an anti-spam requirement, **not** a paywall.

### 4. Point the app at your URL
In **wrangler.jsonc**, set `APP_URL` to your exact deployed URL, e.g.
`https://bank-of-dad.<you>.workers.dev`. The magic link and redirects are built from this, so it
must match exactly (no trailing slash).

### 5. Deploy
```
npx wrangler deploy
```

---

## Test the whole loop
1. Open the landing, tap **Try it** → you land in `/app` with a "Demo — nothing is saved" bar.
   Add a child; it is **not** saved server-side (demo bucket only).
2. Go to `/login`, enter your (Resend-account) email, tap **Email me a link**.
3. Open the email, tap **Sign in** → redirected to `/app`, now signed in (no demo bar).
4. Add a child / top up → reload → still there (it round-tripped through the server).
5. Sign in on a **second device with the same email** → the same family appears.

Verify server writes any time with:
```
npx wrangler d1 execute bank-of-dad --remote --command "SELECT email, updated_at, length(data) FROM family_state;"
```

---

## Updating later
Any change (app, landing, worker) → re-run from `backend/`:
```
npx wrangler deploy
```
Schema changes → re-run the `d1 execute … --file=schema.sql` step (the `CREATE TABLE IF NOT EXISTS`
statements are safe to run again).

---

## How it stays safe (short version)
- The emailed token is random, stored only as a **SHA-256 hash**, **single-use**, **15-min** expiry.
- The session is an opaque id in an **HttpOnly, Secure, SameSite=Lax** cookie (30 days).
- Every state read/write is scoped **`WHERE email = <your session>`** — one family can't see another's.
- The server **re-validates** the uploaded blob (≤1 MB, must be JSON with a `children` array) —
  it never trusts the client.
- No secrets in code; the Resend key lives only in `wrangler secret`.

## Known limits (deliberately simple v1)
- **Last-write-wins** across devices: two parents editing at the exact same moment can clobber one
  change. Fine for a pilot; the upgrade is an append-only entry-list merge later.
- Email throttled to one link per address per 60s; no broader rate-limiting yet.
- Emailing arbitrary families needs a verified sending domain (step 3).

## Troubleshooting
- **Login works but `family_state` stays empty.** In the app (signed in), open the browser console:
  - `fetch('/api/me',{credentials:'include'}).then(r=>r.json()).then(console.log)` — should show your email.
    If it's `null`, the session cookie isn't present in *this* browser (see next point).
  - If the console shows a **CSP error blocking a script**, you deployed an app build without the
    inlined glue — redeploy this bundle (the glue is inlined, there is no external `sync.js`).
- **Magic link doesn't sign the app in.** The session cookie lives in **whichever browser opened
  the link**. If your email app opens links in its own in-app browser, the app in Safari won't see
  the session. Open the link in the same browser you use the app in (long-press → Open in Safari).

## Files
- `wrangler.jsonc` — config (set `database_id`, `APP_URL`, `RESEND_FROM`)
- `schema.sql` — D1 tables
- `src/worker.js` — the Worker (auth, state API, `/app` gate, demo cookie)
- `public/index.html` — the landing (CTA → `/app?demo=1`)
- `public/login.html` — sign-in page (email + "try the demo")
- `public/app/index.html` — the app, with the sync/demo glue inlined
