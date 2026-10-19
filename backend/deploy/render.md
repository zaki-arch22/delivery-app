# Free test server: Neon (database) + Firebase (Google login) + Render (server)

All three are free and need **no bank card**. This server is for TESTING with the owner and a few people, not for real customers
(launch needs a real server: CLAUDE.md section 9).

What you get: one web address, for example `https://delivery-api-xxxx.onrender.com`.
- the phone app talks to it;
- the staff console opens at the same address + `/staff/` (for approving drivers, opening zones, setting prices).

Free limits: after 15 minutes with nobody using it the server sleeps; the next person waits about 1 minute while it wakes.
The database holds up to about 1 GB. Road distances use the straight-line estimate (no OSRM on the free plan).

## 1. Neon: the database (about 3 minutes)
1. Go to https://neon.com and sign up (the "Continue with Google" or "Continue with GitHub" button is easiest).
2. Create a project: name `delivery`, region **AWS Europe Central 1 (Frankfurt)** (closest to Algiers, same place as the server). Keep the other choices.
3. On the project page press **Connect**. Copy the connection string (it starts with `postgresql://`). Keep it private: it is the key to the database.

## 2. Firebase: Google login (about 5 minutes)
1. Go to https://console.firebase.google.com and sign in with your Google account. **Create a project** named `delivery`. Google Analytics: turn it off. Plan: the free "Spark" plan.
2. Left menu: **Build -> Authentication -> Get started -> Sign-in method -> Google -> Enable**. Choose your email as the support email. **Save**.
3. Open Google again in that list, then **Web SDK configuration**. Copy the **Web client ID** (it ends in `.apps.googleusercontent.com`). Not secret.
4. Gear icon -> **Project settings -> General -> Your apps -> Android icon**:
   - Android package name: `dz.delivery.app`
   - App nickname: `Delivery`
   - Debug signing certificate SHA-1: `FB:15:52:C2:E6:1F:2E:F5:37:85:F1:5D:63:B5:BF:C7:25:FE:77:B2`
   - **Register app**, then **Download google-services.json**. Open the file and paste its content to Claude (it is not secret: it goes inside the app).

## 3. Render: the server (about 10 minutes, most of it waiting)
1. Go to https://render.com and sign up with **GitHub** (the account that owns `zaki-arch22/delivery-app`).
2. **New + -> Blueprint**. Connect the repository `zaki-arch22/delivery-app`. Branch: **`claude/wizardly-mayer-zl48ge`**.
3. Render reads the file `render.yaml` and asks for these values:
   - `OWNER_DATABASE_URL`: the Neon connection string from step 1.
   - `GOOGLE_CLIENT_IDS`: the Web client ID from step 2.
   - `FIRST_ADMIN_EMAIL`: your email (your staff login).
   - `FIRST_ADMIN_PASSWORD`: a NEW password of at least 12 characters, only for the staff console. Write it down.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: leave empty for now (phone notifications come later).
   Press **Apply**. The first build takes about 5 minutes.
4. When the service shows **Live**: open it, then **Logs**. Find the box `FIRST STAFF ACCOUNT CREATED`. Open the free
   **Google Authenticator** app on your phone, tap **+ -> Enter a setup key**, and type the secret shown in the box.
   That app now gives you the 6-digit staff code.
5. **Environment** tab: delete `FIRST_ADMIN_PASSWORD` and save (it is no longer needed; the account exists).
6. Copy the address shown at the top of the service page (`https://....onrender.com`) and send it to Claude.

## What Claude does next
Puts the address and the Google settings into the app, builds a new APK, and tells you how to open the first zone and set
the first prices in the staff console (until a zone is open, orders are refused: new zones start closed on purpose).

## Technical notes (for Claude / developers)
- `render.yaml` (repository root) is a Render Blueprint: one free Node web service in Frankfurt. Build: backend + staff console
  (`VITE_BASE=/staff/`). Start: `backend/deploy/render-start.sh` = migrations as the owner, refresh of the limited role
  `delivery_app` (password `APP_DB_PASSWORD`, made by Render), first staff account, then the server as the LIMITED role with
  the owner's address removed from its environment. Restarts are safe (tested on a database whose owner is not a superuser, like Neon).
- Neon's pooled address (`-pooler`) is replaced by the direct one automatically: live notifications need LISTEN.
- Photos are in the database (no disk on Render's free plan). Push stays off until `FIREBASE_SERVICE_ACCOUNT_JSON` is set.
- `TRUST_PROXY=1`: check on the live server that rate limits see the real client address (security log `ip` values).
