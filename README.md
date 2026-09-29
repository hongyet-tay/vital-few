# Vital Few

Find the 20% of tasks, questions and issues that drive 80% of your mission.

A mobile-first Progressive Web App (PWA): people open a link, tap "Add to Home Screen," and it works like an app, including offline. Missions are stored on each person's own device. The optional "Suggest items" feature uses Claude through a small serverless function, so your API key is never exposed.

## What's in this folder

```
public/                  The app itself (what people see)
  index.html             The whole app: capture, rate, focus
  manifest.webmanifest   Makes it installable
  sw.js                  Makes it open instantly and work offline
  icons/                 App icons
functions/api/suggest.js The only server code: calls Claude safely
wrangler.toml            Settings for running it on your computer (optional)
.dev.vars.example        Template for your local API key (optional)
```

No build step and no npm install. It's plain HTML and JavaScript.

---

## Deploy it (about 20 minutes, no coding)

### 1. Put the code on GitHub

1. Sign in at github.com and click **New repository**. Name it `vital-few`. Choose **Private** if you prefer. Leave "Add a README" unticked. Click **Create repository**.
2. On the next page, click **uploading an existing file**.
3. Drag in the *contents* of this folder (`public`, `functions`, `README.md`, `wrangler.toml`, `.gitignore`, `.dev.vars.example`). Keep the folder structure.
   Tip: files starting with a dot can be hidden on Mac. Press Cmd + Shift + . in Finder to show them. They're optional anyway.
4. Click **Commit changes**.

If you use git on the command line instead:
```bash
cd vital-few
git init && git add . && git commit -m "Vital Few PWA"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/vital-few.git
git push -u origin main
```

### 2. Get a Claude API key

1. Sign in to the Claude Console at platform.claude.com.
2. Add a payment method and buy a small amount of credit (US$5 goes a long way at about a quarter of a cent per suggestion).
3. **Set a monthly spend limit** in the billing or limits settings. This is your safety net.
4. Create an API key and copy it. Treat it like a password: never put it in the code or on GitHub.

### 3. Deploy on Cloudflare Pages (free)

1. Sign up at cloudflare.com, then go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick your `vital-few` repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. Click **Save and Deploy**. You'll get a link like `https://vital-few.pages.dev`.

The app works now. Next, switch on the AI suggestions:

5. In your Pages project, go to **Settings → Variables and secrets**. Add:
   - `ANTHROPIC_API_KEY` → your key, type **Secret**
   - `ALLOWED_ORIGIN` → your link, e.g. `https://vital-few.pages.dev` (no trailing slash)
6. Create the store for daily limits: **Workers & Pages → KV → Create namespace**, name it `vital-few-limits`.
7. Back in your Pages project: **Settings → Bindings → Add → KV namespace**. Variable name `RATE_LIMIT`, namespace `vital-few-limits`.
8. Go to **Deployments** and click **Retry deployment** on the latest one, so the new settings take effect.

Open your link, create a mission, and tap **Suggest items I might be missing**.

### Optional limits (same Variables page)

| Variable | Default | Meaning |
|---|---|---|
| `DAILY_LIMIT_PER_DEVICE` | 5 | Free suggestions per phone per day |
| `DAILY_LIMIT_PER_IP` | 20 | Per network per day (catches people resetting their device) |
| `DAILY_GLOBAL_LIMIT` | 500 | All users combined per day. At about US$0.0025 each, 500 is roughly US$1.25/day at most |
| `MODEL` | claude-haiku-4-5-20251001 | The Claude model used |

Limits reset at midnight UTC (8am in Malaysia).

---

## Share and install

Send people your link. To install:
- **iPhone (Safari):** Share button → **Add to Home Screen**
- **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**)

Nobody needs an account. Each person's missions stay on their own phone. They can move them with **Missions → Save backup / Restore backup**.

## Update the app

Edit files on GitHub (or push changes). Cloudflare redeploys automatically in about a minute.
When you change anything in `public/`, also bump the version in `public/sw.js` (`vital-few-v1` → `vital-few-v2`) so installed apps pick up the new version.

## Run it on your computer (optional)

Needs Node.js 18+.
```bash
cp .dev.vars.example .dev.vars   # then paste your API key into .dev.vars
npx wrangler pages dev public
```
Open http://localhost:8788. Rate limits are off locally unless you set up a KV namespace in `wrangler.toml`.

## How the 80/20 works

- **Impact** (Minor → Decisive) doubles each step: weights 1, 2, 4, 8, 16. "Blocks other items" multiplies by 1.5.
- **Effort** (Hours → Weeks): weights 1, 2, 3, 5, 8.
- **Leverage** = impact weight ÷ effort weight. Items are ranked by leverage.
- The **work sequence** lists items in that order until cumulative impact reaches 80%. The headline shows what share of your work that takes. If it's over 40%, the app suggests re-rating.

The logic lives in `analyze()`, `weight()` and `leverage()` near the top of the script in `public/index.html`.

## Roadmap ideas

- Dependencies between items ("can't start B until question A is answered")
- Weekly re-rate reminder
- Optional sign-in to sync across devices
