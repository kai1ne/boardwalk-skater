# Boardwalk Skater leaderboard server

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) with a [D1](https://developers.cloudflare.com/d1/)
database that keeps the global all-time top 5. Everything in this folder is public; the three secrets live only in
Cloudflare's secret store and in two gitignored local files (`server/.env`, `server/.dev.vars`).

## Endpoints (JSON over HTTPS)

| | |
|---|---|
| `GET /top5` | `{ top5: [{ name, score, date }] }`, best first. Cached 5 s in each Worker instance. |
| `POST /start` | A signed run token `{ runId, startedAt, signature }` (HMAC-SHA256 with `RUN_SECRET`). |
| `POST /score` | `{ token, name, score, distance, trickCounts, claimedDurationSec, gameVersion }` → `{ ok, qualified, top5, rank }`. |
| `/admin/...` | `GET /admin/entries`, `DELETE /admin/entries/<id>`, `POST /admin/clear` with `{"confirm":"CLEAR"}`, `GET /admin/rejects`, `GET /admin/health` (today's write count against the cap, and whether Cloudflare passed the client IP header). Needs `Authorization: Bearer <ADMIN_SECRET>`. |

Errors come back as `{ error: "<code>", message }` with a 4xx/5xx status.

## Rules (see `src/config.js` for every number and why)

- **Run tokens:** the signature must match, the token is good for 30 minutes after `/start`, and each run posts once.
- **Time:** the server's own elapsed time must be at least the claimed play time minus 5 s.
- **Score ceiling:** `score ≤ 55,000 + 1,800 × t` (t = the shorter of elapsed and claimed time + 5 s), worked out from
  the game's energy, trick, combo and milestone values; a 10-minute autopilot run reaches about a quarter of it. Also no
  negative, fractional or absurd (over 5,000,000) scores, and no distance a clean run couldn't reach in the time.
  These checks stop impossible scores, not every exaggeration: the game runs in the player's browser, so a determined
  cheater could still post a high but plausible score.
- **Names:** 3–10 letters or numbers, trimmed, plus a basic profanity and slur blocklist (case-insensitive, with simple
  leetspeak). **No filter is perfect**: it misses creative spellings and can occasionally block an innocent name. Use
  the admin tools to remove anything that gets through.
- **Rate limits:** 10 run starts and 10 score posts per hour per client. The client IP (Cloudflare's
  `CF-Connecting-IP`) is hashed with a secret salt and the day; raw IPs are never stored, and the rows expire after
  two hours. Requests carrying the admin secret skip this (for testing).
- **Daily write cap:** 30,000 write operations per UTC day, then writes stop with `503 daily_limit` until midnight UTC,
  well before the D1 free tier's 100,000 rows written a day. Reading the board keeps working.
- **CORS:** only `https://kai1ne.github.io`, `https://boardwalk-skater.boardwalk-skater-leaderboard.workers.dev`,
  `https://boardwalk-skater.pages.dev` and `http://localhost:<port>` may call it from a browser; other origins get
  `403`. (CORS only binds browsers; scripts are covered by the token, limits and score checks.)
- **Stored:** name, score, time and game version per score, top 100 rows only. Rejected submissions are counted by day
  and reason (no names, scores or IPs) and also printed to the Workers logs.

## Setup (once)

You need Node.js and a free Cloudflare account (no card). From this folder:

```bash
npm install
npx wrangler login
npx wrangler d1 create boardwalk-leaderboard        # copy the database_id it prints into wrangler.jsonc
npx wrangler d1 execute boardwalk-leaderboard --remote --file=schema.sql
```

Secrets: generate them into the gitignored `.env` and pipe each one to Cloudflare, so they're never typed or shown:

```bash
umask 077; for k in RUN_SECRET IP_SALT ADMIN_SECRET; do echo "$k=$(openssl rand -hex 32)"; done > .env
for k in RUN_SECRET IP_SALT ADMIN_SECRET; do grep "^$k=" .env | cut -d= -f2 | npx wrangler secret put $k; done
npx wrangler deploy                                  # prints the workers.dev URL
echo "LEADERBOARD_URL=https://<your-worker>.workers.dev" >> .env
```

Then put that URL in `LEADERBOARD_URL` at the top of `game.js`.

## Admin

```bash
node admin.mjs list            # every entry with its id
node admin.mjs delete 42       # remove entry 42
node admin.mjs clear           # remove everything (asks you to type CLEAR)
node admin.mjs rejects         # rejected submissions by day and reason
```

Or use the Cloudflare dashboard: **Storage & Databases → D1 → boardwalk-leaderboard → Console**, and run SQL such as
`SELECT * FROM scores ORDER BY score DESC;` or `DELETE FROM scores WHERE id = 42;`.

## Testing

- `npx wrangler dev`: a local Worker and database at `http://localhost:8787`, using secrets from `.dev.vars`.
- `node test.mjs http://localhost:8787 .dev.vars`, or against the deployed URL with `.env`: checks every rule above
  and clears the board when it's done.

## Free-tier budget

Workers Free: 100,000 requests a day (then error 1027 until midnight UTC). D1 Free: 5 million rows read and 100,000
rows written a day, 5 GB. Neither bills on the free plan; they stop. Don't add a payment card to the account.
