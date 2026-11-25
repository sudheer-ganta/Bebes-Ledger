# Chat bot: update Life OS from WhatsApp or Telegram

Send a short message, the server updates your data, and replies with your numbers. Your phone and laptop pick the change up the next time the app is opened (and once a minute while open).

> **Needs the online version first** ([DEPLOY.md](DEPLOY.md)). Meta and Telegram have to reach a public HTTPS address; they can't reach your laptop.

## What you can send
A leading `@` is optional; `@spent 120 auto` and `spent 120 auto` do the same thing.

| Message | Does |
|---|---|
| `spent 120 auto` · `120 auto` · `chai 20` · `veg 150 #groceries` | Logs an expense. The category is guessed from the words (auto/ola/metro → Rides, chai/lunch/swiggy → Outside Food, veg/eggs/milk → Groceries, movie/date → Movies/Dates, otherwise Personal). Add `#groceries`, `#food`, `#rides`, `#movies` or `#personal` to force it. Replies with what's left today and this week. |
| `water 500` · `water 2` (litres) · `glass` | Adds water. |
| `steps 3000` · `steps set 6000` · `walk` | Adds steps / sets the total so far / ticks the 60-min gym walk. |
| `ate 3 eggs p20` | Logs a meal in the right slot for the time of day. `p20` = 20 g protein, `₹150` = outside-meal cost. |
| `task buy soap tomorrow` · `task pay rent !` | Adds a task (`!` = high priority, `today` / `tomorrow` set the date). |
| `done soap` · `done 2` · `tasks` | Completes the first matching task (or number 2 from the `tasks` list; auto tasks like rent get marked paid) / lists open ones. |
| `paid rent` · `paid bills` | Marks this month's rent / bills paid. They come from the money set aside at salary, so they are not counted as pocket spending. |
| `salary 25160` | Enters this month's salary and allocates it. |
| `debt 2000` | Logs a debt payment. |
| `today` | What you can spend today and this week, pool, water, steps, to-dos. |
| `undo` | Removes the last expense you logged (chat or by hand). Grocery checkouts and crisis entries are undone in the app. |

## Why not your own WhatsApp chat?
WhatsApp gives programs no way to read your personal chats, including "Message yourself". The only official way is a **separate bot number** that you chat with. Tools that log into your personal WhatsApp by QR code to read your messages exist, but they break WhatsApp's rules, can get your number banned, and need a computer logged in all the time. This bot deliberately doesn't do that. Using an `@` prefix inside the bot chat is optional, because everything sent to that chat is a command anyway.

## Option A: WhatsApp (Meta Cloud API)
Menus on Meta's site change; if a name below differs, look for the closest one in Meta's WhatsApp "Cloud API" quickstart.

1. **developers.facebook.com** → My Apps → Create app → type **Business** → add the **WhatsApp** product.
2. WhatsApp → **API Setup**. You'll see a free **test phone number** and its **Phone number ID**. In the "To" box add **your own number** and confirm it with the code WhatsApp sends.
3. Copy the **access token** from that page. The temporary one lasts about 24 hours; for a permanent one create a **System User** in Business Settings and generate a token with the `whatsapp_business_messaging` permission.
4. App settings → Basic → copy the **App secret**.
5. In **Render → your service → Environment** add:
   - `WHATSAPP_TOKEN` — the token
   - `WHATSAPP_PHONE_ID` — the Phone number ID
   - `WHATSAPP_APP_SECRET` — the App secret
   - `WHATSAPP_VERIFY_TOKEN` — any random word you invent (you'll type it again in step 6)
   - `WHATSAPP_ALLOWED` — your number, digits only with country code, e.g. `919876543210`
6. Meta → WhatsApp → **Configuration → Webhook**: Callback URL `https://YOUR-APP.onrender.com/webhook/whatsapp`, Verify token = the word from step 5, then **Verify and save**, and subscribe to the **messages** field.
7. From your phone, message the test number (Meta shows a link or number). Save it as **"Life OS"**. Send `help`.

## Option B: Telegram (simpler, no fees)
1. In Telegram open **@BotFather** → `/newbot` → copy the **token**.
2. Message **@userinfobot** to get your numeric **chat id**.
3. In Render add `TELEGRAM_TOKEN`, `TELEGRAM_SECRET` (any random string of letters and digits, 20+ characters) and `TELEGRAM_ALLOWED` (your chat id).
4. Register the webhook once by opening this in a browser (fill in the three values):
   `https://api.telegram.org/botTOKEN/setWebhook?url=https://YOUR-APP.onrender.com/webhook/telegram&secret_token=SECRET`
5. Open your bot in Telegram, press Start, send `help`.

## How it's protected
- A bot channel is **off** unless all of its values are set, and there's no endpoint at all until then.
- WhatsApp requests must carry Meta's **signature** (made with your App secret). Forged requests get `401`.
- Telegram requests must carry your **secret header**.
- Only the numbers/chat ids in the **allowlist** are answered. Everyone else is silently ignored.
- Meta retries deliveries, so each message id is applied only once.
- Tokens live only in Render's environment. Never put them in the code or in chat.

## Limits and costs
- You start every chat, so replies are normal free-form messages. Reminders the bot would start by itself need Meta-approved templates, which is why those use Claude scheduled tasks for now.
- Meta may charge per message; check [Meta's pricing page](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md) for India. Telegram is free.
- Free Render sleeps after ~15 minutes idle, so the first message after a quiet spell can take up to a minute to get a reply. WhatsApp retries for you.
- Fixed commands only for now. Free text like "gave 300 to rahul for lunch" would need a Claude API key (pay per use).
- The WhatsApp API version defaults to `v25.0` (`WHATSAPP_API_VERSION` overrides it). Meta retires old versions, so update it if replies stop working.

## Testing without Meta or Telegram
`cd server && npm run test:bot` runs a simulated chat and the webhook checks (signatures, allowlist, duplicates) with a fake database. It doesn't touch the internet.
