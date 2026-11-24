# Put Life OS online (free): phone + laptop, same data

You'll create three free accounts, in this order: **MongoDB Atlas** (database), **GitHub** (holds the code), **Render** (runs it). About 20 minutes. Prices and limits on free tiers can change, so glance at each site's pricing page as you sign up.

```
phone ─┐                          ┌─ Render web service (Express API + the app)  ─── MongoDB Atlas (free cluster)
laptop ─┴── https://life-os-xxxx.onrender.com ─┘      protected by your API_KEY
```

## Before you start
1. In the app on the laptop: **Settings → Export backup**. Keep that file. (If a device already has data, this is your safety net.)
2. Decide which device has your **real data**. Connect that one **first** (step D), so the empty ones copy from it, not the other way round.

## A. MongoDB Atlas (database)
1. Sign up at mongodb.com/cloud/atlas → create a project → **Build a database** → pick the **Free** tier. For Bengaluru, an **AWS · Mumbai (ap-south-1)** region is closest.
2. **Database Access → Add user.** Choose a username + an auto-generated password and **copy the password**. Role: *Read and write to any database*.
3. **Network Access → Add IP address → Allow access from anywhere (0.0.0.0/0).** Render's free plan has no fixed address, so this is required. Your data stays protected by the database password **and** your API key.
4. **Database → Connect → Drivers.** Copy the connection string. It looks like
   `mongodb+srv://USER:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`
   Then edit it: replace `<password>` with your password, and put the database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/life-os?retryWrites=true&w=majority`
   If the password has symbols like `@ : / #`, either regenerate one with only letters and numbers, or URL-encode it.

## B. GitHub (private repository)
1. On github.com create a **new private repository** named `life-os` (leave it empty: no README, no .gitignore).
2. In a terminal in the project folder (I can run these for you; just say so):
   ```powershell
   git init
   git add .
   git commit -m "Life OS"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/life-os.git
   git push -u origin main
   ```
   `.gitignore` already keeps `node_modules`, `dist` and `.env` out. Nothing secret is in the code.

## C. Render (runs the server)
1. Sign up at render.com **with GitHub**, then **New → Blueprint** → select the `life-os` repo. Render reads `render.yaml`.
2. It asks for two secrets:
   - `MONGODB_URI` — the string from step A4.
   - `API_KEY` — a long random string. Generate one:
     ```powershell
     node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
     ```
     **Save it in a password manager.** You'll paste the same key into the app.
3. **Apply.** The first build takes a few minutes. When it's live you get an address like `https://life-os-xxxx.onrender.com`.
4. Check it: open `https://life-os-xxxx.onrender.com/api/health`. You want `{"ok":true,"db":true}`.
   - `db:false` → the connection string, password or the 0.0.0.0/0 rule in step A is wrong (see Troubleshooting).
   - If the service won't start and the log says "Refusing to start", the `API_KEY` (16+ characters) or `MONGODB_URI` is missing.

## D. Connect your devices
1. On the device with your real data, open the Render address → **Settings → Data & sync** → paste the **API key** → **Save & reconnect**. The sidebar should say **Synced to MongoDB**.
2. Open the same address on the next device (phone), paste the same key, **Save & reconnect**. It downloads your data. A one-slot copy of anything that was on that device is kept as a safety backup in the browser.
3. **Install on the phone:** Chrome ⋮ → **Install app** (or **Add to Home screen**). Over HTTPS this is a real app that also works offline.

## How sync behaves
- Changes upload about a second after you make them. Other devices pick them up when you open or return to the app (and once a minute while it's open).
- Last write wins on the whole data set. Let a device finish syncing before you switch to the other. Don't edit on both at once while one is offline.
- The free Render server **sleeps after ~15 minutes idle**. The first open after a quiet spell can take up to a minute; the app works from the phone's own data meanwhile and syncs when the server wakes.
- Atlas may pause idle free clusters; resume it from the Atlas dashboard if sync stops.

## Updating the app later
Change code → `git add . && git commit -m "…" && git push`. Render redeploys automatically.

## Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| Sidebar: **API key needed** | Wrong or missing key in Settings → paste again → Save & reconnect. It must match Render's `API_KEY` exactly. |
| `/api/health` shows `db:false` | Atlas: user/password wrong, `<password>` not replaced, database name missing, or Network Access isn't 0.0.0.0/0. Fix `MONGODB_URI` in Render → Environment → redeploy. |
| Stuck on **Connecting…** | Server is waking up. Wait up to a minute; it retries on its own. |
| **Sync error** | Open `/api/health`; check Render logs (Dashboard → Logs). |
| A device shows old data | Open the app and wait a few seconds, or reload. If it still looks wrong, Settings → Import backup from your export. |

## Security notes
- There is no login screen. The **API key** is the lock: anyone with the address can see the empty app, but cannot read or change data without the key. Keep it private; change it in Render (and in each device's Settings) if it leaks.
- Everything travels over HTTPS on Render.
