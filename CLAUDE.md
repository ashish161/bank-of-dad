# CLAUDE.md — Bank of Dad

Guide for any AI/agent session (or human) working on this project. Read this first.

## What this is
An India-adapted "Bank of Dad" allowance app that teaches kids compounding. A parent runs a
pretend bank: weekly allowance `₹100 × (age + 1)`, 10% APR practice interest, a coin jar that
fills as money grows. **No real money moves** — UPI is a deep link to the parent's own bank app.
Design spine: "flyer discipline" (one message, no clutter), no dark patterns, try-first.

## Golden rules (do not violate)
1. **No build step. Single-file app.** `bank-of-dad-app.html` is one self-contained HTML file
   (inline CSS/JS, ~240 KB). No bundler, no npm build. Same for landing pages.
2. **The CSP allows inline scripts only** (`script-src 'unsafe-inline'`, no `'self'`). So you
   **cannot** add external `<script src>` files to the app — inline everything. (This is exactly
   why the sync glue is inlined, not a separate file.)
3. **Render-to-verify before claiming a visual/behavioral fix.** Use the puppeteer harness in
   `/tmp/pw` (puppeteer-core + @sparticuz/chromium, `--no-sandbox`). Don't assert "it works" from
   reading code.
4. **Run the test suite after any engine change**, and **add new engine functions to the
   extractor** or the suite breaks (see Testing).
