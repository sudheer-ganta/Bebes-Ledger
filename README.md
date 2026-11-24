# Life OS

A personal budget, food, fitness and **daily-crisis** companion. React + TypeScript + Tailwind frontend that works instantly from `localStorage`, plus an Express + Mongoose API that mirrors your data to MongoDB when it is running.

## Run it

```powershell
npm run setup        # once: installs root, client and server dependencies
npm run dev:web      # frontend only → http://localhost:5173  (works with zero backend)
npm run dev          # frontend + API together (API needs MongoDB, see below)
```

- **No MongoDB?** Just use `npm run dev:web`. Everything saves in the browser.
- **With MongoDB:** copy `server/.env.example` to `server/.env`, set `MONGODB_URI` (local `mongodb://127.0.0.1:27017/life-os` or a free Atlas string), then `npm run dev`. The header/sidebar shows **Synced to MongoDB** once connected. If the server or database is down the app silently keeps working locally and syncs when it comes back.
- **On your phone (same Wi-Fi):** run `npm run phone`. It builds the app, serves it on your network, and prints a URL and a QR code. Scan the QR with the phone camera, then use the browser menu → *Add to Home screen*. The laptop has to stay on and running that command. Your phone keeps its **own** data (browser storage is per device): to move data across, use Settings → *Export backup* on one device and *Import backup* on the other, or turn on the MongoDB sync below. Over plain `http://` on Wi-Fi the install is a home-screen shortcut and offline mode is off; both need HTTPS (a hosted deploy).
- **Anywhere, with phone + laptop in sync (free):** follow **[DEPLOY.md](DEPLOY.md)**. One Render web service runs the API and serves the app, with a free MongoDB Atlas database behind it, protected by an `API_KEY`. The server refuses to start in production without one.

## What is in it

