# Deploying so-study

The app is no longer localhost-only. This document is the runbook for putting it
on the internet for **exactly two trusted people** — me and one other student who
uses it as an installed standalone PWA on an iPad.

It is deliberately not a guide to running a product. There is no signup, no
onboarding, no billing, no roles.

---

## 1. Why PostgreSQL (and not Turso)

The app used to store everything in `prisma/dev.db`, a local SQLite file. That is
what made it un-deployable, not merely inconvenient: a serverless function's
filesystem is ephemeral and per-instance, so every cold start would have served a
different, empty database and every write would have been thrown away.

Two hosted options were on the table. **Postgres won on friction:**

| | Postgres (Neon / Vercel Postgres / Supabase) | Turso (libSQL) |
| --- | --- | --- |
| Prisma change | `provider = "postgresql"` + a URL | driver adapter + `driverAdapters` |
| New dependencies | **none** | `@libsql/client`, `@prisma/adapter-libsql` |
| Client construction | unchanged (`new PrismaClient()`) | hand-built adapter wiring |
| Migrations | `prisma migrate deploy` | mostly `db push` / Turso CLI |

Since the whole mission constraint was "no heavy deps", the option that needs
**zero** new packages and no preview features wins. The schema is otherwise
identical, so switching later is a datasource change, not a rewrite.

### Migration history was re-baselined

Switching provider invalidates a SQLite migration history — the old SQL will not
run on Postgres. Per Prisma's own guidance the history was replaced with a single
baseline:

```
prisma/migrations/20260822000000_postgres_baseline_tenancy/migration.sql
prisma/migrations/migration_lock.toml   # provider = "postgresql"
```

The old SQLite migrations remain in git history. Nothing is lost; there is simply
no longer a path that pretends to migrate one engine into the other.

---

## 2. Provision the database

Any managed Postgres works. On Vercel, the one-click Postgres/Neon integration
sets `DATABASE_URL` for you.

You will typically get **two** connection strings:

- a **pooled** one (`…-pooler…`) — put this in `DATABASE_URL`. Serverless opens
  many short-lived connections and will exhaust a direct connection limit.
- a **direct** one — use this for migrations. `prisma migrate deploy` takes an
  advisory lock, which PgBouncer in transaction mode does not support.

```bash
# once, from your laptop, against the DIRECT url
DATABASE_URL="<direct url>" npm run db:deploy
```

Confirm it worked from anywhere (this endpoint is intentionally public and
content-free):

```bash
curl -s https://<your-deployment>/api/health
# {"ok":true,"db":"up","users":2,"latencyMs":42,"checkedAt":"…"}
```

`ok:false` means the instance cannot reach the database. `users:0` means the DB is
healthy but nobody can log in yet — go to step 4.

---

## 3. Environment variables

Copy `.env.example`. The ones that are new and non-obvious:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | pooled Postgres URL |
| `SESSION_SECRET` | **yes** | `openssl rand -base64 48`. Auth fails **closed** without it — every request is rejected, including yours. Rotating it signs everyone out. |
| `GEMINI_API_KEY` | for AI | server-side only, never `NEXT_PUBLIC_` |
| `AI_DAILY_COST_LIMIT_USD` | no (default `1.00`) | hard cap, checked before every paid call |
| `AI_MONTHLY_COST_LIMIT_USD` | no (default `20.00`) | hard cap |
| `AI_BUDGET_TIMEZONE` | no (default `Asia/Jakarta`) | when the windows reset |
| `CRON_SECRET` | **yes in production** | `/api/cron/*` and `/api/push/send` are exempt from the session gate because Vercel cron sends no cookie. This secret is the only thing guarding them. |

---

## 4. Create the users (there is no signup)

```bash
npm run db:seed -- habel "a-long-passphrase-here" "Habel"
npm run db:seed -- dini  "her-own-long-passphrase" "Dini"
```

- Re-running with the same name **rotates** that user's passphrase; it does not
  create a duplicate.
- Minimum 12 characters, enforced by the seeder. `/api/auth/login` is public by
  necessity, so the passphrase is the entire attack surface.
- Passphrases are stored as PBKDF2-SHA256 (600k iterations, per-user salt). They
  are never logged and cannot be recovered — only replaced.

Each user logs in with **their own** passphrase, and that is also what identifies
them: the login form has exactly one field, so on an iPad it is one Keychain
autofill instead of a username plus password on a touch keyboard.

---

## 5. Move the old SQLite data across (optional, one shot)

The pre-deploy study work (modules, approved papers, excerpts, chunk embeddings,
cost history) is real and cost paid Gemini calls, so there is an importer:

```bash
node scripts/import-sqlite.mjs prisma/dev.db --owner habel
```

- Reads the SQLite file through Node's built-in `node:sqlite` (no dependency) and
  writes through Prisma inside one transaction — a partial import that leaves
  modules without their papers is worse than no import.
- Assigns **every** imported row to the named owner, because the old schema had no
  concept of ownership.