5. **Never commit secrets.** `RESEND_API_KEY` is a Cloudflare Worker secret set via
   `wrangler secret put` — never in `wrangler.jsonc`, code, or the repo. (`database_id` in
   `wrangler.jsonc` is NOT a secret; it's fine to commit.)
6. **Edits are surgical.** Use exact-match string replacement with a uniqueness assertion
   (Python `rep(old,new,n)` pattern), not broad regex sweeps, on the 240 KB file.
7. **Versioning + archiving is sacred.** Bump the `Build vX.Y.Z` tag, update `CHANGELOG.md`, run
   `make-archive.sh`. `bank-of-dad-STABLE-*.zip` archives are **never** overwritten.

## Two codebases (important)
- **Canonical workspace** (`/mnt/user-data/outputs/`): the source of truth — `bank-of-dad-app.html`,
  the landing variants, `tests/`, all `*.md` docs, `make-archive.sh`, archives.
- **Deployed repo** (`backend/`, pushed to GitHub, connected to Cloudflare): a *subset* — the
  Worker, D1 schema, config, and **copies** of the app/landing with deploy glue inlined. It does
  **not** contain the test harness. Do not treat the deploy copy as canonical.

### Regenerating the deploy copy from canonical (after app/landing changes)
```
cp bank-of-dad-app.html backend/public/app/index.html
# inline the demo/sync glue before </body>, NEUTRALISING any </script> in it:
#   js = open('/tmp/inline.js').read().replace('</script>', '<\\/script>')
sed 's#href="/app"#href="/app?demo=1"#g' landing-napkin.html > backend/public/index.html
```
The inline glue is path/cookie-aware (see Backend → demo/real model). **Gotcha:** an inlined
script containing a literal `</script>` (even in a comment) will terminate the block early in the
browser — always neutralise it.

## The app — architecture & invariants
- **Client-only, localStorage.** Key: `bankOfDad.state.v1` (real) or `bankOfDad.demo.v1` (demo).
  `STORAGE_KEY` is chosen from a readable `bod_mode=demo` cookie the Worker sets; absent the cookie
  (standalone/static hosting), it's the real key.
- **State shape** (what `serializeState` emits / `parseBackup` reads):
  `{ v:1, children:[...], settings, tasks, pending }`. `children` is a top-level array — the
  backend's `putState` validates exactly this.
- **Security invariants (keep intact):**
  - `sanitizeState()` is the single trust gate — called on BOTH `loadState` and `parseBackup`.
    Whitelists settings keys (kills prototype pollution), clamps numbers, validates enums, caps
    arrays (≤30 children, ≤5000 entries, ≤200 pending).
  - `esc()` on every rendered user string (element + attribute escaping).
  - `safeIdStr()` for any id interpolated into an `onclick`.
  - UPI links built with `URLSearchParams` (injection-safe); backup export via `encodeURIComponent`.
  - `warn(err, where)` replaces empty catches (errors surface in console; `saveState` failure also
    toasts the user).
- **Idempotency:** `hasPendingAllowance(pending, childId)` guards `payAllowance` so a duplicate
  top-up can't be queued (multi-tab / UPI-return race). Pure + unit-tested.
- **Modal a11y:** `activateModal(el, closeFn)` / `deactivateModal()` give all four overlays
  `role=dialog` + focus trap + Escape + focus restore. `:focus-visible` outline is global.
- **Themes:** 5 (aurora, vault, passbook, classic, playful). Playful has the two-coin jar
  (`buildPlayfulJar`): gold = paid-in, green = earned; jar ladder `JAR_MILES`.

## Testing
Harness in `tests/` (mirror runs in `/tmp/bod-tests/`):
```
cd /tmp/bod-tests
cp /mnt/user-data/outputs/bank-of-dad-app.html .
node extract-engine.js   # slices engine funcs out of the HTML → engine.gen.js
node test.js             # 242 assertions, incl. 14 security + H1 idempotency
```
- `extract-engine.js` has a WANTED list of `{type:'func'|'const', name}`. **If you add or rename an
  engine function/const that another engine function references, add it here or the suite breaks.**
- `jar-audit.js` checks jar math; `stryker.conf.mjs` is mutation testing (optional).
- Puppeteer render checks live in `/tmp/pw` — use for DOM/visual/behavioral verification.

## Versioning & archiving
- Build tag lives in the app as `Build vX.Y.Z` (+ a `build tag:` comment). `make-archive.sh` reads
  it and produces `bank-of-dad-vX.Y.Z-full-YYYYMMDD.zip`.
- STABLE: drop the `-dev` suffix, tag `vX.Y.Z (STABLE)`, and keep a durable
  `bank-of-dad-STABLE-vX.Y.Z-YYYYMMDD.zip` (never overwritten).
- Current: **v2.2.6** (cookie-driven STORAGE_KEY; last STABLE was v2.2.3).

## Landing pages
- Canonical: `landing-napkin.html` (graph-paper "napkin math", red-pen crossover marker). Also
  copied to `bank-of-dad-landing-v2.html` and the deploy `public/index.html`.
- Candidate: `landing-jobs.html` (Apple-style flyer). Variants a/b/c/d exist; **M4 in the audit =
  pick one canonical and retire the rest.**
- All share an interactive chart: a "start age" slider drives paid-in vs earned areas and marks
  the crossover (the week weekly-interest ≥ weekly-allowance). Contrast fixed to WCAG AA; has
  `aria-live` + `prefers-reduced-motion`.

## Backend (`backend/`, Cloudflare)
- **Stack (all free tier):** Workers + D1 + Resend. See `DEPLOY.md`.
- **Worker** (`src/worker.js`) routes: `POST /api/login`, `GET /api/auth` (magic-link callback →
  session cookie → `/app`), `GET|PUT /api/state`, `POST /api/logout`, `GET /api/me`, plus the
  `/app` gate.
- **D1 tables:** `magic_tokens` (SHA-256 hash, 15-min, single-use), `sessions` (30-day cookie),
  `family_state` (one JSON blob per email).
- **Demo/real model (one app file, session decides):**
  - Worker gates `/app`: session → serve + set `bod_mode=real`; `?demo=1`/`bod_demo` cookie →
    serve + set `bod_mode=demo`; neither → redirect `/login`.
  - App reads `bod_mode` to pick storage bucket + demo banner; inline glue syncs only when real.
  - Demo data is throwaway in its own bucket.
- **wrangler.jsonc must have** `run_worker_first: ["/api/*", "/app", "/app/*"]` (or the gate is
  bypassed) and `APP_URL` exactly matching the deployed URL.
- **Security:** token hashed + single-use + short TTL; HttpOnly/Secure/SameSite=Lax session;
  every state query scoped `WHERE email = <session>`; server re-validates the blob (≤1 MB + shape).
- **Known limits (v1):** last-write-wins across devices (upgrade = append-only entry-list merge);
  emailing arbitrary families needs a verified Resend domain (self-test works on `onboarding@resend.dev`).

## Gotchas that have bitten us
- **CSP blocks external scripts** → inline only (see Golden rule 2). A blocked `/sync.js` was why
  `family_state` stayed empty despite login working.
- **Inlined `</script>`** terminates the script early — neutralise to `<\/script>`.
- **Magic-link session lives in the browser that opened the link.** If email opens an in-app
  browser, the app in Safari won't see the session. Open the link in the app's browser.
- **iOS deploy friction:** the Cloudflare drag-drop only does static assets; the backend needs
  `wrangler` on a computer. Zip download on iOS is fiddly (use Browse → Google Drive in the picker,
  or a laptop).
- **Extractor drift:** forgetting to register a new engine function in `extract-engine.js` breaks
  the suite with confusing errors.

## Status / open items (from AUDIT-REPORT.md)
Done: H1 (idempotent top-up), H2 (modal a11y), M2 (aria-live), L1–L4. Backend built + deployed
(magic-link + demo/real sync). Open: **M1** (multi-tab storage listener), **M3** (PII handling for
Phase 1), **M4** (choose napkin vs jobs), and §7 (harden the backend before wider launch:
rate-limiting, entry-merge, PII-at-rest). See `AUDIT-REPORT.md`, `PHASE-1-PLAN.md`, `CHANGELOG.md`.
