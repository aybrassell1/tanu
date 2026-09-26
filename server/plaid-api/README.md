# Tanu's Plaid pass-through

Plaid needs a secret that cannot live in a static app, so this one function
holds it. It stores nothing, logs nothing and has no database: requests go to
Plaid with the credentials attached and the answer comes straight back. Your
access token and your transactions live on your phone, not here.

## Deploy it (about five minutes, free)

1. **Plaid**: sign up at [dashboard.plaid.com](https://dashboard.plaid.com). Note
   your **client_id** and your **Sandbox secret** from Team Settings → Keys.
   Start in Sandbox — it uses fake banks, so nothing about your real money is at
   stake while we check the wiring. Request Production access when you're ready
   for real accounts; the Trial plan is free for up to 10 connected banks.

2. **A key for yourself**: make a long random string. This is what stops anyone
   else calling your function. On a Mac or in Git Bash:

   ```bash
   openssl rand -hex 32
   ```

3. **Vercel**: sign up at [vercel.com](https://vercel.com) with GitHub, then
   **Add New → Project** and pick the `tanu` repo. Before deploying, set
   **Root Directory** to `server/plaid-api` — otherwise it will try to build the
   whole app. Add these environment variables:

   | Name | Value |
   | --- | --- |
   | `PLAID_CLIENT_ID` | from Plaid |
   | `PLAID_SECRET` | your Sandbox (later Production) secret |
   | `PLAID_ENV` | `sandbox`, then `production` |
   | `APP_KEY` | the random string from step 2 |
   | `ALLOWED_ORIGINS` | `https://aybrassell1.github.io,http://localhost:3000` |

   Deploy. You'll get a URL like `https://tanu-plaid.vercel.app`.

4. **Tanu**: open **More → Connected accounts**, paste the URL and the key, and
   connect a bank. In Sandbox use username `user_good`, password `pass_good`.

## Going live

Switch `PLAID_SECRET` to your Production secret and `PLAID_ENV` to `production`,
redeploy, and reconnect your banks. Sandbox items don't carry over.

## Notifications when money moves (optional)

Skip this and everything else still works; the app will just catch up when you
open it. With it, Plaid tells this deployment a charge arrived and it tells your
phone, with the merchant and the amount.

**What this costs.** Everything above stores nothing. This does: one record per
bank, holding your Plaid access token so the server can read what the charge
was. It is encrypted with a key that lives in an environment variable, so the
database on its own is not enough — but it is a real change, and turning
notifications off in the app deletes the record.

1. **A place to keep it.** In Vercel, **Storage → Create → Upstash Redis** (free
   tier, and it doesn't sleep). Vercel adds `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` to the project for you.

2. **Keys.** Two more environment variables:

   ```bash
   # A 32-byte key for the token at rest
   openssl rand -base64 32

   # And the pair that identifies your server to the browser
   npx web-push generate-vapid-keys
   ```

   | Name | Value |
   | --- | --- |
   | `ENCRYPTION_KEY` | the base64 from the first command |
   | `VAPID_PUBLIC_KEY` | from the second |
   | `VAPID_PRIVATE_KEY` | from the second |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |

   `ENCRYPTION_KEY` and `VAPID_PRIVATE_KEY` are Secret; the public key is not.

3. **Tell Plaid where to call.** In the Plaid dashboard, set the webhook to
   `https://your-project.vercel.app/api/webhook`. Existing connections need
   reconnecting to pick it up; new ones get it automatically.

4. **In the app**, put `VAPID_PUBLIC_KEY` in the notification key field on the
   Connected accounts screen, then turn the switch on. **iOS only allows this
   from an app added to the home screen** — in a browser tab the switch says so
   and stays off.

Webhooks that are not signed by Plaid, are older than five minutes, or whose
body doesn't match the signature are dropped without a word.

## Checking it is alive

A plain GET says how it is configured, without a key and without calling Plaid:

```bash
curl https://your-project.vercel.app/api/plaid
```

It answers with the environment it would use and whether each variable is set —
names and yes/no, never a value. An env of production and three trues means the
server is ready.

## What it will and won't do

- Six Plaid calls, each with a fixed list of fields. Anything else in a request
  body is dropped before it reaches Plaid.
- Requests without the right `x-tanu-key`, or from an origin not in
  `ALLOWED_ORIGINS`, are refused.
- It never writes your data down. If this function disappeared tomorrow, your
  ledger would be exactly where it is: on your phone.