- Skips ids that already exist, so an interrupted run can simply be repeated.
- Deliberately does **not** import `Settings` (its primary key is now the user) or
  `PushSubscription` (per-device credentials must be re-granted from the installed
  app).

---

## 6. Deploy

`vercel.json` is unchanged and still deployable — it only declares the two crons:

```json
{ "crons": [
  { "path": "/api/cron/daily-reminder", "schedule": "1 1 * * *" },
  { "path": "/api/push/send",          "schedule": "0 13 * * *" }
] }
```

`npm run build` runs `prisma generate && next build` so the client is always
generated from the committed schema during the platform build.

---

## 7. Install on the iPad

1. Open the **HTTPS** deployment in Safari (an install from a plain-http LAN origin
   will not go standalone).
2. Log in.
3. Share → **Add to Home Screen**.
4. Launch from the home screen: there must be **no address bar**.

`/manifest.webmanifest`, `/sw.js` and the icons are exempt from the auth gate on
purpose — Safari fetches the manifest **without credentials**, and if it redirected
to `/login` the install would silently degrade back to a plain bookmark.

---

## 8. Working locally without a cloud database

There is no SQLite fallback any more (one schema, one provider). Two options:

**a. Point at the hosted database.** Simplest; what `vercel env pull` gives you.

**b. Run a throwaway local Postgres with no root and no Docker.** The relocatable
binaries published for embedded testing work fine:

```bash
mkdir -p /tmp/pg && cd /tmp/pg
curl -sSL -o pg.jar https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/16.4.0/embedded-postgres-binaries-linux-amd64-16.4.0.jar
unzip -q pg.jar -d jar && mkdir -p dist && tar -xJf jar/postgres-linux-x86_64.txz -C dist
export LD_LIBRARY_PATH=/tmp/pg/dist/lib
dist/bin/initdb -D data -U sostudy --auth=trust -E UTF8 --locale=C
dist/bin/postgres -D data -p 5433 -k /tmp/pg -c listen_addresses=127.0.0.1 &
```

then

```bash
DATABASE_URL="postgresql://sostudy@127.0.0.1:5433/postgres?schema=public"
npm run db:deploy && npm run db:seed -- you "a-long-passphrase-here"
```

This is exactly how the Postgres migration in this release was verified before any
cloud account existed: real server, real `migrate deploy`, real data import.

---

## 9. Auth model, stated plainly

Two layers, because one of them is a regex:

1. `proxy.ts` (this Next.js version renamed `middleware` → `proxy`) verifies the
   cookie **signature** at the edge and turns an unauthenticated page request into
   a redirect to `/login?next=…` and an unauthenticated `/api/*` request into a
   `401`. No database, no Prisma — per the framework docs, proxy code runs outside
   the app's module graph.
2. **Every** route handler independently calls `requireUser(req)`
   (`src/lib/tenancy.ts`), which re-verifies the signed cookie and returns the
   user id. Route handlers trust **no request header** — a route stays safe even if
   it is ever reached outside the proxy's matcher.

`app/api/route-guard.test.ts` walks the filesystem and fails the build if any
route file is missing that call, or if a route touches `Course`/`Topic`/`Module`
without mentioning `ownerId`. Making a route public requires declaring it in
**both** the test's allowlist and `proxy.ts`.

Sessions are stateless signed tokens (HMAC-SHA256 over `userId` + expiry, 90-day
TTL) rather than a sessions table: with two users a table would only add a query
per request and a revocation story nobody will use. The trade is explicit — a
stolen token stays valid until it expires, and `SESSION_SECRET` rotation is the
global revoke.

**What this stops:** the open internet reading and writing the previously
world-writable API, and either student seeing the other's data.
**What it does not stop:** anyone who has a passphrase or can read
`SESSION_SECRET`. There is no second factor and no device binding.

---

## 10. Tenancy model

`ownerId` sits on `Course`, `Topic` and `Module` (`Topic.ownerId` and
`Module.ownerId` are denormalized from their parent so authorization is one hop,
not a join up to `Course`). Everything else is scoped through its parent
relation — `where: { topic: { ownerId } }`, `where: { module: { ownerId } }`.

Two deliberate exceptions:

- **`Paper` is global.** Papers are deduplicated across topics *and* users and
  hold no private data. The `TopicPaper` join is what gets scoped.
- **`AIUsage` is global.** It tracks one shared Gemini key and one wallet, so the
  budget cap must see all spend regardless of who caused it.

`Course.name` is no longer globally unique — it is `@@unique([ownerId, name])`.
Both students can study "Antropologi Ekologi" without colliding, and neither can
discover the other's course list through a name conflict.

Ownership is enforced by folding `ownerId` into the query that was already being
run (`findFirst({ where: { id, ownerId } })`), never by a separate "am I allowed?"
round-trip: one query cannot drift out of sync with itself. A row that is missing
**or** not yours returns **404**, never 403 — a 403 confirms that a guessed id is
real.
