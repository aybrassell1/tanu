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

## Checking it is alive

A plain GET says how it is configured, without a key and without calling Plaid:



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