| Area | Highlights |
|---|---|
| **Today's Command Center** | Safe-to-spend today, daily safe limit, 3 live buckets, 1-tap expense chips, priority to-dos, habits, hydration, steps, gym focus, meals, first-run setup |
| **₹ Wallet, Debt & Pool** | decreasing pocket pool (per day and per week) split Groceries / Lifestyle / Buffer in the 48 : 32 : 20 ratio, salary waterfall with fixed savings, debt payoff with *Log Debt Payment*, Sunday sweeps, overspend analytics, expense log |
| **Groceries & Nutrition** | 4-week pan + kettle + egg-boiler rotator (₹600/week cap; **you enter the prices**, they're remembered per item), *In Kitchen Stock*, *Out of Stock → auto restock task*, *Checkout Week's Groceries*, appliance-tagged meal log |
| **Smart To-Do** | 5 contexts × 3 priorities, priority matrix, carry-over button, auto tasks (restock, rent/debt/bills, payday, Sunday review, evening steps/water nudge) |
| **Gym, Steps & Hydration** | Mon–Sun split with sets/reps/weight + last-best hint, 2.75 L water, 9,500 steps (gym walk credits 5,500) |
| **Consistency Calendar** | Month grid scored on 5 pillars (Move · Water · Steps · Spend · Fuel), current/best streak, 12-week heatmap, per-habit consistency, tap any day to review or backfill it |
| **Daily Journal** | Mood, energy, wins, struggles, tomorrow's top 3, auto "day at a glance" |
| **SOS · Crisis Mode** | Four one-tap crisis flows (below) |

### The crisis layer (new)

1. **Money running out** — compares survival-food cost (₹74/day) to your pool and days to payday, tells you the exact shortfall or spare, **Survival budget** toggle freezes lifestyle spending, and a last-resort top-up from savings.
2. **Surprise expense** — pick how to fund it (buffer first / all savings / spread over the pool), see before-and-after for pool, buffer, daily limit and savings, and get an auto recovery task.
3. **Bad day / missed routine** — **Minimum Viable Day** lowers steps to 5,500, water to 2 L, gym to a 15-min mobility reset, to-dos to the top 3, and **keeps your streak alive**. "Can't train today" moves the session to tomorrow.
4. **Food crisis** — cheapest-protein meals you can make with only the three appliances, filtered by budget and protein, one-tap logging.

A **crisis radar** on Today opens the right flow automatically when the pool runs low, no meal is logged by 2 PM, or a day looks derailed after 5 PM.

## Chat bot (WhatsApp / Telegram)

Send `@spent 120 auto`, `@water 500`, `@task buy soap tomorrow`, `@today`… from WhatsApp or Telegram and the app updates. Setup and the full command list are in **[BOT.md](BOT.md)** (needs the online deploy first).

## Salary: nothing is allocated until it actually lands

The app starts in **Waiting for salary**: pool ₹0, no daily limit, no overdue bills or overspend alerts, just a countdown to payday and a preview of the plan. When your pay arrives (the 7th), tap **My salary has arrived**, enter the real amount and date, check the allocation preview, and confirm. Only then does the month start.

Allocation order: **rent → recharge/gym/bills → debt installment → savings → pocket pool gets whatever is left.** Savings (₹5,000) and the debt installment are fixed and never move with the salary, so a bigger or smaller salary only changes the pocket pool (its three buckets scale proportionally), shown as a per-day and per-week amount. Only if the salary can't even cover the fixed items is savings trimmed, with a warning. After the debt is cleared, its installment flows into the pocket pool. The Wallet then shows each line with its own checkbox (rent paid, bills paid, debt installment logged, moved to savings). Use **Edit salary** to correct an amount. The salary in Settings is only the *expected* amount used for the preview.

## Numbers and the rules I chose

- Pay cycle runs **7th → 6th**. Everything (pool, days left, safe limit) resets on payday.
- `Daily Safe Limit = (pool remaining + today's discretionary spend) ÷ days left`. Today's spend **excludes the weekly grocery checkout and emergency/crisis entries**, otherwise every grocery run would trip the overspend alert.
- Overspend in Groceries or Lifestyle **spills into the Pool Buffer**, so the single ₹5,000 total is what matters. Personal expenses draw from Lifestyle Flex.
- **Sunday sweep:** each finished Mon–Sun week, unspent weekly allowance (buckets ÷ cycle length × days) moves to savings and leaves the pool. Weeks before your first use are never swept. Toggle in Settings.
- Pocket pool = salary − rent − bills − debt installment − savings (₹5,000 fixed). With your numbers: ₹25,160 − 9,500 − 3,000 − 2,000 − 5,000 = **₹5,660**, about ₹189 a day and ₹1,321 a week.
- **My assumptions, all editable in Settings:** rent due on the 10th, debt installment due on the 12th, recharge/gym/bills due on the 15th, protein target 95 g (≈1.8 g/kg), grocery prices are not pre-filled — you type what you pay.
- Meal costs, protein figures and food prices are estimates, not nutrition advice.

## API (Express + Mongoose)

`GET /api/health` · `GET /api/bootstrap` · `PUT /api/sync` (whole-state, last-write-wins on `updatedAt`) · `GET/PUT /api/config`
CRUD (`GET ?from&to`, `POST`, `PATCH /:id`, `DELETE /:id`): `expenses`, `tasks`, `debt-payments`, `pool-topups`, `sweeps`, `meals`, `grocery-checkouts`, `crisis-events`
Per-day (`GET`, `GET /:date`, `PUT /:date`): `day-logs`, `workouts`, `journal`

Set `API_KEY` in `server/.env` to require an `x-api-key` header (enter the same key in Settings → Data & sync). Schemas are in `server/src/models.ts`.

## Honest status

- Frontend: type-checks, builds, and every page and crisis flow was exercised in the browser (desktop and phone width).
- Backend: type-checks, boots, rejects invalid payloads, and the real app state passes its validation schema. **It has not been run against a live MongoDB**, because none was available when this was built. Run it once and check the sync indicator.
- Data is a single-user personal app: there is no login. If you deploy the API publicly, set `API_KEY` and use HTTPS.
